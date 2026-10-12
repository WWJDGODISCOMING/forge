// The first-run how-to tour: who gets it, once, and Next / Back / Skip / replay. (The overlay itself is DOM
// and is checked by hand; these are the rules it follows.)
import { test, eq, assert } from './harness.js';
import { TOUR_STEPS, createTour, scrollToClear, tourFieldsForSave, tourSeenFields, tourPending, shouldStartTour } from '../js/tour/steps.js';

// A tiny model of one account's profile doc and the app around it.
function account(profile) {
  const a = { profile, active: false, shown: 0 };
  a.finishOnboarding = () => { a.profile = { ...(a.profile || {}), goal: 'lose', ...tourFieldsForSave(!!a.profile) }; };
  a.open = () => { // what the app does after each render of Today
    if (!shouldStartTour(a.profile, a.active)) return null;
    a.active = true;
    a.shown++;
    return createTour(TOUR_STEPS, () => { a.active = false; a.profile = { ...a.profile, ...tourSeenFields('2026-10-08T12:00:00Z') }; });
  };
  return a;
}

test('tour: 10–11 steps, each with a title and plain words; the real-element steps name a screen', () => {
  assert(TOUR_STEPS.length >= 10 && TOUR_STEPS.length <= 11, `${TOUR_STEPS.length} steps`);
  for (const s of TOUR_STEPS) {
    assert(s.title && s.body, s.id);
    assert(!s.target || s.route, `${s.id} has a target but no route`);
  }
  const ids = TOUR_STEPS.map((s) => s.id).join();
  for (const id of ['rings', 'workout', 'food', 'weight', 'train', 'start', 'coach', 'recovery', 'progress', 'settings']) assert(ids.includes(id), `covers ${id}`);
  assert(/reps in reserve/i.test(TOUR_STEPS.find((s) => s.id === 'start').body), 'RIR explained in one line');
  assert(/one Forge account/.test(TOUR_STEPS.find((s) => s.id === 'weight').body), 'says the scale links to one account and to log by hand');
});

test('tour: shows once after onboarding for a new account', () => {
  const a = account(null);
  eq(a.open(), null, 'no profile yet: no tour');
  a.finishOnboarding();
  eq(a.profile.tour, 'pending');
  const t = a.open();
  assert(t, 'tour starts');
  eq(a.open(), null, 'not a second one while it is showing');
  t.skip();
  eq(a.open(), null, 'and not again after it was seen');
  eq(a.shown, 1);
  eq(a.profile.tour, 'seen');
  eq(a.profile.tour_seen_at, '2026-10-08T12:00:00Z');
});

test('tour: an existing profile (no tour field) never gets it automatically; editing a profile does not start it', () => {
  const mine = account({ goal: 'lose', weightKg: 90 });
  eq(mine.open(), null);
  mine.finishOnboarding(); // "Edit profile & targets" saves through the same path
  eq(mine.profile.tour, undefined);
  eq(mine.open(), null);
  eq(tourPending(mine.profile), false);
  eq(tourPending(null), false);
  eq(tourFieldsForSave(true).tour, undefined);
  eq(tourFieldsForSave(false).tour, 'pending');
});

test('tour: Next / Back move one step; Back stops at the first; Next on the last finishes and marks it seen', () => {
  const a = account({ goal: 'lose', tour: 'pending' });
  const t = a.open();
  eq(t.index, 0);
  t.back();
  eq(t.index, 0);
  t.next(); t.next();
  eq(t.index, 2);
  t.back();
  eq(t.index, 1);
  while (!t.last) t.next();
  eq(t.index, TOUR_STEPS.length - 1);
  eq(a.profile.tour, 'pending', 'not seen until it ends');
  t.next();
  eq(t.ended, 'finished');
  eq(a.profile.tour, 'seen');
  t.next(); t.back(); t.skip();
  eq(t.ended, 'finished', 'ending twice changes nothing');
});

test('tour: Skip on any step marks it seen', () => {
  const a = account({ goal: 'lose', tour: 'pending' });
  const t = a.open();
  t.next(); t.next();
  t.skip();
  eq(t.ended, 'skipped');
  eq(a.profile.tour, 'seen');
  eq(a.active, false);
});

test('tour: Settings → "Show the how-to tour again" replays it for any account, and the seen mark stays', () => {
  const a = account({ goal: 'lose', tour: 'seen' });
  eq(a.open(), null, 'not by itself');
  // The replay button starts a tour directly (no pending check).
  let ended = null;
  const t = createTour(TOUR_STEPS, (how) => { ended = how; });
  eq(t.index, 0, 'starts from the first step');
  t.skip();
  eq(ended, 'skipped');
  eq(a.profile.tour, 'seen');
  const old = account({ goal: 'lose' }); // existing account: no field
  eq(old.open(), null);
  const again = createTour(TOUR_STEPS);
  eq(again.count, TOUR_STEPS.length);
});

test('tour: a low target is scrolled to sit 12px above the card (home indicator counted), never past the top', () => {
  // 390×844 phone, 34px inset: the card (180px tall) starts at 844 - 34 - 12 - 180 = 618.
  const cardTop = 618;
  const dy = scrollToClear({ top: 600, bottom: 656 }, cardTop);
  eq(656 + 8 - dy, cardTop - 12, 'bottom + pad ends 12px above the card');
  eq(scrollToClear({ top: 300, bottom: 356 }, cardTop), 0, 'already clear: no scroll');
  eq(scrollToClear({ top: 5, bottom: 60 }, cardTop, { minTop: 59 }), -54, 'too high: scroll up to the safe top');
  eq(scrollToClear({ top: 100, bottom: 900 }, cardTop), 88, 'taller than the room: keep its top in view');
});
