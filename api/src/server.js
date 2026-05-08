const crypto = require('crypto');
const http = require('http');

const {
  getConfig: getAiAnalysisConfig,
  getLatestSnapshot,
  getSnapshotHistory,
  getStatus: getAiAnalysisStatus,
  runAnalysis,
  setConfig: setAiAnalysisConfig,
} = require('./ai-analysis');
const {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  issueSessionToken,
  verifySessionToken,
} = require('./auth');
const { config } = require('./config');
const { checkDatabaseReady, migrate } = require('./db');
const {
  GaggiuinoConnectionError,
  getAutoSyncState,
  getGaggiuinoSettings,
  getLatestShotId,
  getSavedShots,
  getShot,
  getStatus,
  importLatestShots,
  saveShot,
  syncNewShotsSinceLast,
  syncShotsToBrews,
  updateAutoSyncState,
  updateGaggiuinoSettings,
} = require('./gaggiuino-client');
const {
  HttpError,
  applyCors,
  parseCookies,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
} = require('./http');
const { RateLimiter } = require('./rate-limit');
const {
  getIdempotencyEntry,
  pruneIdempotencyEntries,
  saveIdempotencyEntry,
} = require('./idempotency-store');
const {
  clearStorage,
  getAllStorage,
  getStorageValue,
  importStorage,
  setStorageValue,
} = require('./storage-repository');
const {
  validateAiAnalysisConfig,
  validateGaggiuinoConfig,
  validateImportLatestRequest,
  validateStorageImport,
  validateStoragePut,
} = require('./validation');

const metrics = {
  requestCount: 0,
  errorCount: 0,
  syncSuccessCount: 0,
  syncFailureCount: 0,
  aiRunSuccessCount: 0,
  aiRunFailureCount: 0,
  routeLatencyBuckets: {
    lt100ms: 0,
    lt500ms: 0,
    lt1000ms: 0,
    gte1000ms: 0,
  },
};

const limiter = new RateLimiter(
  config.rateLimitWindowMs,
  config.rateLimitMaxMutations,
);

function log(level, message, data = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  console.log(JSON.stringify(payload));
}

function getStorageKey(pathname) {
  const prefix = '/api/storage/';
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  return decodeURIComponent(pathname.substring(prefix.length));
}

function isMutation(method) {
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
}

function isAuthorized(request) {
  const appearsBrowser = Boolean(request.headers.origin);
  const cookies = parseCookies(request);
  const sessionToken = cookies[SESSION_COOKIE_NAME];

  if (config.sessionSigningSecret && verifySessionToken(sessionToken, config.sessionSigningSecret)) {
    return true;
  }

  if (!config.clientApiToken) {
    return false;
  }

  const headerToken = request.headers['x-beanconqueror-client-token'];
  if (headerToken === config.clientApiToken) {
    return true;
  }

  const legacyHeaderToken = request.headers['x-beanconqueror-api-token'];
  if (legacyHeaderToken === config.clientApiToken && config.allowLegacyTokenAuth) {
    if (appearsBrowser) {
      log('warn', 'legacy_auth_rejected_for_browser');
      return false;
    }
    log('warn', 'legacy_api_token_header_used');
    return true;
  }

  const authorization = request.headers.authorization || '';
  if (authorization === `Bearer ${config.clientApiToken}` && config.allowLegacyTokenAuth) {
    if (appearsBrowser) {
      log('warn', 'legacy_bearer_auth_rejected_for_browser');
      return false;
    }
    log('warn', 'legacy_bearer_auth_used');
    return true;
  }
  return false;
}

function maybeIssueSessionCookie(request, response) {
  if (!config.sessionSigningSecret) {
    return;
  }

  const cookies = parseCookies(request);
  if (cookies[SESSION_COOKIE_NAME]) {
    return;
  }

  const token = issueSessionToken(config.sessionSigningSecret, config.sessionTtlSeconds);
  response.setHeader('Set-Cookie', buildSessionCookie(token, config.sessionTtlSeconds));
}

