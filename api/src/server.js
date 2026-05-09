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
const { checkDatabaseReady, getPool, migrate } = require('./db');
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
  getCookie,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
} = require('./http');
const { DbRateLimiter, RateLimiter } = require('./rate-limit');
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
  unauthorizedCount: 0,
  rateLimitedCount: 0,
  idempotencyReplayCount: 0,
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

const limiter = config.rateLimitBackend === 'db'
  ? new DbRateLimiter(
    config.rateLimitWindowMs,
    config.rateLimitMaxMutations,
    getPool,
  )
  : new RateLimiter(config.rateLimitWindowMs, config.rateLimitMaxMutations);
let isReady = false;
let isShuttingDown = false;
let serverRef = null;

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

function getClientFingerprint(request) {
  const source = `${request.headers['user-agent'] || ''}|${request.socket.remoteAddress || ''}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function getAuthMode(request) {
  const appearsBrowser = Boolean(request.headers.origin);
  const sessionToken = getCookie(request, SESSION_COOKIE_NAME);
  const clientFingerprint = config.sessionBindClientFingerprint
    ? getClientFingerprint(request)
    : '';

  if (config.sessionSigningSecret && verifySessionToken(sessionToken, config.sessionSigningSecret, clientFingerprint)) {
    return 'session';
  }
  if (config.sessionPreviousSigningSecret
    && verifySessionToken(sessionToken, config.sessionPreviousSigningSecret, clientFingerprint)) {
    return 'session-rotated';
  }

  if (!config.clientApiToken) {
    return null;
  }

  const headerToken = request.headers['x-beanconqueror-client-token'];
  if (headerToken === config.clientApiToken) {
    return 'client-token';
  }

  const legacyHeaderToken = request.headers['x-beanconqueror-api-token'];
  if (legacyHeaderToken === config.clientApiToken && config.allowLegacyTokenAuth) {
    if (appearsBrowser) {
      log('warn', 'legacy_auth_rejected_for_browser');
      return false;
    }
    log('warn', 'legacy_api_token_header_used', {
      removalDate: config.legacyTokenAuthRemovalDate,
    });
    return 'legacy-header-token';
  }

  const authorization = request.headers.authorization || '';
  if (authorization === `Bearer ${config.clientApiToken}` && config.allowLegacyTokenAuth) {
    if (appearsBrowser) {
      log('warn', 'legacy_bearer_auth_rejected_for_browser');
      return false;
    }
    log('warn', 'legacy_bearer_auth_used', {
      removalDate: config.legacyTokenAuthRemovalDate,
    });
    return 'legacy-bearer';
  }
  return null;
}

function maybeIssueSessionCookie(request, response) {
  if (!config.sessionSigningSecret) {
    return;
  }

  if (getCookie(request, SESSION_COOKIE_NAME)) {
    return;
  }

  const clientFingerprint = config.sessionBindClientFingerprint
    ? getClientFingerprint(request)
    : '';
  const token = issueSessionToken(
    config.sessionSigningSecret,
    config.sessionTtlSeconds,
    clientFingerprint,
  );
  response.setHeader('Set-Cookie', buildSessionCookie(token, config.sessionTtlSeconds));
}

function getRateLimitKey(request) {
  const clientToken = request.headers['x-beanconqueror-client-token'];
  if (clientToken) {
    return `token:${clientToken}`;
  }

  const sessionToken = getCookie(request, SESSION_COOKIE_NAME);
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

async function enforceRateLimit(request) {
  if (!isMutation(request.method)) {
    return;
  }

  const key = getRateLimitKey(request);
  const result = await limiter.hit(key);
  if (!result.allowed) {
    metrics.rateLimitedCount += 1;
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

function getIdempotencyRequestHash(request) {
  const raw = request.headers['x-idempotency-body-sha256'];
  if (!raw || typeof raw !== 'string') {
    return '';
  }
  return raw.trim().toLowerCase();
}

function replayIdempotentResponse(response, cacheEntry) {
  if (cacheEntry.status === 204) {
    sendNoContent(response);
    return;
  }
  sendJson(response, cacheEntry.status, cacheEntry.payload);
}

async function saveIdempotentResponse(idempotencyKey, requestHash, status, payload) {
  if (!idempotencyKey) {
    return;
  }
  await saveIdempotencyEntry(
    idempotencyKey,
    requestHash,
    status,
    payload,
    config.idempotencyTtlSeconds,
  );
}

async function readValidatedJson(request, validator) {
  const body = await readJson(request, config.requestBodyLimitBytes);
  validator(body);
  return body;
}

async function handleStorage(request, response, url) {
  if (url.pathname === '/api/storage' && request.method === 'GET') {
    return { handled: true, payload: await getAllStorage(), status: 200 };
  }

  if (url.pathname === '/api/storage/import' && request.method === 'POST') {
    const body = await readValidatedJson(request, validateStorageImport);
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
    const body = await readValidatedJson(request, validateStoragePut);
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
    const body = await readValidatedJson(request, validateGaggiuinoConfig);
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
    const body = await readValidatedJson(request, validateImportLatestRequest);
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
    const body = await readValidatedJson(request, validateAiAnalysisConfig);
    sendJson(response, 200, await setAiAnalysisConfig(body));
    return true;
  }

  return false;
}

async function handleOperationalRoutes(request, response, url) {
  if (url.pathname === '/api/status' && request.method === 'GET') {
    const dbReady = await checkDatabaseReady().catch(() => false);
    sendJson(response, 200, {
      dbReady,
      autoSync: await getAutoSyncState(),
      aiAnalysis: await getAiAnalysisStatus(),
      metrics,
      ready: isReady && !isShuttingDown,
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
    const ready = dbReady && isReady && !isShuttingDown;
    sendJson(response, ready ? 200 : 503, { ok: ready, dbReady, isShuttingDown });
    return true;
  }

  return false;
}

async function route(request, response) {
  metrics.requestCount += 1;
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let authMode = 'none';
  let idempotencyHit = false;
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

    authMode = getAuthMode(request) || 'none';
    if (authMode === 'none') {
      metrics.unauthorizedCount += 1;
      throw new HttpError(401, 'unauthorized', 'Authentication required');
    }
    maybeIssueSessionCookie(request, response);

    if (await handleOperationalRoutes(request, response, url)) {
      return;
    }

    await enforceRateLimit(request);
    const idempotencyKey = getIdempotencyKey(request);
    const idempotencyRequestHash = getIdempotencyRequestHash(request);
    const cached = idempotencyKey ? await getIdempotencyEntry(idempotencyKey) : null;
    if (cached) {
      if (idempotencyRequestHash && cached.requestHash && cached.requestHash !== idempotencyRequestHash) {
        throw new HttpError(
          409,
          'idempotency_conflict',
          'Idempotency key reused with different payload hash',
        );
      }
      metrics.idempotencyReplayCount += 1;
      idempotencyHit = true;
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
        idempotencyRequestHash,
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
      authMode,
      idempotencyHit,
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
  let breakerState = 'closed';
  let consecutiveFailures = 0;

  const schedule = (delayMs) => {
    if (timer) clearTimeout(timer);
    const delay = clampInterval(delayMs, config.gaggiuino.autoSyncIntervalMs);
    timer = setTimeout(runTick, delay);
    updateAutoSyncState({
      enabled: true,
      running,
      nextPollInMs: delay,
      breakerState,
      consecutiveFailures,
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
          breakerState: 'closed',
          nextPollInMs: config.gaggiuino.autoSyncIntervalMs,
        }).catch((err) => console.error('Failed to update auto-sync state:', err));
        breakerState = 'closed';
        consecutiveFailures = 0;
        nextDelay = config.gaggiuino.autoSyncIntervalMs;
        return;
      }

      const result = await syncNewShotsSinceLast({
        maxShotsPerRun: config.gaggiuino.autoSyncBatchSize,
        initialImportCount: config.gaggiuino.autoSyncInitialImportCount,
      });
      metrics.syncSuccessCount += 1;
      consecutiveFailures = 0;
      breakerState = breakerState === 'open' ? 'half-open' : 'closed';
      await updateAutoSyncState({
        enabled: true,
        online: true,
        running: false,
        lastSuccessAt: new Date().toISOString(),
        lastError: '',
        lastImportedCount: result.imported.length,
        lastSyncSummary: result.sync,
        breakerState,
        consecutiveFailures,
      }).catch((err) => console.error('Failed to update auto-sync state:', err));
      nextDelay = config.gaggiuino.autoSyncIntervalMs;
    } catch (error) {
      metrics.syncFailureCount += 1;
      consecutiveFailures += 1;
      breakerState = consecutiveFailures >= 3 ? 'open' : 'closed';
      await updateAutoSyncState({
        enabled: true,
        online: false,
        running: false,
        lastError: error?.message || String(error),
        breakerState,
        consecutiveFailures,
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
  isReady = true;
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
  serverRef = server;

  server.listen(config.port, () => {
    log('info', 'server_started', { port: config.port, env: config.nodeEnv });
    startGaggiuinoAutoSyncMonitor();
    startAiAnalysisMonitor();
    setInterval(() => {
      pruneIdempotencyEntries().catch(() => {});
    }, 15 * 60 * 1000);
  });
}

function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const timeout = setTimeout(() => {
    process.exit(0);
  }, config.gracefulShutdownTimeoutMs);

  if (serverRef) {
    serverRef.close(() => {
      clearTimeout(timeout);
      process.exit(0);
    });
    return;
  }
  clearTimeout(timeout);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((error) => {
  log('error', 'server_start_failed', { message: error.message });
  process.exit(1);
});
