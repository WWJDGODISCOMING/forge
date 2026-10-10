// The first-run how-to tour: what it says, when it shows, and the Next / Back / Skip state machine.
// Pure (no DOM, no Firebase), so the rules are unit-tested; js/tour/tour.js draws it.
//
// When it shows: only for a brand-new account. Finishing onboarding for the first time writes
// profile.tour = 'pending'; finishing or skipping the tour writes profile.tour = 'seen' (+ tour_seen_at).
// Accounts that already existed have no `tour` field, so they never get it on their own; Settings →
// "Show the how-to tour again" replays it for anyone. It lives in the profile doc, not localStorage, so it
// doesn't come back on a new phone.

// target: a CSS selector for the real element to spotlight (null = no spotlight, just the card).
// route: the screen the target is on; the tour opens it first.
export const TOUR_STEPS = [
  {
    id: 'welcome', route: 'today', target: null,
    title: 'Welcome to Forge',
    body: 'Here’s a quick tour of the app. It takes about a minute. You can skip it any time, and you can play it again from Settings.',
  },
  {
    id: 'rings', route: 'today', target: '.rings-card',
    title: 'Your rings',
    body: 'The three outer rings are your week of training: workouts, sets and recovery. The two inner rings are today’s food: calories and protein. Aim to hit your protein and stay near your calories. Going over turns the calorie ring orange.',
  },
  {
    id: 'workout', route: 'today', target: '[data-tour="workout"]',
    title: 'Today’s workout',
    body: 'Forge picks a workout for you each day. Tap Start to begin, or See plan to look at it first.',
  },
  {
    id: 'food', route: 'today', target: '[data-tour="food"]',
    title: 'Log your food',
    body: 'Your calories and protein for today live here, with your daily targets. Tap Log food to add a meal in a couple of taps, or See meals to look at what you’ve eaten.',
  },
  {
    id: 'weight', route: 'today', target: '.weight-card [data-log]',
    title: 'Log your weight',
    body: 'Tap Log weight to add your weight by hand. The Withings scale can only link to one Forge account for now, so type your weight in here instead. A few times a week is plenty.',
  },
  {
    id: 'coach', route: 'today', target: '[data-coach-card]',
    title: 'Ask Coach',
    body: 'Tap this line to ask Coach a question. It answers from your own numbers: your weight, workouts and food. It is not medical advice.',
  },
  {
    id: 'train', route: 'train', target: '[aria-label="Location"]',
    title: 'Train: pick where you are',
    body: 'On the Train tab, choose where you’re working out today. Forge builds the workout from the equipment you have there.',
  },
  {
    id: 'start', route: 'train', target: '.card.preview [data-start]',
    title: 'Start, then one set at a time',
    body: 'When you tap Start workout you’ll see one exercise at a time. Tap Done set after each set. Pause when you need a break, Swap if a move doesn’t suit you, and How to shows a demo. “RIR” means reps in reserve: how many more reps you could have done.',
  },
  {
    id: 'body', route: 'body', target: '[data-tour="body-recovery"]',
    title: 'Body: what’s recovered',
    body: 'Green muscles are ready to train, red ones need rest. Tap a muscle for details. Your Progress photos card is just below, and you can also reach it from Progress.',
  },
  {
    id: 'progress', route: 'weight', target: '.tabbar a[href="#/weight"]',
    title: 'Progress',
    body: 'Here you’ll find your weight chart, your past workouts, your personal records, your progress photos, and the badges and XP you earn.',
  },
  {
    id: 'settings', route: 'settings', target: '[data-tour="settings-profile"]',
    title: 'Settings',
    body: 'Change your profile and targets, your locations and equipment, your units (lb or kg) and the coach audio. You can play this tour again from the bottom of Settings.',
  },
];

// The one-time "New: Food and photos" offer for accounts that already existed. Change the id for the next offer.
export const TOUR_OFFER = 'food-photos-0.15.3';

/** Profile fields to add when a profile is saved: a brand-new account gets the tour (so no offer); editing one doesn't. */
export const tourFieldsForSave = (hasProfile) => (hasProfile ? {} : { tour: 'pending', tour_offer: TOUR_OFFER });

/** Profile fields that mark the tour as seen (skipped or finished). Also settles the offer: they've just seen everything. */
export const tourSeenFields = (iso) => ({ tour: 'seen', tour_seen_at: iso, tour_offer: TOUR_OFFER });

/** Profile fields for "Not now" or "Show me" on the offer: it never comes back. */
export const tourOfferFields = () => ({ tour_offer: TOUR_OFFER });

/** Show the offer card on Today: an existing account (not waiting for the full tour) that hasn't answered this offer. */
export const tourOfferDue = (profile) => !!profile && !tourPending(profile) && profile.tour_offer !== TOUR_OFFER;

/** The tour is waiting for this account (only brand-new accounts; existing profiles have no tour field). */
export const tourPending = (profile) => !!profile && profile.tour === 'pending';

/** Should the app start the tour now? Once only: not while it's already showing, not once it's been seen. */
export const shouldStartTour = (profile, active) => !active && tourPending(profile);

/**
 * How far to scroll (positive = down) so a target sits clear of the tour card: its bottom (plus pad) at least
 * gap px above cardTop, and its top not above minTop. 0 when it already fits.
 */
export function scrollToClear(rect, cardTop, { pad = 8, gap = 12, minTop = 12, context = 0 } = {}) {
  // A target that fits gets `context` px of the page above it; one too tall for the room is pinned at minTop.
  const roomTop = minTop + context;
  const fits = rect.height + pad * 2 <= cardTop - gap - roomTop;
  const top = fits ? roomTop : minTop;
  const down = Math.max(0, rect.bottom + pad - (cardTop - gap));
  if (fits && rect.top < top) return rect.top - top; // too close to the top: scroll up so there is context
  return Math.min(down, rect.top - minTop); // never scroll its top above minTop; negative = scroll up to it
}

/**
 * Step through `steps`. onEnd(how) is called once, with 'finished' (Next on the last step) or 'skipped'.
 * Back stops at the first step; Next/Back/Skip do nothing after the tour has ended.
 */
export function createTour(steps, onEnd = () => {}) {
  let index = 0;
  let ended = null;
  const end = (how) => {
    if (ended) return;
    ended = how;
    onEnd(how);
  };
  return {
    get index() { return index; },
    get count() { return steps.length; },
    get step() { return steps[index]; },
    get first() { return index === 0; },
    get last() { return index === steps.length - 1; },
    get ended() { return ended; },
    next() {
      if (ended) return;
      if (index >= steps.length - 1) end('finished');
      else index++;
    },
    back() {
      if (!ended && index > 0) index--;
    },
    skip() { end('skipped'); },
  };
}