function getRateLimitKey(request) {
  const clientToken = request.headers['x-beanconqueror-client-token'];
  if (clientToken) {
    return `token:${clientToken}`;
  }

  const cookies = parseCookies(request);
  const sessionToken = cookies[SESSION_COOKIE_NAME];
  if (sessionToken) {
    const digest = crypto.createHash('sha256').update(sessionToken).digest('hex');
    return `session:${digest}`;
  }

  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) {
    return `ip:${forwarded}`;
  }

  return `ip:${request.socket.remoteAddress || 'unknown'}`;
}

function enforceRateLimit(request) {
  if (!isMutation(request.method)) {
    return;
  }

  const key = getRateLimitKey(request);
  const result = limiter.hit(key);
  if (!result.allowed) {
    throw new HttpError(429, 'rate_limited', 'Too many requests');
  }
}

function getIdempotencyKey(request) {
  if (!isMutation(request.method)) {
    return null;
  }
  const raw = request.headers['idempotency-key'];
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  return `${request.method}:${request.url}:${raw}`;
}

function replayIdempotentResponse(response, cacheEntry) {
  sendJson(response, cacheEntry.status, cacheEntry.payload);
}

async function saveIdempotentResponse(idempotencyKey, status, payload) {
  if (!idempotencyKey) {
    return;
  }
  await saveIdempotencyEntry(
    idempotencyKey,
    status,
    payload,
    config.idempotencyTtlSeconds,
  );
}

async function handleStorage(request, response, url) {
  if (url.pathname === '/api/storage' && request.method === 'GET') {
    return { handled: true, payload: await getAllStorage(), status: 200 };
  }

  if (url.pathname === '/api/storage/import' && request.method === 'POST') {
    const body = await readJson(request, config.requestBodyLimitBytes);
    validateStorageImport(body);
    await importStorage(body);
    return { handled: true, payload: {}, status: 204 };
  }

  if (url.pathname === '/api/storage' && request.method === 'DELETE') {
    await clearStorage();
    return { handled: true, payload: {}, status: 204 };
  }

  const key = getStorageKey(url.pathname);
  if (!key) {
    return { handled: false };
  }

  if (request.method === 'GET') {
    const value = await getStorageValue(key);
    if (value === undefined) {
      throw new HttpError(404, 'not_found', 'Storage key not found');
    }

    return { handled: true, payload: { key, value }, status: 200 };
  }

  if (request.method === 'PUT') {
    const body = await readJson(request, config.requestBodyLimitBytes);
    validateStoragePut(body);
    await setStorageValue(
      key,
      Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : body,
    );
    return { handled: true, payload: {}, status: 204 };
  }

  return { handled: false };
}

