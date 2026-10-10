import { state, units as getUnits } from '../state.js';
import { isNative } from '../native/bridge.js';
import { loadExpiryInfo } from '../native/expiry.js';
import { refreshRowHtml, openRefreshSheet } from '../native/refresh-ui.js';
import { photoStatus, downloadAllPhotos } from '../ui/photos.js';
import { patch, deleteAllUserData, clearLocalCache } from '../db.js';
import { signOut, reauth, deleteAccount, authErrorMessage } from '../auth.js';
import { exportJSON, exportWeightsCSV, exportWorkoutsCSV, exportCardioCSV, exportBodyCSV, exportFoodCSV } from '../export.js';
import { esc, $, $$, sheet, toast, confirmSheet } from '../ui.js';
import { formatHeight, formatWeight } from '../units.js';
import { GOALS } from '../nutrition/targets.js';
import { VERSION } from '../version.js';
import { unlockAudio, coach, sfx, beep } from '../ui/sound.js';
import { hapticSupport } from '../ui/haptic.js';
import { icon } from '../ui/icons.js';
import { photoSettingsHtml, bindPhotoSettings } from '../photos/settings.js';
import { missionSettings, setMissionSetting } from '../missions/store.js';
import { privacySettingsHtml, bindPrivacySettings } from '../native/lock-ui.js';

function withingsLine() {
  const w = state.integrations && state.integrations.withings;
  if (!w || !w.connected) return 'Not connected';
  if (w.needs_reconnect) return 'Needs reconnecting';
  return `Connected${w.model ? ` · ${esc(w.model)}` : ''}`;
}

function appleLine() {
  if (isNative() && !(state.health_daily || []).length) return 'Tap to connect';
  const a = (state.integrations && state.integrations.apple) || {};
  const n = (state.health_daily || []).length;
  if (a.connected) return n ? `Connected · ${n} days of data` : 'Connected · waiting for the first data';
  return n ? `${n} days imported` : 'Not set up';
}

