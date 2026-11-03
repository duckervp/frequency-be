import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import { api, newUser } from './helpers.js';

async function raw(method: string, path: string, body: string, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await app.request(`/api${path}`, { method, headers, body });
    return { status: res.status, body: await res.json() };
}

describe('request bodies', () => {
    it('regression: malformed or non-object JSON is a 400 with an error message, not a 500', async () => {
        const { token } = await newUser();
        for (const body of ['{oops', 'null', '[1]', '"text"']) {
            for (const [method, path, auth] of [['POST', '/logs', token], ['POST', '/actions', token], ['POST', '/auth/register', undefined]] as const) {
                const res = await raw(method, path, body, auth);
                expect(res.status, `${method} ${path} ${body}`).toBe(400);
                expect(res.body.error, `${method} ${path} ${body}`).toEqual(expect.any(String));
            }
        }
    });
});

describe('auth input', () => {
    it('regression: register rejects a malformed email and a short password', async () => {
        const bad = [
            { email: 'not-an-email', password: 'password123', name: 'A' },
            { email: 'a@test.local', password: '123', name: 'A' },
            { email: 'b@test.local', password: 'x'.repeat(73), name: 'A' }, // bcrypt ignores bytes past 72
            { email: 'c@test.local', password: 'password123', name: 'x'.repeat(101) },
        ];
        for (const body of bad) {
            expect((await api('POST', '/auth/register', { body })).status, JSON.stringify(body).slice(0, 60)).toBe(400);
        }
    });

    it('stores and returns the email in lower case', async () => {
        const res = await api('POST', '/auth/register', { body: { email: `Mixed${Date.now()}@Test.Local`, password: 'password123', name: 'M' } });
        expect(res.status).toBe(201);
        expect(res.body.user.email).toBe(res.body.user.email.toLowerCase());
    });
});

describe('action input', () => {
    it('regression: rejects an over-long or blank name, a bad reminder time, and bad icon/color values', async () => {
        const { token } = await newUser();
        const bad = [
            { name: 'x'.repeat(101) },
            { name: '   ' },
            { name: 'Run', reminderTime: '99:99' },
            { name: 'Run', reminderTime: '7:5' },
            { name: 'Run', icon: '<img>' },
            { name: 'Run', color: 'bg-red-500" onclick="x' },
            { name: 'Run', remindersEnabled: 'yes' },
        ];
        for (const body of bad) {
            expect((await api('POST', '/actions', { token, body })).status, JSON.stringify(body).slice(0, 60)).toBe(400);
        }

        const { body: action } = await api('POST', '/actions', { token, body: { name: 'Run', reminderTime: '07:30' } });
        expect((await api('PUT', `/actions/${action.id}`, { token, body: { name: '  ' } })).status).toBe(400);
        expect((await api('PUT', `/actions/${action.id}`, { token, body: { reminderTime: '24:00' } })).status).toBe(400);
        expect((await api('PUT', `/actions/${action.id}`, { token, body: { name: 'Jog', reminderTime: '23:59' } })).status).toBe(200);
    });
});

describe('log input', () => {
    it('regression: rejects a loggedAt that is not an ISO instant, and an over-long note', async () => {
        const { token } = await newUser();
        for (const body of [{ loggedAt: 'banana' }, { loggedAt: '2026-11-03T10:00:00' }, { loggedAt: '2026-11-03' }, { loggedAt: new Date().toISOString(), note: 'x'.repeat(1001) }]) {
            expect((await api('POST', '/logs', { token, body })).status, JSON.stringify(body).slice(0, 60)).toBe(400);
        }
        const { body: created } = await api('POST', '/logs', { token, body: { loggedAt: '2026-11-03T01:00:00.000Z' } });
        expect((await api('PUT', `/logs/${created.log.id}`, { token, body: { loggedAt: 'banana' } })).status).toBe(400);
    });

    it('stores an instant with an offset as UTC with Z, so range filters compare correctly', async () => {
        const { token } = await newUser();
        const res = await api('POST', '/logs', { token, body: { loggedAt: '2026-11-03T08:00:00+07:00' } });
        expect(res.status).toBe(201);
        expect(res.body.log.loggedAt).toBe('2026-11-03T01:00:00.000Z');
    });

    it("regression: a log cannot reference another user's action, and never shows it", async () => {
        const me = await newUser();
        const other = await newUser();
        const { body: theirs } = await api('POST', '/actions', { token: other.token, body: { name: 'Secret habit' } });

        const res = await api('POST', '/logs', { token: me.token, body: { actionId: theirs.id, loggedAt: new Date().toISOString() } });
        expect(res.status).toBe(400);

        const list = await api('GET', '/logs', { token: me.token });
        expect(JSON.stringify(list.body)).not.toContain('Secret habit');
    });
});
