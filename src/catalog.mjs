import { config } from './config.mjs';
import { requestJson } from './net.mjs';
const roastValues = new Set(['light', 'light_medium', 'medium', 'medium_dark', 'dark']);
const processValues = new Set(['washed', 'natural', 'honey', 'anaerobic', 'carbonic_maceration', 'monsooned', 'wet_hulled', 'pulped_natural']);
const methodAlias = { v60: 'pour_over', pourover: 'pour_over', 'pour over': 'pour_over', aeropress: 'aeropress', espresso: 'espresso', french_press: 'french_press', 'french press': 'french_press', moka: 'moka_pot', 'moka pot': 'moka_pot' };
export function catalogQuery(preferences = {}) {
  const params = new URLSearchParams({ page: '1', limit: '50', inStockOnly: '1', sort: 'newest' });
  if (roastValues.has(preferences.roast)) params.set('roastLevels', preferences.roast);
  if (processValues.has(preferences.process)) params.set('processes', preferences.process);
  if (Number.isFinite(Number(preferences.budget250g)) && Number(preferences.budget250g) > 0)
    params.set('maxPrice', String(preferences.budget250g));
  if (preferences.brewMethod) {
    const method = methodAlias[preferences.brewMethod.toLowerCase()] || preferences.brewMethod.toLowerCase();
    if (/^[a-z_]{2,25}$/.test(method)) params.set('brewMethodIds', method);
  }
  return params;
}
function candidates(response) {
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data?.items)) return response.data.items;
  throw new Error('Unexpected ICB coffees API response format');
}
function scoreCoffee(coffee, pref = {}) {
  let score = 0;
  if (pref.roast === coffee.roast_level) score += 3;
  if (pref.process === coffee.process) score += 3;
  if (pref.brewMethod) {
    const methods = coffee.brew_method_canonical_keys || [];
    if (methods.includes(methodAlias[pref.brewMethod?.toLowerCase()] || pref.brewMethod)) score += 3;
  }
  const haystack = [coffee.name, coffee.display_name, ...(coffee.flavor_keys || []), ...(coffee.tags || []),
    coffee.process, JSON.stringify(coffee.sensory_public || {})].join(' ').toLowerCase();
  for (const note of (Array.isArray(pref.flavors) ? pref.flavors : [])) {
    if (typeof note === 'string' && note.length > 2 && haystack.includes(note.toLowerCase())) score += 5;
  }
  if (Number(coffee.rating_count || 0) >= 3 && Number(coffee.rating_avg || 0) > 0) score += Math.min(2, Number(coffee.rating_avg) / 3);
  if (Number(coffee.in_stock_count || 0) > 0) score += 1;
  return score;
}
export function rankCoffees(items, preferences = {}, topN = 3) {
  return items.filter(c => c && c.in_stock_count > 0 && c.direct_buy_url !== 'null')
    .sort((a, b) => scoreCoffee(b, preferences) - scoreCoffee(a, preferences) ||
      (Number(a.best_normalized_250g) || Infinity) - (Number(b.best_normalized_250g) || Infinity))
    .slice(0, topN);
}
export async function getCoffeeRecommendations(preferences = {}) {
  if (!config.icbApiKey) throw new Error('ICB_API_KEY is not configured');
  const params = catalogQuery(preferences);
  const get = async () => candidates(await requestJson(new URL(`/api/v1/coffees?${params}`, config.icbApiBase), {
    headers: { 'X-API-Key': config.icbApiKey } }, 16000));
  let items = await get();
  // Relax method/process/roast, never stock or budget. Preserve budget limit in fallback.
  if (items.length < 3) {
    params.delete('brewMethodIds'); params.delete('processes');
    items = await get();
  }
  if (items.length < 3) { params.delete('roastLevels'); items = await get(); }
  return rankCoffees(items, preferences, 3);
}
export function renderCoffees(coffees) {
  return coffees.map((c, i) => {
    const name = (c.display_name || c.name || 'Coffee').replace(/[\r\n]/g, ' ').slice(0, 90);
    const roaster = (c.roaster_name || 'Unknown roaster').replace(/[\r\n]/g, ' ').slice(0, 70);
    const price = Number(c.best_normalized_250g);
    const priceText = Number.isFinite(price) && price > 0 ? `~₹${Math.round(price)}/250g` : 'Price varies';
    let link = c.direct_buy_url;
    if (!link || !/^https:\/\//.test(link)) link = `${config.siteUrl}/coffees/${encodeURIComponent(c.slug || '')}`;
    return `${i + 1}. ${name} — ${roaster} (${priceText})\n${[c.roast_level, c.process].filter(Boolean).join(' / ')}\n${link}`;
  }).join('\n\n');
}
