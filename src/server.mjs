import { createServer } from 'node:http';
import { config, assertServerConfig } from './config.mjs';
import { verifySignature, parseMetaWebhook, accountAllowed } from './meta.mjs';
import { enqueueMessage, patchMessage } from './store.mjs';
import { approveDraft, runWorker } from './worker.mjs';
import { safeError } from './net.mjs';
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function readBody(req, maxBytes = 512000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) { const err = new Error('Payload too large'); err.status = 413; throw err; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function bearer(req) {
  const header = req.headers.authorization || '';
  return config.adminToken && header === `Bearer ${config.adminToken}`;
}
export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, mode: config.botMode });
      if (req.method === 'GET' && url.pathname === '/webhooks/meta') {
        const mode = url.searchParams.get('hub.mode');
        const token = url.searchParams.get('hub.verify_token');
        const challenge = url.searchParams.get('hub.challenge');
        if (mode !== 'subscribe' || !config.metaVerifyToken || token !== config.metaVerifyToken || !challenge)
          return json(res, 403, { error: 'Verification failed' });
        res.writeHead(200, { 'content-type': 'text/plain' }); res.end(challenge); return;
      }
      if (req.method === 'POST' && url.pathname === '/webhooks/meta') {
        const raw = await readBody(req);
        if (!verifySignature(raw, req.headers['x-hub-signature-256'], config.metaAppSecret))
          return json(res, 403, { error: 'Invalid signature' });
        let payload;
        try { payload = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        const events = parseMetaWebhook(payload).filter(e => accountAllowed(e) && e.text.length > 0 && e.text.length <= 2000);
        if (events.length > 50) return json(res, 413, { error: 'Too many messages' });
        await Promise.all(events.map(enqueueMessage));
        return json(res, 200, { received: true });
      }
      if (req.method === 'POST' && url.pathname === '/admin/approve') {
        if (!bearer(req)) return json(res, 401, { error: 'Unauthorized' });
        const raw = await readBody(req, 4096);
        const body = JSON.parse(raw.toString('utf8'));
        if (!/^[0-9a-f-]{36}$/i.test(String(body.id || ''))) return json(res, 400, { error: 'Expected draft UUID' });
        await approveDraft(body.id);
        return json(res, 200, { sent: true });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error('HTTP error:', safeError(e));
      return json(res, e.status === 413 ? 413 : 500, { error: 'Request could not be processed' });
    }
  });
}
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  assertServerConfig();
  const server = createApp();
  server.listen(config.port, '0.0.0.0', () => console.log(`ICB Barista AI listening on :${config.port} (${config.botMode})`));
  const stopWorker = runWorker();
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopWorker(); server.close(() => process.exit(0)); });
}
