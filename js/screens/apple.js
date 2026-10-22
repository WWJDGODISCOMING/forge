// Settings → Apple Health: the Shortcut token, the step-by-step Shortcut recipe, the Health export import
// (parsed on this phone; only daily summaries are sent), and a status check that shows which kinds of data
// have arrived. All data here is written by Cloud Functions; the app only reads it.
import { state } from '../state.js';
import { newRecord, put, patch, importedCardioIds } from '../db.js';
import { planWorkoutImport } from '../health/apple-workouts.js';
import { mergeEnergy, saveEnergy, loadEnergy, backfillStart, energyChanged, newerDays } from '../nutrition/balance.js';
import { esc, $, $$, sheet, toast, confirmSheet, todayKey, formatDay } from '../ui.js';
import { serverErrorText, errorFor } from '../ui/errors.js';
import { FIREBASE_CONFIG } from '../../config.js';
import { fieldStatus } from '../health/status.js';
import { currentReadiness } from '../health/today.js';
import { shiftDay } from '../health/metrics.js';
import { NEEDED_DAYS } from '../health/readiness.js';
import { icon } from '../ui/icons.js';
import { isNative } from '../native/bridge.js';
import { haptic } from '../ui/haptic.js';
import { requestAccess, sendLastDays, lastSent } from '../native/workouts-health.js';
import { autoReadMode, nativeReadKey, lastNativeRead, todayDue, backfillDone, markBackfillDone } from '../native/autoread.js';

const call = async (...args) => (await import('../functions.js')).call(...args);
const INGEST_URL = `https://us-east1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/healthIngest`;
const IMPORT_DAYS = 120; // how far back the export import reaches
const CHUNK = 100;

let busy = '';
let importState = null; // { phase, pct, text } while an import runs

