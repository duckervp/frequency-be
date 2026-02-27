import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './api/db/schema.ts',
    out: './api/db/migrations',
    dialect: 'turso',
    dbCredentials: {
        url: process.env.TURSO_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
    },
});