async function handleGaggiuino(request, response, url) {
  if (url.pathname === '/api/gaggiuino/autosync-status' && request.method === 'GET') {
    sendJson(response, 200, await getAutoSyncState());
    return true;
  }

  if (url.pathname === '/api/gaggiuino/autosync-sync-now' && request.method === 'POST') {
    const result = await syncNewShotsSinceLast({
      maxShotsPerRun: config.gaggiuino.autoSyncBatchSize,
      initialImportCount: config.gaggiuino.autoSyncInitialImportCount,
    });
    metrics.syncSuccessCount += 1;
    sendJson(response, 200, {
      result: {
        imported: result.imported.length,
        sync: result.sync,
        latestShotId: result.latestShotId,
        lastSyncedShotId: result.lastSyncedShotId,
      },
      status: await getAutoSyncState(),
    });
    return true;
  }

  if (url.pathname === '/api/gaggiuino/config' && request.method === 'GET') {
    sendJson(response, 200, await getGaggiuinoSettings());
    return true;
  }

  if (url.pathname === '/api/gaggiuino/config' && request.method === 'PUT') {
    const body = await readJson(request, config.requestBodyLimitBytes);
    validateGaggiuinoConfig(body);
    sendJson(response, 200, await updateGaggiuinoSettings(body));
    return true;
  }

  if (url.pathname === '/api/gaggiuino/status' && request.method === 'GET') {
    const status = await getStatus();
    if (!status) {
      throw new HttpError(404, 'not_found', 'Gaggiuino status not found');
    }
    sendJson(response, 200, status);
    return true;
  }

  if (url.pathname === '/api/gaggiuino/shots/latest' && request.method === 'GET') {
    sendJson(response, 200, { lastShotId: await getLatestShotId() });
    return true;
  }

  if (url.pathname === '/api/gaggiuino/shots' && request.method === 'GET') {
    sendJson(response, 200, { shots: await getSavedShots() });
    return true;
  }

  if (url.pathname === '/api/gaggiuino/shots/import-latest' && request.method === 'POST') {
    const body = await readJson(request, config.requestBodyLimitBytes);
    validateImportLatestRequest(body);
    sendJson(response, 200, await importLatestShots(body.count, {
      syncToBrews: body.syncToBrews !== false,
    }));
    return true;
  }

  if (url.pathname === '/api/gaggiuino/shots/sync-saved' && request.method === 'POST') {
    const savedShots = await getSavedShots();
    const sync = await syncShotsToBrews(
      savedShots.map((shot) => ({ id: shot.id, rawData: shot.rawData })),
    );
    metrics.syncSuccessCount += 1;
    sendJson(response, 200, { sync });
    return true;
  }

  const match = url.pathname.match(/^\/api\/gaggiuino\/shots\/(\d+)$/);
  if (match && request.method === 'GET') {
    const id = Number(match[1]);
    const shot = await getShot(id);
    if (!shot) {
      throw new HttpError(404, 'not_found', 'Shot not found');
    }

    await saveShot(id, shot);
    sendJson(response, 200, shot);
    return true;
  }

  return false;
}

async function handleAiAnalysis(request, response, url) {
  if (url.pathname === '/api/ai-analysis/status' && request.method === 'GET') {
    sendJson(response, 200, await getAiAnalysisStatus());
    return true;
  }

  if (url.pathname === '/api/ai-analysis/latest' && request.method === 'GET') {
    sendJson(response, 200, { snapshot: await getLatestSnapshot() });
    return true;
  }

  if (url.pathname === '/api/ai-analysis/history' && request.method === 'GET') {
    const page = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('pageSize') || 10);
    sendJson(response, 200, await getSnapshotHistory(page, pageSize));
    return true;
  }

  if (url.pathname === '/api/ai-analysis/run-now' && request.method === 'POST') {
    const snapshot = await runAnalysis();
    metrics.aiRunSuccessCount += 1;
    sendJson(response, 200, { snapshot });
    return true;
  }

  if (url.pathname === '/api/ai-analysis/config' && request.method === 'GET') {
    sendJson(response, 200, await getAiAnalysisConfig());
    return true;
  }

  if (url.pathname === '/api/ai-analysis/config' && request.method === 'PUT') {
    const body = await readJson(request, config.requestBodyLimitBytes);
    validateAiAnalysisConfig(body);
    sendJson(response, 200, await setAiAnalysisConfig(body));
    return true;
  }

  return false;
}

async function handleOperationalRoutes(request, response, url) {
  if (url.pathname === '/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/ready' && request.method === 'GET') {
    const dbReady = await checkDatabaseReady().catch(() => false);
    sendJson(response, dbReady ? 200 : 503, { ok: dbReady });
    return true;
  }

  if (url.pathname === '/api/status' && request.method === 'GET') {
    const dbReady = await checkDatabaseReady().catch(() => false);
    sendJson(response, 200, {
      dbReady,
      autoSync: await getAutoSyncState(),
      aiAnalysis: await getAiAnalysisStatus(),
      metrics,
    });
    return true;
  }

  if (url.pathname === '/metrics' && request.method === 'GET' && config.metricsEnabled) {
    sendJson(response, 200, metrics);
    return true;
  }

  return false;
}

async function handlePublicOperationalRoutes(request, response, url) {
  if (url.pathname === '/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/ready' && request.method === 'GET') {
    const dbReady = await checkDatabaseReady().catch(() => false);
    sendJson(response, dbReady ? 200 : 503, { ok: dbReady });
    return true;
  }

  return false;
}

