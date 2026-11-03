import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { actions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { genId } from '../lib/id.js';
import * as v from '../lib/validate.js';

export const actionRoutes = new Hono();

// All action routes require auth
actionRoutes.use('*', authMiddleware);

/** Validated fields from a POST (name required) or PUT (only the fields sent) body */
function actionInput(body: Record<string, unknown>, creating: boolean) {
    const input: Partial<Pick<typeof actions.$inferInsert, 'name' | 'icon' | 'color' | 'remindersEnabled' | 'reminderTime'>> = {};
    if (creating || body.name !== undefined) input.name = v.text(body.name, 'name', v.LIMITS.name, { required: true });
    if (body.icon !== undefined) input.icon = v.token(body.icon, 'icon');
    if (body.color !== undefined) input.color = v.token(body.color, 'color');
    if (body.remindersEnabled !== undefined) input.remindersEnabled = v.bool(body.remindersEnabled, 'remindersEnabled');
    if (body.reminderTime !== undefined) input.reminderTime = v.timeOfDay(body.reminderTime, 'reminderTime');
    return input;
}

// ── GET /api/actions ─────────────────────────────────────────────────────────
actionRoutes.get('/', async (c) => {
    const userId = c.get('userId');
    const rows = await db
        .select()
        .from(actions)
        .where(eq(actions.userId, userId))
        .all();
    return c.json(rows);
});

// ── POST /api/actions ────────────────────────────────────────────────────────
actionRoutes.post('/', async (c) => {
    const userId = c.get('userId');
    const input = actionInput(await v.jsonBody(c), true);

    const id = genId();
    await db.insert(actions).values({
        id,
        userId,
        name: input.name!,
        icon: input.icon ?? 'book',
        color: input.color ?? 'bg-primary',
        remindersEnabled: input.remindersEnabled ?? false,
        reminderTime: input.reminderTime ?? '08:00',
    });

    const row = await db.select().from(actions).where(eq(actions.id, id)).get();
    return c.json(row, 201);
});

// ── PUT /api/actions/:id ─────────────────────────────────────────────────────
actionRoutes.put('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const updated = actionInput(await v.jsonBody(c), false);

    const existing = await db
        .select()
        .from(actions)
        .where(and(eq(actions.id, id), eq(actions.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    if (Object.keys(updated).length > 0) {
        await db
            .update(actions)
            .set(updated)
            .where(and(eq(actions.id, id), eq(actions.userId, userId)));
    }

    const row = await db.select().from(actions).where(eq(actions.id, id)).get();
    return c.json(row);
});

// ── DELETE /api/actions/:id ──────────────────────────────────────────────────
actionRoutes.delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');

    const existing = await db
        .select()
        .from(actions)
        .where(and(eq(actions.id, id), eq(actions.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    await db
        .delete(actions)
        .where(and(eq(actions.id, id), eq(actions.userId, userId)));

    return c.json({ success: true });
});
