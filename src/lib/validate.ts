import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Input rules shared by the routes, so POST and PUT of a resource cannot drift apart.

export const LIMITS = {
    name: 100,
    note: 1000,
    email: 254,
    passwordMin: 6,
    passwordMax: 72, // bcrypt ignores bytes past 72
    token: 50, // icon names and color classes
} as const;

/** Throws a 400 that `app.onError` turns into `{ error }` */
export function badRequest(message: string): never {
    throw new HTTPException(400, { message });
}

/** The request body as a plain object; malformed JSON, arrays and primitives are a 400 */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        badRequest('Request body must be valid JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        badRequest('Request body must be a JSON object');
    }
    return body as Record<string, unknown>;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** True for an ISO-8601 instant with Z or an offset (a wall time without offset is ambiguous) */
export function isIsoInstant(value: unknown): value is string {
    return typeof value === 'string' && ISO_INSTANT.test(value) && !isNaN(new Date(value).getTime());
}

/** An ISO instant normalized to UTC with Z, the only format stored, so string comparisons order correctly */
export function instant(value: unknown, field: string): string {
    if (!isIsoInstant(value)) badRequest(`${field} must be an ISO date-time with Z or an offset`);
    return new Date(value).toISOString();
}

export function text(value: unknown, field: string, max: number, { required = false } = {}): string {
    if (value === undefined || value === null) {
        if (required) badRequest(`${field} is required`);
        return '';
    }
    if (typeof value !== 'string') badRequest(`${field} must be a string`);
    const trimmed = value.trim();
    if (required && !trimmed) badRequest(`${field} is required`);
    if (trimmed.length > max) badRequest(`${field} must be at most ${max} characters`);
    return trimmed;
}

export function bool(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') badRequest(`${field} must be true or false`);
    return value;
}

export function timeOfDay(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) badRequest(`${field} must be HH:MM`);
    return value;
}

/** Icon names and color classes are rendered into class names and ligatures: keep them to a safe charset */
export function token(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^[a-z0-9_/-]+$/.test(value) || value.length > LIMITS.token) {
        badRequest(`${field} has an invalid value`);
    }
    return value;
}

export function email(value: unknown): string {
    const v = text(value, 'email', LIMITS.email, { required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) badRequest('email is not a valid address');
    return v;
}

export function password(value: unknown): string {
    if (typeof value !== 'string' || value.length < LIMITS.passwordMin || new TextEncoder().encode(value).length > LIMITS.passwordMax) {
        badRequest(`password must be ${LIMITS.passwordMin} to ${LIMITS.passwordMax} characters`);
    }
    return value;
}
