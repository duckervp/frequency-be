import { createClient } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../db/schema.js';

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
    throw new Error('TURSO_URL environment variable is not set');
}

const client = createClient({
    url,
    authToken,
});

export const db = drizzle(client, { schema });
