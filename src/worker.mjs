import { config } from './config.mjs';
import { createReply } from './brain.mjs';
import { nextInbox, claimInbound, patchMessage, recentHistory, getProfile, mergeProfile, saveReply, getDraft, getInboundById } from './store.mjs';
import { sendMessage } from './meta.mjs';
import { safeError } from './net.mjs';
const active = new Set();
let polling = false;
function withinReplyWindow(message) {
  // Standard customer service window is 24 hours. Conservative 23h cutoff.
  return Date.now() - new Date(message.created_at).getTime() < 23 * 60 * 60_000;
}
export async function sendSavedReply(message, allowedStatus) {
  const original = message.reply_to ? await getInboundById(message.reply_to) : null;
  if (!original || !withinReplyWindow(original)) throw new Error('Original customer message is outside conservative 23h reply window; cannot send freeform text');
  // Acquire send lock. Failed/unknown sends NEVER retry automatically: Meta might already have delivered.
  const locked = await patchMessage(message.id, { status: 'sending', error: null }, { status: `eq.${allowedStatus}` });
  if (!locked.length) throw new Error('Reply is already being sent or status changed');
  try {
    const remote = await sendMessage(message, message.body);
    await patchMessage(message.id, { status: 'sent', sent_at: new Date().toISOString(), external_message_id: remote?.messages?.[0]?.id || remote?.message_id || null });
    return true;
  } catch (e) {
    await patchMessage(message.id, { status: 'failed', error: safeError(e) });
    throw e;
  }
}
export async function approveDraft(id) {
  const message = await getDraft(id);
  if (!message || message.status !== 'draft') throw new Error('Draft not found or no longer awaiting approval');
  return sendSavedReply(message, 'draft');
}
export async function workMessage(row) {
  if (active.has(row.id)) return;
  active.add(row.id);
  try {
    const claimed = await claimInbound(row);
    if (!claimed) return;
    if (claimed.attempts > 3) {
      await patchMessage(claimed.id, { status: 'failed', error: 'Too many processing attempts' });
      return;
    }
    if (config.botMode === 'off') {
      await patchMessage(claimed.id, { status: 'ignored' });
      return;
    }
    try {
      const [history, preferences] = await Promise.all([recentHistory(claimed), getProfile(claimed)]);
      const command = claimed.body.trim().toLowerCase();
      if (['stop', 'unsubscribe', 'opt out'].includes(command)) {
        await mergeProfile(claimed, preferences, { optOut: true });
        await patchMessage(claimed.id, { status: 'ignored' });
        return;
      }
      if (command === 'start') {
        await mergeProfile(claimed, preferences, { optOut: false });
        await patchMessage(claimed.id, { status: 'ignored' });
        return;
      }
      if (preferences.optOut === true) {
        await patchMessage(claimed.id, { status: 'ignored' });
        return;
      }
      const result = await createReply(claimed.body, { previous: preferences, history, channel: claimed.platform });
      const disclose = history.length === 0 ? "Hi, I'm ICB's AI coffee assistant.\n\n" : '';
      const outbound = await saveReply(claimed, disclose + result.text, config.botMode, result.model);
      if (Object.keys(result.preferences).length) await mergeProfile(claimed, preferences, result.preferences);
      await patchMessage(claimed.id, { status: 'done' });
      if (config.botMode === 'auto' && outbound?.status === 'ready') {
        if (withinReplyWindow(claimed)) await sendSavedReply(outbound, 'ready');
        else await patchMessage(outbound.id, { status: 'failed', error: 'Outside customer service reply window' });
      }
    } catch (e) {
      console.error('Message processing failed:', claimed.platform, safeError(e));
      await patchMessage(claimed.id, { status: 'failed', error: safeError(e) });
    }
  } finally { active.delete(row.id); }
}
export async function drainOnce() {
  if (polling) return;
  polling = true;
  try {
    const candidates = await nextInbox(config.workerBatchSize, config.maxAgeMinutes);
    await Promise.allSettled(candidates.map(workMessage));
  } catch (e) { console.error('Worker drain error:', safeError(e)); }
  finally { polling = false; }
}
export function runWorker() {
  void drainOnce();
  const timer = setInterval(() => void drainOnce(), config.workerIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
