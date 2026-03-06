import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import channels from './src/routes/channels.js';
import chat from './src/routes/chat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new Hono();

app.route('/api/channels', channels);
app.route('/api/chat', chat);

app.use('/*', serveStatic({ root: './public' }));

const port = parseInt(process.env.PORT || '5678');

serve({ fetch: app.fetch, port }, () => {
  console.log(`\n  LLM API Tester running at http://localhost:${port}\n`);
});
