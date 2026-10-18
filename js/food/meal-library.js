// Built-in recipe library for meal plans (v0.16.21). Original, generic recipes. Pure data, no DOM, no network.
// kcal and protein are estimates for ONE serving. Tags drive the picker (js/food/meal-plan.js):
//   low_histamine  fresh-cooked, none of: tomato, spinach, eggplant, vinegar, aged or fermented foods, cured or smoked meat, canned fish
//   pregnancy_safe fully cooked eggs, meat and fish; low-mercury fish only; pasteurized dairy; no deli meat, liver or raw fish
//   freezer_friendly / batch_friendly  freezes well the same day / scales up for a Sunday prep session
// Other fields: fridge (needs fridge leftovers), fish_oz (cooked fish per serving), caffeine_mg.

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const SECTIONS = { produce: 'Produce', protein: 'Meat and fish', dairy: 'Dairy and eggs', grains: 'Grains and bread', pantry: 'Pantry', frozen: 'Frozen' };
export const TAGS = ['low_histamine', 'pregnancy_safe', 'vegetarian', 'dairy_free', 'gluten_free', 'contains_tomato', 'spicy', 'freezer_friendly', 'batch_friendly'];

const T = { lh: 'low_histamine', ps: 'pregnancy_safe', veg: 'vegetarian', df: 'dairy_free', gf: 'gluten_free', tom: 'contains_tomato', hot: 'spicy', fz: 'freezer_friendly', bp: 'batch_friendly' };
const SEC = { p: 'produce', m: 'protein', d: 'dairy', g: 'grains', s: 'pantry', f: 'frozen' };

// Estimated fat (g) per serving; carbs are derived so that kcal = 4 protein + 4 carbs + 9 fat.
const FAT_G = {
  'b-oat-apple': 9,
  'b-rice-pear': 14,
  'b-quinoa-blue': 12,
  'b-scramble-sweet': 22,
  'b-turkey-patty': 14,
  'b-milk-pancakes': 12,
  'b-yogurt-parfait': 8,
  'b-smoked-bagel': 17,
  'b-tomato-toast': 16,
  'b-spicy-eggs': 30,
  'b-softegg': 13,
  'b-matcha-oats': 8,
  'l-chicken-rice': 14,
  'l-turkey-quinoa': 17,
  'l-veg-quinoa': 17,
  'l-beef-rice': 18,
  'l-egg-fried-rice': 18,
  'l-salmon-potato': 24,
  'l-pumpkin-soup': 14,
  'l-chicken-wrap': 10,
  'l-tuna-sandwich': 18,
  'l-deli-turkey': 16,
  'l-spicy-chili': 24,
  'l-pasta-red': 10,
  'l-cold-chickpea': 16,
  'd-chicken-veg': 24,
  'd-salmon-rice': 24,
  'd-cod-quinoa': 15,
  'd-beef-stew': 26,
  'd-turkey-meatballs': 18,
  'd-veg-stew': 17,
  'd-veg-risotto': 15,
  'd-egg-tray': 20,
  'd-chicken-stirfry': 12,
  'd-spag-bolognese': 24,
  'd-curry': 20,
  'd-liver': 20,
  'd-swordfish': 18,
  'd-sushi': 14,
  's-apple-seed': 9,
  's-pear-milk': 3,
  's-oat-bites': 6,
  's-sweet-potato': 5,
  's-mango-coconut': 10,
  's-rice-cakes': 1,
  's-egg-hard': 10,
  's-chicken-bites': 8,
  's-matcha-latte': 3,
  's-coffee-shake': 7,
  's-trail-mix': 12,
  's-salami': 24,
};

// r(id, slot, name, kcal, protein, 'tag codes', ['name|qty|section code'], [steps], { fish_oz, caffeine_mg, fridge })
function r(id, slot, name, kcal, protein_g, tags, ing, steps, extra = {}) {
  const fat_g = FAT_G[id] || 0;
  return {
    id, slot, name, kcal, protein_g, fat_g, carbs_g: Math.max(0, Math.round((kcal - 4 * protein_g - 9 * fat_g) / 4)),
    tags: tags.split(' ').filter(Boolean).map((c) => T[c]),
    ingredients: ing.map((s) => { const [n, q, c] = s.split('|'); return { name: n, qty: q, section: SEC[c] }; }),
    steps, fish_oz: 0, caffeine_mg: 0, fridge: false, ...extra,
  };
}

