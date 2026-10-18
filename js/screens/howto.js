// How-To sheet (Lyfta-style exercise detail):
//   the looping demo across the top (Figure | Photos), then Favourite · Watch on YouTube · Share,
//   Instructions | Target tabs (Target = the front/back muscle map), and your history and PRs.
// YouTube is a link out to a search (no embed), so the CSP's frame-src stays 'none'.
import { state } from '../state.js';
import { esc, $, $$, sheet, toast } from '../ui.js';
import { icon } from '../ui/icons.js';
import { patch } from '../db.js';
import { exerciseById, loadInstructions } from '../workouts/library.js';
import { equipmentText } from './picker.js';
import { MUSCLE_LABELS } from '../workouts/recovery.js';
import { historyIndex, unit } from '../workouts/plan.js';
import { exerciseRecords } from '../workouts/history.js';
import { mountFigure, hasFigure } from '../ui/figure.js';
import { photoLoop, hasPhotos, loadPhotoIndex, photoFallback } from '../ui/photos.js';
import { bodyMap, exerciseValues } from '../ui/bodymap.js';

const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/**
 * Open the How-To sheet for an exercise. `extra(body, close)` lets a caller add its own controls at the
 * bottom (the library adds "Never suggest this" and custom-exercise delete). focus: 'history' scrolls to your history.
 */
