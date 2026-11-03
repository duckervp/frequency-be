// Preloaded with `node --import ./test/test-env.mjs` for the e2e test server.
//
// 1. Safety guard: refuse to start unless TURSO_URL is a local SQLite file,
//    so tests can never write to the real (production) Turso database.
// 2. src/lib/db.ts imports `@libsql/client/web`, which cannot open `file:` URLs.
//    For tests only, redirect that import to the Node client, which can.
import { register } from 'node:module';

const url = process.env.TURSO_URL ?? '';
if (!url.startsWith('file:')) {
    console.error(`[test-env] Refusing to start: TURSO_URL must be a file: URL in tests, got "${url.split('://')[0] || '(empty)'}://..."`);
    process.exit(1);
}

register(
    'data:text/javascript,' +
        encodeURIComponent(`
export async function resolve(specifier, context, next) {
    if (specifier === '@libsql/client/web') return next('@libsql/client', context);
    return next(specifier, context);
}`),
    import.meta.url
);