async function route(request, response) {
  metrics.requestCount += 1;
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  response.setHeader('X-Request-Id', requestId);
  applyCors(request, response, config.corsOrigins);

  try {
    if (request.method === 'OPTIONS') {
      sendNoContent(response);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (await handlePublicOperationalRoutes(request, response, url)) {
      return;
    }

    if (!isAuthorized(request)) {
      throw new HttpError(401, 'unauthorized', 'Authentication required');
    }
    maybeIssueSessionCookie(request, response);

    if (await handleOperationalRoutes(request, response, url)) {
      return;
    }

    enforceRateLimit(request);
    const idempotencyKey = getIdempotencyKey(request);
    const cached = idempotencyKey ? await getIdempotencyEntry(idempotencyKey) : null;
    if (cached) {
      replayIdempotentResponse(response, cached);
      return;
    }

    const storageResult = await handleStorage(request, response, url);
    if (storageResult.handled) {
      if (storageResult.status === 204) {
        sendNoContent(response);
      } else {
        sendJson(response, storageResult.status, storageResult.payload);
      }
      await saveIdempotentResponse(
        idempotencyKey,
        storageResult.status,
        storageResult.payload,
      );
      return;
    }

    try {
      if (await handleGaggiuino(request, response, url)) {
        return;
      }
      if (await handleAiAnalysis(request, response, url)) {
        return;
      }
    } catch (error) {
      if (error instanceof GaggiuinoConnectionError) {
        metrics.syncFailureCount += 1;
        throw new HttpError(503, 'gaggiuino_unavailable', error.message);
      }

      throw error;
    }

    throw new HttpError(404, 'not_found', 'Endpoint not found');
  } catch (error) {
    metrics.errorCount += 1;
    if (error instanceof HttpError) {
      sendError(response, error.status, error.code, error.message, requestId);
    } else {
      sendError(response, 500, 'internal_error', 'Internal server error', requestId);
      log('error', 'Unhandled API error', {
        requestId,
        errorMessage: error.message,
      });
    }
  } finally {
    const latencyMs = Date.now() - startedAt;
    if (latencyMs < 100) {
      metrics.routeLatencyBuckets.lt100ms += 1;
    } else if (latencyMs < 500) {
      metrics.routeLatencyBuckets.lt500ms += 1;
    } else if (latencyMs < 1000) {
      metrics.routeLatencyBuckets.lt1000ms += 1;
    } else {
      metrics.routeLatencyBuckets.gte1000ms += 1;
    }
    log('info', 'request_complete', {
      requestId,
      method: request.method,
      path: request.url,
      status: response.statusCode,
      latencyMs,
    });
  }
}

function clampInterval(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1000, parsed);
}

