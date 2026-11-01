// Headless adaptation of the tested Coffee Compass heuristics in 3lokai/icb-v2.
// Reference: src/lib/tools/compass/{compassEngine,compassActions,compassSymptoms}.ts
const extraction = {
  sour: -2, sharp: -1, acidic: -1, vegetal: -2, salty: -2, hollow: -1,
  thin: -1, bitter: 2, harsh: 2, astringent: 2, dry: 1, chalky: 1,
  woody: 2, smoky: 2, watery: 0, weak: 0, heavy: 0, muddy: 1, flat: -1, dull: -1
};
const strength = {
  thin: -2, hollow: -1, watery: -2, weak: -2, heavy: 2, muddy: 2, harsh: 1,
  astringent: 1, bitter: 0, sour: 0, flat: 0
};
const aliases = {
  v60: 'pour_over', chemex: 'pour_over', kalita_wave: 'pour_over', pourover: 'pour_over',
  aeropress: 'immersion', french_press: 'immersion', cold_brew: 'immersion',
  espresso: 'espresso', moka_pot: 'moka_pot', south_indian_filter: 'filter'
};
export function diagnoseBrew(symptoms = [], method = 'pour_over', roast) {
  const selected = [...new Set(symptoms.map(s => String(s).toLowerCase()))].filter(s => s === 'sour_and_bitter' || s in extraction);
  if (!selected.length) return { needsDetails: true, advice: 'Ask what tastes wrong (sour, bitter, thin, muddy), brew method, grinder setting, recipe and brew time.' };
  const hasUnder = selected.some(s => (extraction[s] || 0) < -0.5);
  const hasOver = selected.some(s => (extraction[s] || 0) > 0.5);
  const uneven = selected.includes('sour_and_bitter') || (hasUnder && hasOver);
  const n = selected.length;
  const ex = Math.max(-3, Math.min(3, 1.5 * selected.reduce((sum, s) => sum + (extraction[s] || 0), 0) / n));
  const st = Math.max(-3, Math.min(3, 1.5 * selected.reduce((sum, s) => sum + (strength[s] || 0), 0) / n));
  const group = aliases[String(method).toLowerCase()] || String(method).toLowerCase();
  let action = '', extra = '';
  if (uneven) {
    action = 'Improve evenness: check particle distribution, pouring consistency and channeling before adjusting grind.';
  } else if (ex < -0.5) {
    action = group === 'espresso' ? 'Try grinding slightly finer to slow the shot.' :
      group === 'immersion' ? 'Try a slightly longer steep, changing one variable only.' : 'Try grinding a little finer.';
    extra = 'Often points toward lower extraction; compare the next cup side-by-side.';
  } else if (ex > 0.5) {
    action = group === 'espresso' ? 'Try a slightly coarser grind to shorten the shot.' :
      group === 'immersion' ? 'Try a slightly shorter steep.' : 'Try grinding a little coarser.';
    extra = 'May reflect higher extraction, but roast character and water chemistry also matter.';
  } else if (st < -0.5) {
    action = 'Try increasing the coffee dose slightly while keeping water quantity steady.';
  } else if (st > 0.5) {
    action = 'Try adding a bit more brew water or reducing dose.';
  } else {
    action = 'The symptoms do not strongly indicate a single extraction issue. Check dose, water, grind and tasting temperature.';
  }
  if (roast === 'dark' && /hotter|temperature/i.test(action)) extra += ' Avoid aggressive temperature increases for dark roasts.';
  return { bucket: uneven ? 'UNEVEN' : ex < -0.5 ? 'UNDER' : ex > 0.5 ? 'OVER' : st < -0.5 ? 'WEAK' : st > 0.5 ? 'STRONG' : 'BALANCED',
    extractionScore: Number(ex.toFixed(2)), strengthScore: Number(st.toFixed(2)),
    advice: action, caveat: extra.trim(), selectedSymptoms: selected,
    reference: 'ICB Coffee Compass', url: 'https://www.indiancoffeebeans.com/tools/coffee-compass' };
}
export function brewRatio(coffeeGrams, ratio = 16) {
  const dose = Number(coffeeGrams), factor = Number(ratio);
  if (!(dose > 0 && dose <= 200 && factor >= 1 && factor <= 30)) throw new Error('Invalid brew ratio or dose');
  return { coffeeGrams: dose, waterGrams: Number((dose * factor).toFixed(1)), ratio: `1:${factor}` };
}
export function detectRecipe(text) {
  const g = String(text).match(/(\d+(?:\.\d+)?)\s*g\s*(?:of\s*)?(?:beans|coffee)/i) || String(text).match(/(?:coffee|dose)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*g/i);
  const ratio = String(text).match(/1\s*:\s*(\d+(?:\.\d+)?)/);
  if (!g) return null;
  return brewRatio(Number(g[1]), ratio ? Number(ratio[1]) : 16);
}
