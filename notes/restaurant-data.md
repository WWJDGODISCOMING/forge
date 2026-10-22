# Restaurant data (data/restaurants/*.json)

Static, versioned nutrition files for the Restaurant meal builder. Each file has `source`, `retrieved` and `version`.
Edit the JSON and bump `version` when numbers change. Tests pin a few values (`tests/v01649.test.js`).

| Chain | Guide page the file points at | Checked | Version |
| --- | --- | --- | --- |
| Chipotle | https://www.chipotle.com/nutrition-calculator | 2026-10-22 (burrito components from #172; round-1 review) | 2 |
| Chick-fil-A | https://www.chick-fil-a.com/nutrition-allergens | not re-checked | 1 |
| Panera | https://www.panerabread.com/en-us/nutrition.html | 2026-10-22 (round-1 review) | 2 |
| Subway | https://www.subway.com/en-us/menunutrition/nutrition | not re-checked | 1 |
| Starbucks | https://www.starbucks.com/menu | not re-checked | 1 |
| McDonald's | https://www.mcdonalds.com/us/en-us/about-our-food/nutrition-calculator.html | not re-checked | 1 |
| Taco Bell | https://www.tacobell.com/nutrition/info | not re-checked | 1 |
| Wendy's | https://www.wendys.com/nutrition-info | 2026-10-22 (round-1 review) | 2 |
| Cava | https://cava.com/nutrition | 2026-10-22 (round-1 review) | 2 |
| Sweetgreen | https://www.sweetgreen.com/nutrition | 2026-10-22 (round-1 review) | 2 |

## Honest status

- The build agent had no web access in the round-1 fix run. Values corrected in round 1 (Wendy's small chili, Cava Crazy Feta,
  Cava Greek vinaigrette, Cava grilled chicken protein) are the figures the review gave from each chain's guide.
- Items the review flagged but gave only part of the numbers for were **removed** instead of guessed: Cava hummus, SuperGreens,
  brown rice and spicy lamb meatballs; Panera Mediterranean Veggie and the Turkey sandwich (the current item is
  "Turkey & Cheddar", 840 / 40 P / 47 F, but carbs were not given); Sweetgreen blackened chicken. Add them back once someone
  has the full line from the guide.
- Every other item is still from memory (not re-checked line by line) and the `source` points at the chain's nutrition page,
  not a specific PDF. The exact guide document URLs still need to be filled in by someone who can open them.
- The in-app note already calls the numbers a close estimate.