const A = () => (state.integrations && state.integrations.apple) || {};
const ago = (iso) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 36 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const dayText = (d) => (d ? formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' }) : '—');

// ---------- iPhone app: read HealthKit directly (js/native/health.js) ----------
const NATIVE_KEY = () => nativeReadKey(state.user && state.user.uid);
let nativeState = null; // { text } while reading
const NOT_IN_HEALTHKIT = ['walkhr']; // not read from HealthKit (the plugin has no walking heart rate)
const lastNative = () => lastNativeRead(state.user && state.user.uid);

/** Keep Apple's resting/active energy per day on this phone (state.energy + localStorage). Never uploaded. */
export function storeEnergy(entries) {
  const uid = state.user && state.user.uid;
  const known = state.energy && Object.keys(state.energy).length ? state.energy : loadEnergy(uid);
  const energy = mergeEnergy(known, entries);
  if (!energyChanged(known, energy)) return false; // same numbers: no write, no state change, nothing redrawn
  saveEnergy(uid, energy);
  state.set({ energy });
  return true;
}

/** Write the planned Apple workouts as cardio rows. A deleted row is never touched. Returns how many were new or changed. */
async function saveWorkouts(workouts) {
  if (!workouts.length) return 0;
  const existing = await importedCardioIds().catch(() => new Map());
  const plan = planWorkoutImport(workouts, { existing, forgeWorkouts: state.workouts });
  const have = new Map(state.cardio.map((c) => [c.id, c]));
  let n = 0;
  for (const { id, fields } of plan.create) { put('cardio_sessions', newRecord(fields, { id, source: 'apple_health' })); n++; }
  for (const { id, fields } of plan.update) {
    const cur = have.get(id);
    if (cur && Object.keys(fields).every((k) => cur[k] === fields[k])) continue; // nothing new: no write
    patch('cardio_sessions', id, fields); n++;
  }
  return n;
}

/**
 * Read Apple Health on this phone and save the daily summaries, Apple Watch workouts (as cardio) and energy. The
 * first time it reaches back IMPORT_DAYS days; after that, from 3 days before the last read (late Watch syncs).
 * Resting/active energy for the last 30 days (and always today + yesterday) is read too and kept on this phone.
 * Returns { days, workouts }.
 */
export async function nativeHealthSync({ onText = () => {} } = {}) {
  const { readHealthDays, readHealthWorkouts, readHealthEnergy } = await import('../native/health.js');
  const last = lastNative();
  const today = todayKey();
  const since = last ? shiftDay(new Date(last).toLocaleDateString('en-CA'), -3) : shiftDay(today, -(IMPORT_DAYS - 1));
  onText('Reading Apple Health on this phone…');
  const { days, records } = await readHealthDays({ since });
  if (!records) throw new Error('Apple Health shared nothing with Forge. On your iPhone: Settings → Health → Data Access & Devices → Forge → Turn On All. Then try again.');
  let sent = 0;
  for (let i = 0; i < days.length; i += CHUNK) {
    onText(`Saving ${days.length} daily summaries…`);
    const r = await call('importHealthDays', { days: days.slice(i, i + CHUNK) });
    sent += r.days || 0;
  }
  let workouts = 0;
  try {
    const uid = state.user && state.user.uid;
    const first = !backfillDone(uid); // the first read since 0.16.45 on this phone reaches back 30 days for workouts and energy, even if daily summaries were read before
    const from30 = shiftDay(today, -29);
    onText('Reading Apple Watch workouts…');
    workouts = await saveWorkouts(await readHealthWorkouts({ since: first && from30 < since ? from30 : since }));
    const known = state.energy && Object.keys(state.energy).length ? state.energy : loadEnergy(uid);
    storeEnergy(await readHealthEnergy({ since: first ? from30 : backfillStart(known, today, shiftDay) }));
    if (first) markBackfillDone(uid);
  } catch { /* workouts and energy are extras: the daily summaries are already saved */ }
  try { localStorage.setItem(NATIVE_KEY(), String(Date.now())); } catch { /* private mode */ }
  return { days: sent, workouts };
}

/** "Saved 12 days and 3 workouts from Apple Health" / "Up to date". */
export const syncToast = ({ days, workouts }) => (days || workouts
  ? `Saved ${[days && `${days} ${days === 1 ? 'day' : 'days'}`, workouts && `${workouts} ${workouts === 1 ? 'workout' : 'workouts'}`].filter(Boolean).join(' and ')} from Apple Health`
  : 'Up to date');

let todayAt = 0;
let todayBusy = false;
/**
 * The cheap one: re-read only today's steps, active energy, exercise and resting energy (no history, no workouts),
 * at most every 3 minutes, whatever the 6 h full read says. Called on open, on resume, on pull-to-refresh on Today and
 * every few minutes while Today is showing. `force` skips the 3 minute wait (pull-to-refresh). The Today cards
 * update by themselves when health_daily changes; the energy lines update through state.energy.
 */
export async function refreshToday({ force = false } = {}) {
  if (!isNative() || !state.user || nativeState || todayBusy || !lastNative()) return false;
  const now = new Date();
  if (!force && !todayDue({ now, todayAt })) return false;
  todayBusy = true;
  todayAt = now.getTime();
  try {
    const { readHealthToday } = await import('../native/health.js');
    const { days, energy } = await readHealthToday({ now });
    storeEnergy(energy);
    const fresh = newerDays(days, state.health_daily);
    if (fresh.length) await call('importHealthDays', { days: fresh });
    return true;
  } catch { return false; } finally { todayBusy = false; }
}

let autoFailedAt = 0;
let morningAt = 0;
let morningFailedAt = 0;
let backfillFailedAt = 0;
/**
 * Called by the app on open and when it comes back to the front: a quiet read if the last one is 6 h old, or, after
 * 4:00, if today's overnight data hasn't arrived yet (at most every 20 min; js/native/autoread.js). Not while you're
 * reading by hand. The Today cards update by themselves when health_daily changes.
 */
export async function autoHealthSync({ force = false } = {}) {
  if (!isNative() || !state.user || nativeState || !lastNative()) return null;
  const now = new Date();
  const mode = autoReadMode({ now, last: lastNative(), today: todayKey(), rows: state.health_daily, failedAt: autoFailedAt, morningAt, morningFailedAt, backfill: !backfillDone(state.user.uid), backfillFailedAt });
  if (!mode) { await refreshToday({ force }); return null; }
  todayAt = now.getTime(); // the full read covers today too
  if (mode === 'backfill') backfillFailedAt = now.getTime(); // backs off 20 min unless it finishes (then the flag is set)
  morningAt = now.getTime(); // any auto read counts as the morning try, so the 20 minutes start now
  try { return await nativeHealthSync(); } catch {
    if (mode === 'backfill') backfillFailedAt = Date.now(); else if (mode === 'morning') morningFailedAt = Date.now(); else autoFailedAt = Date.now();
    return null;
  }
}

/** "Last saved: Push day · 182 kcal · 10:42 AM" / "Linked to your Apple Watch workout". */
function writeStatus() {
  const w = lastSent();
  if (!w) return 'Nothing saved yet. Workouts you finish from now on are sent.';
  if (w.health_write === 'linked') return 'Linked to your Apple Watch workout';
  const t = new Date(w.finished_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Last saved: ${w.label || 'Workout'}${w.kcal ? ` · ${Math.round(w.kcal)} kcal` : ''} · ${t}`;
}

function writeCard() {
  const st = state.settings || {};
  const on = !!st.health_write_workouts;
  const left = (state.workouts || []).some((w) => w.status === 'done' && !w.deleted && !w.health_write && Date.now() - Date.parse(w.finished_at) < 7 * 86400000);
  return `<div class="card stack" data-write>
    <div class="group"><label class="g-row sw" style="min-height:44px"><span class="g-text"><span>Save Forge workouts to Apple Health</span><small>Fills your Move and Exercise rings and shows in Activity sharing.</small></span><input type="checkbox" switch name="writeworkouts" ${on ? 'checked' : ''}></label></div>
    ${on ? `<p class="small" data-write-status>${esc(writeStatus())}</p>` : ''}
    ${on && left ? '<button class="btn ghost bigbtn" data-write-week>Also send the last 7 days</button>' : ''}
    <p class="small muted">Starting the Apple Watch Workout at the same time gives Watch-measured calories and heart rate. Forge links to it instead of saving a duplicate.</p>
  </div>`;
}

const WRITE_DENIED = 'Allow Forge to write Workouts and Active Energy in Settings → Health → Data Access & Devices → Forge.';

async function setWrite(el, box) {
  if (!box.checked) { patch('settings', 'main', { health_write_workouts: false }); haptic('select'); renderApple(el); return; }
  const status = await requestAccess();
  if (status === 'denied' || status === 'unavailable') {
    box.checked = false;
    toast(WRITE_DENIED, 6000);
    return;
  }
  patch('settings', 'main', { health_write_workouts: true, health_write_since: new Date().toISOString() });
  haptic('success');
  renderApple(el);
}

async function sendWeek(el, btn) {
  btn.disabled = true;
  const n = await sendLastDays(7).catch(() => 0);
  toast(n ? `Sent ${n} ${n === 1 ? 'workout' : 'workouts'} to Apple Health` : 'Nothing new to send', 3500);
  renderApple(el);
}

function nativeCard() {
  const last = lastNative();
  return `<div class="card stack" data-native-health>
    <p class="label">Apple Health on this iPhone</p>
    <p>Forge reads your Watch’s HRV, resting heart rate, sleep, wrist temperature, breathing, blood oxygen, cardio fitness, steps, exercise, workouts and calories burned straight from Apple Health. Only daily summaries and your workouts are saved. ${last ? '' : 'iOS asks once which data to share: turn them all on.'}</p>
    ${nativeState ? `<p class="small" aria-live="polite">${esc(nativeState.text)}</p>` : ''}
    <button class="btn bigbtn" data-native-read ${nativeState ? 'disabled' : ''}>${nativeState ? 'Reading…' : last ? 'Read Apple Health now' : 'Connect Apple Health'}</button>
    <p class="small muted">${last ? `Last read ${esc(ago(new Date(last).toISOString()))}. Forge reads again by itself when you open it. In the morning it checks every 20 minutes until last night’s sleep is in, then every 6 hours.` : `The first read brings in the last ${IMPORT_DAYS} days.`}</p>
  </div>`;
}

async function runNative(el) {
  if (nativeState) return;
  nativeState = { text: 'Asking Apple Health…' };
  renderApple(el);
  try {
    const r = await nativeHealthSync({ onText: (text) => { nativeState = { text }; const p = $('[data-native-health] [aria-live]', el); if (p) p.textContent = text; } });
    nativeState = null;
    toast(syncToast(r), 3500);
  } catch (e) {
    nativeState = null;
    toast(e.message || 'Couldn’t read Apple Health.', 5000);
  }
  renderApple(el);
}

const ACRONYMS = new Set(['HRV']);
const lowerLabel = (l) => (ACRONYMS.has(l) ? l : l.toLowerCase());
const WATCH_ONLY = new Set(['Wrist temperature', 'Cardio fitness', 'Exercise minutes']);
const joinWords = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

/** Short bold line, then the iOS path on its own line; the Watch sentence only if one of those kinds is missing. */
function missingNotice(labels) {
  const names = joinWords(labels.map(lowerLabel));
  const watch = labels.filter((l) => WATCH_ONLY.has(l));
  return `<div class="notice info small" data-missing style="display:grid;gap:6px">
      <b>Nothing yet for ${esc(names)}</b>
      <span>Settings → Health → Data Access &amp; Devices → Forge → <b>Turn On All</b></span>
      <span>Then tap Read Apple Health now.${watch.length ? ` ${esc(joinWords(watch.map(lowerLabel)).replace(/^./, (c) => c.toUpperCase()))} also ${watch.length > 1 ? 'need' : 'needs'} an Apple Watch that records ${watch.length > 1 ? 'them' : 'it'}.` : ''}</span>
    </div>`;
}

/** No active energy from Apple Health for today or the 2 days before (the Fitness Tracking switches may be off). */
const noRecentActive = (today) => ![0, 1, 2].some((i) => {
  const d = shiftDay(today, -i);
  return (state.health_daily || []).some((r) => (r.id || r.day) === d && r.active_kcal != null);
});

function statusCard() {
  const today = todayKey();
  const st = fieldStatus(state.health_daily, today, state.cardio);
  const r = currentReadiness();
  const a = A();
  const have = Math.min(NEEDED_DAYS, r.baselineDays || 0);
  const native = isNative();
  if (native) st.fields = st.fields.filter((f) => !NOT_IN_HEALTHKIT.includes(f.key)); // the plugin can't read these
  // After the first read: kinds HealthKit gave nothing for, with the exact switch to flip in iOS.
  const missing = native && lastNative() ? st.fields.filter((f) => !f.lastDay).map((f) => f.label) : [];
  const chips = st.fields.map((f) => `<div class="field-chip ${f.lastDay ? 'on' : 'off'}">
      <b>${esc(f.label)}</b><small>${f.lastDay ? `${f.count28} of last 28 days · last ${esc(dayText(f.lastDay))}` : 'Not received yet'}</small></div>`).join('');
  return `<div class="card stack apple-status" data-status>
    <p class="label">Data check</p>
    <p><b>${st.days ? `${st.days} days of Apple Health data` : 'No Apple Health data yet'}</b></p>
    <p class="small muted">Latest day: ${esc(dayText(st.lastDay))}${a.last_ingest_at ? ` · Shortcut ${esc(ago(a.last_ingest_at))}` : ''}${a.last_import_at ? ` · import ${esc(ago(a.last_import_at))}` : ''}</p>
    <div>
      <div class="ready-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${NEEDED_DAYS}" aria-valuenow="${have}"><i style="width:${Math.round((have / NEEDED_DAYS) * 100)}%"></i></div>
      <p class="small muted" style="margin-top:6px">${have >= NEEDED_DAYS ? 'Readiness has enough history.' : `Readiness needs ${NEEDED_DAYS} days of HRV, resting heart rate or sleep. You have ${have}.`}</p>
    </div>
    ${(a.rejected_last || []).length ? `<div class="notice warn small" data-rejected>${esc(rejectedText(a.rejected_last))}</div>` : ''}
    ${missing.length ? missingNotice(missing) : ''}
    ${native && lastNative() && noRecentActive(today) ? `<div class="notice info small" data-no-active><b>No calories burned in the last 3 days</b>
      <span>Check iPhone Settings → Privacy &amp; Security → Motion &amp; Fitness → Fitness Tracking, and Watch app → Privacy → Fitness Tracking.</span></div>` : ''}
    <div class="field-grid">${chips}</div>
  </div>`;
}

const REJECT_LABEL = {
  hrv_sdnn_ms: 'HRV', rhr_bpm: 'Resting heart rate', resp_rate: 'Breathing rate', wrist_temp_c: 'Wrist temperature', wrist_temp_delta_c: 'Wrist temperature',
  spo2_avg_pct: 'Blood oxygen', vo2max: 'Cardio fitness', walking_hr_avg: 'Walking heart rate', steps: 'Steps', active_kcal: 'Active energy',
  exercise_min: 'Exercise minutes', sleep: 'Sleep', sleep_text: 'Some sleep lines', sleep_segments: 'Some sleep lines', workouts: 'Some workouts', workouts_text: 'Some workouts',
  fallback_body: 'Body measurements', hrv_samples: 'HRV sample count',
};
/** "Wrist temperature arrived in a format Forge couldn't read." (field names only: the server never sends values). */
function rejectedText(fields) {
  const names = [...new Set(fields.map((f) => REJECT_LABEL[f] || 'One value'))];
  return `${names.join(', ')} arrived in a format Forge couldn’t read, so the last Shortcut run skipped ${names.length > 1 ? 'them' : 'it'}. Everything else was saved. Check that step in your Shortcut.`;
}

// Fill in once Christian has built the Shortcut from the recipe below and shared it (Shortcuts → Share → Copy iCloud
// Link). Build it with Import Questions on the token, so installing it asks for the token and nothing else.
// Empty until then: the screen shows the step-by-step recipe instead.
export const APPLE_SHORTCUT_URL = '';

// Overnight signals: the window is yesterday 6 pm → now, and only samples that END before 11 am today count.
const OVERNIGHT_TYPES = [
  ['Heart Rate Variability', 'hrv_sdnn_ms'],
  ['Resting Heart Rate', 'rhr_bpm'],
  ['Respiratory Rate', 'resp_rate'],
  ['Wrist Temperature', 'wrist_temp_c'],
  ['Blood Oxygen Saturation', 'spo2_avg_pct'],
];
// Daily totals: Group By Day gives Health’s own de-duplicated totals (iPhone + Watch aren’t added twice).
const TOTAL_TYPES = [
  ['Steps', 'steps'],
  ['Active Energy', 'active_kcal'],
  ['Exercise Minutes', 'exercise_min'],
];
const OTHER_TYPES = [
  ['Cardio Fitness (VO₂ max)', 'vo2max'],
  ['Walking Heart Rate Average', 'walking_hr_avg'],
];

/** A tappable code chip: copies its text. (Text inside <code> is hard to select on iPhone.) */
const copyChip = (text, label = text) => `<button type="button" class="copy-chip" data-copy-text="${esc(text)}" aria-label="Copy ${esc(label)}"><code>${esc(label).replace(/_/g, '_<wbr>')}</code><span aria-hidden="true">Copy</span></button>`;

function recipe() {
  const keyList = (types) => `<ul>${types.map(([n, k]) => `<li>${esc(n)} → ${copyChip(k)}</li>`).join('')}</ul>`;
  return `
  ${APPLE_SHORTCUT_URL ? `<div class="card stack">
    <p class="label">Easiest way</p>
    <p>Add the ready-made Shortcut. It asks for your token once, then you’re done.</p>
    <a class="btn bigbtn" href="${esc(APPLE_SHORTCUT_URL)}" rel="noopener">Add the Shortcut</a>
    <p class="small muted">Create your token above first and copy it. Shortcuts will ask for it while installing.</p>
  </div>` : ''}
  <details class="card" data-recipe>
    <summary>${APPLE_SHORTCUT_URL ? 'Or build it yourself' : 'Build the Shortcut'} (about 10 minutes, once)</summary>
    <div class="stack" style="margin-top:12px">
      <p class="callout">${icon('info')}<span>Uses the iPhone and Apple Watch you already have. Tap any <b>Copy</b> chip to copy that text.</span></p>
      <ol class="steps">
        <li><div><b>Create your token above</b> and copy it. You’ll paste it in step 6.</div></li>
        <li><div><b>Shortcuts app → + (new shortcut).</b> Name it <b>Forge Health</b>. Add <b>Current Date</b>, then <b>Adjust Date</b> → subtract <b>1 day</b>, then <b>Adjust Date</b> again → <b>Start of Day</b> plus <b>18 hours</b>. Call the result <b>Since</b> (yesterday 6 pm). Add <b>Current Date</b> → <b>Start of Day</b> plus <b>11 hours</b> and call it <b>Cutoff</b> (today 11 am).</div></li>
        <li><div><b>Overnight signals.</b> For each, add <b>Find Health Samples</b> with <b>End Date is after Since</b> <i>and</i> <b>End Date is before Cutoff</b> (no limit), then <b>Get Details of Health Samples → Value</b>:
          ${keyList(OVERNIGHT_TYPES)}
          <ul><li>Only readings that end before 11 am count, so a daytime workout can’t change your overnight HRV. Forge does the averaging, so send the whole list. Use whatever units your phone shows (°F is fine): Forge converts.</li></ul></div></li>
        <li><div><b>Daily totals.</b> For each, add <b>Find Health Samples</b> with <b>Group By: Day</b> (Sort: Start Date, newest first, limit 2). Health adds up iPhone and Watch without counting anything twice. Send <b>today’s</b> total (the first group) under one key and <b>yesterday’s finished</b> total (the second group) under the <code>_yesterday</code> key:
          <ul>${TOTAL_TYPES.map(([n, k]) => `<li>${esc(n)} → ${copyChip(k)} and ${copyChip(`${k}_yesterday`)}</li>`).join('')}</ul></div></li>
        <li><div><b>Sleep:</b> Find Health Samples → <b>Sleep</b>, End Date is after Since. Add <b>Repeat with Each</b>. Inside, add <b>Text</b> with <code>Value,Start Date,End Date</code> (both dates as <b>ISO 8601</b>) and <b>Add to Variable</b> “SleepLines”. After the loop, <b>Combine Text</b> with New Lines. Send it as ${copyChip('sleep_text')}. A line Forge can’t read is skipped, the rest still counts.
          <ul><li>Optional: ${keyList(OTHER_TYPES)}</li><li>Optional: <b>Find Workouts</b> the same way as ${copyChip('workouts_text')} (type, start, minutes, kcal, heart rate).</li></ul></div></li>
        <li><div><b>Send it:</b> add <b>Dictionary</b> with ${copyChip('day')} = Current Date formatted <code>yyyy-MM-dd</code>, plus one item per key above (text value = that step’s result). Then <b>Get Contents of URL</b>:
          <ul><li>URL: ${copyChip(INGEST_URL, 'the Forge address')}</li><li>Method: <b>POST</b>, Request Body: <b>JSON</b> (the Dictionary)</li><li>Header: ${copyChip('Authorization')} = ${copyChip('Bearer <your token>', 'Bearer + your token')} (the token sheet has a button that copies it whole)</li></ul></div></li>
        <li><div><b>Run it once</b> and allow each Health type when iOS asks. Then come back here: the Data check above should show what arrived.</div></li>
      </ol>
    </div>
  </details>
  <details class="card">
    <summary>Make it run by itself every morning</summary>
    <div class="stack" style="margin-top:12px">
      <ol class="steps">
        <li><div><b>Shortcuts → Automation → + → Sleep → Waking Up.</b> Choose <b>Run Shortcut → Forge Health</b>, and set <b>Run Immediately</b> (not “Ask Before Running”).</div></li>
        <li><div><b>Optional evening run</b> for today’s steps and energy: make a copy of the shortcut called <b>Forge Evening</b> that sends <b>only</b> ${copyChip('day')} and the daily totals (steps, active energy, exercise minutes) and leaves out the overnight keys and sleep. Run it from another automation, <b>Time of Day</b> (say 9 pm), Run Immediately. That way it can never replace this morning’s HRV.</div></li>
      </ol>
      <p class="small muted">Health data is locked while the iPhone is locked, so a run can fail if you haven’t unlocked it yet. “Waking Up” fires right as you pick up the phone, which is why it’s the best trigger. If a morning is missed, the next run fills it in.</p>
    </div>
  </details>
  <details class="card">
    <summary>What iPhone can’t share (and what to do)</summary>
    <ul class="reasons" style="margin-top:12px">
      <li><b>ECG:</b> Shortcuts can’t read ECG recordings. A manual ECG log comes later.</li>
      <li><b>Wrist temperature</b> is missing from Shortcuts on some iOS versions. If yours doesn’t have it, skip that step. Everything else still works, and the export import below fills in temperature history.</li>
      <li><b>Weight and body fat</b> still come from your Withings scale directly. They only come through Health as a backup.</li>
    </ul>
  </details>`;
}

function importCard() {
  const s = importState;
  return `<div class="card stack" data-import>
    <p class="label">Start with your history</p>
    <p>Readiness compares today with your own last 28 days. Import your Health export once and it works from day one.</p>
    ${s ? `<div class="import-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.pct)}"><i style="width:${Math.round(s.pct)}%"></i></div>
       <p class="small" aria-live="polite">${esc(s.text)}</p>` : `
    <ol class="steps"><li><div>Health app → your picture (top right) → <b>Export All Health Data</b> → save to Files. It can take a few minutes.</div></li>
      <li><div>Tap the button and choose <b>export.zip</b>. Forge reads it <b>on this phone</b> and sends only small daily summaries (the last ${IMPORT_DAYS} days). The zip itself never leaves your phone.</div></li></ol>
    <label class="btn bigbtn file ${busy === 'import' ? 'disabled' : ''}">Choose export.zip<input type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" data-file hidden></label>`}
  </div>`;
}

export function renderApple(el) {
  const a = A();
  const has = !!a.connected;
  const readErr = errorFor(state.serverErrors, ['health_daily', 'integrations']);
  el.innerHTML = `
    <section class="stack">
      <h1>Apple Health</h1>
      ${readErr ? `<div class="notice warn">${esc(serverErrorText(readErr, 'Apple Health'))}</div>` : ''}
      <p class="muted">Bring your Watch’s overnight HRV, resting heart rate, sleep and wrist temperature into Forge for Readiness and your Forge Score. Everything stays in your own Forge account.</p>
      ${isNative() ? nativeCard() + writeCard() : ''}
      ${statusCard()}
      ${isNative() ? '<details class="card"><summary>Other ways: Shortcut or export file</summary><div class="stack" style="margin-top:12px">' : ''}
      <div class="card stack">
        <p class="label">Shortcut token</p>
        <p>${has ? 'A token is active. Your Shortcut uses it to send data to Forge.' : 'Make a token, then paste it into the Shortcut below. It works like a password for just this one job.'}</p>
        ${has && a.token_created_at ? `<p class="small muted">Made ${esc(ago(a.token_created_at))}.</p>` : ''}
        <button class="btn bigbtn" data-create ${busy === 'create' ? 'disabled' : ''}>${busy === 'create' ? 'Making it…' : has ? 'Make a new token' : 'Create token'}</button>
        ${has ? `<button class="btn ghost bigbtn" data-revoke ${busy === 'revoke' ? 'disabled' : ''}>Turn it off</button>` : ''}
      </div>
      ${recipe()}
      ${importCard()}
      ${isNative() ? '</div></details>' : ''}
      <div class="card stack">
        <p class="label">Delete Apple Health data</p>
        <p class="small muted">Removes every Apple Health day from Forge and turns the Shortcut token off. Your Withings data and your workouts stay.</p>
        <button class="btn danger-ghost bigbtn" data-delete ${busy === 'delete' ? 'disabled' : ''}>Delete Health data</button>
      </div>
      <p class="disclaimer">General fitness information, not medical advice.</p>
    </section>`;

  $$('[data-copy-text]', el).forEach((b) => (b.onclick = () => copyText(b.dataset.copyText, b)));
  const ww = $('input[name=writeworkouts]', el);
  if (ww) ww.addEventListener('change', () => setWrite(el, ww));
  const wk = $('[data-write-week]', el);
  if (wk) wk.onclick = () => sendWeek(el, wk);
  const nr = $('[data-native-read]', el);
  if (nr) nr.onclick = () => runNative(el);
  $('[data-delete]', el).onclick = () => deleteApple(el);
  $('[data-create]', el).onclick = () => createToken(el, has);
  const rv = $('[data-revoke]', el);
  if (rv) rv.onclick = () => revoke(el);
  const file = $('[data-file]', el);
  if (file) file.onchange = () => file.files[0] && runImport(el, file.files[0]);
}

/** Copy to the clipboard; the button says so for a moment. Falls back to selecting the text. */
async function copyText(text, btn) {
  const span = btn.querySelector('span') || btn;
  const was = span.textContent;
  try {
    await navigator.clipboard.writeText(text);
    span.textContent = 'Copied';
  } catch {
    const code = btn.querySelector('code');
    if (code) {
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    span.textContent = 'Selected: tap Copy';
  }
  setTimeout(() => { span.textContent = was; }, 2000);
}

async function deleteApple(el) {
  const ok = await confirmSheet({ title: 'Delete Apple Health data?', message: 'This removes all your Apple Health days from Forge and turns off the Shortcut token. Your Withings data and workouts stay. You can import your export again any time.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  busy = 'delete';
  renderApple(el);
  try {
    await call('deleteAppleHealthData');
    const uid = state.user && state.user.uid;
    try { localStorage.removeItem(`forge.energy.${uid || ''}`); } catch { /* private mode */ }
    state.set({ energy: {} });
    toast('Apple Health data deleted');
  } catch (e) {
    toast(e.message, 4000);
  }
  busy = '';
  renderApple(el);
}

function showToken(token) {
  sheet('Your Shortcut token', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <p class="notice warn small"><b>This is the only time you’ll see it.</b> Copy it now and paste it into your Shortcut. If you lose it, make a new one.</p>
        <div class="token-box" data-token>${esc(token)}</div>
        <button class="btn bigbtn" data-copy>Copy token</button>
        <button class="btn ghost bigbtn" data-copy-bearer>Copy “Bearer + token”</button>
        <button class="btn ghost bigbtn" data-copy-url>Copy the Forge address</button>
        <p class="small muted">Keep it private, like a password. Anyone with it could add data to your Forge. If it ever leaks, tap <b>Turn it off</b>.</p>
        <button class="btn ghost bigbtn" data-done>Done</button>
      </div>`;
    $('[data-copy]', body).onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(token);
        e.currentTarget.textContent = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents($('[data-token]', body));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        e.currentTarget.textContent = 'Selected: tap Copy in the menu';
      }
    };
    const plain = (sel, text, done) => {
      $(sel, body).onclick = async (e) => {
        const b = e.currentTarget;
        const was = b.textContent;
        try { await navigator.clipboard.writeText(text); b.textContent = done; } catch { b.textContent = 'Couldn’t copy: select the token above'; }
        setTimeout(() => { b.textContent = was; }, 2000);
      };
    };
    plain('[data-copy-bearer]', `Bearer ${token}`, 'Copied');
    plain('[data-copy-url]', INGEST_URL, 'Copied');
    $('[data-done]', body).onclick = close;
  });
}

