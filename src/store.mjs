import { config } from './config.mjs';
import { requestJson } from './net.mjs';
function api(table, params = {}) {
  const url = new URL(`/rest/v1/${table}`, config.supabaseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}
function auth(prefer = '') {
  return { apikey: config.supabaseKey, authorization: `Bearer ${config.supabaseKey}`,
    'content-type': 'application/json', ...(prefer ? { prefer } : {}) };
}
async function write(table, method, params, payload, prefer = 'return=representation') {
  return requestJson(api(table, params), { method, headers: auth(prefer), body: JSON.stringify(payload) });
}
async function read(table, params) { return requestJson(api(table, params), { headers: auth() }); }
export async function enqueueMessage(event) {
  const rows = await write('icb_bot_messages', 'POST', { on_conflict: 'platform,account_id,external_message_id' },
    { platform: event.platform, account_id: event.accountId, contact_id: event.contactId,
      external_message_id: event.messageId, direction: 'inbound', body: event.text, status: 'queued' },
    'resolution=ignore-duplicates,return=representation');
  return rows.length > 0;
}
export async function nextInbox(batchSize, maxAgeMinutes) {
  const staleClaim = new Date(Date.now() - 5 * 60_000).toISOString();
  const notBefore = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  return read('icb_bot_messages', {
    select: '*', direction: 'eq.inbound', created_at: `gte.${notBefore}`,
    or: `(status.eq.queued,and(status.eq.processing,claimed_at.lt.${staleClaim}))`,
    order: 'created_at.asc', limit: batchSize
  });
}
export async function claimInbound(row) {
  const params = { id: `eq.${row.id}`, direction: 'eq.inbound',
    ...(row.status === 'queued' ? { status: 'eq.queued' } : { status: 'eq.processing', claimed_at: `lt.${new Date(Date.now() - 5 * 60_000).toISOString()}` }) };
  const rows = await write('icb_bot_messages', 'PATCH', params,
    { status: 'processing', claimed_at: new Date().toISOString(), attempts: row.attempts + 1, error: null });
  return rows[0] || null;
}
export async function patchMessage(id, updates, conditions = {}) {
  return write('icb_bot_messages', 'PATCH', { id: `eq.${id}`, ...conditions }, updates);
}
export async function saveReply(inbound, text, mode, model) {
  const rows = await write('icb_bot_messages', 'POST', { on_conflict: 'reply_to' },
    { platform: inbound.platform, account_id: inbound.account_id, contact_id: inbound.contact_id,
      direction: 'outbound', body: text, status: mode === 'auto' ? 'ready' : 'draft',
      reply_to: inbound.id, model }, 'resolution=ignore-duplicates,return=representation');
  if (rows[0]) return rows[0];
  const existing = await read('icb_bot_messages', { select: '*', reply_to: `eq.${inbound.id}`, direction: 'eq.outbound', limit: 1 });
  return existing[0] || null;
}
export async function recentHistory(message, limit = 12) {
  const rows = await read('icb_bot_messages', { select: 'direction,body,status,created_at',
    platform: `eq.${message.platform}`, account_id: `eq.${message.account_id}`, contact_id: `eq.${message.contact_id}`,
    created_at: `lt.${message.created_at}`, order: 'created_at.desc', limit });
  return rows.reverse().filter(x => x.direction === 'inbound' || ['sent', 'done'].includes(x.status))
    .map(x => ({ role: x.direction === 'inbound' ? 'user' : 'assistant', content: x.body }));
}
export async function getProfile(message) {
  const rows = await read('icb_bot_profiles', { select: 'preferences', platform: `eq.${message.platform}`,
    account_id: `eq.${message.account_id}`, contact_id: `eq.${message.contact_id}`, limit: 1 });
  return rows[0]?.preferences || {};
}
export async function mergeProfile(message, previous, updates) {
  const safe = Object.fromEntries(Object.entries(updates || {}).filter(([k, v]) =>
    ['brewMethod','roast','process','flavors','budget250g','skillLevel','grinder','optOut'].includes(k)
    && v !== null && v !== '' && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v))));
  if (!Object.keys(safe).length) return;
  await write('icb_bot_profiles', 'POST', { on_conflict: 'platform,account_id,contact_id' },
    { platform: message.platform, account_id: message.account_id, contact_id: message.contact_id,
      preferences: { ...previous, ...safe }, updated_at: new Date().toISOString() },
    'resolution=merge-duplicates,return=minimal');
}
export async function getInboundById(id) {
  const rows = await read('icb_bot_messages', { select: '*', id: `eq.${id}`, direction: 'eq.inbound', limit: 1 });
  return rows[0] || null;
}
export async function getDraft(id) {
  const rows = await read('icb_bot_messages', { select: '*', id: `eq.${id}`, direction: 'eq.outbound', limit: 1 });
  return rows[0] || null;
}
