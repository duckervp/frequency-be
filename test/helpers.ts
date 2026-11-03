import app from '../src/index.js';

let counter = 0;

/** Calls the Hono app in-process (no HTTP server). */
export async function api<T = any>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await app.request(`/api${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : (undefined as T) };
}

/** Registers a fresh user with a unique email and returns its token. */
export async function newUser(name = 'Test User') {
    const email = `user${Date.now()}-${++counter}@test.local`;
    const password = 'password123';
    const res = await api<{ token: string; user: { id: string } }>('POST', '/auth/register', {
        body: { email, password, name },
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
    return { email, password, token: res.body.token, userId: res.body.user.id };
}
