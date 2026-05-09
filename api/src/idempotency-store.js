const { getPool } = require('./db');

async function getIdempotencyEntry(idempotencyKey) {
  const [rows] = await getPool().query(
    `SELECT request_hash, response_status, response_payload
     FROM api_idempotency
     WHERE idempotency_key = ? AND expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [idempotencyKey],
  );
  if (!rows || rows.length === 0) {
    return null;
  }

  return {
    requestHash: rows[0].request_hash || '',
    status: Number(rows[0].response_status),
    payload: rows[0].response_payload,
  };
}

async function saveIdempotencyEntry(idempotencyKey, requestHash, status, payload, ttlSeconds) {
  await getPool().query(
    `INSERT INTO api_idempotency (idempotency_key, request_hash, response_status, response_payload, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE
       expires_at = expires_at`,
    [idempotencyKey, requestHash || '', status, JSON.stringify(payload || {}), ttlSeconds],
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
