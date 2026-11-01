import { config } from './config.mjs';
import { requestJson } from './net.mjs';
let nextCallAt = 0;
async function throttle() {
  // Single-instance protection for OpenRouter's free-model RPM cap.
  const spacing = Math.max(3500, Number(process.env.LLM_MIN_INTERVAL_MS || 3500));
  const when = Math.max(Date.now(), nextCallAt);
  nextCallAt = when + spacing;
  const delay = when - Date.now();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}
function provider() {
  if (config.llmProvider === 'openai') {
    if (!config.openaiKey) throw new Error('OPENAI_API_KEY is missing');
    return { url: 'https://api.openai.com/v1/chat/completions', key: config.openaiKey, model: config.openaiModel };
  }
  if (!config.openrouterKey) throw new Error('OPENROUTER_API_KEY is missing');
  return { url: 'https://openrouter.ai/api/v1/chat/completions', key: config.openrouterKey, model: config.openrouterModel };
}
export async function complete(messages, { json = false, maxTokens = 460 } = {}) {
  const llm = provider();
  await throttle();
  const payload = { model: llm.model, temperature: json ? 0.15 : 0.45, max_tokens: maxTokens, messages };
  // Do not require JSON mode: free models differ in JSON schema support.
  const response = await requestJson(llm.url, { method: 'POST', headers: {
    authorization: `Bearer ${llm.key}`, 'content-type': 'application/json',
    ...(config.llmProvider !== 'openai' ? { 'HTTP-Referer': config.siteUrl, 'X-Title': 'ICB Barista AI' } : {})
  }, body: JSON.stringify(payload) }, 32000);
  let value = response?.choices?.[0]?.message?.content;
  if (Array.isArray(value)) value = value.filter(x => x.type === 'text').map(x => x.text).join('');
  if (typeof value !== 'string' || !value.trim()) throw new Error('LLM returned no text');
  return { text: value.trim(), model: response.model || llm.model };
}
export function decodeJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {
    const from = cleaned.indexOf('{'), to = cleaned.lastIndexOf('}');
    if (from < 0 || to <= from) throw new Error('LLM planner did not return valid JSON');
    return JSON.parse(cleaned.slice(from, to + 1));
  }
}
export async function plan(message, preferences, history = []) {
  const recent = history.slice(-6).map(x => `${x.role}: ${x.content}`).join('\n').slice(0, 2000);
  const { text } = await complete([
    { role: 'system', content: `You classify a conversation with an Indian specialty coffee assistant. Respond ONLY as JSON.\nSchema: {"intent":"recommend|diagnose|calculator|grind|progression|knowledge|other", "preferences":{"brewMethod":string|null,"roast":string|null,"process":string|null,"flavors":string[]|null,"budget250g":number|null,"skillLevel":"beginner|intermediate|advanced"|null,"grinder":string|null}, "symptoms":string[]}.\nRecommend means looking to BUY coffee beans/roaster suggestions, not brewing tips. Diagnose means fixing a disappointing cup. Progression means a learning path. Calculator means water:coffee quantity ratio. Grind means grinder settings. For missing preferences set null, do not infer fake facts. budget250g is INR per 250g; if user gives whole-bag budget without pack size set null. Known symptoms: sour,bitter,watery,thin,weak,flat,dull,astringent,harsh,heavy,muddy,dry,vegetal,salty,smoky,woody,sour_and_bitter. Map colloquial descriptions to nearest; limit 3. Process: washed,natural,honey,anaerobic,carbonic_maceration,monsooned. Roast: light,light_medium,medium,medium_dark,dark. JSON only.` },
    { role: 'user', content: `Previous preferences: ${JSON.stringify(preferences)}\nRecent turns:\n${recent}\nLatest message: ${message.slice(0, 2000)}` }
  ], { json: true, maxTokens: 270 });
  return decodeJson(text);
}
