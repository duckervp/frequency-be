import { app } from './index.js';
import { serve } from '@hono/node-server';

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
    console.log(`🚀 API server running at http://localhost:${port}`);
});
