import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Same values as the e2e server, but a separate DB file so both can run at once.
const env: Record<string, string> = {};
for (const line of readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
}
env.TURSO_URL = 'file:./test/.tmp/vitest.db';
delete env.TURSO_AUTH_TOKEN;

export default defineConfig({
    resolve: {
        // src/lib/db.ts uses the web client, which cannot open file: URLs (see test/test-env.mjs)
        alias: [{ find: /^@libsql\/client\/web$/, replacement: '@libsql/client' }],
    },
    test: {
        env,
        globalSetup: './test/global-setup.ts',
        include: ['test/**/*.test.ts'],
        fileParallelism: false,
        silent: 'passed-only', // hide Hono request logs unless a test fails
        testTimeout: 15000,
    },
});
