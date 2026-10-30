// Quick-log rules, kept free of the DOM so they can be unit-tested: when the floating + shows, and what the
// sheet's six rows are and where each one goes. js/ui/quicklog.js draws it.
import { routeDepth } from './nav.js';

/** Screens where the + shows: tab roots only (Today, Train, Food, Body, Progress and its siblings). */
export function quickLogVisible({ parts = [], navHidden = false, busy = false, keyboard = false, sheets = 0, dialogs = 0, overlay = false } = {}) {
  if (navHidden || busy || keyboard || overlay) return false;
  if (sheets > 0 || dialogs > 0) return false;
  return routeDepth(parts) === 0;
}

/**
 * The sheet's rows, in order. `go` is a hash to open; `run` is an existing flow to start in place.
 * `active` is true when a workout is in progress (Start workout becomes Resume workout and goes to the player).
 */
export function quickLogRows({ active = false, playerRoute = '#/play' } = {}) {
  return [
    { id: 'food', label: 'Log food', icon: 'food', run: 'logFood' },
    { id: 'snap', label: 'Snap a meal', icon: 'camera', run: 'snapMeal' },
    { id: 'weight', label: 'Log weight', icon: 'scale', run: 'logWeight' },
    active
      ? { id: 'workout', label: 'Resume workout', icon: 'play', go: playerRoute }
      : { id: 'workout', label: 'Start workout', icon: 'dumbbell', run: 'startWorkout' },
    { id: 'cardio', label: 'Log a workout', icon: 'plus', run: 'logCardio' },
    { id: 'photos', label: 'Take progress photos', icon: 'camera', go: '#/photos' },
    { id: 'coach', label: 'Ask Coach', icon: 'help', go: '#/coach' },
  ];
}