export function openHowTo(id, { extra, focus } = {}) {
  const ex = exerciseById(id);
  if (!ex) return;
  // Open straight away, even on a weak signal: the Photos view joins in when the photo index arrives.
  const fig = hasFigure(id);
  let pics = hasPhotos(id);
  let view = fig ? 'figure' : pics ? 'photos' : 'map';
  const favs = () => (state.settings && state.settings.favorites) || [];
  const u = unit();
  const sessions = historyIndex().historyFor(id);
  const rec = exerciseRecords(sessions, ex);
  const works = `${ex.primary.map((m) => MUSCLE_LABELS[m] || m).join(', ')}`;
  const also = ex.secondary.map((m) => MUSCLE_LABELS[m] || m).join(', ');

  sheet(ex.name, (body, close) => {
    body.innerHTML = `
      <div class="stack howto">
        <div class="ht-demo" data-demo></div>
        <div data-viewseg></div>
        <div class="ht-actions">
          <button class="ht-act" data-fav aria-pressed="false"><span aria-hidden="true" data-favicon>${icon('star')}</span><small>Favourite</small></button>
          <a class="ht-act" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} exercise form`)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">${icon('play', { size: 22 })}</span><small>YouTube</small></a>
          <button class="ht-act" data-share><span aria-hidden="true">${icon('share', { size: 22 })}</span><small>Share</small></button>
        </div>
        <div class="seg ht-seg" role="tablist" aria-label="Details">
          <button role="tab" data-tab="steps" class="on" aria-selected="true">Instructions</button><button role="tab" data-tab="target" aria-selected="false">Target</button>
        </div>
        <div data-panel="steps" class="stack">
          <p class="small muted">${esc(equipmentText(ex))}</p>
          <div><p class="label">Form cues</p><ul class="reasons">${ex.cues.map((c) => `<li>${esc(c)}</li>`).join('') || '<li class="muted">No cues yet</li>'}</ul></div>
          <div data-steps><p class="small muted">Loading steps…</p></div>
        </div>
        <div data-panel="target" class="stack" hidden>
          ${bodyMap(exerciseValues(ex), { size: 'small' })}
          <p><b>Works:</b> ${esc(works)}${also ? `<span class="muted"> · also ${esc(also)}</span>` : ''}</p>
        </div>
        <div class="ht-history">
          <p class="label">Your history</p>
          ${sessions.length ? `
          <div class="ht-prs">
            ${ex.timed
              ? `<div><span>Longest hold</span><b>${rec.hold ? `${rec.hold.value} s` : '—'}</b></div>`
              : `${rec.e1rm ? `<div><span>Est. 1-rep max</span><b>${rec.e1rm.value} ${u}</b></div>` : ''}
                 ${rec.heaviest ? `<div><span>Heaviest</span><b>${rec.heaviest.value} ${u}</b></div>` : ''}
                 <div><span>Most reps</span><b>${rec.reps ? rec.reps.value : '—'}</b></div>`}
          </div>
          <ul class="list ht-sessions">
            ${sessions.slice(0, 4).map((s) => `<li><span class="muted">${fmtDate(s.date)}${s.deload ? ' · deload' : ''}</span><span>${s.sets.map((x) => `${x.weight ? `${x.weight}×` : ''}${x.reps}${ex.timed ? 's' : ''}`).join(' · ')}</span></li>`).join('')}
          </ul>` : '<p class="small muted">Not done yet. Your best sets show up here.</p>'}
        </div>
        <div data-extra></div>
      </div>`;

    const demo = $('[data-demo]', body);
    const mapHtml = () => bodyMap(exerciseValues(ex), { size: 'small' });
    const paintToggle = () => {
      const seg = $('[data-viewseg]', body);
      if (!seg || !(fig && pics)) return;
      seg.innerHTML = `<div class="seg ht-seg" role="tablist" aria-label="Demo">
          <button role="tab" data-view="figure">Figure</button><button role="tab" data-view="photos">Photos</button>
        </div>`;
      $$('[data-view]', body).forEach((b) => (b.onclick = () => { view = b.dataset.view; showView(); }));
    };
    const markView = () => {
      $$('[data-view]', body).forEach((b) => {
        b.classList.toggle('on', b.dataset.view === view);
        b.setAttribute('aria-selected', String(b.dataset.view === view));
      });
    };
    const showView = () => {
      markView();
      if (view === 'figure') {
        demo.innerHTML = '<div class="fig-wrap"></div>';
        mountFigure(demo.firstChild, ex);
      } else if (view === 'photos') {
        demo.innerHTML = photoLoop(id, ex.name);
        photoFallback(demo, mapHtml()); // offline and not cached: the muscle map, not a blank box
      } else {
        demo.innerHTML = mapHtml();
      }
    };
    paintToggle();
    showView();
    // After the sheet's open animation, so the scroll isn't lost.
    if (focus === 'history') setTimeout(() => $('.ht-history', body)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 260);
    if (!pics) {
      loadPhotoIndex().then(() => {
        if (!demo.isConnected || !hasPhotos(id)) return;
        pics = true;
        paintToggle();
        if (view === 'map') {
          view = 'photos';
          showView();
        } else markView(); // the figure keeps playing
      });
    }

    // Favourite
    const favBtn = $('[data-fav]', body);
    const paintFav = () => {
      const on = favs().includes(id);
      favBtn.setAttribute('aria-pressed', String(on));
      favBtn.classList.toggle('on', on);
      $('[data-favicon]', favBtn).innerHTML = icon('star', { filled: on });
    };
    paintFav();
    favBtn.onclick = () => {
      const set = new Set(favs());
      const on = !set.has(id);
      on ? set.add(id) : set.delete(id);
      patch('settings', 'main', { favorites: [...set] });
      if (state.settings) state.settings.favorites = [...set];
      paintFav();
      toast(on ? 'Added to favourites' : 'Removed from favourites');
    };

    // Share: the system share sheet where there is one, otherwise copy the cues.
    $('[data-share]', body).onclick = async () => {
      const text = `${ex.name}\n${ex.cues.map((c) => `• ${c}`).join('\n')}`;
      try {
        if (navigator.share) await navigator.share({ title: ex.name, text });
        else {
          await navigator.clipboard.writeText(text);
          toast('Copied');
        }
      } catch { /* cancelled */ }
    };

    // Tabs
    $$('[data-tab]', body).forEach((b) => (b.onclick = () => {
      $$('[data-tab]', body).forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', String(x === b));
      });
      $$('[data-panel]', body).forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    }));

    if (extra) extra($('[data-extra]', body), close);

    loadInstructions().then((all) => {
      const steps = all[id];
      $('[data-steps]', body).innerHTML = steps
        ? `<p class="label">Step by step</p><ol class="reasons">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
           <p class="small muted">Steps${hasPhotos(id) ? ' and photos' : ''} from free-exercise-db (public domain).</p>`
        : '';
    }).catch(() => { $('[data-steps]', body).innerHTML = ''; });
  }, { detents: ['medium', 'large'] });
}
