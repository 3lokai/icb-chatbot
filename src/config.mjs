const text = (key, fallback = '') => process.env[key]?.trim() || fallback;
const num = (key, fallback) => {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const config = {
  port: num('PORT', 8080),
  botMode: text('BOT_MODE', 'draft'),
  workerIntervalMs: num('WORKER_INTERVAL_MS', 10000),
  workerBatchSize: Math.min(num('WORKER_BATCH_SIZE', 3), 20),
  maxAgeMinutes: num('BOT_MAX_AGE_MINUTES', 1440),
  llmProvider: text('LLM_PROVIDER', 'openrouter'),
  openrouterKey: text('OPENROUTER_API_KEY'),
  openrouterModel: text('OPENROUTER_MODEL', 'openrouter/free'),
  openaiKey: text('OPENAI_API_KEY'),
  openaiModel: text('OPENAI_MODEL', 'gpt-4.1-mini'),
  supabaseUrl: text('SUPABASE_URL'),
  supabaseKey: text('SUPABASE_SERVICE_ROLE_KEY'),
  siteUrl: text('ICB_SITE_BASE', 'https://www.indiancoffeebeans.com'),
  icbApiBase: text('ICB_API_BASE', 'https://www.indiancoffeebeans.com'),
  icbApiKey: text('ICB_API_KEY'),
  sanityProject: text('SANITY_PROJECT_ID', 'otnc59kw'),
  sanityDataset: text('SANITY_DATASET', 'production'),
  sanityVersion: text('SANITY_API_VERSION', '2024-01-01'),
  metaAppSecret: text('META_APP_SECRET'),
  metaVerifyToken: text('META_VERIFY_TOKEN'),
  metaGraphVersion: text('META_GRAPH_VERSION', 'v25.0'),
  whatsappToken: text('META_WHATSAPP_TOKEN'),
  whatsappNumberId: text('META_WHATSAPP_PHONE_NUMBER_ID'),
  facebookToken: text('META_FACEBOOK_PAGE_TOKEN'),
  facebookPageId: text('META_FACEBOOK_PAGE_ID'),
  instagramLogin: text('META_INSTAGRAM_LOGIN_MODE', 'instagram'),
  instagramUserId: text('META_INSTAGRAM_USER_ID'),
  instagramToken: text('META_INSTAGRAM_TOKEN'),
  adminToken: text('ADMIN_TOKEN')
};
export function assertServerConfig() {
  if (!['draft', 'auto', 'off'].includes(config.botMode)) throw new Error('BOT_MODE must be draft, auto, or off');
  if (!config.supabaseUrl || !config.supabaseKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!config.metaAppSecret || !config.metaVerifyToken) throw new Error('META_APP_SECRET and META_VERIFY_TOKEN are required');
  if (!config.icbApiKey) console.warn('ICB_API_KEY missing — coffee recommendations will report API unavailable.');
  if (!config.openrouterKey && !config.openaiKey) console.warn('LLM key missing — live messages cannot receive generated replies.');
}
