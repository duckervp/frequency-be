import { describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { baselineMigrations, MIGRATIONS_FOLDER } from '../src/db/baseline.js';

// vitest.db is built from src/db/schema.ts (drizzle-kit export), the same way db:push built production
const FROM_SCHEMA = 'file:./test/.tmp/vitest.db';

/** Tables, columns, indexes and foreign keys, comparable between two databases */
async function schemaOf(client: Client) {
    const out: Record<string, unknown> = {};
    const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
    );
    for (const { name } of tables.rows) {
        const indexes = [];
        for (const idx of (await client.execute(`PRAGMA index_list(${name})`)).rows.filter((r) => r.origin !== 'pk')) {
            const cols = (await client.execute(`PRAGMA index_info(${idx.name})`)).rows.map((r) => r.name);
            indexes.push(`${idx.name}${idx.unique ? ' unique' : ''} (${cols.join(',')})`);
        }
        out[String(name)] = {
            columns: (await client.execute(`PRAGMA table_info(${name})`)).rows.map((r) => [r.name, r.type, r.notnull, r.dflt_value, r.pk].join('|')),
            indexes: indexes.sort(),
            fks: (await client.execute(`PRAGMA foreign_key_list(${name})`)).rows.map((r) => [r.from, r.table, r.to, r.on_delete].join('|')).sort(),
        };
    }
    return out;
}

function freshDb(name: string) {
    const path = `./test/.tmp/${name}.db`;
    rmSync(path, { force: true });
    return createClient({ url: `file:${path}` });
}

async function migrationRows(client: Client) {
    return (await client.execute('SELECT hash, created_at FROM __drizzle_migrations')).rows.length;
}

describe('migrations', () => {
    it('build the same schema as src/db/schema.ts (run db:generate after changing the schema)', async () => {
        const migrated = freshDb('migrated');
        await migrate(drizzle(migrated), { migrationsFolder: MIGRATIONS_FOLDER });
        const fromSchema = createClient({ url: FROM_SCHEMA });
        expect(await schemaOf(migrated)).toEqual(await schemaOf(fromSchema));
        migrated.close();
        fromSchema.close();
    });

    it('baseline marks a db:push database as migrated, so db:migrate runs nothing again', async () => {
        const pushed = freshDb('pushed');
        // Same tables as production: build them with the migrations, then drop the history
        await migrate(drizzle(pushed), { migrationsFolder: MIGRATIONS_FOLDER });
        await pushed.execute('DROP TABLE __drizzle_migrations');

        await baselineMigrations(pushed);
        expect(await migrationRows(pushed)).toBe(1);
        await migrate(drizzle(pushed), { migrationsFolder: MIGRATIONS_FOLDER });
        expect(await migrationRows(pushed)).toBe(1);
        pushed.close();
    });

    it('baseline refuses an empty database and one that already has history', async () => {
        const empty = freshDb('empty');
        await expect(baselineMigrations(empty)).rejects.toThrow(/empty/i);
        empty.close();

        const migrated = freshDb('migrated-twice');
        await migrate(drizzle(migrated), { migrationsFolder: MIGRATIONS_FOLDER });
        await expect(baselineMigrations(migrated)).rejects.toThrow(/already/i);
        migrated.close();
    });
});
