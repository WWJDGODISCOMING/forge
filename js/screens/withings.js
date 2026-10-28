// Settings → Withings (connect, status, Sync now, review queue, disconnect) and Settings → Withings →
// Data check (what the free API returns for every metric, webhook proof, backfill, saved reports, and the
// "safe to cancel Withings+?" verdict). Everything here is read from users/{uid}/integrations/withings and
// body_measures, which only Cloud Functions write.
import { state, units as getUnits } from '../state.js';
import { haptics } from '../ui/haptic.js';
import { esc, $, $$, sheet, toast, formatDay, todayKey } from '../ui.js';
import { serverErrorText, errorFor } from '../ui/errors.js';
import { fieldStatus } from '../health/status.js';
import { reviewBodyMeasure, bulkNotMe, putMany, readAll, newRecord } from '../db.js';
import { formatWeight, weightToDisplay, weightFromInput, weightUnit } from '../units.js';
import { classify, verdict, compare, STATE_LABEL, median, yearRows, backfillYears } from '../withings/check.js';
import { reviewQueue, byDay, suggestCutoff, underCutoff, parseWeightCSV, planCsvImport, csvAccounted, importMessage } from '../withings/review.js';
import { fmtMetric, KEY_OF_TYPE } from '../withings/body.js';
import { icon, emptyState } from '../ui/icons.js';
import { openExternal } from '../native/bridge.js';
import { needsActivityScope } from '../steps-source.js';

const W = () => (state.integrations && state.integrations.withings) || null;
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const mins = (s) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
const call = async (...args) => (await import('../functions.js')).call(...args);

const EXISTING_ACCOUNT = 'Log in with your <b>existing</b> Withings account. Don’t create a new one: Withings accounts made after October 12, 2026 need Withings+ to share data, and yours doesn’t.';

let connectUrl = null; // the Withings sign-in link, ready to tap (popup blockers never see it)
let busy = '';
let cutoffInput = null; // the "Not me: all under X" value, in display units, once you've changed it
let showAllReview = false;
const REVIEW_DAYS = 15;