function startGaggiuinoAutoSyncMonitor() {
  let timer = null;
  let running = false;

  const schedule = (delayMs) => {
    if (timer) clearTimeout(timer);
    const delay = clampInterval(delayMs, config.gaggiuino.autoSyncIntervalMs);
    timer = setTimeout(runTick, delay);
    updateAutoSyncState({
      enabled: true,
      running,
      nextPollInMs: delay,
    }).catch((err) => console.error('Failed to update auto-sync state:', err));
  };

  const runTick = async () => {
    if (running) {
      schedule(config.gaggiuino.autoSyncIntervalMs);
      return;
    }

    running = true;
    const checkedAt = new Date().toISOString();
    await updateAutoSyncState({
      enabled: true,
      running: true,
      lastCheckedAt: checkedAt,
    }).catch((err) => console.error('Failed to update auto-sync state:', err));

    let nextDelay = config.gaggiuino.autoSyncIntervalMs;
    try {
      const settings = await getGaggiuinoSettings();
      if (!settings.autoSyncEnabled) {
        await updateAutoSyncState({
          enabled: false,
          online: null,
          running: false,
          consecutiveFailures: 0,
          lastError: '',
          nextPollInMs: config.gaggiuino.autoSyncIntervalMs,
        }).catch((err) => console.error('Failed to update auto-sync state:', err));
        nextDelay = config.gaggiuino.autoSyncIntervalMs;
        return;
      }

      const result = await syncNewShotsSinceLast({
        maxShotsPerRun: config.gaggiuino.autoSyncBatchSize,
        initialImportCount: config.gaggiuino.autoSyncInitialImportCount,
      });
      metrics.syncSuccessCount += 1;
      await updateAutoSyncState({
        enabled: true,
        online: true,
        running: false,
        lastSuccessAt: new Date().toISOString(),
        lastError: '',
        lastImportedCount: result.imported.length,
        lastSyncSummary: result.sync,
      }).catch((err) => console.error('Failed to update auto-sync state:', err));
      nextDelay = config.gaggiuino.autoSyncIntervalMs;
    } catch (error) {
      metrics.syncFailureCount += 1;
      await updateAutoSyncState({
        enabled: true,
        online: false,
        running: false,
        lastError: error?.message || String(error),
      }).catch((err) => console.error('Failed to update auto-sync state:', err));
      nextDelay = config.gaggiuino.autoSyncMaxBackoffMs;
    } finally {
      running = false;
      schedule(nextDelay);
    }
  };

  schedule(2000);
}

function startAiAnalysisMonitor() {
  let timer = null;
  let running = false;

  const schedule = async (delayMs) => {
    if (timer) clearTimeout(timer);
    const aiConfig = await getAiAnalysisConfig();
    const cadenceMs = clampInterval(
      aiConfig.cadenceHours * 60 * 60 * 1000,
      24 * 60 * 60 * 1000,
    );
    const delay = clampInterval(delayMs, cadenceMs);
    timer = setTimeout(runTick, delay);
  };

  const runTick = async () => {
    if (running) {
      schedule(60 * 1000).catch((err) => console.error('AI analysis schedule error:', err));
      return;
    }

    running = true;
    let nextDelay = 24 * 60 * 60 * 1000;
    try {
      const aiConfig = await getAiAnalysisConfig();
      const status = await getAiAnalysisStatus();
      nextDelay = clampInterval(
        aiConfig.cadenceHours * 60 * 60 * 1000,
        24 * 60 * 60 * 1000,
      );
      if (!aiConfig.enabled) {
        return;
      }

      const lastRunAt = status.lastRunAt ? new Date(status.lastRunAt).getTime() : 0;
      if (lastRunAt > 0 && Date.now() - lastRunAt < nextDelay) {
        return;
      }

      await runAnalysis();
      metrics.aiRunSuccessCount += 1;
    } catch (_error) {
      metrics.aiRunFailureCount += 1;
      nextDelay = Math.min(6 * 60 * 60 * 1000, nextDelay * 2);
    } finally {
      running = false;
      schedule(nextDelay).catch((err) => console.error('AI analysis schedule error:', err));
    }
  };

  schedule(10 * 1000).catch((err) => console.error('AI analysis schedule error:', err));
}

async function start() {
  await migrate();
  const settings = await getGaggiuinoSettings();
  await updateAutoSyncState({ enabled: settings.autoSyncEnabled, running: false }).catch(
    (err) => console.error('Failed to initialize auto-sync state:', err),
  );

  const server = http.createServer((request, response) => {
    route(request, response).catch((error) => {
      log('error', 'request_handler_failed', {
        errorMessage: error?.message || String(error),
      });
      sendError(
        response,
        500,
        'internal_error',
        'Internal server error',
        crypto.randomUUID(),
      );
    });
  });

  server.listen(config.port, () => {
    log('info', 'server_started', { port: config.port, env: config.nodeEnv });
    startGaggiuinoAutoSyncMonitor();
    startAiAnalysisMonitor();
    setInterval(() => {
      pruneIdempotencyEntries().catch(() => {});
    }, 15 * 60 * 1000);
  });
}

start().catch((error) => {
  log('error', 'server_start_failed', { message: error.message });
  process.exit(1);
});
