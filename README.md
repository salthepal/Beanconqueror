# Beanconqueror (Docker + Gaggiuino Edition)

[![license](https://img.shields.io/badge/license-GPL%203.0-brightgreen.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)

Beanconqueror packaged for local/self-hosted use with:

- browser UI (Angular/Ionic)
- bundled API in same container
- persistent MariaDB storage
- direct Gaggiuino integration (import, sync, autosync monitor)

Primary target: Unraid + local network espresso setup.

Disclaimer: this distribution is a vibe-coded app.

## What this build changes

- Data stored in MariaDB, not browser localStorage as primary source.
- Container stays stateless; database handles persistence.
- Gaggiuino routes proxied server-side by bundled API.
- Optional autosync for new Gaggiuino shots.
- Scheduled AI shot analysis with cached recommendations.

## New features included

### Security + reliability

- Session-cookie auth path for browser traffic with short-lived signed session token.
- Machine-client auth via `X-Beanconqueror-Client-Token`.
- Legacy token auth path gated and deprecation-ready.
- Request body size cap and stricter write-endpoint validation.
- Mutation route rate limiting.
- Idempotency-key replay protection persisted in MariaDB (`api_idempotency`), not memory only.
- Consistent API error shape: `code`, `message`, `requestId`.
- Production startup fails on known weak DB/root defaults.

### API + ops endpoints

- `GET /health` basic liveness.
- `GET /ready` DB readiness check.
- `GET /api/status` consolidated ops status:
  - DB connectivity
  - autosync monitor state
  - AI analysis monitor state
  - API counters/metrics
- Optional `GET /metrics` endpoint for counters/latency buckets.

### Container/runtime hardening

- Runtime runs as non-root user.
- Explicit healthcheck + readiness flow.
- Compose split with safe defaults + override example.
- `.env.example` with required vars.

### Backup/restore safety

- `scripts/backup.sh` creates timestamped compressed dumps.
- Backup checksum file generated when hash tool exists.
- `scripts/restore.sh --dry-run` validates backup stream before restore.
- Restore verifies checksum when present.

### CI + security gates

- CI workflow for lint/build/tests plus API tests.
- Container smoke checks in CI:
  - app health
  - storage import
  - AI run-now
  - Gaggiuino sync-now behavior
- Dependency audits (`npm audit` / `pnpm audit`) and container image scanning.

### Frontend feature upgrades

- Home Beans:
  - quick segmented filters (`All`, `Favorites`, `Recent`, `Running Low`)
  - quick actions (`Add`, `Import`, `Scan`)
  - density modes (`Comfort`, `Compact`, `Ultra`)
  - configurable low-bean threshold
  - selection mode + multi-select bulk actions (`Favorite`, `Freeze`, `Archive`) with destructive confirms
- Brew detail:
  - compare modal for current shot vs previous shot with delta metrics and flow profile cards
- Gaggiuino page:
  - sync-now action
  - richer autosync health details (last check, consecutive failures, reason)
- Statistics:
  - brew presets (`All`, `Dial-in`, `New Bag`, `Gaggiuino`)
  - new KPI cards (extraction time, consistency score, ratio)
  - apply AI recommendation to next brew controls
- Removed in-app v8.6 “What’s New” popup surfacing.

## Quick start (local)

```bash
docker compose up --build -d
```

Open:

```text
http://localhost:8080
```

Services:

- `beanconqueror`: web UI + API
- `mariadb`: MariaDB 11
- `mariadb-data`: persistent Docker volume

## Environment variables

### Web/API

- `API_BASE_URL` (default `/api`)
- `API_CLIENT_TOKEN` (optional; for machine clients)
- `SESSION_SIGNING_SECRET` (required in production)
- `SESSION_TTL_SECONDS` (default `3600`)
- `ALLOW_LEGACY_TOKEN_AUTH` (default `true`)
- `FEATURE_FLAGS_JSON` (optional JSON string)
- `CORS_ORIGINS` (comma-separated origins; default same-origin only)
- `TAILSCALE_HOSTNAMES` (comma-separated `*.ts.net` hostnames; API derives HTTPS CORS origins)
- `TAILSCALE_ALLOW_HTTP` (`true|false`, default `false`; only enable if you intentionally use plain HTTP over tailnet)
- `REQUEST_BODY_LIMIT_BYTES` (default `1048576`)
- `RATE_LIMIT_WINDOW_MS` (default `60000`)
- `RATE_LIMIT_MAX_MUTATIONS` (default `120`)
- `IDEMPOTENCY_TTL_SECONDS` (default `3600`)
- `METRICS_ENABLED` (`true|false`, default `true`)

### Database

- `DB_HOST` (default `mariadb`)
- `DB_PORT` (default `3306`)
- `DB_NAME` (default `beanconqueror`)
- `DB_USER` (default `beanconqueror`)
- `DB_PASSWORD` (required)

### Gaggiuino

- `GAGGIUINO_BASE_URL` (example `http://gaggiuino.local` or LAN IP)
- `GAGGIUINO_TIMEOUT_MS` (default `5000`)
- `GAGGIUINO_AUTOSYNC_ENABLED` (`true|false`)
- `GAGGIUINO_AUTOSYNC_INTERVAL_MS` (default `30000`)
- `GAGGIUINO_AUTOSYNC_MAX_BACKOFF_MS` (default `300000`)
- `GAGGIUINO_AUTOSYNC_BATCH_SIZE` (default `10`)
- `GAGGIUINO_AUTOSYNC_INITIAL_IMPORT_COUNT` (default `6`)

### AI analysis

- Configure provider in `Settings > AI`.
- Required for cloud AI calls: `provider`, `api key`, `model`.
- Optional scheduled analysis settings:
  - cadence hours
  - snapshot retention count
  - statistics visibility
- Analysis outputs cached in MariaDB:
  - `AI_ANALYSIS_CONFIG`
  - `AI_ANALYSIS_STATUS`
  - `AI_ANALYSIS_SNAPSHOTS`

## Gaggiuino workflow

1. Configure `GAGGIUINO_BASE_URL` in container env.
2. Open app `Gaggiuino` page.
3. Pull shot history from Gaggiuino API.
4. Cache/imported shots stored in MariaDB.
5. Sync to brews creates/updates Beanconqueror brew records.
6. Optional autosync polls incrementally and syncs new shots.

Dashboard and Gaggiuino page expose autosync status + manual sync-now action.

## AI statistics workflow

1. Open `Settings > AI` and configure provider/key/model.
2. Enable schedule (or run manually).
3. Open `Statistics > AI Analysis`.
4. Review:
   - health + last run
   - ranked recommendations
   - evidence metrics
   - snapshot history and rating deltas

## Unraid

Template file:

```text
unraid/beanconqueror.xml
```

Run MariaDB container on same host/network, then map:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Default web port mapping:

- container `8080`
- host `8080`

## Persistence + backup

- Back up MariaDB database/volume (`mariadb-data`).
- App container can be recreated safely.
- Mobile exports still importable.

## Development

Requirements:

- Node.js `>=22`
- pnpm `>=10.26.0`
- Docker Desktop

Install:

```bash
pnpm install
```

Frontend dev:

```bash
pnpm start
```

Build:

```bash
pnpm run build
```

Local full stack:

```powershell
scripts/local-stack.ps1 up
```

More details:

- [docs/local-testing.md](docs/local-testing.md)
- [docs/container-deployment.md](docs/container-deployment.md)
- [.env.example](.env.example)

## Tailscale compatibility

No hardcoded tailnet IP needed.

Set in `.env`:

- `TAILSCALE_HOSTNAMES=your-node-name.ts.net`
- keep `TAILSCALE_ALLOW_HTTP=false` unless you require plain HTTP

API will auto-allow matching Tailscale origins for CORS.

## Container publishing

Workflow:

```text
.github/workflows/container-image.yml
```

- PRs build image
- branch/tag/manual can publish to GHCR
- `latest` tag only from default branch

## License

GPL-3.0. See [LICENSE](LICENSE).
