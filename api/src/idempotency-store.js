const { getPool } = require('./db');

async function getIdempotencyEntry(idempotencyKey) {
  const [rows] = await getPool().query(
    `SELECT response_status, response_payload
     FROM api_idempotency
     WHERE idempotency_key = ? AND expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [idempotencyKey],
  );
  if (!rows || rows.length === 0) {
    return null;
  }

  return {
    status: Number(rows[0].response_status),
    payload: rows[0].response_payload,
  };
}

async function saveIdempotencyEntry(idempotencyKey, status, payload, ttlSeconds) {
  await getPool().query(
    `INSERT INTO api_idempotency (idempotency_key, response_status, response_payload, expires_at)
     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE
       response_status = VALUES(response_status),
       response_payload = VALUES(response_payload),
       expires_at = VALUES(expires_at)`,
    [idempotencyKey, status, JSON.stringify(payload || {}), ttlSeconds],
  );
}

async function pruneIdempotencyEntries() {
  await getPool().query(
    'DELETE FROM api_idempotency WHERE expires_at <= UTC_TIMESTAMP()',
  );
}

module.exports = {
  getIdempotencyEntry,
  pruneIdempotencyEntries,
  saveIdempotencyEntry,
};