export function renderWithings(el, sub) {
  if (sub === 'check') return renderCheck(el);
  const w = W();
  const u = getUnits();
  const connected = !!(w && w.connected);
  const profileKg = (state.profile && state.profile.weightKg) || null;
  const review = reviewQueue(state.weights, state.body_measures, profileKg);
  const days = byDay(review);
  const suggested = suggestCutoff(state.weights, profileKg);
  const cutDisp = cutoffInput != null ? cutoffInput : suggested != null ? niceCutoff(suggested, u) : null;
  const cutKg = cutDisp != null ? weightFromInput(String(cutDisp), u) : null;
  const under = underCutoff(review, cutKg);
  const bf = (w && w.backfill) || {};
  const years = backfillYears(bf);
  const csvCount = state.weights.filter((x) => x.source === 'withings_csv').length;

  // connected but nothing has arrived: no weigh-in time, no Withings weights or measurements, and no import numbers yet
  const noData = connected && !w.last_weigh_in_at && !bf.weighins && !bf.groups && !csvCount && !state.weights.some((x) => x.source === 'withings') && !(state.body_measures || []).length;
  const readErr = errorFor(state.serverErrors, ['body_measures', 'integrations']);
  el.innerHTML = `
    <section class="stack">
      <h1>Withings</h1>
      ${readErr ? `<div class="notice warn">${esc(serverErrorText(readErr, 'Withings'))}</div>` : ''}

      ${!connected ? `
      <div class="card stack" data-not-connected>
        ${emptyState({ art: 'scale', icon: 'scale', title: 'No scale connected yet', text: 'Your scale’s weigh-ins and body composition arrive in Forge on their own, history included.' })}
        <p class="callout" data-one-account>${icon('info')}<span>This scale isn’t linked to your Forge account yet. You can still log your weight by hand.</span></p>
        <p class="callout warn">${icon('warn')}<span>Log in with your <b>existing</b> Withings account. Don’t create a new one.</span></p>
        ${connectUrl ? `
          <a class="btn primary" href="${esc(connectUrl)}" target="_blank" rel="noopener" data-go>Continue to Withings ${icon('chev')}</a>
          <p class="small muted">On the Withings page, tap <b>Log in</b> (not “Create account”), then <b>Allow</b>. When it says “Connected”, come back here.</p>`
        : `<button class="btn primary" data-connect data-own-haptic ${busy === 'connect' ? 'disabled' : ''}>${busy === 'connect' ? 'Preparing…' : 'Connect Withings'}</button>`}
        <details class="learn-more small"><summary>Learn more</summary>
          <div class="stack">
            <p class="small muted"><b>One scale, one Forge account (for now).</b> A Withings scale can only link to a single Forge account at the moment. To log by hand, tap <b>Log weight</b> on Today, or <b>Progress → + Log weight</b>.</p>
            <p class="small muted">Weigh-ins land a few minutes after you step off, and your full Withings history comes in too.</p>
            <p class="small muted">${EXISTING_ACCOUNT}</p>
          </div>
        </details>
      </div>` : `
      ${w.needs_reconnect ? `<div class="notice warn">Withings stopped accepting Forge’s sign-in. <button class="link" data-connect data-own-haptic>Connect again</button> (${EXISTING_ACCOUNT})</div>` : ''}
      ${needsActivityScope(w) ? `<p class="small muted" data-steps-note>Want your Withings steps too? <button class="link" data-connect data-own-haptic>Reconnect to add steps</button></p>` : ''}
      ${connectUrl && w.needs_reconnect ? `<a class="btn" href="${esc(connectUrl)}" target="_blank" rel="noopener" data-go>Continue to Withings →</a>` : ''}
      <div class="card stack">
        <div class="row between center"><p class="label">Connected</p><span class="small muted">${esc(w.model || 'Scale')}</span></div>
        <div class="stats stats-fit" data-wd-stats>
          <div><span>Last weigh-in</span><b>${w.last_weigh_in_at ? when(w.last_weigh_in_at) : '—'}</b></div>
          <div><span>Arrived in</span><b>${w.last_latency_s == null ? '<small class="muted" data-arrived>waiting for your next weigh-in</small>' : mins(w.last_latency_s)}</b></div>
          <div><span>Notifications</span><b>${w.subscription_ok === true ? 'On' : w.subscription_ok === false ? 'Off' : '…'}</b></div>
        </div>
        ${noData ? `<div data-no-data>${emptyState({ art: 'weigh', icon: 'scale', title: 'No weigh-ins yet', text: 'Step on your scale and it shows up here in a few minutes. Your history comes in too.', action: { attr: `data-sync data-own-haptic ${busy === 'sync' ? 'disabled' : ''}`, label: busy === 'sync' ? 'Syncing…' : 'Sync now' } })}</div>` : ''}
        <p class="small muted" data-history>${historyLine(bf)}</p>
        ${years.length ? `<details class="small"><summary>History by year</summary>
          <ul class="list dc-years">${years.map((y) => `<li><span>${y.year}</span><small class="muted">${y.weighins.toLocaleString()} weigh-in${y.weighins === 1 ? '' : 's'} · ${y.groups.toLocaleString()} measurements</small></li>`).join('')}</ul></details>` : ''}
        <button class="btn ghost small" data-reimport data-own-haptic ${busy === 'reimport' || (!bf.done && !bf.error && bf.updated_at && Date.now() - Date.parse(bf.updated_at) < 30 * 60000) ? 'disabled' : ''}>${busy === 'reimport' ? 'Starting…' : 'Re-import history'}</button>
        <p class="small muted">Re-import asks Withings for everything again, year by year, without disconnecting. Nothing is duplicated, and weigh-ins you deleted or marked “Not me” stay gone.</p>
        <div class="row gap">
          ${noData ? '' : `<button class="btn ghost grow" data-sync data-own-haptic ${busy === 'sync' ? 'disabled' : ''}>${busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>`}
          <a class="btn ghost grow" href="#/withings/check">Data check</a>
        </div>
        <p class="small muted">Last synced ${when(w.last_sync_at)}. Weigh-ins normally arrive by themselves; Sync now is for when one hasn’t.</p>
        ${w.last_error_code ? `<p class="small muted">Last problem: <code>${esc(w.last_error_code)}</code>${/enqueue/.test(w.last_error_code) ? ' — see docs/withings.md → “If the import or notifications never start”.' : ''}</p>` : ''}
      </div>`}

      ${review.length ? `
      <div class="card stack" data-review>
        <p class="label">Is this you? <span class="muted">(${review.length.toLocaleString()})</span></p>
        <p class="small muted">Weigh-ins Withings wasn’t sure about, and ones far from your own weight at the time (probably someone else in the family). They stay out of your trend and body stats until you decide.</p>
        ${cutDisp != null ? `
        <div class="stack bulk">
          <label class="row gap center"><span class="small">Not me: everything under</span>
            <input type="number" inputmode="decimal" name="cutoff" value="${cutDisp}" step="1" class="short" aria-label="Weight cutoff"><span class="small">${weightUnit(u)}</span></label>
          <p class="small muted" data-preview>${under.count ? `${under.count.toLocaleString()} weigh-in${under.count === 1 ? '' : 's'} from ${formatDay(under.from, { month: 'short', year: 'numeric' })} to ${formatDay(under.to, { month: 'short', year: 'numeric' })}` : 'Nothing in the list is under that weight.'}</p>
          <button class="btn small" data-under ${under.count ? '' : 'disabled'}>Not me: ${under.count.toLocaleString()} under ${cutDisp} ${weightUnit(u)}</button>
        </div>` : ''}
        ${(showAllReview ? days : days.slice(0, REVIEW_DAYS)).map((g) => `
        <div class="review-day">
          <div class="row between center"><p class="small"><b>${formatDay(g.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b></p>
            ${g.items.length > 1 ? `<button class="btn ghost small" data-notme-day="${esc(g.day)}">Not me — whole day (${g.items.length})</button>` : ''}</div>
          <ul class="list">${g.items.map((d) => `
            <li><div><b>${d.kg == null ? 'No weight' : formatWeight(d.kg, u)}</b><small class="muted">${timeOnly(d.measured_at)}${d.reason === 'outlier' ? ' · far from your weight' : ' · Withings unsure'}</small></div>
              <div class="row gap"><button class="btn small" data-me="${esc(d.id)}">That’s me</button><button class="btn ghost small" data-notme="${esc(d.id)}">Not me</button></div></li>`).join('')}
          </ul>
        </div>`).join('')}
        ${!showAllReview && days.length > REVIEW_DAYS ? `<button class="btn ghost small" data-review-all>Show all ${days.length} days</button>` : ''}
      </div>` : ''}

      <div class="card stack">
        <p class="label">Import weight.csv</p>
        <p class="small muted">From a Withings data export (Health Mate → Settings → Download my data). Use it if the history import can’t reach your older weigh-ins. Rows Forge already has from Withings are skipped, and importing the same file again adds nothing.</p>
        <label class="btn ghost small file"><input type="file" accept=".csv,text/csv" name="wcsv" hidden ${busy === 'csv' ? 'disabled' : ''}>${busy === 'csv' ? 'Importing…' : 'Choose weight.csv'}</label>
        ${csvCount ? `<p class="small muted" data-csv-count>${csvCount.toLocaleString()} weigh-ins imported from weight.csv.</p>` : ''}
      </div>

      ${connected ? '<button class="btn danger-ghost" data-disconnect>Disconnect Withings</button>' : ''}
      <p class="small muted">Forge uses Withings’ official API with read-only access to your measurements. Your Withings sign-in tokens live only on Forge’s server, never in the app.</p>
    </section>`;

  const connectBtns = $$('[data-connect]', el);
  connectBtns.forEach((b) => (b.onclick = async () => {
    busy = 'connect';
    renderWithings(el);
    try {
      const r = await call('withingsAuthStart');
      connectUrl = r.url;
      haptics.success();
      setTimeout(() => { connectUrl = null; }, 9 * 60 * 1000); // the link expires after 10 minutes
    } catch (e) {
      haptics.warning();
      toast(e.message);
    }
    busy = '';
    renderWithings(el);
  }));
  const go = $('[data-go]', el);
  if (go) go.addEventListener('click', (e) => {
    // iPhone app: open Withings' page over Forge (Safari view) instead of leaving the app.
    if (openExternal(go.href)) e.preventDefault();
    setTimeout(() => { connectUrl = null; }, 1000);
  });
  const sync = $('[data-sync]', el);
  if (sync) sync.onclick = async () => {
    busy = 'sync';
    renderWithings(el);
    try {
      const r = await call('withingsSyncNow', {}, { timeout: 130000 });
      haptics.success();
      toast(r.created ? `${r.created} new measurement${r.created === 1 ? '' : 's'}` : 'Up to date');
    } catch (e) {
      haptics.warning();
      toast(e.message);
    }
    busy = '';
    renderWithings(el);
  };
  const item = (id) => review.find((q) => q.id === id);
  $$('[data-me]', el).forEach((b) => (b.onclick = () => item(b.dataset.me) && reviewBodyMeasure(item(b.dataset.me), true)));
  $$('[data-notme]', el).forEach((b) => (b.onclick = () => item(b.dataset.notme) && reviewBodyMeasure(item(b.dataset.notme), false)));
  $$('[data-notme-day]', el).forEach((b) => (b.onclick = () => {
    const g = days.find((x) => x.day === b.dataset.notmeDay);
    if (!g) return;
    bulkNotMe(g.items);
    toast(`Removed ${g.items.length} weigh-ins`);
  }));
  const cut = $('input[name=cutoff]', el);
  if (cut) cut.addEventListener('input', () => {
    const v = Number(cut.value);
    cutoffInput = Number.isFinite(v) && v > 0 ? v : null;
    const kg = cutoffInput != null ? weightFromInput(String(cutoffInput), u) : null;
    const p = underCutoff(review, kg);
    $('[data-preview]', el).textContent = p.count ? `${p.count.toLocaleString()} weigh-in${p.count === 1 ? '' : 's'} from ${formatDay(p.from, { month: 'short', year: 'numeric' })} to ${formatDay(p.to, { month: 'short', year: 'numeric' })}` : 'Nothing in the list is under that weight.';
    const btn = $('[data-under]', el);
    btn.disabled = !p.count;
    btn.textContent = `Not me: ${p.count.toLocaleString()} under ${cut.value} ${weightUnit(u)}`;
  });
  const underBtn = $('[data-under]', el);
  if (underBtn) underBtn.onclick = () => {
    const kg = cut ? weightFromInput(String(cut.value), u) : null;
    const p = underCutoff(review, kg);
    if (!p.count) return;
    bulkNotMe(p.items);
    cutoffInput = null;
    toast(`Removed ${p.count} weigh-ins`);
  };
  const allBtn = $('[data-review-all]', el);
  if (allBtn) allBtn.onclick = () => { showAllReview = true; renderWithings(el); };
  const re = $('[data-reimport]', el);
  if (re) re.onclick = async () => {
    busy = 'reimport';
    renderWithings(el);
    try {
      await call('withingsReimport');
      haptics.success();
      toast('History import started');
    } catch (e) {
      haptics.warning();
      toast(e.message);
    }
    busy = '';
    renderWithings(el);
  };
  const file = $('input[name=wcsv]', el);
  if (file) file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    busy = 'csv';
    renderWithings(el);
    try {
      const r = await importWeightCsv(await f.text());
      toast(importMessage(r), 5000);
    } catch (e) {
      toast(e.message);
    }
    busy = '';
    renderWithings(el);
  });
  const dis = $('[data-disconnect]', el);
  if (dis) dis.onclick = () => openDisconnect(el);
}

