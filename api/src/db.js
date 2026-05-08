const mysql = require('mysql2/promise');

const { config } = require('./config');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      decimalNumbers: true,
      namedPlaceholders: true,
    });
  }

  return pool;
}

async function waitForDatabase() {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < 60000) {
    try {
      const connection = await getPool().getConnection();
      connection.release();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw lastError;
}

async function migrate() {
  await waitForDatabase();
  const migrationLockName = 'beanconqueror:migrate:v1';
  const [[lockRow]] = await getPool().query(
    'SELECT GET_LOCK(?, 30) AS acquired',
    [migrationLockName],
  );
  if (!lockRow || lockRow.acquired !== 1) {
    throw new Error('Could not acquire migration lock');
  }

  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS app_storage (
        storage_key VARCHAR(191) NOT NULL PRIMARY KEY,
        storage_value JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS gaggiuino_shots (
        shot_id INT NOT NULL PRIMARY KEY,
        shot_timestamp BIGINT NULL,
        profile_name VARCHAR(255) NULL,
        raw_data JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS api_idempotency (
        idempotency_key VARCHAR(255) NOT NULL PRIMARY KEY,
        response_status INT NOT NULL,
        response_payload JSON NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } finally {
    await getPool().query('SELECT RELEASE_LOCK(?)', [migrationLockName]);
  }
}

async function checkDatabaseReady() {
  const [[result]] = await getPool().query('SELECT 1 AS ok');
  return Boolean(result && result.ok === 1);
}

module.exports = { checkDatabaseReady, getPool, migrate };
