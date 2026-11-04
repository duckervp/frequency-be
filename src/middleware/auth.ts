import type { Context, MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt.js';

declare module 'hono' {
    interface ContextVariableMap {
        userId: string;
        /** Unix seconds; lets sensitive routes ask for a recent sign-in */
        tokenIssuedAt: number;
    }
}

export const authMiddleware: MiddlewareHandler = async (c: Context, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.slice(7);
    const verified = await verifyToken(token);
    if (!verified) {
        return c.json({ error: 'Invalid or expired token' }, 401);
    }
    c.set('userId', verified.userId);
    c.set('tokenIssuedAt', verified.issuedAt);
    await next();
};
