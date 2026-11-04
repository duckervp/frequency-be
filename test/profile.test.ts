import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, newUser } from './helpers.js';
import { db } from '../src/lib/db.js';
import { users } from '../src/db/schema.js';

describe('profile', () => {
    it('requires auth', async () => {
        expect((await api('PUT', '/auth/me', { body: { name: 'X' } })).status).toBe(401);
        expect((await api('PUT', '/auth/password', { body: { newPassword: 'password456' } })).status).toBe(401);
    });

    it('/me says whether the account has a password', async () => {
        const { token } = await newUser();
        expect((await api('GET', '/auth/me', { token })).body.hasPassword).toBe(true);
    });

    it('updates the display name, trimmed, and rejects a blank or too long one', async () => {
        const { token } = await newUser('Old Name');
        const res = await api('PUT', '/auth/me', { token, body: { name: '  New Name  ' } });
        expect(res.status).toBe(200);
        expect(res.body.user.name).toBe('New Name');
        expect((await api('GET', '/auth/me', { token })).body.user.name).toBe('New Name');

        expect((await api('PUT', '/auth/me', { token, body: { name: '   ' } })).status).toBe(400);
        expect((await api('PUT', '/auth/me', { token, body: { name: 'x'.repeat(101) } })).status).toBe(400);
    });

    it('changes the password only with the current one', async () => {
        const { token, email, password } = await newUser();
        const wrong = await api('PUT', '/auth/password', { token, body: { currentPassword: 'not-it', newPassword: 'password456' } });
        expect(wrong.status).toBe(400);
        expect(wrong.body.error).toMatch(/current password/i);
        expect((await api('PUT', '/auth/password', { token, body: { newPassword: 'password456' } })).status).toBe(400);

        const ok = await api('PUT', '/auth/password', { token, body: { currentPassword: password, newPassword: 'password456' } });
        expect(ok.status).toBe(200);
        expect((await api('POST', '/auth/login', { body: { email, password } })).status).toBe(401);
        expect((await api('POST', '/auth/login', { body: { email, password: 'password456' } })).status).toBe(200);
    });

    it('rejects a new password that is too short', async () => {
        const { token, password } = await newUser();
        expect((await api('PUT', '/auth/password', { token, body: { currentPassword: password, newPassword: '123' } })).status).toBe(400);
    });

    it('lets a Google-only account (no password yet) set one without a current password', async () => {
        const { token, userId, email } = await newUser();
        await db.update(users).set({ passwordHash: null }).where(eq(users.id, userId));
        expect((await api('GET', '/auth/me', { token })).body.hasPassword).toBe(false);

        expect((await api('PUT', '/auth/password', { token, body: { newPassword: 'password456' } })).status).toBe(200);
        expect((await api('POST', '/auth/login', { body: { email, password: 'password456' } })).status).toBe(200);
        expect((await api('GET', '/auth/me', { token })).body.hasPassword).toBe(true);
    });
});
