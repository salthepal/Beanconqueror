# Beanconqueror (Docker + Gaggiuino Edition)

[![license](https://img.shields.io/badge/license-GPL%203.0-brightgreen.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)

Self-hosted Beanconqueror build with:
- Angular/Ionic web app
- bundled Node API in same container
- MariaDB-backed persistence
- Gaggiuino import/sync/autosync integration

Primary target: local/home-lab and Unraid deployments.

Disclaimer: this distribution is a vibe-coded app.

## Core changes in this fork

### 1) Persistence + deployment model
- Primary app data moved from browser local storage to MariaDB.
- Containerized runtime remains stateless; DB is source of truth.
- Runtime config injected via `assets/env.js` from container env.

### 2) Security + reliability hardening
- Browser auth: short-lived signed session cookie.
- Machine auth: `X-Beanconqueror-Client-Token`.
- Legacy token paths isolated and gated.
- Request protections: body size limits, schema validation, mutation rate limiting, idempotency replay controls.
- Standard API errors: `code`, `message`, `requestId`.
- Production startup fails on weak default DB credentials.
- Graceful shutdown/readiness behavior added.

### 3) Ops + observability
- Health/status endpoints:
  - `GET /health`
  - `GET /ready`
  - `GET /api/status` (DB + autosync + AI + counters)
  - optional `GET /metrics`
- Structured API logging and request IDs.
- Backup/restore scripts:
  - `scripts/backup.sh` (retention support)
  - `scripts/restore.sh` (`--dry-run`, `--verify-only`)

### 4) Gaggiuino + AI workflow
- Server-side Gaggiuino sync/import pipeline.
- Autosync monitor with richer state and failure tracking.
- AI analysis run-now + scheduled snapshots + history/status endpoints.

### 5) UX changes shipped recently
- Beans page:
  - quick filters/actions, compact modes, bulk actions
  - working `Scan` action in browser mode (manual paste fallback) and mobile scanner path
  - stale-data warning when server sync/storage path is degraded
- Brew defaults:
  - default bean priority now: `settings.default_bean` (if valid) -> newest open bean
  - grinder setting field available on brew entry
  - grinder setting defaults from last brew
- Statistics:
  - presets + added KPI cards + stale-data warning
- Navigation:
  - removed bottom “About Beanconqueror” menu entry
- Removed v8.6 “What’s New” in-app popup surfacing.

## Quick start

```bash
docker compose up --build -d
```

Open: `http://localhost:8080`

Services:
- `beanconqueror` (web + API)
- `mariadb` (DB)

## Required environment

Minimum important variables:
- `API_BASE_URL` (default `/api`)
- `API_CLIENT_TOKEN` (for machine clients)
- `SESSION_SIGNING_SECRET` (required outside development)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `GAGGIUINO_BASE_URL` (if using Gaggiuino integration)

Reference: [`.env.example`](.env.example)

## Tailscale compatibility

No hardcoded tailnet IP required.

Use:
- `TAILSCALE_HOSTNAMES=your-node.ts.net`
- keep `TAILSCALE_ALLOW_HTTP=false` unless intentionally using plain HTTP

## Development

Requirements:
- Node.js `>=22`
- pnpm `>=10.26.0`
- Docker Desktop

```bash
pnpm install
pnpm run build
```

Local stack helper:

```powershell
scripts/local-stack.ps1 up
```

Additional docs:
- [docs/local-testing.md](docs/local-testing.md)
- [docs/container-deployment.md](docs/container-deployment.md)

## License

GPL-3.0. See [LICENSE](LICENSE).
