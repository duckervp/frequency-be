// Recreates a local SQLite test database from the current Drizzle schema.
// Usage: `tsx test/reset-db.ts` (reads TURSO_URL from the environment).
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

export async function resetTestDb(url = process.env.TURSO_URL ?? '') {
    if (!url.startsWith('file:')) {
        throw new Error('resetTestDb: TURSO_URL must be a local file: URL — refusing to touch a remote database');
    }

    const path = url.slice('file:'.length);
    mkdirSync(dirname(path), { recursive: true });
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });

    // `drizzle-kit export` prints CREATE statements from src/db/schema.ts without connecting to any DB.
    const sql = execSync('npx drizzle-kit export', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const ddl = sql.slice(sql.indexOf('CREATE'));

    const client = createClient({ url });
    await client.executeMultiple(ddl.replaceAll('--> statement-breakpoint', ''));
    client.close();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await resetTestDb();
    console.log(`[reset-db] Fresh test DB at ${process.env.TURSO_URL}`);
}
