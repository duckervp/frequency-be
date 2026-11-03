import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, newUser } from './helpers.js';

const HCM = 'Asia/Ho_Chi_Minh'; // UTC+7
const NY = 'America/New_York'; // UTC-5 / UTC-4 (DST)

async function log(token: string, loggedAt: string, actionId?: string) {
    const res = await api('POST', '/logs', { token, body: { loggedAt, actionId } });
    expect(res.status).toBe(201);
}

async function streak(token: string, query: string) {
    return api<{ streak: number }>('GET', `/logs/streak?${query}`, { token });
}

describe('GET /logs/streak', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-03T03:00:00.000Z')); // Nov 3, 10:00 in HCM; Nov 2, 22:00 in NY
    });
    afterEach(() => vi.useRealTimers());

    it('requires auth', async () => {
        expect((await api('GET', `/logs/streak?tz=${HCM}`)).status).toBe(401);
    });

    it('rejects a missing or unknown timezone', async () => {
        const { token } = await newUser();
        expect((await streak(token, '')).status).toBe(400);
        expect((await streak(token, 'tz=Mars/Base')).status).toBe(400);
    });

    it('is 0 with no logs, and 0 when nothing is logged today', async () => {
        const { token } = await newUser();
        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 0 });
        await log(token, '2026-11-02T01:00:00.000Z'); // Nov 2 local, yesterday
        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 0 });
    });

    it('counts consecutive local days back from today, across the start of the month', async () => {
        const { token } = await newUser();
        for (const at of [
            '2026-10-28T01:00:00.000Z', // Oct 28 - gap on Oct 29, so not counted
            '2026-10-30T01:00:00.000Z',
            '2026-10-31T01:00:00.000Z',
            '2026-11-01T01:00:00.000Z',
            '2026-11-02T01:00:00.000Z',
            '2026-11-03T01:00:00.000Z',
            '2026-11-03T02:00:00.000Z', // second log today counts once
        ]) await log(token, at);
        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 5 });
    });

    it('uses the given timezone for day boundaries', async () => {
        const { token } = await newUser();
        await log(token, '2026-11-02T23:00:00.000Z'); // Nov 3 06:00 in HCM, Nov 2 18:00 in NY
        await log(token, '2026-11-02T05:00:00.000Z'); // Nov 2 12:00 in HCM, Nov 2 00:00 in NY
        // HCM: today Nov 3 + Nov 2 -> 2. NY: today is Nov 2 and both logs are on Nov 2 -> 1.
        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 2 });
        expect((await streak(token, `tz=${NY}`)).body).toEqual({ streak: 1 });
    });

    it('counts across a DST change by local calendar days', async () => {
        const { token } = await newUser();
        // NY falls back on Nov 1, 2026. Local days Oct 31, Nov 1, Nov 2 (today in NY).
        await log(token, '2026-10-31T16:00:00.000Z'); // Oct 31 12:00 EDT
        await log(token, '2026-11-01T17:00:00.000Z'); // Nov 1 12:00 EST
        await log(token, '2026-11-02T17:00:00.000Z'); // Nov 2 12:00 EST
        expect((await streak(token, `tz=${NY}`)).body).toEqual({ streak: 3 });
    });

    it("counts back from the client's today when given, and rejects a malformed one", async () => {
        const { token } = await newUser();
        await log(token, '2026-12-31T17:30:00.000Z'); // Jan 1 2027, 00:30 local
        await log(token, '2027-01-02T01:00:00.000Z'); // Jan 2 2027, 08:00 local
        expect((await streak(token, `tz=${HCM}&today=2027-01-02`)).body).toEqual({ streak: 2 });
        expect((await streak(token, `tz=${HCM}&today=02/01/2027`)).status).toBe(400);
    });

    it('follows the actionId filter', async () => {
        const { token } = await newUser();
        const { body: run } = await api('POST', '/actions', { token, body: { name: 'Run' } });
        const { body: read } = await api('POST', '/actions', { token, body: { name: 'Read' } });
        await log(token, '2026-11-03T01:00:00.000Z', run.id);
        await log(token, '2026-11-02T01:00:00.000Z', run.id);
        await log(token, '2026-11-01T01:00:00.000Z', read.id);

        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 3 });
        expect((await streak(token, `tz=${HCM}&actionId=${run.id}`)).body).toEqual({ streak: 2 });
        expect((await streak(token, `tz=${HCM}&actionId=${read.id}`)).body).toEqual({ streak: 0 });
    });

    it('skips a stored loggedAt that is not a date instead of failing', async () => {
        const { token } = await newUser();
        await log(token, '2026-11-03T01:00:00.000Z');
        await log(token, 'yesterday'); // POST does not validate the format yet
        const res = await streak(token, `tz=${HCM}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ streak: 1 });
    });

    it('reads a long history in batches and still counts every day', async () => {
        const { token } = await newUser();
        // 3 logs a day for 400 days: more rows than one batch
        for (let i = 0; i < 400; i++) {
            const day = new Date(Date.UTC(2026, 10, 3) - i * 86_400_000);
            for (const h of [1, 2, 3]) {
                day.setUTCHours(h);
                await log(token, day.toISOString());
            }
        }
        expect((await streak(token, `tz=${HCM}`)).body).toEqual({ streak: 400 });
    }, 120_000);

    it("returns 0 for another user's actionId", async () => {
        const me = await newUser();
        const other = await newUser();
        const { body: theirs } = await api('POST', '/actions', { token: other.token, body: { name: 'Run' } });
        await log(other.token, '2026-11-03T01:00:00.000Z', theirs.id);
        await log(me.token, '2026-11-03T01:00:00.000Z');
        expect((await streak(me.token, `tz=${HCM}&actionId=${theirs.id}`)).body).toEqual({ streak: 0 });
    });

    it("ignores other users' logs and future logs", async () => {
        const me = await newUser();
        const other = await newUser();
        await log(me.token, '2026-11-03T01:00:00.000Z');
        await log(other.token, '2026-11-02T01:00:00.000Z');
        await log(me.token, '2026-11-04T01:00:00.000Z'); // tomorrow
        expect((await streak(me.token, `tz=${HCM}`)).body).toEqual({ streak: 1 });
    });
});
