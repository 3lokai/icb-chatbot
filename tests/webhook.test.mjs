import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
process.env.META_APP_SECRET = 'local-test-secret';
process.env.META_VERIFY_TOKEN = 'local-verify';
process.env.META_FACEBOOK_PAGE_ID = 'PAGE123';
const { createApp } = await import('../src/server.mjs');
test('GET verifies Meta challenge; bad token rejected', async () => {
  const server = createApp().listen(0);
  try {
    const port = server.address().port;
    let response = await fetch(`http://127.0.0.1:${port}/webhooks/meta?hub.mode=subscribe&hub.verify_token=local-verify&hub.challenge=abc123`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'abc123');
    response = await fetch(`http://127.0.0.1:${port}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`);
    assert.equal(response.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('POST never acknowledges invalid signed Meta payload', async () => {
  const server = createApp().listen(0);
  const body = JSON.stringify({ object: 'page', entry: [] });
  try {
    const port = server.address().port;
    const invalid = await fetch(`http://127.0.0.1:${port}/webhooks/meta`, { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=invalid' } });
    assert.equal(invalid.status, 403);
    const validSignature = 'sha256=' + createHmac('sha256', 'local-test-secret').update(body).digest('hex');
    const valid = await fetch(`http://127.0.0.1:${port}/webhooks/meta`, { method: 'POST', body, headers: { 'x-hub-signature-256': validSignature } });
    assert.equal(valid.status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
