import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.mjs';
import { requestJson } from './net.mjs';
export function verifySignature(body, signature, appSecret) {
  if (!appSecret || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(body).digest('hex'));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function parseMetaWebhook(payload) {
  const events = [];
  if (payload?.object === 'whatsapp_business_account') {
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      const accountId = String(value.metadata?.phone_number_id || '');
      for (const msg of value.messages || []) {
        const text = msg.type === 'text' ? msg.text?.body :
          msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title) :
          msg.type === 'button' ? msg.button?.text : null;
        if (text && accountId && msg.id && msg.from) events.push({ platform: 'whatsapp', accountId,
          contactId: String(msg.from), messageId: String(msg.id), text: String(text) });
      }
    }
  } else if (payload?.object === 'page' || payload?.object === 'instagram') {
    const platform = payload.object === 'page' ? 'facebook' : 'instagram';
    for (const entry of payload.entry || []) for (const event of entry.messaging || []) {
      const message = event.message;
      if (!message || message.is_echo || !message.mid || !event.sender?.id || !event.recipient?.id) continue;
      const msgText = message.text || message.quick_reply?.payload;
      if (msgText) events.push({ platform, accountId: String(event.recipient.id), contactId: String(event.sender.id),
        messageId: String(message.mid), text: String(msgText) });
    }
  }
  return events;
}
function assertAccount(event) {
  const expected = event.platform === 'whatsapp' ? config.whatsappNumberId :
    event.platform === 'facebook' ? config.facebookPageId : config.instagramUserId;
  if (!expected || expected !== event.accountId) throw new Error(`Unexpected/unconfigured ${event.platform} account`);
}
export function accountAllowed(event) {
  try { assertAccount(event); return true; } catch { return false; }
}
export function splitForChannel(text, platform) {
  const max = platform === 'instagram' ? 950 : platform === 'facebook' ? 1900 : 4000;
  const result = [];
  let remaining = String(text).trim();
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n\n', max);
    if (cut < max / 3) cut = remaining.lastIndexOf('\n', max);
    if (cut < max / 3) cut = remaining.lastIndexOf(' ', max);
    if (cut < max / 3) cut = max;
    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}
export async function sendMessage(message, text) {
  assertAccount({ platform: message.platform, accountId: message.account_id });
  let url, token, makeBody;
  if (message.platform === 'whatsapp') {
    token = config.whatsappToken;
    url = `https://graph.facebook.com/${config.metaGraphVersion}/${encodeURIComponent(message.account_id)}/messages`;
    makeBody = part => ({ messaging_product: 'whatsapp', to: message.contact_id, type: 'text', text: { body: part, preview_url: false } });
  } else if (message.platform === 'facebook') {
    token = config.facebookToken;
    url = `https://graph.facebook.com/${config.metaGraphVersion}/${encodeURIComponent(message.account_id)}/messages`;
    makeBody = part => ({ recipient: { id: message.contact_id }, messaging_type: 'RESPONSE', message: { text: part } });
  } else {
    token = config.instagramLogin === 'facebook' ? config.facebookToken : config.instagramToken;
    url = config.instagramLogin === 'facebook'
      ? `https://graph.facebook.com/${config.metaGraphVersion}/${encodeURIComponent(message.account_id)}/messages`
      : `https://graph.instagram.com/${config.metaGraphVersion}/${encodeURIComponent(message.account_id)}/messages`;
    makeBody = part => ({ recipient: { id: message.contact_id }, message: { text: part } });
  }
  if (!token) throw new Error(`No configured Meta token for ${message.platform}`);
  const delivered = [];
  for (const part of splitForChannel(text, message.platform)) {
    const answer = await requestJson(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(makeBody(part)) }, 10000);
    delivered.push(answer?.messages?.[0] || { id: answer?.message_id || null });
  }
  return { messages: delivered }; 
}