export function renderSettings(el) {
  const u = getUnits();
  const p = state.profile;
  const st = state.settings || {};
  const pl = st.player === 'list' ? 'list' : 'guided';
  const coachMode = st.audio_coach || 'voice';
  const sfxOn = st.sfx !== false;
  const hapOn = st.haptics !== false;
  const hapSupport = hapticSupport();
  const ms = missionSettings();
  const nav = (href, ic, title, sub, attrs = '') => `
        <a class="g-row" href="${href}" ${attrs}><span class="g-ic">${icon(ic)}</span><span class="g-text"><span>${title}</span><small>${sub}</small></span><span class="chev">${icon('chev')}</span></a>`;
  el.innerHTML = `
    <section class="stack">
      <h1>Settings</h1>

      <div class="group" data-tour="settings-profile">
        <a class="g-row" href="#/profile"><span class="g-ic">${icon('person')}</span><span class="g-text"><span>${esc(GOALS[p.goal]?.label || 'Profile')}</span><small>${esc(p.age)} yrs · ${formatHeight(p.heightCm, u)}${p.targetWeightKg ? ` · goal ${formatWeight(p.targetWeightKg, u, 0)}` : ''}</small></span><span class="chev">${icon('chev')}</span></a>
      </div>

      <p class="sec-title">Units</p>
      <div class="seg" role="radiogroup" aria-label="Units">
        <label><input type="radio" name="units" value="imperial" ${u === 'imperial' ? 'checked' : ''}><span>lb, ft, in</span></label>
        <label><input type="radio" name="units" value="metric" ${u === 'metric' ? 'checked' : ''}><span>kg, cm</span></label>
      </div>

      <p class="sec-title">Workouts</p>
      <div class="group">
        <div class="g-row col static"><span>Workout screen</span>
          <div class="seg" role="radiogroup" aria-label="Workout screen">
            <label><input type="radio" name="player" value="guided" ${pl === 'guided' ? 'checked' : ''}><span>Guided</span></label>
            <label><input type="radio" name="player" value="list" ${pl === 'list' ? 'checked' : ''}><span>List</span></label>
          </div>
        </div>
        <div class="g-row col static"><span>Coach audio</span>
          <div class="seg" role="radiogroup" aria-label="Coach audio">
            <label><input type="radio" name="coach" value="off" ${coachMode === 'off' ? 'checked' : ''}><span>Off</span></label>
            <label><input type="radio" name="coach" value="beeps" ${coachMode === 'beeps' ? 'checked' : ''}><span>Beeps</span></label>
            <label><input type="radio" name="coach" value="voice" ${coachMode === 'voice' ? 'checked' : ''}><span>Voice</span></label>
          </div>
        </div>
        <label class="g-row sw"><span class="g-text"><span>Sound effects</span><small>Power-up, PR and finish sounds.</small></span><input type="checkbox" switch name="sfx" ${sfxOn ? 'checked' : ''}></label>
        <label class="g-row sw"><span class="g-text"><span>Haptic tick</span><small>${hapSupport === 'native' || hapSupport === 'switch' ? 'A light tap on tabs, controls and Done set.' : 'Not supported on this device.'}</small></span><input type="checkbox" switch name="haptics" ${hapOn ? 'checked' : ''}></label>
      </div>
      <p class="sec-foot">Coach audio mixes with your music and is silent when your ringer switch is off.</p>
      <div class="stack" data-photos hidden>
        <p class="small"><b>Demo photos</b> <span class="muted" data-photo-status></span></p>
        <button class="btn ghost" data-photo-dl>Download demo photos</button>
      </div>

      <p class="sec-title">Missions</p>
      <div class="group">
        <div class="g-row static ms-set"><span class="g-text"><span>Steps</span><small>A daily mission with Apple Health.</small></span>
          <div class="ms-stepper"><button type="button" data-steps="-500" aria-label="500 fewer steps">−</button><output data-steps-val aria-live="polite">${ms.steps.toLocaleString()}</output><button type="button" data-steps="500" aria-label="500 more steps">+</button></div></div>
        <label class="g-row ms-set"><span class="g-text"><span>Bedtime</span><small>In bed by this time counts.</small></span><input type="time" name="mission_bed" value="${esc(ms.bed.padStart(5, '0'))}"></label>
      </div>

      <p class="sec-title">Connections</p>
      <div class="group">
        ${nav('#/locations', 'pin', 'Locations', state.locations.map((l) => esc(l.name)).join(', ') || 'None yet')}
        ${nav('#/withings', 'scale', 'Withings', withingsLine(), 'data-withings-card')}
        ${nav('#/apple', 'heart', 'Apple Health', appleLine(), 'data-apple-card')}
      </div>
      ${isNative() ? '<p class="sec-title" data-app-refresh-title hidden>iPhone app</p><div class="group" data-app-refresh-group hidden></div>' : ''}

      <p class="sec-title">Your data</p>
      <div class="group">
        ${nav('#/report', 'heart', 'Doctor summary', isNative() ? 'A PDF to share with your doctor' : 'A PDF to print or save for your doctor')}
        <button class="g-row" data-export-json><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export all (JSON)</span></span></button>
        <button class="g-row" data-export-csv><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export weights (CSV)</span></span></button>
        <button class="g-row" data-export-workouts><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export workouts (CSV)</span></span></button>
        <button class="g-row" data-export-cardio><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export cardio (CSV)</span></span></button>
        <button class="g-row" data-export-food><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export food log (CSV)</span></span></button>
        <button class="g-row" data-export-body><span class="g-ic">${icon(isNative() ? 'share' : 'download')}</span><span class="g-text"><span>Export body data (CSV)</span></span></button>
      </div>
      <p class="sec-foot">Your data is stored in your own Firebase project. If you connect Withings, Forge reads your scale data from Withings; nothing is sent to any other service.</p>

      <div class="group">
        <button class="g-row" data-tour-again><span class="g-ic">${icon('help')}</span><span class="g-text"><span>Replay the how-to tour</span></span></button>
      </div>

      ${photoSettingsHtml()}

      ${privacySettingsHtml()}

      <p class="sec-title">Account</p>
      <div class="group">
        <div class="g-row static"><span class="g-text"><span>${esc(state.user.email)}</span></span></div>
        <button class="g-row" data-signout><span class="g-text"><span>Sign out</span></span></button>
        <button class="g-row g-danger" data-delete><span class="g-text"><span>Delete everything</span></span></button>
      </div>

      <div class="small muted g-pad">
        <p>Forge ${VERSION}</p>
        <p>General fitness information, not medical advice. Calorie math: Mifflin-St Jeor (1990). Safe floors: Harvard Health (more cautious than NIH/NHLBI). Exercise library: free-exercise-db (public domain, Unlicense) by Yuhonas. Weight trend: Hacker’s Diet exponential smoothing.</p>
      </div>
    </section>`;

  $$('input[name=units]', el).forEach((r) =>
    r.addEventListener('change', () => patch('settings', 'main', { units: r.value }))
  );
  const group = $('[data-app-refresh-group]', el);
  if (group) loadExpiryInfo().then((info) => {
    if (!info || info.at == null || !group.isConnected) return;
    group.innerHTML = refreshRowHtml(info.at, info.exact);
    group.hidden = false;
    $('[data-app-refresh-title]', el).hidden = false;
    $('[data-app-refresh]', group).addEventListener('click', openRefreshSheet);
  });
  $$('input[name=player]', el).forEach((r) => r.addEventListener('change', () => patch('settings', 'main', { player: r.value })));
  $$('input[name=coach]', el).forEach((r) => r.addEventListener('change', () => {
    unlockAudio();
    patch('settings', 'main', { audio_coach: r.value });
    if (r.value !== 'off') setTimeout(() => (r.value === 'voice' ? coach.go() : beep(880, 160)), 50);
  }));
  $('input[name=sfx]', el).addEventListener('change', (e) => {
    unlockAudio();
    patch('settings', 'main', { sfx: e.target.checked });
    if (e.target.checked) setTimeout(() => sfx.charge(0.5), 50);
  });
  $('input[name=haptics]', el).addEventListener('change', (e) => patch('settings', 'main', { haptics: e.target.checked }));

  // Missions: the steps target moves in steps of 500 (2,000 to 30,000); the bedtime is a time input.
  let stepsNow = ms.steps;
  $$('[data-steps]', el).forEach((b) => b.addEventListener('click', () => {
    stepsNow = Math.min(30000, Math.max(2000, stepsNow + Number(b.dataset.steps)));
    $('[data-steps-val]', el).textContent = stepsNow.toLocaleString();
    setMissionSetting('mission_steps', stepsNow);
  }));
  $('input[name=mission_bed]', el).addEventListener('change', (e) => {
    if (/^\d{2}:\d{2}$/.test(e.target.value)) setMissionSetting('mission_bed', e.target.value);
  });

  // Demo photos: only shown once the photo script has added some.
  const paintPhotos = async () => {
    const st = await photoStatus();
    const box = $('[data-photos]', el);
    if (!box || !st.total || st.bundled) return; // in the iPhone app the photos are already inside the app
    box.hidden = false;
    $('[data-photo-status]', el).textContent = `· ${st.saved} of ${st.total} saved for offline${st.saved >= st.total ? '' : ` · ≈ ${st.mb.toFixed(1)} MB to download`}`;
    const btn = $('[data-photo-dl]', el);
    btn.textContent = st.saved >= st.total ? 'All demo photos saved' : 'Download demo photos';
    btn.disabled = st.saved >= st.total;
  };
  paintPhotos();
  $('[data-photo-dl]', el).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const st = await downloadAllPhotos((done, total) => (btn.textContent = `Saving… ${done} of ${total}`));
    toast(st.saved >= st.total ? 'All demo photos saved for offline use'
      : st.saved ? `Saved ${st.saved} of ${st.total}. Try again on a better connection for the rest.`
        : 'Couldn’t save the photos. Check your connection and try again.');
    paintPhotos();
  };

  const run = (fn) => async (ev) => {
    const btn = ev && ev.currentTarget;
    const lab = btn && btn.querySelector('.g-text > span');
    const label = lab && lab.textContent;
    if (btn) { btn.disabled = true; if (isNative() && lab) lab.textContent = 'Getting it ready…'; }
    try {
      await fn();
    } catch (e) {
      toast(e.message || 'Export failed');
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; if (lab) lab.textContent = label; }
    }
  };
  $('[data-export-json]', el).onclick = run(exportJSON);
  $('[data-export-csv]', el).onclick = run(exportWeightsCSV);
  $('[data-export-workouts]', el).onclick = run(exportWorkoutsCSV);
  $('[data-export-cardio]', el).onclick = run(exportCardioCSV);
  $('[data-export-food]', el).onclick = run(exportFoodCSV);
  $('[data-export-body]', el).onclick = run(exportBodyCSV);

  $('[data-signout]', el).onclick = async () => {
    if (state.sync !== 'synced') {
      const ok = await confirmSheet({
        title: 'Sign out with unsynced changes?',
        message: 'Some changes haven’t reached the cloud yet. Signing out now may lose them. Wait until the status says Synced to be safe.',
        confirmLabel: 'Sign out anyway',
        danger: true,
      });
      if (!ok) return;
    }
    await signOut();
  };

  bindPhotoSettings(el);
  bindPrivacySettings(el);
  $('[data-delete]', el).onclick = () => openDeleteEverything();
  $('[data-tour-again]', el).onclick = () => import('../tour/tour.js').then((m) => m.startTour({ replay: true }));
}

