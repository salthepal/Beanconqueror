function readInteger(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || '', 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function readCsv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function readBoolean(name, fallback = false) {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return fallback;
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'production',
  isDevelopment: (process.env.NODE_ENV || 'production') === 'development',
  port: readInteger('API_PORT', 3000),
  clientApiToken: process.env.API_CLIENT_TOKEN || '',
  sessionSigningSecret: process.env.SESSION_SIGNING_SECRET || '',
  sessionTtlSeconds: readInteger('SESSION_TTL_SECONDS', 3600),
  allowLegacyTokenAuth: readBoolean('ALLOW_LEGACY_TOKEN_AUTH', true),
  requestBodyLimitBytes: readInteger('REQUEST_BODY_LIMIT_BYTES', 1024 * 1024),
  rateLimitWindowMs: readInteger('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMaxMutations: readInteger('RATE_LIMIT_MAX_MUTATIONS', 120),
  metricsEnabled: readBoolean('METRICS_ENABLED', true),
  idempotencyTtlSeconds: readInteger('IDEMPOTENCY_TTL_SECONDS', 3600),
  corsOrigins: readCsv('CORS_ORIGINS'),
  db: {
    host: process.env.DB_HOST || 'mariadb',
    port: readInteger('DB_PORT', 3306),
    database: process.env.DB_NAME || 'beanconqueror',
    user: process.env.DB_USER || 'beanconqueror',
    password: process.env.DB_PASSWORD || 'beanconqueror',
  },
  gaggiuino: {
    baseUrl: process.env.GAGGIUINO_BASE_URL || 'http://gaggiuino.local',
    timeoutMs: readInteger('GAGGIUINO_TIMEOUT_MS', 5000),
    autoSyncEnabled: readBoolean('GAGGIUINO_AUTOSYNC_ENABLED', false),
    autoSyncIntervalMs: readInteger('GAGGIUINO_AUTOSYNC_INTERVAL_MS', 30000),
    autoSyncMaxBackoffMs: readInteger(
      'GAGGIUINO_AUTOSYNC_MAX_BACKOFF_MS',
      300000,
    ),
    autoSyncBatchSize: readInteger('GAGGIUINO_AUTOSYNC_BATCH_SIZE', 10),
    autoSyncInitialImportCount: readInteger(
      'GAGGIUINO_AUTOSYNC_INITIAL_IMPORT_COUNT',
      6,
    ),
  },
};

module.exports = { config };
