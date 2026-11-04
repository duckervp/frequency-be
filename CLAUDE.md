# frequency-be

Hono REST API for Frequency, Drizzle ORM on Turso (libsql). Deployed to Vercel. See `../CLAUDE.md` for how it fits with the clients.

## Commands

- Dev: `npm run dev` — runs `src/server.ts` with `--watch`, loads `.env`, listens on `PORT` (default 3001)
- Verify: `npx tsc --noEmit -p .` and `npm test` — both must pass before any commit
- Smoke test: `curl http://localhost:3001/api/health` → `{"ok":true}`

## Tests

- `npm test` — Vitest API tests in `test/*.test.ts`. They call the Hono app in-process (`test/helpers.ts` → `api()`, `newUser()`), against a fresh SQLite file `test/.tmp/vitest.db`.
- `npm run test:server` — resets `test/.tmp/e2e.db` and starts the BE on **:3101** for the web app's Playwright e2e. Config comes from `.env.test` (committed, no secrets).
- Test DB safety: `test/test-env.mjs` and `test/reset-db.ts` refuse any `TURSO_URL` that is not `file:` — tests can never reach Turso. Keep those guards.
- `src/lib/db.ts` uses `@libsql/client/web` (cannot open `file:`). Tests redirect it to `@libsql/client` via the Vitest alias / `test-env.mjs` loader hook — do not change the production import for tests.
- Schema for test DBs is generated from `src/db/schema.ts` via `drizzle-kit export`, so schema changes apply to tests automatically.
- Every bug fix gets a test that fails before the fix and passes after it.

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
- Schema changes go through migrations: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `src/db/migrations/`, then `npm run db:migrate` against Turso (back up first, see the runbooks in `../frequency/docs/runbooks/`). `test/migrations.test.ts` fails if the schema and the migrations drift apart. Production was created with `db:push` and baselined at `0000_baseline` with `npm run db:baseline` (one-off; it refuses to run twice). Do not use `db:push` on the real DB any more.
- `npx drizzle-kit export` prints the schema as SQL without touching the DB or repo — use it to sanity-check `drizzle.config.ts`.
- `.env` points at the **same Turso database as production** (same host as the Vercel env). Local testing writes real data — ask before running `db:push`/`db:migrate`, bulk writes, or deleting anything.
- Google OAuth only works on the deployed BE (redirect URI). Test locally with email + password.
- Request/response shapes are defined in `src/api-types.ts` (no imports: clients copy it). After changing them run `npm run sync:api-types` in `../frequency` in the same task; mobile's `api.ts` is updated when the feature is synced. `src/api-types.check.ts` ties the contract to the schema.
