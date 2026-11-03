import { resetTestDb } from './reset-db.js';

export default async function setup() {
    await resetTestDb('file:./test/.tmp/vitest.db');
}
