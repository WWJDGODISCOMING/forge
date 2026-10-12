// Settings → Your data → Doctor summary (#/report). Built on this phone from data Forge already
// has; nothing is uploaded. "Print or save as PDF" uses the browser's print sheet (on iPhone: Share → Save to Files).
import { state, units as getUnits } from '../state.js';
import { $, $$, toast, todayKey } from '../ui.js';
import { icon, emptyState } from '../ui/icons.js';
import { weightSeries, myBodyMeasures, foodTargets } from '../derived.js';
import { buildSummary, summaryText, isEmpty, DEFAULT_RANGE } from '../health/clinical.js';
import { reportHtml, rangeSegHtml } from '../health/clinicalview.js';
import { summaryPdf } from '../health/pdf.js';
import { isNative } from '../native/bridge.js';
import { shareNative } from '../native/share.js';

let range = DEFAULT_RANGE;

export function renderReport(el) {
  const u = getUnits();
  const today = todayKey();
  const native = isNative();
  const s = buildSummary({
    range, today, rows: state.health_daily || [], measures: myBodyMeasures(), series: weightSeries(),
    workouts: state.workouts, cardio: state.cardio || [], profile: state.profile || {}, foodLogs: state.food_logs || [], targets: foodTargets(),
  });
  const empty = isEmpty(s);
  el.innerHTML = `
    <section class="stack report">
      <div class="rp-tools stack">
        <h1>Health summary</h1>
        <p class="muted">A one-to-two page summary for your doctor or dietitian, made on this phone. Nothing is uploaded or sent anywhere.</p>
        ${rangeSegHtml(range)}
        ${empty ? '' : `<div class="row gap rp-actions">
          <button class="btn primary grow" data-print>${icon(native ? 'share' : 'download')}${native ? 'Print or share' : 'Save PDF'}</button>
          <button class="btn ghost grow" data-share>${icon('share')}Share text</button></div>`}
      </div>
      ${empty
        ? `<div class="card" data-empty>${emptyState({ icon: 'heart', title: 'Nothing to summarise yet', text: `There is no data in the last ${range === 365 ? 'year' : `${range} days`}. Weigh in, train, or connect Apple Health or your scale and this fills in.`, action: { href: '#/body/log', label: 'Log a weigh-in' } })}</div>`
        : `<div class="rp-page stack">${reportHtml(s, u, today)}</div>`}
    </section>`;

  $$('input[name=rprange]', el).forEach((r) => r.addEventListener('change', () => { range = Number(r.value); renderReport(el); }));
  const print = $('[data-print]', el);
  if (print) {
    print.onclick = native ? async () => {
      // WKWebView can't print: make a letter-size PDF and open the iOS share sheet (Print, Save to Files, Mail, AirDrop).
      const label = print.innerHTML;
      print.disabled = true;
      print.textContent = 'Making the PDF…';
      try {
        await new Promise((r) => setTimeout(r, 30)); // let the label draw first
        await shareNative(summaryPdf(s, u, today), `forge-health-summary-${today}.pdf`, 'Forge health summary');
      } catch (e) {
        toast(e.message || 'Couldn’t open the share sheet. Try again.');
      } finally {
        if (print.isConnected) { print.disabled = false; print.innerHTML = label; }
      }
    } : () => window.print();
  }
  const share = $('[data-share]', el);
  if (share) share.onclick = async () => {
    const text = summaryText(s, u, today);
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied to your clipboard'); } catch { toast('Couldn’t copy. Try again.'); }
    };
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: 'Forge health summary', text }); } catch (e) { if (e && e.name !== 'AbortError') await copy(); }
  };
}