/** The history line under the connected card. */
export function historyLine(bf) {
  const n = (x) => (x || 0).toLocaleString();
  const what = bf.weighins != null ? `${n(bf.weighins)} weigh-ins (${n(bf.groups)} measurements)` : `${n(bf.groups)} measurements`;
  if (bf.error) return `History import stopped (<code>${esc(bf.error)}</code>) after ${what}. Try Re-import; if it stops again, run the data check and send it to me.`;
  if (bf.done) return `History: ${what} since ${dateOnly(bf.from)}`;
  if (!bf.updated_at && !bf.groups) return 'History: starting…';
  return `History: importing… ${what} so far${bf.year ? `, now at ${bf.year}` : ''}${bf.from ? ` (back to ${dateOnly(bf.from)})` : ''}`;
}

const timeOnly = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

/** A round cutoff in display units (nearest 5 lb or 2 kg) for the "Not me: all under X" control. */
export function niceCutoff(kg, u) {
  const v = weightToDisplay(kg, u);
  const step = u === 'metric' ? 2 : 5;
  return Math.round(v / step) * step;
}

/** Import Withings' weight.csv as scale weigh-ins (source withings_csv). Returns { added, skipped, unreadable }. */
async function importWeightCsv(text) {
  const { rows, skipped: unreadable } = parseWeightCSV(text);
  if (!rows.length) throw new Error('No weigh-ins found in that file.');
  const existing = await readAll('weights'); // includes deleted ones, so a "Not me" isn't brought back
  const plan = planCsvImport(rows, existing);
  await putMany('weights', plan.add.map((r) => newRecord(r, { id: r.id, source: 'withings_csv' })));
  try { localStorage.setItem(CSV_KEY, String(rows.length)); } catch { /* private mode */ }
  return { added: plan.add.length, skipped: plan.already + plan.matched, unreadable };
}

