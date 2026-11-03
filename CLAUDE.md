# frequency-be

Hono REST API for Frequency, Drizzle ORM on Turso (libsql). Deployed to Vercel. See `../CLAUDE.md` for how it fits with the clients.

## Commands

- Dev: `npm run dev` — runs `src/server.ts` with `--watch`, loads `.env`, listens on `PORT` (default 3001)
- Verify: `npx tsc --noEmit -p .` — must pass before any commit (there are no tests yet)
- Smoke test: `curl http://localhost:3001/api/health` → `{"ok":true}`

## Layout

- `src/index.ts` — Hono app, `basePath('/api')`, CORS (`ALLOWED_ORIGINS`), mounts routes. Vercel entry.
- `src/server.ts` — local Node server only.
- `src/routes/` — `auth.ts` (register, login, Google OAuth, `/me`), `actions.ts` (CRUD), `logs.ts` (CRUD + stats)
- `src/middleware/auth.ts` — JWT Bearer middleware
- `src/db/schema.ts` — tables `users`, `actions`, `action_logs`
- `src/lib/` — `db.ts` (Turso client), `jwt.ts`, `id.ts` (nanoid)

## Conventions

- ESM with `.js` extensions in relative imports (`./routes/auth.js`), even from `.ts` files.
- Routes are `Hono` instances exported as `xxxRoutes` and mounted in `src/index.ts`.
- IDs come from `src/lib/id.ts`, never auto-increment.
- Protected routes use the auth middleware; scope every query by the authenticated user's id.

## Gotchas

- `.env` is local dev; `.env.local` was pulled by the Vercel CLI and may hold **production** values. Both are secret — never read values out loud or commit them.
- No migration history exists: the DB was created with `db:push`. The first `db:generate` will emit a `0000` migration with `CREATE TABLE` for tables that already exist — never `db:migrate` that against the real DB. Prefer `db:push` (after reviewing the diff) or baseline the migrations first.
- `npx drizzle-kit export` prints the schema as SQL without touching the DB or repo — use it to sanity-check `drizzle.config.ts`.
- `.env` points at the **same Turso database as production** (same host as the Vercel env). Local testing writes real data — ask before running `db:push`/`db:migrate`, bulk writes, or deleting anything.
- Google OAuth only works on the deployed BE (redirect URI). Test locally with email + password.
- After changing a route's request/response shape, update `../frequency/src/lib/api.ts` (web) in the same task; mobile's `api.ts` is updated when the feature is synced.
