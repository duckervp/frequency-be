import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRoutes } from './routes/auth.js';
import { actionRoutes } from './routes/actions.js';
import { logRoutes } from './routes/logs.js';

const app = new Hono().basePath('/api');

app.use('*', logger());

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.APP_URL ?? '*').split(',').map(o => o.trim());

app.use(
    '*',
    cors({
        origin: (origin) => {
            if (!origin) return '*';
            if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return origin;
            return allowedOrigins[0];
        },
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
        credentials: true,
    })
);

app.route('/auth', authRoutes);
app.route('/actions', actionRoutes);
app.route('/logs', logRoutes);

app.get('/health', (c) => c.json({ ok: true }));

export default app;
