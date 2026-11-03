import { sql } from 'drizzle-orm';
import { text, integer, sqliteTable, index } from 'drizzle-orm/sqlite-core';

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
    id: text('id').primaryKey(), // nanoid
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'), // null if google-only user
    name: text('name').notNull().default(''),
    avatarUrl: text('avatar_url'),
    googleId: text('google_id').unique(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Actions (habit/task templates) ──────────────────────────────────────────
export const actions = sqliteTable('actions', {
    id: text('id').primaryKey(), // nanoid
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('book'),
    color: text('color').notNull().default('bg-primary'),
    remindersEnabled: integer('reminders_enabled', { mode: 'boolean' })
        .notNull()
        .default(false),
    reminderTime: text('reminder_time').default('08:00'), // HH:MM
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [index('actions_user_id_idx').on(t.userId)]);

// ─── Action Logs (individual occurrences) ────────────────────────────────────
export const actionLogs = sqliteTable('action_logs', {
    id: text('id').primaryKey(), // nanoid
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    actionId: text('action_id').references(() => actions.id, {
        onDelete: 'set null',
    }),
    loggedAt: text('logged_at').notNull(), // ISO-8601 datetime
    note: text('note').default(''),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
    // Every log query filters by user and a loggedAt range, newest first
    index('action_logs_user_logged_at_idx').on(t.userId, t.loggedAt),
    // Deleting an action sets action_id to null on its logs
    index('action_logs_action_id_idx').on(t.actionId),
]);

// ─── Inferred types ───────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type Action = typeof actions.$inferSelect;
export type ActionLog = typeof actionLogs.$inferSelect;
