// Ask Forge (v0.16.47): the app side of "Can I eat this?". The rules-based answer lives in ask-rules.js (shared with the server);
// this file builds today's context, finds the food's numbers, asks the optional AI and checks what comes back. Pure helpers plus one
// network call, no DOM. Nothing here runs against the network unless Settings → "Ask Forge AI" is on.
import { judge, dietConflict, cleanItem, cleanContext, foodFromQuestion, stricter, HEADLINE, VERDICTS, MAX_QUESTION } from './ask-rules.js';
import { dayTotals, logFields } from './core.js';
import { searchLocal, searchRemote } from './search.js';

export { foodFromQuestion, MAX_QUESTION, HEADLINE };
export const ASK_FAIL = 'The AI didn’t answer, so this is from your numbers.';
export const askAiOn = (settings) => !!(settings && settings.ask_ai === true);

/** Today's context for the question: eaten so far, the ceiling, the protein goal, calories burned (or null), the hour. */
export function contextFrom({ logs = [], day, targets, burned = null, now = new Date() }) {
  const t = dayTotals(logs, day);
  return cleanContext({
    eatenKcal: t.kcal, eatenProtein: t.protein_g, eatenCarbs: t.carbs_g, eatenFat: t.fat_g,
    ceiling: targets && targets.calories, proteinGoal: targets && targets.proteinG, burned: Number.isFinite(burned) && burned > 0 ? burned : null, hour: now.getHours(),
  });
}

/** "bowl of oatmeal" → ["bowl of oatmeal", "oatmeal"]: the amount word never helps a food search. */
export function queryVariants(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  const plain = q.replace(/^(?:(?:a|an|the|some|one|half|1|2) )?(?:(?:big|small|large|tiny|little) )?(?:bowl|slice|piece|cup|glass|handful|scoop|serving|bite|bar|can|bottle|bag|pack|packet|tub|container|spoonful|bit|few) of /, '').trim();
  return plain && plain !== q ? [q, plain] : [q];
}

/** Finds one serving of the food: My foods and recents first, then USDA when `online` is true. → the cleaned item or null. */
export async function lookupFood(query, { foods = [], logs = [], online = true, remote = searchRemote } = {}) {
  const variants = queryVariants(query);
  const q = variants[variants.length - 1];
  if (q.length < 2) return null;
  for (const v of variants) {
    const local = searchLocal(v, { foods, logs, limit: 3 }).map(cleanItem).filter((i) => i && i.kcal > 0);
    if (local.length) return { ...local[0], from: 'mine' };
  }
  if (!online) return null;
  try {
    const res = await remote(q);
    const hit = (res.items || []).map(cleanItem).find((i) => i && i.kcal > 0);
    return hit ? { ...hit, from: 'usda' } : null;
  } catch { return null; }
}

/** The answer from the numbers alone: { source: 'rules', verdict, headline, reason, better, item, numbers, factor } or null. */
export function localAnswer(item, ctx, prefs) {
  const j = judge(item, ctx, prefs);
  return j ? { source: 'rules', verdict: j.verdict, headline: j.headline, reason: j.reason, better: j.better, item: cleanItem(item), numbers: j.numbers, factor: j.factor, conflict: j.conflict } : null;
}

/**
 * Checks an answer from the server against the same rules; null if it is malformed. The app's rules have the last word: if they are
 * stricter than the server's verdict, their verdict and sentence win.
 */
export function checkAnswer(raw, ctx, prefs) {
  if (!raw || typeof raw !== 'object' || !VERDICTS.includes(raw.verdict)) return null;
  const item = cleanItem(raw.item);
  if (!item) return null;
  const rules = judge(item, ctx, prefs);
  if (!rules) return null;
  const verdict = rules.conflict ? 'better' : stricter(rules.verdict, raw.verdict);
  const str = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const mine = verdict === raw.verdict && !rules.conflict;
  return {
    source: 'ai', verdict, headline: HEADLINE[verdict],
    reason: (mine && str(raw.reason, 280)) || (verdict === rules.verdict ? rules.reason : 'Something else would suit your day better.'),
    better: verdict === 'better' ? (mine && !dietConflict(str(raw.better, 160), prefs) && str(raw.better, 160)) || rules.better : '',
    item, numbers: rules.numbers, factor: verdict === 'yes' ? 1 : verdict === 'half' ? 0.5 : 0, conflict: rules.conflict,
  };
}

/** Asks the server. Resolves to a checked answer; rejects with a short message so the sheet can fall back to the numbers. `call` is js/functions.js call. */
export async function requestAnswer({ question, item, ctx, prefs, call }) {
  const send = {
    question: String(question || '').slice(0, MAX_QUESTION), ctx,
    prefs: { diets: prefs.diets, avoid: prefs.avoid },
    ...(item ? { item: { name: item.name, kcal: item.kcal, protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g } } : {}),
  };
  let res;
  try { res = await call('askForge', send, { timeout: 30000 }); } catch (e) { throw new Error(e && e.message ? e.message : ASK_FAIL); }
  const answer = checkAnswer(res && res.answer, ctx, prefs);
  if (!answer) throw new Error(ASK_FAIL);
  return answer;
}

/** The food_logs fields for "Log it" (portion 1) or "Log half" (0.5). The entry is named as the food, with the portion noted. */
export function askLogFields(answer, portion, { meal, day }) {
  const f = portion === 0.5 ? 0.5 : 1;
  const it = answer.item;
  const r1 = (n) => Math.round(n * f * 10) / 10;
  return logFields({
    item: { name: it.name, kcal: it.kcal * f, protein_g: r1(it.protein_g), carbs_g: r1(it.carbs_g), fat_g: r1(it.fat_g), portion: f === 0.5 ? 'Half a serving' : it.serving },
    servings: 1, meal, day,
  });
}
