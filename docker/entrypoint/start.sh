#!/bin/sh
set -eu

export API_BASE_URL="${API_BASE_URL:-/api}"
export API_PORT="${API_PORT:-3000}"
if [ -z "${FEATURE_FLAGS_JSON:-}" ]; then
  FEATURE_FLAGS_JSON='{}'
fi
export FEATURE_FLAGS_JSON

if [ -z "${SESSION_SIGNING_SECRET:-}" ]; then
  SESSION_SIGNING_SECRET="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
fi
export SESSION_SIGNING_SECRET

if [ "${NODE_ENV:-production}" != "development" ]; then
  if [ "${DB_PASSWORD:-}" = "beanconqueror" ] || [ "${MARIADB_ROOT_PASSWORD:-}" = "change-me" ]; then
    echo "Refusing insecure default DB credentials outside development."
    exit 1
  fi
fi

envsubst < /tmp/env.template.js > /usr/share/nginx/html/assets/env.js

node /app/api/src/server.js &
api_pid="$!"

nginx -g 'pid /tmp/nginx.pid; daemon off;' &
nginx_pid="$!"

terminate() {
  kill "$api_pid" "$nginx_pid" 2>/dev/null || true
  wait "$api_pid" "$nginx_pid" 2>/dev/null || true
}

trap 'terminate; exit 143' TERM INT

set +e
wait -n "$api_pid" "$nginx_pid"
status="$?"
terminate
exit "$status"