function openDeleteEverything() {
  sheet('Delete everything', (body, close) => {
    body.innerHTML = `
      <form class="stack" novalidate>
        <p>This permanently deletes your account and all your data (profile, weigh-ins, workouts, cardio, programs, locations, custom exercises, foods and food logs) from the cloud and from this phone. It can’t be undone.</p>
        <p class="small muted">Tip: export your data first.</p>
        <label class="field"><span>Type DELETE to confirm</span><input name="confirm" autocomplete="off" autocapitalize="characters"></label>
        <label class="field"><span>Your password</span><input name="password" type="password" autocomplete="current-password"></label>
        <p class="error" aria-live="polite"></p>
        <button class="btn danger" type="submit">Delete my account and data</button>
      </form>`;
    const form = $('form', body);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.error', body);
      if (form.confirm.value.trim().toUpperCase() !== 'DELETE') {
        err.textContent = 'Type DELETE to confirm.';
        return;
      }
      if (!navigator.onLine) {
        err.textContent = 'You need a connection to delete your cloud data.';
        return;
      }
      const btn = $('button[type=submit]', body);
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      let accountGone = false;
      const uid = state.user.uid;
      try {
        await reauth(form.password.value);
        await deleteAllUserData();
        await deleteAccount();
        accountGone = true;
        await import('../photos/store.js').then((m) => m.dropPhotoDb(uid)); // progress photos on this phone go too
        await clearLocalCache();
      } catch (ex) {
        if (accountGone) {
          // The account and cloud data are gone; only the on-device wipe failed. Reloading still signs you out.
          console.error(ex);
        } else {
          err.textContent = authErrorMessage(ex);
          btn.disabled = false;
          btn.textContent = 'Delete my account and data';
          return;
        }
      }
      close();
      location.hash = '';
      location.reload();
    });
  });
}