function openDisconnect(el) {
  sheet('Disconnect Withings', (body, close) => {
    body.innerHTML = `
      <div class="stack">
        <p>Forge stops receiving weigh-ins and forgets its Withings sign-in. Your Withings account and scale aren’t affected.</p>
        <label class="choice check small"><input type="checkbox" name="wipe"><span>Also delete the synced Withings data from Forge<small>Body measurements and Withings weigh-ins. Your own logged weights stay.</small></span></label>
        <button class="btn danger" data-ok>Disconnect</button>
      </div>`;
    $('[data-ok]', body).onclick = async () => {
      const wipe = $('input[name=wipe]', body).checked;
      $('[data-ok]', body).disabled = true;
      try {
        await call('withingsDisconnect', { deleteData: wipe });
        close();
        toast('Withings disconnected');
      } catch (e) {
        toast(e.message);
        $('[data-ok]', body).disabled = false;
      }
    };
  });
}

// ---------- data check ----------
/** The nightly 90-day comparison with Withings (removals from the Withings app, and its safety stop). */
export function reconcileLine(r) {
  if (!r) return '<p class="small muted" data-reconcile>Nightly check for weigh-ins deleted in the Withings app: hasn’t run yet (04:00 each night).</p>';
  const at = r.at ? when(r.at) : 'last night';
  if (r.aborted) return `<p class="small" data-reconcile>${icon('warn')} Nightly check ${at}: <b>stopped for safety</b>. Withings listed far fewer weigh-ins than Forge has (${r.suspicious || 'many'} would have gone; the limit is 3 or 20% of the last 90 days, whichever is more), so nothing was removed.</p>`;
  const bits = [`${r.removed || 0} removed`];
  if (r.restored) bits.push(`${r.restored} restored`);
  return `<p class="small muted" data-reconcile>Nightly check ${at}: ${bits.join(', ')} (weigh-ins deleted in the Withings app in the last 90 days).</p>`;
}

