import { Hono } from 'hono';
import { eq, and, gte, lt, sql, desc, type SQL } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { actionLogs, actions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { genId } from '../lib/id.js';
import * as v from '../lib/validate.js';

export const logRoutes = new Hono();

logRoutes.use('*', authMiddleware);

/**
 * Parses ?from=&to= (ISO instants, e.g. a local day's midnight-to-midnight computed by the client)
 * into normalized UTC ISO strings comparable with stored loggedAt values.
 * Returns null when neither is given, 'invalid' when either is missing, not ISO with Z/offset, or from >= to.
 * Note: a raw '+' in an offset is decoded as a space — clients must URL-encode it (or send Z).
 */
function parseRange(from?: string, to?: string): { from: string; to: string } | null | 'invalid' {
    if (from === undefined && to === undefined) return null;
    if (!v.isIsoInstant(from) || !v.isIsoInstant(to)) return 'invalid';
    const f = new Date(from);
    const t = new Date(to);
    if (f >= t) return 'invalid';
    return { from: f.toISOString(), to: t.toISOString() };
}

const INVALID_RANGE = { error: 'from and to must both be valid ISO dates, with from < to' };

// Newest first; createdAt breaks ties between logs with the same loggedAt
const NEWEST_FIRST = [desc(actionLogs.loggedAt), desc(actionLogs.createdAt)];

/** Logs joined with their action. The join only matches the log owner's actions, so a foreign actionId never leaks. */
function logsWithAction(where: SQL | undefined) {
    return db
        .select({ log: actionLogs, action: actions })
        .from(actionLogs)
        .leftJoin(actions, and(eq(actionLogs.actionId, actions.id), eq(actions.userId, actionLogs.userId)))
        .where(where);
}

// ── GET /api/logs ─────────────────────────────────────────────────────────────
// Query params:
//   ?from=ISO&to=ISO  → logs with from <= loggedAt < to (clients send their local day's bounds)
//   ?date=YYYY-MM-DD  → logs for that calendar day (UTC) — legacy, kept for older clients
//   ?last24h=true     → logs in the last 24 hours
// Returns log rows joined with action metadata, newest loggedAt first.
logRoutes.get('/', async (c) => {
    const userId = c.get('userId');
    const date = c.req.query('date');
    const last24h = c.req.query('last24h') === 'true';
    const range = parseRange(c.req.query('from'), c.req.query('to'));
    if (range === 'invalid') return c.json(INVALID_RANGE, 400);

    let filter: SQL | undefined;
    if (range) {
        filter = and(gte(actionLogs.loggedAt, range.from), lt(actionLogs.loggedAt, range.to));
    } else if (date) {
        // e.g. date=2025-10-14 -> loggedAt LIKE '2025-10-14%'
        filter = sql`${actionLogs.loggedAt} LIKE ${date + '%'}`;
    } else if (last24h) {
        filter = gte(actionLogs.loggedAt, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    }

    const rows = await logsWithAction(and(eq(actionLogs.userId, userId), filter))
        .orderBy(...NEWEST_FIRST)
        .all();
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

// ── GET /api/logs/streak ──────────────────────────────────────────────────────
// Query params:
//   ?tz=IANA zone (required, e.g. Asia/Ho_Chi_Minh) -> days are the user's local calendar days
//   ?actionId=    -> only logs of that action
//   ?today=YYYY-MM-DD -> the client's local today (so it matches the calendar it shows); defaults to today in tz
// Returns { streak }: consecutive local days with a log, counting back from today (0 if nothing today).
// Computed here so clients never download the log history just to count days.
logRoutes.get('/streak', async (c) => {
    const userId = c.get('userId');
    const tz = c.req.query('tz');
    const actionId = c.req.query('actionId');
    const today = c.req.query('today');
    if (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
        return c.json({ error: 'today must be YYYY-MM-DD' }, 400);
    }

    let toDay: Intl.DateTimeFormat;
    try {
        if (!tz) throw new RangeError('missing tz');
        toDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
        return c.json({ error: 'tz must be a valid IANA timezone, e.g. Asia/Ho_Chi_Minh' }, 400);
    }

    let expected = today ?? toDay.format(new Date());
    let streak = 0;
    let before: string | undefined;
    // Newest first in batches (index on user_id, logged_at), so a short streak reads only a few rows
    scan: while (true) {
        const rows = await db
            .select({ loggedAt: actionLogs.loggedAt })
            .from(actionLogs)
            .where(and(
                eq(actionLogs.userId, userId),
                actionId ? eq(actionLogs.actionId, actionId) : undefined,
                before ? lt(actionLogs.loggedAt, before) : undefined,
            ))
            .orderBy(desc(actionLogs.loggedAt))
            .limit(STREAK_BATCH)
            .all();

        for (const { loggedAt } of rows) {
            const at = new Date(loggedAt);
            if (isNaN(at.getTime())) continue; // rows written before POST/PUT validated the format
            const day = toDay.format(at);
            if (day > expected) continue; // later today already counted, or a future log
            if (day !== expected) break scan;
            streak++;
            expected = previousDay(expected);
        }
        if (rows.length < STREAK_BATCH) break;
        before = rows[rows.length - 1].loggedAt;
    }
    return c.json({ streak });
});

const STREAK_BATCH = 500;

/** 'YYYY-MM-DD' of the calendar day before (pure date math, no timezone involved) */
function previousDay(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// ── GET /api/logs/:id ─────────────────────────────────────────────────────────
logRoutes.get('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');

    const row = await logsWithAction(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId))).get();

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
});

// ── POST /api/logs ────────────────────────────────────────────────────────────
logRoutes.post('/', async (c) => {
    const userId = c.get('userId');
    const body = await v.jsonBody(c);
    const loggedAt = v.instant(body.loggedAt, 'loggedAt');
    const note = v.text(body.note, 'note', v.LIMITS.note);

    let actionId: string | null = null;
    if (body.actionId !== undefined && body.actionId !== null) {
        actionId = v.text(body.actionId, 'actionId', v.LIMITS.token, { required: true });
        const owned = await db
            .select({ id: actions.id })
            .from(actions)
            .where(and(eq(actions.id, actionId), eq(actions.userId, userId)))
            .get();
        if (!owned) v.badRequest('actionId does not match one of your actions');
    }

    const id = genId();
    await db.insert(actionLogs).values({ id, userId, actionId, loggedAt, note });

    const row = await logsWithAction(eq(actionLogs.id, id)).get();
    return c.json(row, 201);
});

// ── PUT /api/logs/:id ─────────────────────────────────────────────────────────
logRoutes.put('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const body = await v.jsonBody(c);
    const updated = {
        ...(body.loggedAt !== undefined && { loggedAt: v.instant(body.loggedAt, 'loggedAt') }),
        ...(body.note !== undefined && { note: v.text(body.note, 'note', v.LIMITS.note) }),
    };

    const existing = await db
        .select()
        .from(actionLogs)
        .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    if (Object.keys(updated).length > 0) {
        await db
            .update(actionLogs)
            .set(updated)
            .where(and(eq(actionLogs.id, id), eq(actionLogs.userId, userId)));
    }

    const row = await logsWithAction(eq(actionLogs.id, id)).get();
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
