// One-off for a database created with `db:push`, which has the tables but no migration history:
// records the migrations up to BASELINE_TAG as applied, so `db:migrate` only runs newer ones.
// Usage: npm run db:baseline (reads TURSO_URL / TURSO_AUTH_TOKEN; back up the database first).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export const MIGRATIONS_FOLDER = 'src/db/migrations';
const BASELINE_TAG = '0000_baseline';

export async function baselineMigrations(client: Client): Promise<number> {
    const hasTables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'");
    if (hasTables.rows.length === 0) {
        throw new Error('Database is empty: run db:migrate instead of a baseline');
    }

    // Same table drizzle's libsql migrator creates and reads
    await client.execute('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    const history = await client.execute('SELECT count(*) AS n FROM "__drizzle_migrations"');
    if (Number(history.rows[0].n) > 0) {
        throw new Error('Database already has migration history: nothing to baseline');
    }

    const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as { entries: { tag: string }[] };
    const count = journal.entries.findIndex((e) => e.tag === BASELINE_TAG) + 1;
    if (count === 0) throw new Error(`Migration ${BASELINE_TAG} not found in the journal`);

    // Hash and timestamp exactly as drizzle computes them when it applies a migration
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).slice(0, count);
    await client.batch(
        migrations.map((m) => ({
            sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
            args: [m.hash, m.folderMillis],
        })),
        'write'
    );
    return migrations.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const client = createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
    const n = await baselineMigrations(client);
    console.log(`[baseline] Marked ${n} migration(s) up to ${BASELINE_TAG} as applied`);
    client.close();
}