let picked = []; // report indexes ticked for Compare (the last two count)
const CSV_KEY = 'forge.withings.csvRows';
const csvRows = () => { try { const v = localStorage.getItem(CSV_KEY); return v ? Number(v) : null; } catch { return null; } };

let csvAcc = null; // csvAccounted() over every weights doc, deleted ones included
let csvAccFor = ''; // what it was computed from, so the check isn't re-read on every render
let csvAccUid = null;
function refreshCsvAccounted(el) {
  const uid = state.user ? state.user.uid : null;
  if (uid !== csvAccUid) { csvAccUid = uid; csvAcc = null; csvAccFor = ''; } // another account: start over
  const sig = state.weights.length + ':' + state.weights.filter((x) => x.source === 'withings_csv').length;
  if (sig === csvAccFor) return;
  csvAccFor = sig;
  readAll('weights').then((all) => {
    const n = csvAccounted(all);
    if (n !== csvAcc) {
      csvAcc = n;
      if (el.isConnected && el.querySelector('[data-wf]')) renderCheck(el);
    }
  }, () => {});
}

/** One line on the Apple Health bridge for the data check (watch data comes from there, not from Withings). */
function appleLine() {
  const st = fieldStatus(state.health_daily || [], todayKey());
  if (!st.lastDay) return 'Watch data (HRV, sleep, resting heart rate, wrist temperature) comes from Apple Health. Not set up yet.';
  const on = st.fields.filter((f) => f.lastDay).length;
  return `Watch data comes from Apple Health: ${on} of ${st.fields.length} kinds received, latest day ${formatDay(st.lastDay, { month: 'short', day: 'numeric' })}.`;
}

