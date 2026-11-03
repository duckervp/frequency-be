import { describe, expect, it } from 'vitest';
import { api, newUser } from './helpers.js';

async function userWithAction() {
    const u = await newUser();
    const { body: action } = await api('POST', '/actions', { token: u.token, body: { name: 'Read' } });
    return { ...u, action };
}

describe('logs', () => {
    it('requires auth', async () => {
        expect((await api('GET', '/logs')).status).toBe(401);
    });

    it('creates a log joined with its action, then gets, updates and deletes it', async () => {
        const { token, action } = await userWithAction();

        const created = await api('POST', '/logs', {
            token,
            body: { actionId: action.id, loggedAt: '2026-01-15T09:30:00.000Z', note: 'ch. 3' },
        });
        expect(created.status).toBe(201);
        expect(created.body.log).toMatchObject({ actionId: action.id, note: 'ch. 3' });
        expect(created.body.action).toMatchObject({ id: action.id, name: 'Read' });
        const id = created.body.log.id;

        expect((await api('GET', `/logs/${id}`, { token })).body.log.id).toBe(id);

        const updated = await api('PUT', `/logs/${id}`, { token, body: { note: 'ch. 4' } });
        expect(updated.body.log).toMatchObject({ note: 'ch. 4', loggedAt: '2026-01-15T09:30:00.000Z' });

        expect((await api('DELETE', `/logs/${id}`, { token })).body).toEqual({ success: true });
        expect((await api('GET', `/logs/${id}`, { token })).status).toBe(404);
    });

    it('requires loggedAt', async () => {
        const { token } = await newUser();
        expect((await api('POST', '/logs', { token, body: { note: 'x' } })).status).toBe(400);
    });

    it('filters by ?date and ?last24h', async () => {
        const { token, action } = await userWithAction();
        const now = new Date().toISOString();
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-01-15T09:30:00.000Z' } });
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-01-16T09:30:00.000Z' } });
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: now } });

        expect((await api('GET', '/logs', { token })).body).toHaveLength(3);

        const day = await api('GET', '/logs?date=2026-01-15', { token });
        expect(day.body.map((r: any) => r.log.loggedAt)).toEqual(['2026-01-15T09:30:00.000Z']);

        const recent = await api('GET', '/logs?last24h=true', { token });
        expect(recent.body.map((r: any) => r.log.loggedAt)).toEqual([now]);
    });

    it("counts today's logs in /stats", async () => {
        const { token, action } = await userWithAction();
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: new Date().toISOString() } });
        const stats = await api('GET', '/logs/stats', { token });
        expect(stats.body.totalToday).toBe(1);
    });

    it("isolates users: cannot read, update or delete another user's log", async () => {
        const alice = await userWithAction();
        const bob = await newUser();
        const { body } = await api('POST', '/logs', {
            token: alice.token,
            body: { actionId: alice.action.id, loggedAt: new Date().toISOString() },
        });
        const id = body.log.id;

        expect((await api('GET', '/logs', { token: bob.token })).body).toEqual([]);
        expect((await api('GET', `/logs/${id}`, { token: bob.token })).status).toBe(404);
        expect((await api('PUT', `/logs/${id}`, { token: bob.token, body: { note: 'x' } })).status).toBe(404);
        expect((await api('DELETE', `/logs/${id}`, { token: bob.token })).status).toBe(404);
    });
});
