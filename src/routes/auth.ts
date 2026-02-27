import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../lib/db.js';
import { users } from '../db/schema.js';
import { signToken } from '../lib/jwt.js';
import { genId } from '../lib/id.js';

export const authRoutes = new Hono();

// ── POST /api/auth/register ──────────────────────────────────────────────────
authRoutes.post('/register', async (c) => {
    const { email, password, name } = await c.req.json<{
        email: string;
        password: string;
        name: string;
    }>();

    if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400);
    }

    const existing = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .get();

    if (existing) {
        return c.json({ error: 'Email already in use' }, 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = genId();

    await db.insert(users).values({
        id,
        email: email.toLowerCase(),
        passwordHash,
        name: name ?? email.split('@')[0],
    });

    const token = await signToken(id);
    return c.json({ token, user: { id, email, name } }, 201);
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
authRoutes.post('/login', async (c) => {
    const { email, password } = await c.req.json<{
        email: string;
        password: string;
    }>();

    if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400);
    }

    console.log(`[AUTH] Checking user: ${email}`);
    const user = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .get();

    console.log(`[AUTH] DB result for ${email}: ${!!user}`);

    if (!user || !user.passwordHash) {
        return c.json({ error: 'Invalid credentials' }, 401);
    }

    console.log(`[AUTH] Validating password...`);
    const valid = await bcrypt.compare(password, user.passwordHash);
    console.log(`[AUTH] Password valid: ${valid}`);
    if (!valid) {
        return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = await signToken(user.id);
    return c.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    });
});

// ── GET /api/auth/google ─────────────────────────────────────────────────────
authRoutes.get('/google', (c) => {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;
    const scope = 'openid email profile';

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');

    return c.redirect(url.toString());
});

// ── GET /api/auth/google/callback ────────────────────────────────────────────
authRoutes.get('/google/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'No code provided' }, 400);

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string };

    if (!tokenData.access_token) {
        return c.json({ error: 'Failed to get access token' }, 400);
    }

    // Fetch Google profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as {
        id: string;
        email: string;
        name: string;
        picture?: string;
    };

    // Upsert user
    let user = await db
        .select()
        .from(users)
        .where(eq(users.googleId, profile.id))
        .get();

    if (!user) {
        // Check if email already registered (link accounts)
        user = await db
            .select()
            .from(users)
            .where(eq(users.email, profile.email.toLowerCase()))
            .get();

        if (user) {
            await db
                .update(users)
                .set({ googleId: profile.id, avatarUrl: profile.picture })
                .where(eq(users.id, user.id));
        } else {
            const id = genId();
            await db.insert(users).values({
                id,
                email: profile.email.toLowerCase(),
                name: profile.name,
                avatarUrl: profile.picture,
                googleId: profile.id,
            });
            user = { id, email: profile.email, name: profile.name, avatarUrl: profile.picture ?? null, passwordHash: null, googleId: profile.id, createdAt: '' };
        }
    }

    const token = await signToken(user.id);
    // Redirect to frontend with token in URL hash
    const frontendUrl = process.env.FRONTEND_URL ?? process.env.APP_URL ?? '';
    return c.redirect(`${frontendUrl}/dashboard#token=${token}`);
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
import { authMiddleware } from '../middleware/auth.js';

authRoutes.get('/me', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .get();

    if (!user) {
        return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
        },
    });
});