function renderCheck(el) {
  const w = W();
  const u = getUnits();
  const report = w && w.data_check;
  const rows = report ? classify(report) : [];
  // weight.csv imports still count after "Not me" (state.weights hides deleted docs), so read them all.
  const csvImported = csvAcc != null ? csvAcc : state.weights.filter((x) => x.source === 'withings_csv').length;
  refreshCsvAccounted(el);
  const v = verdict(report, { csvRows: csvRows(), csvImported });
  const yrs = yearRows(report);
  const history = (w && w.data_check_history) || [];
  const lat = (report && report.latencies_s) || (w && w.latencies_s) || [];
  const med = median(lat);
  const sel = picked.filter((i) => history[i]).sort((a, b) => a - b);
  const cmp = sel.length === 2 ? compare(history[sel[0]], history[sel[1]]) : null;
  const beforeNov = Date.now() < Date.parse('2026-11-01T04:00:00Z');

  el.innerHTML = `
    <section class="stack">
      <h1>Data check</h1>
      ${!w || !w.connected ? '<div class="notice warn">Connect Withings first.</div>' : ''}
      <div class="card stack">
        <p class="small muted">Asks Withings for every measurement type over your whole history and shows what the free API actually returns. Run it while subscribed, save it, and run it again after Withings+ ends.</p>
        <button class="btn" data-run ${busy === 'check' || !w || !w.connected ? 'disabled' : ''}>${busy === 'check' ? 'Checking… (up to a minute)' : report ? 'Run again' : 'Run check'}</button>
        ${report ? `<p class="small muted">Last run ${when(report.ran_at)} · ${esc(report.model || 'model unknown')}${report.devices && report.devices.length ? ` · scale last synced ${when(report.devices[0].last_session)}` : ''}</p>` : ''}
      </div>

      ${report ? `
      <div class="card">
        <p class="label">Metrics</p>
        <ul class="list dc-list">${rows.map((r) => `
          <li class="dc-${r.state}">
            <div><b>${esc(r.label)}</b>
              <small class="muted">${esc(STATE_LABEL[r.state])}${r.state === 'received'
                ? ` · ${esc(fmtMetric(KEY_OF_TYPE[r.last_code] || '', r.last_value, u))} · ${dateOnly(r.last)} · ${r.count.toLocaleString()} since ${dateOnly(r.first)}`
                : r.note ? ` · ${esc(r.note)}` : ''}</small></div>
            <code class="dc-codes" title="Withings meastype code${r.codes.length === 1 ? '' : 's'}">${r.state === 'received' ? '' : 'asked '}${r.codes.join(', ')}${r.positions && r.positions.length ? ` · pos ${r.positions.join(',')}` : ''}</code>
          </li>`).join('')}
        </ul>
        ${report.rejected && report.rejected.length ? `<p class="small muted">Withings rejected type${report.rejected.length === 1 ? '' : 's'} ${report.rejected.join(', ')} (unknown to its API).</p>` : ''}
        <p class="small muted">Codes are Withings API measure types (1 = weight, 6 = fat %, 76 = muscle…), so you can match each row with the Withings app.</p>
      </div>

      <div class="card stack">
        <p class="label">Webhook and history</p>
        <div class="stats">
          <div><span>Notifications</span><b>${report.subscription && report.subscription.present ? (report.subscription.key_ok ? 'On' : 'Old URL') : 'Off'}</b></div>
          <div><span>Median arrival</span><b>${mins(med)}</b></div>
          <div><span>Weigh-ins seen</span><b>${lat.length}/7</b></div>
        </div>
        <p class="small muted">Last notification ${when(report.last_notify_at)} · last arrival ${mins(lat[lat.length - 1])}</p>
        <p class="small"><b>Weigh-ins</b> (what weight.csv lists)</p>
        <div class="stats">
          <div><span>Withings has</span><b data-ww>${(report.withings_weight_groups ?? 0).toLocaleString()}</b></div>
          <div><span>Forge has</span><b data-wf>${(report.stored_weight_groups ?? 0).toLocaleString()}</b></div>
          <div><span>weight.csv</span><b>${csvRows() == null ? '—' : csvRows().toLocaleString()}</b></div>
        </div>
        ${report.stored_not_me ? `<p class="small muted" data-notme-count>Forge’s count includes ${report.stored_not_me.toLocaleString()} you marked “Not me” or deleted (they’re accounted for, just not in your trend).</p>` : ''}
        ${csvImported ? `<p class="small muted">Plus ${csvImported.toLocaleString()} imported from weight.csv.</p>` : ''}
        ${yrs.length ? `<details class="small" data-years ${yrs.some((r) => r.forge < r.withings) ? 'open' : ''}><summary>By year</summary>
          <table class="dc-years"><thead><tr><th>Year</th><th>Withings</th><th>Forge</th></tr></thead><tbody>${yrs.map((r) => `<tr class="${r.forge < r.withings ? 'dc-lost' : ''}"><td>${r.year}</td><td>${r.withings.toLocaleString()}</td><td>${r.forge.toLocaleString()}</td></tr>`).join('')}</tbody></table>
          <p class="small muted">If Withings shows nothing before a year that your weight.csv has, the free API doesn’t return those readings: import weight.csv on the Withings screen.</p></details>` : ''}
        ${report.types_list_rejected ? '<p class="small muted">Withings rejected Forge’s list of measurement types, so the check asked for every type instead.</p>' : ''}
        <p class="small muted">Oldest ${dateOnly(report.backfill && report.backfill.from)} · all measurement groups: Withings ${(report.groups ?? 0).toLocaleString()}, Forge ${(report.stored_groups ?? 0).toLocaleString()} (includes heart-rate-only and nerve-only readings, and ones you deleted)</p>
        <label class="field"><span class="small muted">Rows in weight.csv from your Withings export, <b>not counting the header row</b></span>
          <input type="number" inputmode="numeric" name="csv" value="${csvRows() ?? ''}" placeholder="e.g. 1243"></label>
        ${reconcileLine(report.last_reconcile || (w && w.last_reconcile))}
      </div>

      <div class="card">
        <p class="label">Apple Health</p>
        <p class="small muted" data-apple-line>${appleLine()}</p>
        <a class="link small" href="#/apple">Apple Health status ${icon('chev')}</a>
      </div>

      <div class="card stack">
        <p class="label">Saved reports</p>
        <div class="row gap"><input name="label" value="${beforeNov ? 'subscribed' : 'after cancelling'}" maxlength="40" aria-label="Report name" class="grow"><button class="btn small" data-save data-own-haptic ${busy === 'save' ? 'disabled' : ''}>Save report</button></div>
        ${history.length ? `<ul class="list dc-saved">${history.map((h, i) => `
          <li><label class="choice check small"><input type="checkbox" name="cmp" value="${i}" ${sel.includes(i) ? 'checked' : ''}><span>${esc(h.label)}<small>${when(h.saved_at)}</small></span></label></li>`).join('')}</ul>
          <p class="small muted">Tick two to compare.</p>` : '<p class="small muted">None yet.</p>'}
        ${cmp ? `<ul class="list dc-cmp">${cmp.map((c) => `<li class="${c.lost ? 'dc-lost' : c.changed ? 'dc-changed' : ''}"><span>${esc(c.label)}</span><small>${esc(STATE_LABEL[c.before].split(' ')[0])} ${c.before_count} → ${esc(STATE_LABEL[c.after].split(' ')[0])} ${c.after_count}${c.lost ? ' · lost' : ''}</small></li>`).join('')}</ul>
          <p class="small">${cmp.some((c) => c.lost) ? `${icon('warn')} Something stopped arriving. You can resubscribe to Withings+ and nothing is deleted on their side.` : `${icon('check')} Nothing lost between these two reports.`}</p>` : ''}
      </div>

      <div class="card verdict ${v.safe ? 'ok' : 'warn'}">
        <p class="label">Safe to cancel Withings+?</p>
        <p><b>${esc(v.text)}</b></p>
        ${v.blockers.length ? `<ul class="reasons">${v.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        ${v.decisions.length ? `<p class="small muted">Not on the free API (still free to view in the Withings app; decide whether to enter them by hand monthly): ${v.decisions.map(esc).join(', ')}.</p>` : ''}
      </div>` : ''}
    </section>`;

  const run = $('[data-run]', el);
  if (run) run.onclick = async () => {
    busy = 'check';
    renderCheck(el);
    try {
      await call('withingsDataCheck', { action: 'run' }, { timeout: 300000 });
      toast('Check finished');
    } catch (e) {
      toast(e.message);
    }
    busy = '';
    renderCheck(el);
  };
  const save = $('[data-save]', el);
  if (save) save.onclick = async () => {
    busy = 'save';
    renderCheck(el);
    try {
      await call('withingsDataCheck', { action: 'save', label: $('input[name=label]', el).value });
      haptics.success();
      toast('Report saved');
    } catch (e) {
      haptics.warning();
      toast(e.message);
    }
    busy = '';
    renderCheck(el);
  };
  const csv = $('input[name=csv]', el);
  if (csv) csv.addEventListener('change', () => {
    try { csv.value ? localStorage.setItem(CSV_KEY, String(Math.max(0, Math.round(Number(csv.value))))) : localStorage.removeItem(CSV_KEY); } catch { /* private mode */ }
    renderCheck(el);
  });
  $$('input[name=cmp]', el).forEach((c) => c.addEventListener('change', () => {
    const i = Number(c.value);
    picked = c.checked ? [...picked.filter((x) => x !== i), i].slice(-2) : picked.filter((x) => x !== i);
    renderCheck(el);
  }));
}

