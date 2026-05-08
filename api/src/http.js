class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function sendNoContent(response, headers = {}) {
  response.writeHead(204, headers);
  response.end();
}

function sendError(response, status, code, message, requestId) {
  sendJson(response, status, { code, message, requestId });
}

function readJson(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    request.on('data', (chunk) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length > maxBytes) {
        reject(new HttpError(413, 'payload_too_large', 'Request body too large'));
        request.destroy();
      }
    });

    request.on('end', () => {
      if (length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new HttpError(400, 'invalid_json', 'Invalid JSON payload'));
      }
    });

    request.on('error', reject);
  });
}

function parseCookies(request) {
  const header = request.headers.cookie || '';
  if (!header) {
    return {};
  }

  return header.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index <= 0) {
      return acc;
    }

    const key = pair.substring(0, index).trim();
    const value = pair.substring(index + 1).trim();
    try {
      acc[key] = decodeURIComponent(value);
    } catch (_error) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,DELETE,OPTIONS',
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Beanconqueror-Client-Token, Idempotency-Key',
  );
}

module.exports = {
  HttpError,
  applyCors,
  parseCookies,
  readJson,
  sendError,
  sendJson,
  sendNoContent,
};
