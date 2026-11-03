import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db.js';

async function plan(query: ReturnType<typeof sql>) {
    const rows = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`);
    return rows.map((r) => r.detail).join(' | ');
}

describe('indexes', () => {
    it('log range queries use the (user_id, logged_at) index instead of scanning every user', async () => {
        const detail = await plan(sql`
            SELECT * FROM action_logs
            WHERE user_id = 'u' AND logged_at >= '2026-10-31T17:00:00.000Z' AND logged_at < '2026-11-30T17:00:00.000Z'
            ORDER BY logged_at DESC, created_at DESC`);
        expect(detail).toContain('USING INDEX action_logs_user_logged_at_idx');
        expect(detail).not.toMatch(/SCAN action_logs/);
    });

    it('clearing action_id when an action is deleted does not scan every log', async () => {
        const detail = await plan(sql`UPDATE action_logs SET action_id = NULL WHERE action_id = 'a'`);
        expect(detail).toMatch(/USING (COVERING )?INDEX action_logs_action_id_idx/);
    });

    it('listing actions uses the user_id index', async () => {
        const detail = await plan(sql`SELECT * FROM actions WHERE user_id = 'u'`);
        expect(detail).toContain('USING INDEX actions_user_id_idx');
    });
});
