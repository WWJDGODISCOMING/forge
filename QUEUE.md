# Forge build queue

The order Claude works in. `.github/workflows/queue-next.yml` reads this file **on `main`** and starts the first `todo` item.
Each item is one `## ` section with `Issue`, `Version` and `Status` lines. Keep that format: the workflow parses it.

## Rules
- **One item per PR.** One issue (or one #58 slice) per branch and PR; no bundling.
- **At most 2 open `claude/*` PRs at once.** The queue waits while 2 are open or a `claude.yml` run is in progress.
- **No auto-merge.** The reviewer (Christian / his review bot) merges. Nothing in this repo merges a PR automatically.
- **Status values:** `todo` → `in-progress` (branch started) → `in-review` (PR open) → `done` (merged).
- **Mark the item `in-review` in this file inside the PR itself** as soon as the PR opens (the PR's QUEUE.md change lands on `main` when it merges; the reviewer flips it to `done` on merge, or the next PR does).
- Versions are reserved here in order. If an item is dropped, its version is skipped, not reused.
- Every PR body carries the completed **Self-review checklist** from `CLAUDE.md` and ticks each acceptance criterion below one by one.

## 1. #154 Joints to protect: knee- and lower-back-friendly workouts
- Issue: #154
- Version: 0.16.40
- Status: done (PR #159)
- Acceptance:
  - 'Joints to protect' setting (Knees, Lower back; multi-select, per profile) in Settings plus a quick toggle on Train before Start workout.
  - Generator and swap picker exclude/deprioritize stressful moves; joint-friendly substitutes train the same muscles and still count toward weekly sets.
  - Every exercise in `exercises.js` has data-driven joint-stress tags (`knee`, `lowBack`), with tests.
  - 'Knee-friendly' / 'Back-friendly' badge with a one-line why on swapped exercises.
  - Safety copy: "If pain is sharp, swelling, or lasts more than 1-2 weeks, see a doctor." Never diagnose.
  - Navy/cyan + depth tokens, Duo-ready.

## 2. #158 Reorder Train and Today cards; label the weekly report as last week
- Issue: #158
- Version: 0.16.41
- Status: done (PR #162)
- Acceptance:
  - Train order: muscle body map → today's workout (list + Start) → one compact, expandable 'Why this workout' card replacing the separate callouts.
  - Today order: larger full-width Ask Coach → today's workout → training and food rings → all missions → food → weight → everything else → readiness/HRV alerts near the bottom.
  - Weekly report titled 'Last week · <dates>' with this week's live progress (e.g. 1/4 so far) beside it, in the card and in the share text.
  - Duo-ready, depth tokens and palette.

## 3. #163 Train: tap an exercise to preview its demo before starting
- Issue: #163
- Version: 0.16.42
- Status: done (PR #166)
- Acceptance:
  - Tapping an exercise row or thumbnail on Train's list (not the ••• menu) opens a preview sheet with the same looping demo as the player, form cues, muscles worked, and joint-friendly notes when Knees/Lower back is on.
  - Swap and Replace right in the sheet, using the existing joint-aware lists.
  - Light haptic on open, animates in from the tapped thumbnail, subtle play badge on thumbnails so they look tappable.
  - VoiceOver label 'Preview demo', reduced motion respected, works offline with cached demos.
  - iPhone and Duo folded/unfolded (side panel instead of a sheet on wide screens). Tests for open, swap-from-preview and reduced motion.

## 4. #164 Train: tap the gym chip to switch gyms; joint toggles on the Resume card
- Issue: #164
- Version: 0.16.43
- Status: done (PR #167)
- Acceptance:
  - The gym chip at the top of Train opens a small picker (light haptic) with saved gyms plus a shortcut to add or edit them in Settings (check how the existing location chips behave first and build on them).
  - Picking a gym re-plans today's workout for that gym's equipment and keeps the Knees/Lower back settings; during an in-progress workout, Forge asks before switching.
  - The Knees/Lower back toggles also show on the Resume card while a workout is in progress.
  - VoiceOver labels, reduced motion, iPhone and Duo layouts; tests for switching gyms and the toggles mid-workout.

## 5. #165 Food: barcode scan + brand fallback + custom foods
- Issue: #165
- Version: 0.16.44
- Status: done (PR #168)
- Acceptance:
  - Barcode scanner on Food > Add (camera): looks the barcode up in the existing food database first, then falls back to Open Food Facts (free, no key) on the server side.
  - When typed search misses, also query Open Food Facts by brand and name and show the results under a 'Brand products' section.
  - 'Create food' saves a custom food from the nutrition label (optional photo-of-label estimate via the existing AI provider, fully manual when AI is off) to his foods, so it shows up first next time; a barcode miss leads straight to Create food.
  - Recent and favorite foods appear at the top of search.
  - Works offline for saved foods, VoiceOver, iPhone and Duo layouts. Tests for the barcode hit, the barcode miss leading to Create food, and the fallback search.
  - No new paid services; any new secret goes in Cloud Functions only.

## 6. #146 Apple Health Phase 1: import Apple workouts + Eaten vs burned + leg activity
- Issue: #146
- Version: 0.16.45
- Status: todo
- Acceptance:
  - Read `workouts`, `heartRate`, `basalCalories`; `readHealthWorkouts()` pages with `anchor` and adds avg/max HR.
  - Pure `js/health/apple-workouts.js`: skips Forge-written and linked-overlap workouts, maps workout types to Forge cardio keys (indoor/no-distance run → `jog_in_place`), idempotent `hk_<uuid>` docs, never revives deleted docs, kcal fallback.
  - Runs inside `nativeHealthSync()` with the same cadence and toast; Workouts chip counts imported cardio; History shows an Apple Watch tag.
  - Pure `js/nutrition/balance.js`: burned = resting + active (never adds workout kcal on top); Today line and Food 'Eaten vs burned' block + 7-day sheet; target unchanged; `toLocaleString('en-US')` numbers.
  - Pure `js/workouts/leg-activity.js` with the issue's exact conversion, weights and 4.0 cap; striped segment + legend + sheet on the leg rows; hard-set counts never change.
  - No Functions or rules change.
  - Eaten vs burned shows an explicit signed number: burned minus eaten as 'N calorie deficit' (or 'N calories over' when eaten is higher), on Today and the Food screen.
  - Weekly deficit total for the last 7 days in the 7-day sheet.
  - Backfill: on first run, read the last 30 days of Apple Health resting + active energy so past days show their deficit too.
  - The 2,150 kcal ceiling stays fixed and never rises with calories burned (no 'eat more' prompt after a big workout).

## 7. #169 Missions: explosion sound barrage for completion celebrations
- Issue: #169
- Version: 0.16.46
- Status: todo
- Acceptance:
  - Synthesize sounds in `js/ui/sound.js` (Web Audio, no audio files): filtered noise burst + low sine thump per explosion, short sub-bass tail.
  - All-goals tier: barrage timed exactly to the 10 accelerating heavy haptic impacts in `hapticPlan`, then a bigger final boom with the success haptic and lime burst.
  - One goal: single soft pop; two goals: double thud; perfect week: its own bigger variant.
  - Respects the Settings Sound effects switch and the silent ringer; once per day per tier like the visuals; still plays with reduced motion.
  - Volume capped, no clipping. Tests: sound plan matches haptic timings; sfx switch respected.

## 8. #155 Ask Forge: 'Can I eat this?' food coach
- Issue: #155
- Version: 0.16.47
- Status: todo
- Acceptance:
  - Ask sheet on Today and Food (text; dictation via the iOS keyboard).
  - Context via the existing swappable AI interface and Cloud Function (no keys in the front end): eaten kcal/macros, ceiling, protein goal, burned (from #146), the food (USDA/label lookup when possible).
  - Short verdict (Yes / Have half / Better pick), the numbers, one-tap 'Log it' / 'Log half'.
  - Rules-based answer when AI is off. Function is rate-limited; cost near zero.
  - General guidance only, never diagnoses; per-profile needs respected (Hannah's low-histamine/pregnancy).
  - Premium UI, navy/cyan + depth tokens, Duo-ready.

## 9. #147 Apple Health Phase 2: save Forge workouts to Apple Health
- Issue: #147
- Version: 0.16.48
- Status: todo
- Acceptance:
  - Local Swift plugin `ForgeWorkouts` (requestAuthorization, saveWorkout via `HKWorkoutBuilder` with per-minute active-energy samples summing to kcal, pause events, sync identifier/version metadata, overlappingWorkouts); capgo stays for reads.
  - Re-saving with a higher version replaces, no duplicates; overlaps with a Watch workout are linked, not double-saved.
  - `NSHealthUpdateUsageDescription` added and the share description/docs updated.
  - Phase 1 importer skips Forge-written workouts. No-op on the web.

## 10. #153 Live workout screen + lock-screen Live Activity
- Issue: #153
- Version: 0.16.49
- Status: todo
- Acceptance:
  - HKWorkoutSession + HKLiveWorkoutBuilder (iOS 26+) by extending the #147 plugin.
  - Live screen: timer, active + total kcal, HR with a Watch, distance/pace for walk/run, time-only for Jog in place; pause/resume/end; Duo-ready.
  - ActivityKit Live Activity + Dynamic Island with timer, kcal, pause.
  - On end: saved to Apple Health and Forge with no duplicate against the #146 import.
  - Flags anything that needs the paid Apple account; notes the native rebuild.

## 11. #157 Awards: badges flip in 3D
- Issue: #157
- Version: 0.16.50
- Status: todo
- Acceptance:
  - Tap toggles; drag rotates with the finger and springs to front/back; light haptic at the flip midpoint.
  - Back shows meaning, how/when earned or progress left (bar), and tier.
  - Earned badges shine/glow; locked stay muted.
  - transform/perspective only, 60fps; Reduce Motion = crossfade; button role, VoiceOver reads the back.
  - Navy/cyan + depth tokens, Duo-ready grid.

## 12. #160 Interactive charts: drag to scrub
- Issue: #160
- Version: 0.16.51
- Status: todo
- Acceptance:
  - Press-and-drag on Body weight, Today mini chart and Progress charts: vertical line snaps to the nearest point with an enlarged dot and a label (value · date) plus the trend value.
  - Selection haptic per snap; line fades on lift.
  - Horizontal swipe pans the range; prev/next arrows step one point.
  - Never fights vertical scroll (starts on horizontal move or long-press).
  - Pointer events, 60fps, Reduce Motion respected, VoiceOver adjustable, Duo-ready.

## 13. #161 Contrast + onboarding follow-up
- Issue: #161
- Version: 0.16.52
- Status: todo
- Acceptance:
  - Light-mode Done set button and How-To pill in the player reach 4.5:1.
  - The selected Settings item on the unfolded Duo (626x890, 890x626) reaches 4.5:1, light and dark.
  - Onboarding buttons never overlap on short screens (320x568, 375x667, Duo folded/landscape); tap targets ≥ 44 px.
  - A test asserts each ratio; the layout harness covers onboarding at short sizes.

## 14. #58 slice: consistent native navigation (item 9)
- Issue: #58
- Version: 0.16.53
- Status: todo
- Acceptance:
  - Check the CHANGELOG first and only build what is not shipped yet.
  - Large-title collapse with nav-bar blur on every root screen; tab re-tap scrolls to top, second re-tap pops to root (with a test).
  - No rubber-band on fixed chrome, no text selection/callout or tap-highlight flash on chrome.
  - No white frame on cold start, tab switch or route change in light mode; lazy screens pre-imported on tab touchstart; images decoded before transitions.

## 15. #58 slice: native pieces not covered by #147/#153 (item 10)
- Issue: #58
- Version: 0.16.54
- Status: todo
- Acceptance:
  - Check the CHANGELOG first and only build what is not shipped yet.
  - Tab-bar spike decision (native UITabBar vs CSS) written in `docs/ios-setup.md`.
  - Native share/save/print for exports and the doctor PDF; native camera capture for photos/meals with the pose ghost overlay (`NSCameraUsageDescription`); native barcode scanning in food search.
  - Everything is a no-op on the web.

## 16. #58 slice: remaining audit gaps (items 5-8)
- Issue: #58
- Version: 0.16.55
- Status: todo
- Acceptance:
  - Compare the shipped CHANGELOG to #58 items 5-8 and build the largest remaining gap only (one slice); name it in the PR title.
  - Before/after renders per #58 (same fixture, dark + light); contrast AA; at most one accent-filled control per screen.

## After the queue: rest of the CLAUDE.md roadmap
Not an item (no `Status` line, so the workflow ignores it). When everything above is `done`, the review bot opens issues for the remaining roadmap work in `CLAUDE.md` (e.g. home-screen widgets from #58 item 10, Withings steps sync in Functions from #146's out-of-scope note) and adds them here with the next free versions.
