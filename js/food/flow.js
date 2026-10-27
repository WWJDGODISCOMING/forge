// The Log food sheet as a small state machine, so the "3 taps" promise is tested without a browser.
// Tap 1 opens the sheet (counted here), tap 2 picks a food from the list, tap 3 is "Add". Servings start at 1
// and the meal is already chosen by the time of day, so a recent food needs nothing else.
import { mealForHour, logFields, quickItem, stepServings } from './core.js';
import { searchLocal } from './search.js';

export function createFlow({ foods = [], logs = [], hour = 12, day }) {
  const f = { meal: mealForHour(hour), servings: 1, selected: null, query: '', taps: 1 };
  return {
    f,
    results: () => searchLocal(f.query, { foods, logs }),
    search(q) { f.query = q; },
    setMeal(meal) { f.meal = meal; },
    select(item) { f.taps++; f.selected = item; f.servings = 1; },
    step(dir) { f.servings = stepServings(f.servings, dir); },
    /** Quick add: calories (and maybe protein, carbs, fat) straight into the chosen meal. null = not enough to log. */
    quick(kcal, protein, carbs, fat) {
      const item = quickItem(kcal, protein, carbs, fat);
      if (!item) return null;
      f.taps++;
      return logFields({ item, servings: 1, meal: f.meal, day });
    },
    /** The final tap: fields for a food_logs record, or null when nothing is picked. */
    commit() {
      if (!f.selected) return null;
      f.taps++;
      return logFields({ item: f.selected, servings: f.servings, meal: f.meal, day });
    },
  };
}
