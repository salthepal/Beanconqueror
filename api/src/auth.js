const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'beanconqueror_session';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function issueSessionToken(secret, ttlSeconds) {
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const [encodedPayload, signature] = parts;
  const expected = sign(encodedPayload, secret);
  if (signature.length !== expected.length) {
    return false;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (_error) {
    return false;
  }

  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    return false;
  }

  return true;
}

function buildSessionCookie(token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax; ${secure}`.trim();
}

module.exports = {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  issueSessionToken,
  verifySessionToken,
};
