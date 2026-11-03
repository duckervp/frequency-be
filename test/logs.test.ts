import { describe, expect, it, vi } from 'vitest';
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

describe('local-day filters (UTC+7 user)', () => {
    const NOV_3_UTC7 = 'from=2026-11-03T00:00:00%2B07:00&to=2026-11-04T00:00:00%2B07:00';

    it('regression: ?from&to returns logs from the local day, not the UTC day', async () => {
        const { token, action } = await userWithAction();
        // Nov 3, 06:00 in Asia/Ho_Chi_Minh — still Nov 2 in UTC
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-11-02T23:00:00.000Z' } });

        // Nov 2 12:00 local, and Nov 4 00:00 local (the exclusive end of Nov 3)
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-11-02T05:00:00.000Z' } });
        await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-11-03T17:00:00.000Z' } });

        // What a UTC+7 client sends for Nov 3: local midnight to next local midnight
        const day = await api('GET', `/logs?${NOV_3_UTC7}`, { token });
        expect(day.body.map((r: any) => r.log.loggedAt)).toEqual(['2026-11-02T23:00:00.000Z']);
    });

    it("regression: /stats counts today's logs by the local day, not the UTC day", async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-03T03:00:00.000Z')); // Nov 3, 10:00 local
            const { token, action } = await userWithAction();
            await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: '2026-11-02T23:00:00.000Z' } });

            const stats = await api('GET', `/logs/stats?${NOV_3_UTC7}`, { token });
            expect(stats.body.totalToday).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("includes a log exactly at from, and only the current user's logs", async () => {
        const alice = await userWithAction();
        const bob = await userWithAction();
        await api('POST', '/logs', { token: alice.token, body: { actionId: alice.action.id, loggedAt: '2026-11-02T17:00:00.000Z' } });
        await api('POST', '/logs', { token: bob.token, body: { actionId: bob.action.id, loggedAt: '2026-11-02T18:00:00.000Z' } });

        const day = await api('GET', `/logs?${NOV_3_UTC7}`, { token: alice.token });
        expect(day.body.map((r: any) => r.log.loggedAt)).toEqual(['2026-11-02T17:00:00.000Z']);
    });

    it('rejects a half or invalid range', async () => {
        const { token } = await newUser();
        expect((await api('GET', '/logs?from=2026-11-03T00:00:00Z', { token })).status).toBe(400);
        expect((await api('GET', '/logs?from=nope&to=2026-11-04T00:00:00Z', { token })).status).toBe(400);
        expect((await api('GET', '/logs?from=2026-11-04T00:00:00Z&to=2026-11-03T00:00:00Z', { token })).status).toBe(400);
        expect((await api('GET', '/logs/stats?to=2026-11-04T00:00:00Z', { token })).status).toBe(400);
        // Parseable by Date but not an ISO instant with an offset
        expect((await api('GET', '/logs?from=1&to=2026-11-04T00:00:00Z', { token })).status).toBe(400);
        expect((await api('GET', '/logs?from=2026-11-03 00:00&to=2026-11-04T00:00:00Z', { token })).status).toBe(400);
    });
});

describe('list order', () => {
    it('regression: lists are sorted newest loggedAt first, not by insertion order', async () => {
        const { token, action } = await userWithAction();
        const now = Date.now();
        const at = (h: number) => new Date(now - h * 3600e3).toISOString();
        // Insert out of order, as happens when a log is backdated in the time picker
        for (const h of [1, 5, 3]) {
            await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: at(h) } });
        }
        const expected = [at(1), at(3), at(5)];
        const range = `from=${encodeURIComponent(new Date(now - 6 * 3600e3).toISOString())}&to=${encodeURIComponent(new Date(now + 1).toISOString())}`;

        for (const query of ['', '?last24h=true', `?${range}`]) {
            const res = await api('GET', `/logs${query}`, { token });
            expect(res.body.map((r: any) => r.log.loggedAt), `GET /logs${query}`).toEqual(expected);
        }
    });

    it('regression: legacy ?date= (UTC day) is sorted newest first too', async () => {
        const { token, action } = await userWithAction();
        for (const t of ['10', '05', '08']) {
            await api('POST', '/logs', { token, body: { actionId: action.id, loggedAt: `2026-01-20T${t}:00:00.000Z` } });
        }
        const res = await api('GET', '/logs?date=2026-01-20', { token });
        expect(res.body.map((r: any) => r.log.loggedAt)).toEqual([
            '2026-01-20T10:00:00.000Z',
            '2026-01-20T08:00:00.000Z',
            '2026-01-20T05:00:00.000Z',
        ]);
    });
});
