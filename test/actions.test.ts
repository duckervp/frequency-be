import { describe, expect, it } from 'vitest';
import { api, newUser } from './helpers.js';

describe('actions', () => {
    it('requires auth', async () => {
        expect((await api('GET', '/actions')).status).toBe(401);
    });

    it('creates with defaults, lists, updates and deletes', async () => {
        const { token } = await newUser();

        const created = await api('POST', '/actions', { token, body: { name: '  Drink water  ' } });
        expect(created.status).toBe(201);
        expect(created.body).toMatchObject({
            name: 'Drink water',
            icon: 'book',
            color: 'bg-primary',
            remindersEnabled: false,
            reminderTime: '08:00',
        });
        const id = created.body.id;

        const list = await api('GET', '/actions', { token });
        expect(list.body.map((a: any) => a.id)).toEqual([id]);

        const updated = await api('PUT', `/actions/${id}`, { token, body: { name: 'Water', remindersEnabled: true } });
        expect(updated.status).toBe(200);
        expect(updated.body).toMatchObject({ name: 'Water', remindersEnabled: true, icon: 'book' });

        expect((await api('DELETE', `/actions/${id}`, { token })).body).toEqual({ success: true });
        expect((await api('GET', '/actions', { token })).body).toEqual([]);
    });

    it('rejects an empty name', async () => {
        const { token } = await newUser();
        expect((await api('POST', '/actions', { token, body: { name: '   ' } })).status).toBe(400);
    });

    it("isolates users: cannot see, update or delete another user's action", async () => {
        const alice = await newUser('Alice');
        const bob = await newUser('Bob');
        const { body: action } = await api('POST', '/actions', { token: alice.token, body: { name: 'Secret' } });

        expect((await api('GET', '/actions', { token: bob.token })).body).toEqual([]);
        expect((await api('PUT', `/actions/${action.id}`, { token: bob.token, body: { name: 'Hacked' } })).status).toBe(404);
        expect((await api('DELETE', `/actions/${action.id}`, { token: bob.token })).status).toBe(404);

        const still = await api('GET', '/actions', { token: alice.token });
        expect(still.body[0]).toMatchObject({ id: action.id, name: 'Secret' });
    });

    it("gets one action by id, and 404 for another user's or a missing one", async () => {
        const me = await newUser();
        const other = await newUser();
        const { body: mine } = await api('POST', '/actions', { token: me.token, body: { name: 'Mine' } });
        const { body: theirs } = await api('POST', '/actions', { token: other.token, body: { name: 'Theirs' } });

        const res = await api('GET', `/actions/${mine.id}`, { token: me.token });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: mine.id, name: 'Mine' });
        expect((await api('GET', `/actions/${theirs.id}`, { token: me.token })).status).toBe(404);
        expect((await api('GET', '/actions/missing', { token: me.token })).status).toBe(404);
    });
});
