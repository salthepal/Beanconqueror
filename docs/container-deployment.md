# Container Deployment

## What Is Included

- Multi-stage Docker build.
- Angular production build served by Nginx.
- Bundled Node API proxied at `/api`.
- MariaDB-backed app storage.
- Local Gaggiuino API proxy/import endpoints.
- Runtime config templating with `envsubst` into `assets/env.js`.
- Session-cookie auth for same-origin browser calls and token auth for machine clients.
- Example `docker-compose.yml` binding host port `8080` to container port `8080`.

## Build And Run

```bash
docker compose up --build
```

Open `http://localhost:8080`.

Compose starts the app and MariaDB. MariaDB data persists in the `mariadb-data` named volume.

## Published Image

```bash
docker run --rm -p 8080:8080 \
  -e DB_HOST=mariadb \
  -e DB_NAME=beanconqueror \
  -e DB_USER=beanconqueror \
  -e DB_PASSWORD=change-me \
  -e SESSION_SIGNING_SECRET=replace-me \
  -e API_BASE_URL=/api \
  ghcr.io/salthepal/beanconqueror:latest
```

Use this with an existing MariaDB-compatible database.

## Unraid

Template: `unraid/beanconqueror.xml`.

Install a MariaDB container on the same server and set the Beanconqueror DB variables to match it:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

The Beanconqueror container does not need an app-data volume for normal use. Persistent data lives in MariaDB.

## Runtime Env Templating

At container start, `docker/entrypoint/start.sh` generates:

- template: `/tmp/env.template.js`
- output: `/usr/share/nginx/html/assets/env.js`

Supported browser config:

- `API_BASE_URL` defaults to `/api`
- `FEATURE_FLAGS_JSON` defaults to `{}`

Supported API config:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `CORS_ORIGINS`
- `API_CLIENT_TOKEN`
- `SESSION_SIGNING_SECRET`
- `GAGGIUINO_BASE_URL`
- `GAGGIUINO_TIMEOUT_MS`

The generated `assets/env.js` is loaded by `src/index.html` before app bootstrap.

`CORS_ORIGINS` is empty by default. Leave it empty for the bundled same-origin app. Set it only when a separate trusted origin must call the API.

## API Endpoints

Storage:

- `GET /api/storage`
- `GET /api/storage/:key`
- `PUT /api/storage/:key`
- `POST /api/storage/import`
- `DELETE /api/storage`

Gaggiuino:

- `GET /api/gaggiuino/status`
- `GET /api/gaggiuino/shots/latest`
- `GET /api/gaggiuino/shots/:id`
- `GET /api/gaggiuino/shots`
- `POST /api/gaggiuino/shots/import-latest`

All storage and Gaggiuino API endpoints require one of:
- valid `beanconqueror_session` cookie (same-origin browser session)
- `X-Beanconqueror-Client-Token`
- `Authorization: Bearer <API_CLIENT_TOKEN>`

## Backups

Scripts:
- `scripts/backup.sh`
- `scripts/restore.sh`

Optional scheduled backup container (example):

```yaml
backup:
  image: mariadb:11
  entrypoint: ["/bin/sh", "-c", "while true; do /scripts/backup.sh /backups; sleep 86400; done"]
```

## Gaggiuino Notes

Default:

```text
GAGGIUINO_BASE_URL=http://gaggiuino.local
```

If Docker cannot resolve mDNS, use a fixed LAN IP:

```text
GAGGIUINO_BASE_URL=http://192.168.1.50
```

Set a DHCP reservation for the Gaggiuino machine if using a LAN IP.

## Persistence Expectations

Beanconqueror user data is stored in MariaDB through the bundled API. Browser storage may still be used by app code as cache or migration staging, but it is not the intended source of truth when `API_BASE_URL=/api`.

If a user upgrades from browser-only storage, startup checks whether server storage is empty. When empty and existing browser data is present, that browser data is imported into MariaDB once.

Back up the MariaDB database or its volume as part of normal Unraid backup policy.
