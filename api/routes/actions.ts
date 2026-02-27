import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { actions } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { genId } from '../lib/id.js';

export const actionRoutes = new Hono();

// All action routes require auth
actionRoutes.use('*', authMiddleware);

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
    const { name, icon, color, remindersEnabled, reminderTime } = await c.req.json<{
        name: string;
        icon?: string;
        color?: string;
        remindersEnabled?: boolean;
        reminderTime?: string;
    }>();

    if (!name?.trim()) {
        return c.json({ error: 'Name is required' }, 400);
    }

    const id = genId();
    await db.insert(actions).values({
        id,
        userId,
        name: name.trim(),
        icon: icon ?? 'book',
        color: color ?? 'bg-primary',
        remindersEnabled: remindersEnabled ?? false,
        reminderTime: reminderTime ?? '08:00',
    });

    const row = await db.select().from(actions).where(eq(actions.id, id)).get();
    return c.json(row, 201);
});

// ── PUT /api/actions/:id ─────────────────────────────────────────────────────
actionRoutes.put('/:id', async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    const { name, icon, color, remindersEnabled, reminderTime } = await c.req.json<{
        name?: string;
        icon?: string;
        color?: string;
        remindersEnabled?: boolean;
        reminderTime?: string;
    }>();

    const existing = await db
        .select()
        .from(actions)
        .where(and(eq(actions.id, id), eq(actions.userId, userId)))
        .get();

    if (!existing) return c.json({ error: 'Not found' }, 404);

    const updated = {
        ...(name !== undefined && { name: name.trim() }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(remindersEnabled !== undefined && { remindersEnabled }),
        ...(reminderTime !== undefined && { reminderTime }),
    };

    await db
        .update(actions)
        .set(updated)
        .where(and(eq(actions.id, id), eq(actions.userId, userId)));

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
