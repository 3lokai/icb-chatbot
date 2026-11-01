import { config } from './config.mjs';
import { requestJson } from './net.mjs';
let cache = { expires: 0, articles: [] };
const query = `*[_type == "article" && defined(slug.current) && !(_id in path("drafts.**")) && draft != true && metadata.noIndex != true] | order(date desc)[0...250]{_id,title,excerpt,"slug":slug.current,difficulty,tags,brewingMethod,"bodyText":pt::text(body),faqItems[]{question,answer}}`;
export async function articles() {
  if (cache.expires > Date.now()) return cache.articles;
  const url = new URL(`https://${config.sanityProject}.api.sanity.io/v${config.sanityVersion}/data/query/${config.sanityDataset}`);
  url.searchParams.set('query', query);
  const result = await requestJson(url, {}, 18000);
  if (!Array.isArray(result.result)) throw new Error('Unexpected Sanity query response');
  cache = { expires: Date.now() + 10 * 60_000, articles: result.result };
  return cache.articles;
}
const stop = new Set(['the', 'and', 'that', 'with', 'have', 'from', 'what', 'this', 'coffee', 'beans', 'want', 'need', 'make', 'how', 'does', 'their', 'should', 'when', 'about', 'would', 'for', 'using', 'some', 'more', 'into']);
function terms(text) { return [...new Set((String(text).toLowerCase().match(/[a-z]{3,}/g) || []).filter(t => !stop.has(t)))]; }
export function findArticles(allArticles, userMessage, intent = 'knowledge', limit = 3) {
  const words = terms(userMessage);
  const docs = allArticles.map(a => {
    const title = String(a.title || '').toLowerCase();
    const tags = (a.tags || []).join(' ').toLowerCase();
    const desc = [a.excerpt, a.brewingMethod].join(' ').toLowerCase();
    const body = String(a.bodyText || '').slice(0, 12000).toLowerCase();
    let score = words.reduce((sum, w) => sum + (title.includes(w) ? 9 : 0) +
      (tags.includes(w) ? 6 : 0) + (desc.includes(w) ? 3 : 0) + (body.includes(w) ? 0.3 : 0), 0);
    if (intent === 'progression' && a.difficulty === 'beginner') score += 2;
    return { a, score };
  }).filter(x => x.score > 0);
  return docs.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.a);
}
export function articleUrl(doc) { return `${config.siteUrl}/learn/${encodeURIComponent(doc.slug)}`; }
export function summarizeArticles(docs) {
  return docs.map((a, i) => `Source ${i + 1}: ${a.title} (${articleUrl(a)})\n${String(a.excerpt || '').slice(0, 350)}\n${String(a.bodyText || '').slice(0, 1400)}\n${(a.faqItems || []).slice(0, 2).map(x => x.question + ': ' + (typeof x.answer === 'string' ? x.answer : '')).join('\n')}`).join('\n\n');
}
