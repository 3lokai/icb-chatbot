import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { verifySignature, parseMetaWebhook, splitForChannel } from '../src/meta.mjs';
import { catalogQuery, rankCoffees, renderCoffees } from '../src/catalog.mjs';
import { brewRatio, diagnoseBrew, detectRecipe } from '../src/coffee-tools.mjs';
import { createReply } from '../src/brain.mjs';
import { findArticles } from '../src/knowledge.mjs';
test('webhook verifies body exactly and rejects tampering', () => {
  const body = Buffer.from('{"object":"page"}');
  const signature = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
  assert.equal(verifySignature(body, signature, 'secret'), true);
  assert.equal(verifySignature(Buffer.from('altered'), signature, 'secret'), false);
  assert.equal(verifySignature(body, 'sha256=oops', 'secret'), false);
});
test('parses only genuine WhatsApp text messages', () => {
  const result = parseMetaWebhook({ object: 'whatsapp_business_account', entry: [ { changes: [ { value: {
    metadata: { phone_number_id: 'PHONE' }, messages: [ { id: 'wamid.1', from: '91999', type: 'text', text: { body: 'beans?' } }, { id: '2', from: '91999', type: 'image' } ] } } ] } ] });
  assert.deepEqual(result, [{ platform: 'whatsapp', accountId: 'PHONE', contactId: '91999', messageId: 'wamid.1', text: 'beans?' }]);
});
test('ignores Messenger echoes and Instagram read events', () => {
  const result = parseMetaWebhook({ object: 'instagram', entry: [{ messaging: [
    { sender: { id: 'A' }, recipient: { id: 'BUSINESS' }, message: { mid: 'mid1', text: 'hi' } },
    { sender: { id: 'BUSINESS' }, recipient: { id: 'A' }, message: { mid: 'mid2', text: 'echo', is_echo: true } },
    { sender: { id: 'A' }, recipient: { id: 'BUSINESS' }, read: {} }
  ] }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].platform, 'instagram');
});
test('existing ICB API search filters include stock and per-250g budget', () => {
  const p = catalogQuery({ roast: 'light', process: 'natural', brewMethod: 'v60', budget250g: 600 });
  assert.equal(p.get('inStockOnly'), '1');
  assert.equal(p.get('maxPrice'), '600');
  assert.equal(p.get('brewMethodIds'), 'pour_over');
});
test('recommendations never invent coffees, prices or URLs', () => {
  const list = rankCoffees([{ display_name: 'Sample', name: 'Sample', slug: 'sample', roaster_name: 'R',
    in_stock_count: 3, flavor_keys: ['plum'], roast_level: 'light', process: 'natural', best_normalized_250g: 580 }], { flavors: ['plum'] });
  assert.equal(list.length, 1);
  assert.match(renderCoffees(list), /₹580\/250g/);
  assert.match(renderCoffees(list), /https:\/\//);
});
test('brew formula and first-change advice are deterministic', () => {
  assert.deepEqual(brewRatio(15, 16), { coffeeGrams: 15, waterGrams: 240, ratio: '1:16' });
  assert.equal(detectRecipe('15g coffee at 1:16').waterGrams, 240);
  assert.equal(diagnoseBrew(['sour', 'bitter'], 'v60').bucket, 'UNEVEN');
  assert.equal(diagnoseBrew(['sour'], 'v60').bucket, 'UNDER');
});
test('knowledge prioritizes relevant Sanity titles', () => {
  const rows = findArticles([{ title: 'Coffee Grind Size', slug: 'grind', bodyText: 'grinders click clicks' },
    { title: 'Coffee Harvest Calendar', slug: 'harvest', bodyText: 'harvest' }], 'grind clicks');
  assert.equal(rows[0].slug, 'grind');
});
test('recommendation paths use only external API results and format them deterministically', async () => {
  const output = await createReply('Suggest fruity coffee', {
    planner: async () => ({ intent: 'recommend', preferences: { flavors: ['plum'] } }),
    knowledgeLoader: async () => [],
    coffeeLoader: async () => [{ name: 'Only real bean', roaster_name: 'Roaster', slug: 'only-real-bean', in_stock_count: 1, best_normalized_250g: 550 }]
  });
  assert.match(output.text, /Only real bean/);
  assert.match(output.text, /₹550/);
});

test('splits long Instagram text without silently dropping shop links', () => {
  const whole = 'Intro\n\n' + ('Coffee — https://example.com/buy/beans\n\n'.repeat(40));
  const parts = splitForChannel(whole, 'instagram');
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.length <= 950));
  assert.ok(parts.join('\n\n').includes('https://example.com/buy/beans'));
});