async function createToken(el, rotating) {
  if (rotating) {
    const ok = await confirmSheet({ title: 'Make a new token?', message: 'Your current Shortcut stops working until you paste the new token into it.', confirmLabel: 'Make new token' });
    if (!ok) return;
  }
  busy = 'create';
  renderApple(el);
  try {
    const r = await call('createShortcutToken');
    busy = '';
    renderApple(el);
    showToken(r.token);
  } catch (e) {
    busy = '';
    renderApple(el);
    toast(e.message, 4000);
  }
}

async function revoke(el) {
  const ok = await confirmSheet({ title: 'Turn off the token?', message: 'Your Shortcut will stop sending data until you make a new token. Data already in Forge stays.', confirmLabel: 'Turn it off', danger: true });
  if (!ok) return;
  busy = 'revoke';
  renderApple(el);
  try {
    await call('revokeShortcutToken');
    toast('Token turned off');
  } catch (e) {
    toast(e.message, 4000);
  }
  busy = '';
  renderApple(el);
}

function setImport(el, s) {
  importState = s;
  const box = $('[data-import]', el);
  if (!box) return;
  const bar = $('.import-progress i', box);
  const text = $('[aria-live]', box);
  if (!bar || !text) return renderApple(el);
  bar.style.width = `${Math.round(s.pct)}%`;
  text.textContent = s.text;
}

