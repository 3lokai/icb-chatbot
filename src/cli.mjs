import { createReply } from './brain.mjs';
const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Usage: npm run ask -- "Suggest a fruity natural coffee under 600 INR per 250g"');
  process.exitCode = 1;
} else {
  try {
    const answer = await createReply(text);
    process.stdout.write(`${answer.text}\n\n[intent=${answer.intent}; model=${answer.model}]\n`);
  } catch (e) { console.error(String(e)); process.exitCode = 1; }
}
