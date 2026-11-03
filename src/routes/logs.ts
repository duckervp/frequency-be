import { Hono } from 'hono';
import { eq, and, gte, lt, sql } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { actionLogs, actions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { genId } from '../lib/id.js';

export const logRoutes = new Hono();

logRoutes.use('*', authMiddleware);

/**
 * Parses ?from=&to= (ISO instants, e.g. a local day's midnight-to-midnight computed by the client)
 * into normalized UTC ISO strings comparable with stored loggedAt values.
 * Returns null when neither is given, 'invalid' when either is missing, not ISO with Z/offset, or from >= to.
 * Note: a raw '+' in an offset is decoded as a space — clients must URL-encode it (or send Z).
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseRange(from?: string, to?: string): { from: string; to: string } | null | 'invalid' {
    if (from === undefined && to === undefined) return null;
    if (!from || !to || !ISO_INSTANT.test(from) || !ISO_INSTANT.test(to)) return 'invalid';
    const f = new Date(from);
    const t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f >= t) return 'invalid';
    return { from: f.toISOString(), to: t.toISOString() };
}

const INVALID_RANGE = { error: 'from and to must both be valid ISO dates, with from < to' };

// ── GET /api/logs ─────────────────────────────────────────────────────────────
// Query params:
//   ?from=ISO&to=ISO  → logs with from <= loggedAt < to (clients send their local day's bounds)
//   ?date=YYYY-MM-DD  → logs for that calendar day (UTC) — legacy, kept for older clients
//   ?last24h=true     → logs in the last 24 hours
// Returns log rows joined with action metadata.
logRoutes.get('/', async (c) => {
    const userId = c.get('userId');
    const date = c.req.query('date');
    const last24h = c.req.query('last24h') === 'true';
    const range = parseRange(c.req.query('from'), c.req.query('to'));
    if (range === 'invalid') return c.json(INVALID_RANGE, 400);

    let rows;

    if (range) {
        rows = await db
            .select({ log: actionLogs, action: actions })
            .from(actionLogs)
            .leftJoin(actions, eq(actionLogs.actionId, actions.id))
            .where(
                and(
                    eq(actionLogs.userId, userId),
                    gte(actionLogs.loggedAt, range.from),
                    lt(actionLogs.loggedAt, range.to)
                )
            )
            .all();
    } else if (date) {
        // e.g. date=2025-10-14  → filter loggedAt LIKE '2025-10-14%'
        rows = await db
            .select({
                log: actionLogs,
                action: actions,
            })
            .from(actionLogs)
            .leftJoin(actions, eq(actionLogs.actionId, actions.id))
            .where(
                and(
                    eq(actionLogs.userId, userId),
                    sql`${actionLogs.loggedAt} LIKE ${date + '%'}`
                )
            )
            .all();
    } else if (last24h) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        rows = await db
            .select({ log: actionLogs, action: actions })
            .from(actionLogs)
            .leftJoin(actions, eq(actionLogs.actionId, actions.id))
            .where(and(eq(actionLogs.userId, userId), gte(actionLogs.loggedAt, since)))
            .all();
    } else {
        rows = await db
            .select({ log: actionLogs, action: actions })
            .from(actionLogs)
            .leftJoin(actions, eq(actionLogs.actionId, actions.id))
            .where(eq(actionLogs.userId, userId))
            .all();
    }

    return c.json(rows);
});

// ── GET /api/logs/stats ───────────────────────────────────────────────────────
// Query params:
//   ?from=ISO&to=ISO  → bounds of the client's local "today"; without them, today is the UTC day (legacy)
logRoutes.get('/stats', async (c) => {
    const userId = c.get('userId');
    const range = parseRange(c.req.query('from'), c.req.query('to'));
    if (range === 'invalid') return c.json(INVALID_RANGE, 400);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const todayFilter = range
        ? and(gte(actionLogs.loggedAt, range.from), lt(actionLogs.loggedAt, range.to))
        : sql`${actionLogs.loggedAt} LIKE ${today + '%'}`;

    const todayCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(actionLogs)
        .where(and(eq(actionLogs.userId, userId), todayFilter))
        .get();

    return c.json({
        totalToday: todayCount?.count ?? 0,
        dateInfo: `Today, ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    });
});

// ── GET /api/logs/:id ─────────────────────────────────────────────────────────
logRoutes.get('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');

    const row = await db
        .select({ log: actionLogs, action: actions })
        .from(actionLogs)
        .leftJoin(actions, eq(actionLogs.actionId, actions.id))
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)))
        .get();

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
});

// ── POST /api/logs ────────────────────────────────────────────────────────────
logRoutes.post('/', async (c) => {
    const userId = c.get('userId');
    const { actionId, loggedAt, note } = await c.req.json<{
        actionId?: string;
        loggedAt: string; // ISO-8601
        note?: string;
    }>();

    if (!loggedAt) return c.json({ error: 'loggedAt is required' }, 400);

    const id = genId();
    await db.insert(actionLogs).values({
        id,
        userId,
        actionId: actionId ?? null,
        loggedAt,
        note: note ?? '',
    });

    const row = await db
        .select({ log: actionLogs, action: actions })
        .from(actionLogs)
        .leftJoin(actions, eq(actionLogs.actionId, actions.id))
        .where(eq(actionLogs.id, id))
        .get();

    return c.json(row, 201);
});

// ── PUT /api/logs/:id ─────────────────────────────────────────────────────────
logRoutes.put('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const { loggedAt, note } = await c.req.json<{
        loggedAt?: string;
        note?: string;
    }>();

    const existing = await db
        .select()
        .from(actionLogs)
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updated = {
        ...(loggedAt !== undefined && { loggedAt }),
        ...(note !== undefined && { note }),
    };

    await db
        .update(actionLogs)
        .set(updated)
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)));

    const row = await db
        .select({ log: actionLogs, action: actions })
        .from(actionLogs)
        .leftJoin(actions, eq(actionLogs.actionId, actions.id))
        .where(eq(actionLogs.id, id))
        .get();

    return c.json(row);
});

// ── DELETE /api/logs/:id ──────────────────────────────────────────────────────
logRoutes.delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');

    const existing = await db
        .select()
        .from(actionLogs)
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    await db
        .delete(actionLogs)
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)));

    return c.json({ success: true });
});