async function runImport(el, file) {
  if (importState) return;
  busy = 'import';
  const since = shiftDay(todayKey(), -(IMPORT_DAYS - 1));
  importState = { pct: 0, text: 'Opening your export…' };
  renderApple(el);
  try {
    const [{ exportTextStream }, { parseExport }] = await Promise.all([import('../health/zip.js'), import('../health/apple-export.js')]);
    const stream = await exportTextStream(file, (p) => setImport(el, { pct: p * 80, text: `Reading your Health export on this phone… ${Math.round(p * 100)}%` }));
    const { days, records } = await parseExport(stream, { since });
    if (!days.length) throw new Error(records ? 'I found Health data, but none from the last few months.' : 'I couldn’t find HRV, heart rate or sleep data in that file.');
    let sent = 0;
    for (let i = 0; i < days.length; i += CHUNK) {
      setImport(el, { pct: 80 + (i / days.length) * 20, text: `Saving ${days.length} daily summaries to your Forge… (no raw data leaves your phone)` });
      const r = await call('importHealthDays', { days: days.slice(i, i + CHUNK) });
      sent += r.days;
    }
    importState = null;
    busy = '';
    toast(`Imported ${sent} days of history`, 3500);
  } catch (e) {
    importState = null;
    busy = '';
    toast(e.message || 'Couldn’t read that file.', 5000);
  }
  renderApple(el);
}
