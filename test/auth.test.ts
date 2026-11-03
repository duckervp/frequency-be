import { describe, expect, it } from 'vitest';
import { api, newUser } from './helpers.js';

describe('auth', () => {
    it('health check works without auth', async () => {
        const res = await api('GET', '/health');
        expect(res).toEqual({ status: 200, body: { ok: true } });
    });

    it('registers, logs in and reads /me', async () => {
        const u = await newUser('Alice');

        const login = await api('POST', '/auth/login', { body: { email: u.email, password: u.password } });
        expect(login.status).toBe(200);
        expect(login.body.token).toBeTruthy();

        const me = await api('GET', '/auth/me', { token: login.body.token });
        expect(me.status).toBe(200);
        expect(me.body.user).toMatchObject({ id: u.userId, email: u.email, name: 'Alice' });
    });

    it('treats email as case-insensitive on login', async () => {
        const u = await newUser();
        const res = await api('POST', '/auth/login', { body: { email: u.email.toUpperCase(), password: u.password } });
        expect(res.status).toBe(200);
    });

    it('rejects duplicate email (any case)', async () => {
        const u = await newUser();
        const res = await api('POST', '/auth/register', {
            body: { email: u.email.toUpperCase(), password: 'x12345678', name: 'Dup' },
        });
        expect(res.status).toBe(409);
    });

    it('rejects missing credentials', async () => {
        expect((await api('POST', '/auth/register', { body: { email: 'a@b.c' } })).status).toBe(400);
        expect((await api('POST', '/auth/login', { body: { email: 'a@b.c' } })).status).toBe(400);
    });

    it('rejects wrong password and unknown email with the same error', async () => {
        const u = await newUser();
        const wrong = await api('POST', '/auth/login', { body: { email: u.email, password: 'nope' } });
        const unknown = await api('POST', '/auth/login', { body: { email: 'ghost@test.local', password: 'nope' } });
        expect(wrong).toEqual({ status: 401, body: { error: 'Invalid credentials' } });
        expect(unknown).toEqual(wrong);
    });

    it('protects /me', async () => {
        expect((await api('GET', '/auth/me')).status).toBe(401);
        expect((await api('GET', '/auth/me', { token: 'garbage' })).status).toBe(401);
    });
});