export const RECIPES = [
  // ---- breakfast ----
  r('b-oat-apple', 'breakfast', 'Apple cinnamon oatmeal', 380, 14, 'lh ps veg df gf fz bp', ['rolled oats|1/2 cup (certified gluten-free)|g', 'apple|1|p', 'cinnamon|1 tsp|s', 'maple syrup|1 tbsp|s', 'ground flaxseed|1 tbsp|s', 'water|1 cup|s'],
    ['Simmer the oats in water for 5 minutes.', 'Dice the apple and stir it in with the cinnamon.', 'Top with flaxseed and maple syrup.']),
  r('b-rice-pear', 'breakfast', 'Creamy rice porridge with pear', 390, 11, 'lh ps veg df gf fz bp', ['cooked rice|1 cup|g', 'coconut milk|1/2 cup|s', 'pear|1|p', 'vanilla|1/2 tsp|s', 'honey|1 tsp|s'],
    ['Warm the rice with the coconut milk until creamy, about 6 minutes.', 'Slice the pear and cook it in for 2 minutes.', 'Finish with vanilla and honey.']),
  r('b-quinoa-blue', 'breakfast', 'Blueberry quinoa breakfast bowl', 400, 15, 'lh ps veg df gf fz bp', ['quinoa|1/2 cup dry|g', 'blueberries|1/2 cup|p', 'coconut milk|1/3 cup|s', 'maple syrup|1 tbsp|s', 'pumpkin seeds|1 tbsp|s'],
    ['Rinse the quinoa and simmer in 1 cup water for 15 minutes.', 'Stir in the coconut milk and warm through.', 'Top with blueberries, seeds and maple syrup.']),
  r('b-scramble-sweet', 'breakfast', 'Veggie scramble with sweet potato hash', 430, 22, 'lh ps veg df gf', ['eggs|2|d', 'sweet potato|1 small|p', 'zucchini|1/2|p', 'olive oil|1 tbsp|s', 'fresh parsley|1 tbsp|p'],
    ['Dice the sweet potato small and pan-fry in oil for 10 minutes.', 'Add the zucchini for 3 minutes.', 'Scramble the eggs in the pan until fully set and firm. Top with parsley.']),
  r('b-turkey-patty', 'breakfast', 'Turkey and apple breakfast patties with rice', 440, 30, 'lh ps df gf fz bp', ['fresh ground turkey|4 oz|m', 'apple|1/2|p', 'fresh sage|1 tsp|p', 'cooked rice|3/4 cup|g', 'olive oil|1 tsp|s'],
    ['Mix the turkey with grated apple and sage, and shape into two patties.', 'Cook in oil, 5 minutes per side, until no pink remains and the middle reaches 165°F.', 'Serve over warm rice. Freeze extras the same day.']),
  r('b-milk-pancakes', 'breakfast', 'Oat pancakes with maple and pear', 410, 16, 'lh ps veg fz bp', ['rolled oats|1/2 cup|g', 'eggs|1|d', 'milk|1/3 cup|d', 'pear|1|p', 'maple syrup|1 tbsp|s', 'butter|1 tsp|d'],
    ['Blend the oats, egg and milk into a batter.', 'Cook small pancakes in butter until golden and set through.', 'Top with sliced pear and maple syrup.']),
  r('b-yogurt-parfait', 'breakfast', 'Greek yogurt berry parfait', 340, 22, 'ps veg', ['Greek yogurt|1 cup|d', 'strawberries|1/2 cup|p', 'honey|1 tsp|s', 'granola|1/4 cup|g'],
    ['Make the night before: layer the yogurt, berries and granola.', 'Drizzle with honey and chill.'], { fridge: true }),
  r('b-smoked-bagel', 'breakfast', 'Smoked salmon bagel', 460, 24, '', ['bagel|1|g', 'smoked salmon|2 oz|m', 'cream cheese|2 tbsp|d', 'capers|1 tsp|s'],
    ['Toast the bagel.', 'Spread with cream cheese and top with salmon and capers.'], { fish_oz: 2 }),
  r('b-tomato-toast', 'breakfast', 'Tomato and egg toast', 360, 18, 'veg tom', ['sourdough bread|2 slices|g', 'eggs|2|d', 'tomato|1|p', 'olive oil|1 tsp|s'],
    ['Toast the bread.', 'Fry the eggs hard.', 'Top the toast with sliced tomato and eggs.']),
  r('b-spicy-eggs', 'breakfast', 'Spicy chorizo egg burrito', 520, 28, 'hot', ['flour tortilla|1|g', 'eggs|2|d', 'chorizo|2 oz|m', 'hot sauce|1 tsp|s'],
    ['Brown the chorizo.', 'Scramble in the eggs.', 'Wrap in the tortilla with hot sauce.']),
  r('b-softegg', 'breakfast', 'Soft-boiled egg with toast strips', 300, 16, 'veg', ['eggs|2|d', 'bread|2 slices|g', 'butter|1 tsp|d'],
    ['Boil the eggs 6 minutes so the yolk stays runny.', 'Serve with buttered toast strips.']),
  r('b-matcha-oats', 'breakfast', 'Matcha oatmeal', 360, 13, 'ps veg df', ['rolled oats|1/2 cup|g', 'matcha powder|1 tsp|s', 'oat milk|1/2 cup|s', 'honey|1 tsp|s'],
    ['Simmer the oats in oat milk.', 'Whisk in the matcha and honey.'], { caffeine_mg: 35 }),

  // ---- lunch ----
  r('l-chicken-rice', 'lunch', 'Herb chicken and rice bowl', 520, 42, 'lh ps df gf fz bp', ['fresh chicken breast|5 oz|m', 'cooked rice|1 cup|g', 'zucchini|1|p', 'olive oil|1 tbsp|s', 'fresh thyme|1 tsp|p'],
    ['Season the chicken with thyme and cook through to 165°F, about 6 minutes per side.', 'Slice the zucchini and sauté in oil.', 'Serve over the rice.']),
  r('l-turkey-quinoa', 'lunch', 'Turkey and sweet potato quinoa bowl', 540, 40, 'lh ps df gf fz bp', ['fresh ground turkey|5 oz|m', 'quinoa|1/2 cup dry|g', 'sweet potato|1 small|p', 'broccoli|1 cup|p', 'olive oil|1 tbsp|s'],
    ['Cook the quinoa.', 'Roast the cubed sweet potato and broccoli at 425°F for 20 minutes.', 'Brown the turkey until no pink remains and combine in a bowl.']),
  r('l-veg-quinoa', 'lunch', 'Roasted veggie quinoa bowl', 480, 16, 'lh ps veg df gf fz bp', ['quinoa|1/2 cup dry|g', 'zucchini|1|p', 'carrot|2|p', 'green peas|1/2 cup|f', 'olive oil|1 tbsp|s', 'fresh basil|1 tbsp|p'],
    ['Cook the quinoa.', 'Roast the chopped zucchini and carrots at 425°F for 20 minutes.', 'Toss everything with the peas, oil and basil.']),
  r('l-beef-rice', 'lunch', 'Beef and broccoli rice bowl', 560, 38, 'lh ps df gf fz bp', ['fresh beef sirloin|5 oz|m', 'broccoli|1.5 cups|p', 'cooked rice|1 cup|g', 'fresh ginger|1 tsp|p', 'olive oil|1 tbsp|s'],
    ['Slice the beef thin and cook through in oil.', 'Steam the broccoli for 5 minutes.', 'Add ginger, toss together and serve over rice.']),
  r('l-egg-fried-rice', 'lunch', 'Veggie egg fried rice', 500, 22, 'lh ps veg df gf', ['cooked rice|1.5 cups|g', 'eggs|2|d', 'carrot|1|p', 'green peas|1/2 cup|f', 'olive oil|1 tbsp|s', 'green onion|2|p'],
    ['Cook the diced carrot and peas in oil for 4 minutes.', 'Push aside, scramble the eggs until fully set.', 'Stir in warm fresh rice and green onion.']),
  r('l-salmon-potato', 'lunch', 'Baked salmon with potatoes and green beans', 560, 36, 'lh ps df gf', ['fresh salmon fillet|4 oz|m', 'baby potatoes|8 oz|p', 'green beans|1 cup|p', 'olive oil|1 tbsp|s', 'fresh dill|1 tbsp|p'],
    ['Roast the halved potatoes at 425°F for 15 minutes.', 'Add the salmon and beans and bake 12 minutes until the fish flakes and reaches 145°F.', 'Top with dill.', 'Buy the fish fresh or frozen and cook it the same day.'], { fish_oz: 4 }),
  r('l-pumpkin-soup', 'lunch', 'Creamy pumpkin carrot soup with rice', 430, 12, 'lh ps veg df gf fz bp', ['pumpkin|2 cups cubed|p', 'carrot|2|p', 'coconut milk|1/3 cup|s', 'cooked rice|3/4 cup|g', 'olive oil|1 tsp|s'],
    ['Simmer the pumpkin and carrot in water until soft, 20 minutes.', 'Blend with the coconut milk.', 'Serve over the rice. Freeze extra portions the same day.']),
  r('l-chicken-wrap', 'lunch', 'Chicken and cucumber lettuce wraps', 420, 38, 'lh ps df gf', ['fresh chicken breast|5 oz|m', 'butter lettuce|4 leaves|p', 'cucumber|1/2|p', 'carrot|1|p', 'olive oil|1 tsp|s', 'cooked rice|1/2 cup|g'],
    ['Cook the chicken through and shred it.', 'Fill the lettuce leaves with chicken, rice, cucumber and carrot.']),
  r('l-tuna-sandwich', 'lunch', 'Tuna salad sandwich', 470, 32, 'df', ['canned tuna|1 can|m', 'bread|2 slices|g', 'mayonnaise|1 tbsp|s', 'celery|1 stalk|p'], ['Mix the tuna, mayo and celery.', 'Serve on bread.'], { fish_oz: 4 }),
  r('l-deli-turkey', 'lunch', 'Deli turkey and cheddar sandwich', 450, 30, '', ['deli turkey|3 oz|m', 'aged cheddar|1 oz|d', 'bread|2 slices|g', 'mustard|1 tsp|s'], ['Layer the turkey and cheese on the bread.', 'Add mustard and serve cold.']),
  r('l-spicy-chili', 'lunch', 'Spicy beef and tomato chili', 560, 40, 'gf df tom hot fz bp', ['ground beef|5 oz|m', 'crushed tomatoes|1 cup|s', 'kidney beans|1/2 cup|s', 'chili powder|1 tbsp|s', 'onion|1/2|p'], ['Brown the beef with onion.', 'Add tomatoes, beans and chili powder.', 'Simmer for 30 minutes.']),
  r('l-pasta-red', 'lunch', 'Tomato basil pasta', 520, 18, 'veg tom df', ['pasta|3 oz dry|g', 'tomato sauce|3/4 cup|s', 'fresh basil|1 tbsp|p', 'olive oil|1 tsp|s'], ['Boil the pasta.', 'Warm the sauce, toss and top with basil.']),
  r('l-cold-chickpea', 'lunch', 'Overnight chickpea cucumber salad', 400, 16, 'veg df gf', ['chickpeas|1 cup|s', 'cucumber|1|p', 'red onion|1/4|p', 'red wine vinegar|1 tbsp|s', 'olive oil|1 tbsp|s'], ['Toss everything and rest in the fridge overnight.'], { fridge: true }),

  // ---- dinner ----
  r('d-chicken-veg', 'dinner', 'Herb roasted chicken thighs with root veggies', 580, 44, 'lh ps df gf fz bp', ['fresh chicken thighs|6 oz|m', 'carrot|2|p', 'baby potatoes|8 oz|p', 'olive oil|1 tbsp|s', 'fresh rosemary|1 tsp|p'],
    ['Toss the veggies in oil and roast at 425°F for 15 minutes.', 'Add the chicken and roast another 25 minutes until it reaches 165°F.', 'Rest 5 minutes and serve.']),
  r('d-salmon-rice', 'dinner', 'Baked salmon with rice and broccoli', 590, 40, 'lh ps df gf', ['fresh salmon fillet|4 oz|m', 'cooked rice|1 cup|g', 'broccoli|1.5 cups|p', 'olive oil|1 tbsp|s', 'fresh dill|1 tbsp|p'],
    ['Bake the salmon at 400°F for 12 to 15 minutes until it flakes and reaches 145°F.', 'Steam the broccoli.', 'Serve over rice with dill.', 'Buy the fish fresh or frozen and cook it the same day.'], { fish_oz: 4 }),
  r('d-cod-quinoa', 'dinner', 'Pan-seared cod with quinoa and zucchini', 480, 38, 'lh ps df gf', ['fresh cod fillet|5 oz|m', 'quinoa|1/2 cup dry|g', 'zucchini|1|p', 'olive oil|1 tbsp|s', 'fresh parsley|1 tbsp|p'],
    ['Cook the quinoa.', 'Sear the cod 4 minutes per side until opaque and 145°F.', 'Sauté the zucchini and serve together.', 'Buy the fish fresh or frozen and cook it the same day.'], { fish_oz: 5 }),
  r('d-beef-stew', 'dinner', 'Slow-simmered beef and root vegetable stew', 600, 42, 'ps df gf fz bp', ['fresh beef chuck|6 oz|m', 'carrot|2|p', 'potato|1|p', 'parsnip|1|p', 'olive oil|1 tbsp|s', 'fresh thyme|1 tsp|p'],
    ['Brown the beef cubes in oil.', 'Add the vegetables, thyme and water to cover.', 'Simmer covered for 90 minutes. Freeze extra portions the same day.']),
  r('d-turkey-meatballs', 'dinner', 'Turkey meatballs with zucchini noodles and rice', 520, 42, 'lh ps df gf fz bp', ['fresh ground turkey|6 oz|m', 'zucchini|2|p', 'cooked rice|1/2 cup|g', 'fresh basil|1 tbsp|p', 'olive oil|1 tbsp|s'],
    ['Mix the turkey with basil and shape into meatballs.', 'Bake at 400°F for 18 minutes until they reach 165°F.', 'Spiralize and sauté the zucchini. Serve with rice.']),
  r('d-veg-stew', 'dinner', 'Coconut pumpkin and carrot stew with rice', 500, 11, 'lh ps veg df gf fz bp', ['pumpkin|2 cups cubed|p', 'carrot|2|p', 'coconut milk|1/2 cup|s', 'cooked rice|1 cup|g', 'fresh ginger|1 tsp|p', 'green peas|1/2 cup|f'],
    ['Simmer the pumpkin, carrot and ginger in water for 20 minutes.', 'Stir in the coconut milk and peas.', 'Serve over rice.']),
  r('d-veg-risotto', 'dinner', 'Zucchini and pea risotto', 520, 14, 'lh ps veg df gf', ['arborio rice|1/2 cup dry|g', 'zucchini|1|p', 'green peas|1/2 cup|f', 'olive oil|1 tbsp|s', 'fresh basil|1 tbsp|p', 'water|3 cups|s'],
    ['Toast the rice in oil.', 'Add warm water a ladle at a time, stirring, for about 20 minutes.', 'Fold in the zucchini and peas and cook 3 more minutes. Top with basil.']),
  r('d-egg-tray', 'dinner', 'Roasted veggie quinoa tray with eggs', 490, 24, 'lh ps veg df gf', ['quinoa|1/2 cup dry|g', 'sweet potato|1 small|p', 'broccoli|1 cup|p', 'eggs|2|d', 'olive oil|1 tbsp|s'],
    ['Roast the potato and broccoli at 425°F for 20 minutes.', 'Cook the quinoa.', 'Fry the eggs until the yolk is cooked hard and serve over the quinoa and veggies.']),
  r('d-chicken-stirfry', 'dinner', 'Ginger chicken and green bean stir-fry', 510, 44, 'lh ps df gf', ['fresh chicken breast|6 oz|m', 'green beans|1.5 cups|p', 'cooked rice|1 cup|g', 'fresh ginger|1 tsp|p', 'olive oil|1 tbsp|s'],
    ['Slice the chicken and cook through in oil.', 'Add the beans and ginger for 5 minutes.', 'Serve over rice.']),
  r('d-spag-bolognese', 'dinner', 'Spaghetti bolognese', 640, 36, 'tom df', ['ground beef|5 oz|m', 'spaghetti|3 oz dry|g', 'crushed tomatoes|1 cup|s', 'onion|1/2|p'], ['Brown the beef and onion.', 'Add tomatoes and simmer 20 minutes.', 'Serve over spaghetti.']),
  r('d-curry', 'dinner', 'Spicy chickpea curry', 540, 18, 'veg df gf hot', ['chickpeas|1 cup|s', 'curry paste|2 tbsp|s', 'coconut milk|1/2 cup|s', 'cooked rice|1 cup|g'], ['Simmer the chickpeas with paste and coconut milk for 15 minutes.', 'Serve over rice.']),
  r('d-liver', 'dinner', 'Pan-fried liver and onions', 460, 38, 'df gf', ['beef liver|5 oz|m', 'onion|1|p', 'olive oil|1 tbsp|s'], ['Fry the onions soft.', 'Cook the liver 3 minutes per side.']),
  r('d-swordfish', 'dinner', 'Grilled swordfish with rice', 520, 42, 'df gf', ['swordfish steak|6 oz|m', 'cooked rice|1 cup|g', 'olive oil|1 tbsp|s'], ['Grill the swordfish 5 minutes per side.', 'Serve over rice.'], { fish_oz: 6 }),
  r('d-sushi', 'dinner', 'Raw salmon sushi bowl', 500, 30, 'df', ['raw salmon|4 oz|m', 'sushi rice|1 cup|g', 'cucumber|1/2|p', 'soy sauce|1 tbsp|s'], ['Slice the salmon.', 'Serve over rice with cucumber and soy sauce.'], { fish_oz: 4 }),

  // ---- snacks ----
  r('s-apple-seed', 'snack', 'Apple slices with sunflower seed butter', 210, 5, 'lh ps veg df gf', ['apple|1|p', 'sunflower seed butter|1 tbsp|s'], ['Slice the apple and serve with the seed butter.']),
  r('s-pear-milk', 'snack', 'Warm pear poached in milk', 180, 8, 'lh ps veg gf', ['pear|1|p', 'milk|1/2 cup|d', 'honey|1 tsp|s'], ['Poach the sliced pear in the milk for 5 minutes.', 'Drizzle with honey.']),
  r('s-oat-bites', 'snack', 'Blueberry oat bites', 190, 6, 'lh ps veg df gf fz bp', ['rolled oats|1/2 cup (certified gluten-free)|g', 'blueberries|1/4 cup|p', 'honey|1 tbsp|s', 'sunflower seed butter|1 tbsp|s'], ['Mix everything and roll into 4 balls.', 'Freeze the same day or eat fresh.']),
  r('s-sweet-potato', 'snack', 'Baked sweet potato rounds with cinnamon', 170, 3, 'lh ps veg df gf fz bp', ['sweet potato|1 small|p', 'cinnamon|1/2 tsp|s', 'olive oil|1 tsp|s'], ['Slice into rounds, brush with oil and cinnamon.', 'Bake at 425°F for 20 minutes.']),
  r('s-mango-coconut', 'snack', 'Mango coconut bowl', 200, 3, 'lh ps veg df gf', ['mango|1 cup|p', 'coconut milk|1/4 cup|s', 'shredded coconut|1 tbsp|s'], ['Dice the mango, top with coconut milk and coconut.']),
  r('s-rice-cakes', 'snack', 'Rice cakes with mashed pear', 190, 4, 'lh ps veg df gf', ['plain rice cakes|2|g', 'pear|1/2|p', 'honey|1 tsp|s'], ['Mash the pear and spread on the rice cakes.']),
  r('s-egg-hard', 'snack', 'Hard-boiled egg and cucumber', 140, 12, 'lh ps veg df gf', ['eggs|2|d', 'cucumber|1/2|p'], ['Boil the eggs 10 minutes until firm throughout.', 'Serve with sliced cucumber.']),
  r('s-chicken-bites', 'snack', 'Baked chicken bites with carrot sticks', 230, 24, 'lh ps df gf fz bp', ['fresh chicken breast|3 oz|m', 'carrot|1|p', 'olive oil|1 tsp|s'], ['Cube the chicken and bake at 400°F for 12 minutes until cooked through.', 'Serve with carrot sticks.']),
  r('s-matcha-latte', 'snack', 'Matcha oat latte', 120, 3, 'ps veg df', ['matcha powder|1 tsp|s', 'oat milk|1 cup|s'], ['Whisk the matcha into warm oat milk.'], { caffeine_mg: 70 }),
  r('s-coffee-shake', 'snack', 'Coffee protein shake', 220, 25, 'ps veg gf', ['brewed coffee|1/2 cup|s', 'milk|1 cup|d', 'protein powder|1 scoop|s'], ['Blend everything with ice.'], { caffeine_mg: 95 }),
  r('s-trail-mix', 'snack', 'Salted cashew trail mix', 250, 7, 'ps veg df gf', ['cashews|1/4 cup|s', 'raisins|2 tbsp|s'], ['Mix and portion.']),
  r('s-salami', 'snack', 'Salami and aged cheese plate', 280, 14, 'gf', ['salami|2 oz|m', 'aged gouda|1 oz|d'], ['Slice and serve.']),
];

export const getRecipe = (id) => RECIPES.find((x) => x.id === id) || null;
