# Changelog

## 0.15.11 — Fit-and-finish, part 5: the running app picks up Refresh Forge (2026-10-10)

Issue #64, part 5 (item 26). No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes. **New native dependency `@capacitor/app`:** Refresh Forge installs it and runs `cap sync` by itself, so the usual double-click is all that's needed.

- **Update on resume (iPhone app):** `app-install.json` now carries `version` next to `builtAt`. When Forge comes back to the front (the `@capacitor/app` resume event, with `visibilitychange` as a fallback) it re-reads that file (`no-store`). If the version, build time or signing date changed, it reloads, so an app that was left open shows the new version and the Settings countdown without a force-quit.
- **Never mid-workout:** the reload waits while the player or workout list is open, or while you are typing in a field, and goes through as soon as you leave. A running rest timer and the active workout are saved and survive a reload anyway.
- **"Updated to 0.15.11 · What's new":** once per version, after the update, a toast with a What's new button. The sheet lists that version's highlights from `whats-new.json`, which the build generates from this CHANGELOG. Nothing shows on a first install.
- **Native cleanup:** on the iPhone app's first launch of this build, any service worker and `forge-*` cache left from older builds is removed, so a stale cached file can never be served inside the app.
- **Refresh Forge.command** now relaunches Forge on the phone after installing (`devicectl device process launch --terminate-existing`, phone unlocked). If this Xcode lacks the flag or the launch fails, it says "If Forge was open on the phone, close and reopen it."
- **Missions footer:** "Finish all 4 for a +30 XP bonus." The bonus can't split from its number or leave "XP" alone on a line, and the sentence balances across two lines.
- **Tour:** a target that fits now gets about 28 px of page above it as well as clear space over the card, on every step at 320, 375 and 390 (the tab-bar step and cards taller than the room, like Rings and Recovery, are pinned under the nav bar). The layout test steps through all 11 and checks it.
- Tests: `tests/v01511.test.js`; the layout test simulates a resume with a changed `app-install.json` (reload, then the toast and sheet), and checks the missions footer at 320/390, text scale 1 and 1.35.

## 0.15.10 — Fit-and-finish, part 4: weight card, Food at 320, Log food dock (2026-10-10)

Issue #64, part 4. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes.

- **Weight card (Today):** today's weigh-in is the big number, labelled "Today · 7:42 AM" (or "Yesterday" / "Latest · Oct 8"). Under it: "Trend 207.7 · ↑ 2.0 this week", and a one-line "What's trend weight?" explainer. Weight screen: the stats show Today/Latest next to Trend (two-by-two).
- **Weight detail message:** instead of "Not enough readings…" it says how many weigh-ins there are, e.g. "Only 2 weigh-ins in the last 4 weeks. The trend line is your smoothed average. Weigh in 3+ times a week for a reliable 4-week direction."
- **Steps insight:** the "Steps are trending up" wording from 0.15.6 comes from one function that both the Today card and the Body card use. A phone still showing "Steps is…" is on an older build.
- **Food summary at 320:** each value and its "of target" stay on one line at 320, 375 and 390, at normal and large text. When they don't fit beside the label the value goes under it on purpose; Carbs and Fat stack label over value.
- **Log food dock:** each macro keeps its number with its unit ("5 g fat" never splits); the line only breaks between macros.
- **Round 1 review fixes:**
  - Today weight card heading is "Weight" (the big number is the scale reading, the trend has its own line).
  - "Trend 208.3 · ↑ 0.4 this week" stays on one line at 390 and 375; when it must break it breaks only at the dot. The text column takes the free width and the sparkline is narrower on small screens.
  - "What's trend weight?" and Log weight share one row (44 pt targets); the explainer opens below. At 320 or large text the button drops to its own line instead of overflowing.
  - Weight detail message: "No weigh-ins in the last 4 weeks." (not "Only no…"), and a separate honest line when there are enough readings but no clear change. Weight screen's first stat reads "Yesterday" / "Latest · Oct 8" when the newest reading isn't today.
- **Round 2 review fixes:**
  - The weight card's action row never wraps: "What's trend weight?" can take two lines on the left, Log weight stays on the right edge, both centred and 44 pt; the explainer opens below the row.
  - Interval timer presets: the 320px rule now caps text growth too, so "EMOM", "Tabata" and "Custom" fit at the largest text with space between them.
  - Interval timer Work / Rest / Rounds inputs line up on one line even when a label wraps.
- Tests: `tests/v01510.test.js`; the layout test covers over-target Food at 320/375/390 (scale 1 and 1.35) and the dock macro line at 320/390 (scale 1 and 1.35).

## 0.15.9 — USDA food search (2026-10-10)

Part 4 of the audit in issue #57. **The functions (`foodSearch`, and the `withingsDisconnect` change) are already deployed.** `firestore.rules` is unchanged (the `usda:<fdcId>` id fits the existing `food_id` string, and the portion text is an extra field the rules already allow), and so are `firebase.json` and `config.js`. The web app updates by itself; the iPhone app needs one Refresh Forge run.

- **Real foods in Log food:** type "banana" or "chobani" and USDA FoodData Central rows appear under your own foods and recents. Yours show instantly; USDA rows follow about 300 ms after you stop typing, under a skeleton, and the list doesn't jump (old rows dim until the new ones arrive).
- **Rows:** name, brand, "1,250 kcal" and a serving line ("1 cup (240 g)" or "100 g"). The name wraps to two lines; brand, calories and serving stay on one line (a long brand shortens first, the calories never split).
- **Portion picker:** servings ½, 1, 1½, 2, or type an amount in servings, oz or g (oz first for lb/ft users), with calories and protein, carbs and fat updating as you go. The app remembers which unit you used last.
- **What gets logged:** a normal food entry for exactly that portion, with the USDA id kept (`usda:<fdcId>`) and a portion line like "4 oz (113 g)", so Recents bring it back. Small amounts (20 g of oil) are exact, not rounded up to a quarter serving.
- **Offline or down:** your own foods keep working and one quiet line says "Online search needs a connection" or "Online search isn’t available right now". No toasts.
- **Round 1 review fixes:**
  - Rows: a short brand sizes to its text ("Perdue · 123 kcal · 4 oz (112 g)"); names wrap to two lines so "raw" vs "roasted" shows; the loading skeleton is a name bar and a grey bar.
  - Household servings: foods with USDA household measures (Survey/FNDDS) default to the first one ("1 cup (158 g)") instead of 100 g, and up to 4 measures show as chips above the ½ 1 1½ 2 chips. 100 g stays the fallback.
  - Names: a USDA entry is stored with the clean title and the brand in its own `brand` field (40 characters at most). The Log food dock, the meal list and Recents show the title (two lines) with the brand first on the grey line. The "Added" toast is one short line ("Added to breakfast · 1,250 kcal"). Calories show a thousands separator everywhere on the Food screen.
  - Messages: the server's "That's a lot of searches…" line is shown as written; "isn’t available right now" is only for real outages.
  - Privacy: Delete everything now also removes the food-search counter (`private/food_search`), even if you never used Withings or Apple Health. **This is a Cloud Functions change (`withingsDisconnect`): redeploy with `firebase deploy --only functions`.**
  - Server brand text is cut cleanly at 40 characters with a real "…".
- **Round 2 review fixes:**
  - Serving-size chips are one scrolling row of one-line pills under a "Serving size" caption (the `.chips` grid no longer overrides them). "0.5 breast, bone and skin removed" now survives (limit 40 characters), and 0.5 / 0.25 read "½" / "¼".
  - Toasts size to their text (`width: max-content`), so "Added to breakfast · 1,250 kcal" is one line. This applies to every toast in the app.
  - Round 3: the server shortens brands in code (`shortBrand`: "Kraft Heinz Foods Company International Division" becomes "Kraft Heinz"; past 22 characters it cuts at a word with a real "…"), so no CSS ellipsis leaves a gap. With a serving-size chip row, the "1 serving = 86 g" note is one line (the selected chip names the measure); otherwise "(86 g)" never orphans. The chips deliberately wrap onto more rows.
  - The meal row's grey line is one line: brand (shortens first) · protein · portion. Calories are the number on the right.
  - A cut brand ends where its "…" ends (the separator belongs to the brand). The loading skeleton bars line up with the row text.
  - "Food search is busy. Try again in a minute." is shown as written.
  - Privacy without a bypass: Delete everything removes `private/food_search` only after its hour window has passed, so it can't reset the 120 an hour limit.
- **Server (`foodSearch`):** needs sign-in, 2–60 characters, 120 searches an hour per person, the key in a header (never in a URL), a 6 s timeout, a 5-minute in-memory cache. Whole foods rank first for "chicken breast"; brand-named queries ("quest bar") rank branded first. Near-duplicates are dropped, 25 results at most. The key, the request and what you typed are never logged.

## 0.15.8 — Fit-and-finish, part 3: "Change today's workout" (2026-10-10)

Issue #64, item 25. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes, and #65's branch is untouched. Update-on-resume (26) and the iPhone Duo layouts (27–31) are not in this release.

- **Change replaces Switch:** the button says "Change" (⇄ icon, 44 px, aria-label "Change today's workout") and opens a bottom sheet. Nothing changes until you pick an option, and each option says what it does:
  - **New exercises:** same focus, different moves. Your hand-picked ⋯ → Replace exercises stay unless you tick "Also replace the ones I picked". Greyed out with the reason when nothing else fits ("No other moves fit Home gym for Upper. Try a different focus or location."). If only some can change, the toast says "2 of 6 swapped".
  - **Train a different focus:** a second step with "Recommended: …" first, then the focuses (the custom days for a custom program). This replaces the "Or train a different day" menu on the card.
  - **Session length:** 20, 30, 45 or 60 min for today only. New per-day override through `planToday` → `generateWorkout({ sessionMin })`; the profile is never written.
  - **Different location:** only when you have 2+ locations.
  - **Back to recommended:** only when something was changed.
- **Undo:** every change shows a toast with an Undo button that restores the exact previous workout (swapped exercises, picks, rest timers, focus, length and location). Rest-timer choices move along with their slot when an exercise is swapped. Swapped rows get a brief highlight (none with reduced motion). Haptics on native.
- **Toast:** `toast(message, ms, { action: { label, onClick } })`; the action is a 44 px button.
- Hidden while a workout is in progress, as before. Works offline (all local).
- Tests: `tests/v0158.test.js` (option logic, snapshot/Undo, rest carry-over, per-day length) and a layout case that opens the sheet, each step and the Undo toast at 320, 375, 390 and 440 wide (plus light mode and long location names).
- **Review round 1:** 20 and 30 min now really shorten the workout: after accessories, sets on the later lifts are trimmed toward 2, then lifts are dropped from the end (the first always stays); 20 min also gets a 3-minute warm-up with one lighter-set ramp. Every day type fits its length (+2 min) at home and at the gym. Undo after "Different location" keeps earlier swaps, picks and rest timers. The Undo toast is one line (long place names ellipsize) with a plain accent "Undo". The sheet's rows name the focus, the other focuses, the current length and the other places; the focus list no longer repeats the recommended day; each step is the sheet's title with a back chevron in the header (slides in; no motion with reduced motion); length rows preview the real result ("3 exercises · your usual"), disabled with a reason when a length can't be met.
- Not done: the optional "Log weight beside the goal line" tweak. The goal sentence can fill the whole row, so it stays on its own row rather than squeeze at 320.

## 0.15.7 — Fit-and-finish, part 2: large text, stale readings, Today and a layout test (2026-10-10)

Issue #64, second pass. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes. Items 25–31 (Change sheet, update-on-resume, iPhone Duo) are **not** in this release. If #65 (v0.15.5) merges after this one, rebase and fix the CHANGELOG order.

- **Large text (item 16):** every font size and line height up to 28 px now scales with iOS Settings → Text Size (up to 135%) through one `--ts` variable (`js/ui/textsize.js`). Buttons wrap their label instead of clipping, and a pair of buttons stacks when both don't fit on a row.
- **Nav bar (21):** stronger glass (about 84–88% opaque, plus the blur) so text scrolling under it is never half-readable; "What is this?" uses the shared `.learn-more` disclosure; the large title collapses exactly when the heading itself passes under the bar.
- **Body composition (20):** a reading older than your latest weigh-in says "2 days ago" or "Sep 23" in quiet grey (no orange) on one line; readings older than 90 days sit behind "Show older (n)"; Standing HR is explained under the tiles.
- **Progress photos card (22):** lime accent card with a filled camera disc, "See your change, not just the scale" and a "Take photos" pill. With photos it shows "Last set …" and "Next check-in in N days".
- **Today (density):** "See meals", "See plan" and "See chart" moved into the card headers; Start sits beside the workout title; Log food sits beside the Food ring; Log weight sits on the goal row; one insight instead of two; 12 px between cards; a smaller Score ring.
- **Rings legend:** the ring column is 16 px narrower so "Weekly sets" fits at 375.
- **Player:** the footer says "Undo set" so it stays on one line at 320 px; on very short phones the How-To strip names the main muscle (for example "Chest") instead of being an empty bar.
- **Small labels:** Body tile says "fresh muscles"; Settings rows "Export all (JSON)", "Export body data (CSV)", "Replay the how-to tour", "Delete all photos".
- **Standing layout test (`tests/layout.test.js`):** boots the real app in headless Chromium (no npm packages, Firebase stubbed, synthetic account) and renders Today, Train, Body, Weight, Trends, Timer, History, Settings, Apple Health, Food, Awards, Locations and Library at 320×568, 375×667, 390×844 and 440×956, dark and light, plus long-name/4-digit-calorie data and a 130% text-size case. It fails on text that wraps in a chip, pill, button or label, clipped text or ellipsis, tap targets under 44 px, sideways overflow, content under the tab bar and layout shift. It runs inside `node tests/run.js` (skipped with a note when no Chrome is installed; `--no-layout` skips it) and in CI. Run one screen with `node tests/layout.test.js --routes=today --size=375 --shots=tests/.shots`.
- Tests: `tests/v0157.test.js` pins the stale-reading captions, the text scale, the photos card, the Today markup and the CSS rules.
- **Review round 1:** workout meta is "4 exercises · 41 min" with the place on its own ellipsised line; goal sentence gets a full-width line with dates kept together (Today and Body goal path); "+ Log weight" is one flex item; "Plates" tile; buttons wrap only between words (`overflow-wrap: break-word`); layout test skips on Node below 22 and creates the `--shots` folder; Standing HR note shows whenever an HR tile exists.
- **Review round 2:** the Standing HR note renders inside "Show older" when the HR tile is there, and under the grid when it is fresh; the goal-path chart label is "Goal 181 lb" at the left end of the goal line so the projection never covers it.

## 0.15.6 — Fit-and-finish, part 1: chips, steppers and Body (2026-10-10)

Issue #64, first pass. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes. Items 16, 20, 22, 25, 26 and 27–31 (large text, stale body readings, photos card accent, the Change sheet, update-on-resume, iPhone Duo layouts) are **not** in this release.

- **Root cause fixed:** `css/food.css` no longer redefines the global `.chips`, `.chip-btn` and `.stepper`. Food uses `.meal-chips` and `.serv-stepper`. This un-squeezes the Train location chips and the exercise rest chips, and restores the player's weight/reps steppers (56 px −/+ with the value centred).
- **Chips** size to their text; wrapped segmented controls (Interval timer presets) really wrap instead of overlapping.
- **Tap targets:** segmented controls are 44 px tall; "In the tank" is one row of label + 6 buttons, 44 px tall.
- **Player rest:** −15 s / Skip rest / +15 s sit in a 3-column grid and stay on one line.
- **Today:** the Coach line may take two balanced lines instead of being cut off; the rings legend uses short titles ("Calories", "Protein") and Weekly sets as three rows with no "·".
- **Train:** the preview card drops the duplicate location pill. **Health summary:** buttons say "Save PDF" and "Share text" and stack on narrow phones.
- **Apple Health setup:** field tiles in one column under 400 px; copy-chip identifiers no longer split mid-word.
- **Tour:** one focus ring on Next; a compact card on short phones.
- **Body:** Recovery is the first card under the tiles, and the "fresh muscle groups" tile scrolls to it and pulses once (instant with reduced motion). The empty workout tile is "0 / Start your first workout" and links to Train. "Body profile" is sentence case. The photos slot reserves space so the page doesn't jump. Programs "Recommended" uses accent tokens.
- **Insights:** "Steps are trending up"; the body states the change over the window with units (e.g. "+2,520 steps/day vs 4 weeks ago", "−1 h/night").
- Pages scroll with `scroll-padding-top` so jumps don't land under the nav bar.
- Tests: `tests/v0156.test.js` pins the CSS/markup rules and the insight maths.
- **Review round 1:** "In the tank" label sits above a row of six equal 44 px buttons; the Progress switcher is 44 px; Interval timer presets are one row of five equal segments with short labels (full names stay in the aria-label); Apple copy chips break identifiers only after `_`, with "Copy" in a fixed column; insight numbers use one decimal for weight, "ml/kg/min" for VO₂max, "2 h 34 min/night" for long sleep changes and a real minus sign; Body shows "Today / last workout" and the two tappable tiles get a chevron and press feedback; the tour's Next keeps one offset keyboard focus ring.
- **Review round 2:** "Done set" is pinned to the bottom of the player (with the "Next:" line), and the exercise picture and big rep number shrink a little on short phones. The "In the tank" buttons and timer presets fit on 320 px screens. Body tiles stay equal width ("Today" scales to fit). The tour's Next button only gets a focus ring for keyboard users; after a tap, focus goes to the card. Insights read "−0.6% body fat", "−1.5 on the visceral fat index" and "−6 bpm", and never show a zero change.
- **Review round 3:** on short phones (700 px tall or less) the exercise picture is 72 px and the rep number 56 px, so the "In the tank" row clears the pinned "Done set"; the "Next:" line stays on one row (long names get an ellipsis); the first-time hint balances its lines and keeps "Do 12." and "14 times" together; the second Body tile's value is plain text colour again, and both tile values share one 48 px box so the captions line up.
- **Review round 4:** on very short phones (600 px tall or less, like a 320×568 SE) the player hides the exercise picture (the How-To chip stays) and puts the two steppers side by side, so no row sits in the faded strip above "Done set"; every Body tile value now has one fixed 56 px box (line-height 1), so the captions line up for numbers, "Today" and text.

## 0.15.4 — Exports, shares and Print work in the iPhone app (2026-10-10)

Part 3 of the audit in issue #57 (item 5). No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes. **Christian: run Refresh Forge once** (it installs the two new plugins), then check on the phone: Settings → Export everything, Export photos, and Health summary → Print or share should each open the iOS sheet.

- **Share sheet instead of dead downloads:** in the app, Export everything (JSON), the CSV exports, the photos zip, the time-lapse or photo strip and the workout share card are written to the app's cache (`@capacitor/filesystem`), opened in the iOS share sheet (`@capacitor/share`: Save to Files, AirDrop, Mail…) and deleted afterwards. Big files go in 3 MB pieces so a 100+ MB zip doesn't freeze the screen. The web keeps its downloads exactly.
- **Doctor summary:** in the app the button says "Print or share". It makes a US Letter PDF (lb, °F, "8,532") that follows the printed page: title block, boxed sections with the label on the left and the bold value on the right, small grey sub-lines, the weight trend as a line chart with start/end dates, the HRV and Forge Score notes, and a "Page X of Y · Not a medical record" footer. A box never splits across pages. Opens the share sheet, which includes Print.
- **Rows stay put while busy:** the export rows keep their icon and style and only swap the label text. In the app they show the share icon, and the Health summary row says "Print or share a PDF".
- **Never silent:** buttons say "Getting it ready…", "Making the PDF…" or "Building your backup…" while they work. If writing or sharing fails you get "Couldn’t open the share sheet. Try again." Closing the share sheet shows nothing.

## 0.15.3 — Findable photos, a shorter Today, a fuller tour, small fixes (2026-10-10)

Part 2 of the audit in issue #57 (items 4, 6, 7, 8 and one rings polish fix). No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes. **Christian: run Refresh Forge once** to get this on your phone (the web app updates by itself).

- **Progress photos are easy to find:** Progress → Weight has a "Progress photos" row at the top of the Awards / Coach list (also when you have no weigh-ins yet). On Body, the photos card now sits right under the two numbers at the top, above Body composition.
- **Honest about storage:** if this phone can't save photos, the Body card says "Photos can’t be saved here" instead of vanishing.
- **Native wording:** in the iPhone app the photo notes say "If you delete the Forge app, they’re gone. Export a zip to keep them." The web keeps the Safari wording.
- **Shorter Today:** Daily targets moved into the Food card (protein, carbs, fat, and "Why these numbers?" folded away). Coach is one line under Readiness. Order: Readiness, Coach, rings, workout, Food, missions, weight, then Program, Score, Weekly report (still Sun/Mon), photo reminder and insights. The rings card has a permanent **This week** link next to Awards.
- **Tour:** 11 steps. New: "Ask Coach" (Today) and "Body: what’s recovered" (recovery map, and where the photos card is). The Food step spotlights the Food card and mentions the targets. Accounts that already existed see a one-time "New: Food and photos" card on Today with **Show me** and **Not now**; either answer settles it for good (saved as `tour_offer` on the profile). New accounts get the full tour instead, and no offer.
- **Small fixes:** Train location chips stay on one line with an ellipsis (a long name never wraps to two lines). A new user's Body screen says "No workouts yet" instead of a bare dash. Body Profile works out fat mass from weight × body fat % when the scale only sends the percentage (Withings Body Comp). The iPhone app no longer shows "0 of 175 saved for offline" and hides the demo-photo download, because those photos are already inside the app.
- **Rings draw once per visit:** when data refreshes while you're on Today, the arcs glide on from where they were instead of emptying and refilling. Reduced motion is unchanged (no animation).
- Tests: Today order and the targets inside the Food card, tour step count/targets/offer, ratio-only fat mass, chip ellipsis, native photo copy, empty-storage state, rings start offsets.

## 0.15.2 — Camera fix for the iPhone app, and Food gets a real home on Today (2026-10-09)

Part 1 of the audit in issue #57. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes.

- **Camera fix (iPhone app):** `Info.plist` now has `NSCameraUsageDescription`. Without it iOS closes the app the moment "Take photo" opens the camera. The words: "Forge uses the camera for your progress photos and meal photos. Photos stay on this iPhone unless you choose to analyse a meal." No `NSPhotoLibraryAddUsageDescription`: nothing saves straight into Photos (exports, the zip and the time-lapse go through the share sheet or a download), so a test now pins that it stays absent until a flow needs it. **Christian: run Refresh Forge once** to get this on your phone.
- **Food card moved up:** it now sits right under the workout card instead of at the very bottom. A calories ring with protein inside it, "1,850 of 2,200 kcal", kcal left (or over), protein, **Log food** (one tap to the sheet) and **See meals**.
- **Calories and protein on the Today rings:** two new rings (today's calories vs target, today's protein vs target) join Training, Weekly sets and Recovery. The five rings are thinner so they fit the same circle. They never burst.
- **Tour:** a new "Log your food" step spotlights the real Food card (9 steps).
- **Food colours:** calories and protein have their own colours (`--food-kcal`, `--food-protein`), shared by the Today rings and the Food card. Orange (`--warn`) now means "over" only.
- **Going over looks different:** past the calorie target the ring turns orange with the extra drawn as a darker second lap, and the note reads "1,310 kcal over" in orange (Food card and Today legend).
- **No split numbers:** a number and its unit never wrap apart; protein sits on its own line on the Food card.
- **Tour and label:** the rings step now explains the outer three (your week) and inner two (today's food); the card label is "Training and food".
- **Legend wrapping:** the over amount is its own orange legend line ("1,310 kcal over"), and each Weekly sets count stays with its label, with the "·" kept at the end of the line above, so no line starts with a dot.
- **Second lap timing:** the darker over-target lap now draws after the first lap closes (1s delay); instant under reduced motion.
- Tests: Info.plist keys, the food rings, the over state in the Today rings and the Food card, the tour step.

## 0.15.1 — One-click weekly refresh for the iPhone app (2026-10-09)

A free Apple ID signs the iPhone app for 7 days only. This makes the weekly re-install one double-click, and Forge tells you when it's due. The web app is unchanged. No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes.

- **`Refresh Forge.command`:** `scripts/ios-setup.sh` now copies it to the Desktop. Double-click with the iPhone plugged in (or paired for Wi-Fi) and unlocked: it switches `~/forge-app` to `main`, pulls, runs the same build steps as the setup script, builds with `xcodebuild` (automatic signing, `-allowProvisioningUpdates`) and installs with `xcrun devicectl` on the first connected iPhone, without opening Xcode. Plain-words ✓/✗ steps, a fix for the usual problems (locked phone, not plugged in, Developer Mode, Apple ID signed out), a `refresh-forge.log`, and "Forge is refreshed: good for 7 more days."
- **Refresh hardening:** clears Forge's cached signing profile first (so a refresh really gets a fresh 7 days) and ends with the real date; checks the expiry reached the app; error advice reads only the failing step's output; `-allowProvisioningDeviceRegistration` so a second iPhone works; fetches and switches to `main` by itself (stashing build leftovers); sets Homebrew's PATH. The log is for your Forge chat, not GitHub.
- **Countdown in the app (iPhone app only):** Settings → iPhone app → "App refresh" is a proper row (exact date, days left, amber when due) that opens a 3-step sheet with a "Remind me" button; Today shows a "Forge needs its weekly refresh" banner with the real deadline from 1 day before. The day-before notification (8:00 to 20:00) is only scheduled once notifications are already allowed: Forge never asks at launch ("Remind me" asks in context). The expiry is the signing profile's ExpirationDate, which the refresh writes into the app (`app-install.json`); without it, build time + 7 days.
- **Docs:** "Every week" in docs/ios-setup.md.
- Tests for the expiry math.

## 0.15.0 — iPhone app proof of concept (Capacitor) (2026-10-09)

- Morning read: from 4:00 to 12:00, until last night's sleep has arrived (HRV alone doesn't count), Forge reads Apple Health again on open (at most every 20 min, 30 min back-off after a failure). Readiness updates by itself.
- Clearer "nothing yet" notice on Apple Health; Today's Readiness no longer says "Connect" after you have; the setup script skips `npm ci` when nothing changed.

The same Forge code can now run inside a native iPhone shell, built on your Mac with Xcode: one command (`bash scripts/ios-setup.sh`) and **docs/ios-setup.md**. HealthKit works with a free Apple ID (Personal Team); the $99 program is only for TestFlight, the App Store and no weekly re-sign. The web app on GitHub Pages works exactly as before; nothing here runs in a browser. No Cloud Functions, `firestore.rules` or `config.js` changes. Merge after 0.14.5 and 0.14.6.

**In the iPhone app:**
- **Real haptics:** the Taptic Engine on Done set, tabs, segments and "rest's over", instead of the iOS switch trick.
- **The rest timer reaches the lock screen:** a "Rest's over · Next: Bench press" notification, kept in step with +/- 15 s, pause and skip.
- **Apple Health straight from HealthKit:** Settings → Apple Health → Connect. Forge reads HRV, resting heart rate, breathing, blood oxygen, sleep stages, sleeping wrist temperature, VO₂max, steps, active energy and exercise minutes, turns them into the same daily summaries as the export import (same code), and saves only those. It reads again by itself on open, every 6 hours at most. The Shortcut and export import are still there under "Other ways". In the app, every "set up the Shortcut" prompt (Today, Score, metric screens, Settings) says **Connect Apple Health**. After connecting, the card shows which kinds arrived and, for any with nothing, the exact switch: Settings → Health → Data Access & Devices → Forge → Turn On All. Walking heart rate isn't in the HealthKit plugin, so it isn't read (nothing depends on it).
- **Feels like an app:** the real Forge icon (1024 px) and a dark launch screen with the Forge mark (no Capacitor art, no white flash; it comes down once the first screen is drawn), the keyboard shrinks the view so sheets and set entry stay above it (key bar with Done stays on), no rubber-banding, no link previews or long-press callouts, no text selection on controls, portrait only, and the in-app edge swipe is the only back gesture.
- **Ready to build:** the configured `ios/` project is committed (HealthKit entitlement, privacy strings, portrait, icon, splash) with `package-lock.json`, `scripts/ios-setup.sh`, `docs/ios-setup.md` and `docs/app-store-checklist.md`.
- **Opens offline:** the app carries its own files and Firebase's code (`scripts/build-www.mjs`), so it needs no service worker.
- **Withings sign-in** opens over the app (Safari view) instead of leaving it.
- **Status bar** follows light and dark.

**Under the hood:**
- `js/native/bridge.js` is the only place the app touches native code. Every call is a no-op in a browser.
- `js/native/health.js` maps HealthKit to export-style records. The export aggregator gained `addRecord()`.
- New files: `capacitor.config.json` (bundle ID `com.christianeverett.forge` for now; it becomes your LLC's before TestFlight) and npm scripts `native:setup`, `native:build`, `native:assets`, `native:sync`, `native:open`.
- New tests cover the bridge (with a fake native shell), the HealthKit → daily-summary path, and the www build.

## 0.14.6 — Polish: readable charts, plain-words errors, steadier family-weigh-in check (2026-10-09)

Merge after 0.14.5 (food logging). **Cloud Functions changed** (one line, the history-import year windows): deploy with `firebase deploy --only functions` when convenient. Nothing breaks before you do. No `firestore.rules` or `config.js` changes.

- **Server-error notice is per collection:** the Withings screen warns only when `body_measures` or `integrations` can't be read, and Apple Health only for `health_daily` or `integrations`. A failure in one no longer shows on the other. The chart's "N sets" scale line is lighter so it doesn't read as part of the weight axis.
- **Body metric charts:**
  - axis numbers are round (146, 148, 150… or 26.5, 27.0…) with the unit above them;
  - the training-set bars have a scale ("36 sets" at their top line);
  - touch or drag across a chart to read that day's value.
- **Errors in plain words:** the Withings and Apple Health screens no longer show "(permission-denied)". They say what's wrong and what to do.
- **Data check:** the Apple Health card shows what's actually arriving (it still said "arrives with the next update"), with a link to Apple Health status. Saved reports are one box per row, not a box inside a box.
- **"Is this you?" check:** starts from a weight you typed in or confirmed within 14 days of your newest reading, or from your profile weight, before falling back to the newest readings. So a run of a child's weigh-ins right after yours can no longer flip it.
- **History import:** yearly windows now stop one second before New Year, so a reading at exactly midnight on Jan 1 can't be counted in two years.
- **docs/levels.md:** the title no longer says v0.3.2.

## 0.14.5 — Food logging, part 1 (2026-10-09)

_Built as 0.11.0 (PR #33) and rebased onto 0.14.4; everything in 0.12.0–0.14.4 is kept._

**`firestore.rules` changed. Publish the rules BEFORE you open this version: `firebase deploy --only firestore:rules` (DEPLOY.md, "If an update changes `firestore.rules`").** No Cloud Functions or `config.js` changes. Until the rules are published the app still opens, but the Food screen says food isn't switched on and nothing can be saved there.

- **Food, under Today.** A new Food card on Today shows calories and protein so far, with **Log food** and **See meals**. The Food screen shows today's calories and protein (large) and carbs and fat against your daily targets, then Breakfast, Lunch, Dinner and Snacks. Arrows move between days. There is no new tab.
- **Log food is fast.** The sheet opens with your recent foods on top: tap the food, tap Add (three taps in all). Servings start at 1 and the meal is pre-picked by the time of day. Search covers My foods and your recent entries, all on the phone.
- **Quick add** for "about 600": just calories, protein if you know it.
- **My foods:** save, edit and delete the things you eat often. Each entry keeps its own copy of the numbers, so editing a food never changes what you logged before.
- **Copy yesterday** on an empty meal, and tap an entry to change servings or meal or delete it.
- **Forge Score:** the Nutrition part (15%) now counts days logged, calories within 10% of target and protein at target. It switches on once you've logged food on 3 of the last 7 days; until then it stays "not tracked yet".
- **Weekly report:** a Nutrition card (days logged, average calories and protein against target) and one line in the shared text.
- **Your data:** foods and food logs are in the JSON export, a new "Export food log (CSV)" in Settings, and Delete everything.
- Under the hood: new `foods` and `food_logs` collections (types and ranges checked in `firestore.rules`, covered by the rules tests), `js/food/search.js` as the single place USDA search plugs into in part 2, and `docs/food.md`. Adaptive TDEE is not in this version (TODO in `docs/food.md`).

## 0.14.4 — Figures for cardio machines, jump rope and boxing (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Twelve new demo figures** (new `js/ui/poses-cardio.js`, added to the offline shell). They are loops, not reps: each has one cycle angle `ph` that runs at a steady speed, and the feet and hands are placed from the machine's own geometry, so they stay on the belt, pedals, plates, steps and handles in every frame.
  - **Treadmill incline walk** (side view): a 10° belt with marks that slide back at the speed of the foot on it, an upright with a console and two handrails. The feet swap (one on the belt, one swinging just above it), the hips sit high and bob a little so the stance leg is nearly straight at mid-stance (a walk, not a squat), the hands stay on the rails.
  - **Bike steady / Bike intervals** (side view): seat, handlebars, crank and pedals. The ball of each foot stays over its pedal, the pedals go round a circle and stay opposite each other, the body sits on the seat and the hands stay on the bars. Intervals use the same bike with a bigger lean (40° instead of 22°) and a twice-as-fast cadence.
  - **Rower intervals** (side view): rail, sliding seat, footplates, a flywheel and a handle on a chain. Catch → drive (legs, then back, then arms) → finish → recovery (arms, then body, then seat). Feet stay strapped to the plates, the body stays on the seat, and the hands stay on the handle.
  - **Stair climber** (side view): two steps that go up and down in turn, hands on the rails; the foot on the high step has its knee bent while the other leg pushes.
  - **Elliptical** (side view): two foot plates on a tilted ellipse (drawn faintly), and two handles that swing about a pivot (back as the same-side foot goes forward). Hands stay on the handles.
  - **Jump rope and double-unders** (straight-on front view, so the rope reads as an arch over the head and a U under the feet, never sticking out past the hands): a small hop with a rope that goes from hand to hand, passes under the feet while they are in the air and over the head. The double-under turns the rope twice in one higher hop. The rope is a flat-bottomed U under the feet and a round loop elsewhere, and is drawn in front of or behind the body depending on which side of it it is on.
  - **Shadowboxing, Shadowboxing with Light Dumbbells, Boxing footwork, Heavy bag rounds** (3/4 front view): a guard stance (lead foot forward, rear heel up) with alternating straight punches (jab with the lead hand, cross with the rear). The dumbbell version is the same with a small dumbbell in each hand. Footwork steps in (lead foot, then rear) and out (rear foot, then lead) and keeps one foot on the floor. On the heavy bag the fists stop at the bag's surface (it is round, so it curves away at the sides), and the bag swings away only after it has been hit.
- **Left without a figure:** `slip_and_roll`, `muscleup`, `muscleup_transition` and `mb_rotational_throw`. The rig has no way to twist or roll the trunk, hang from a bar and transition over it, or throw a medicine ball, and a wrong-looking figure is worse than none.
- **Rig additions** (`rig.js`, `figure.js`; existing templates are unchanged): a template may have a `drive(P)` that turns its cycle angle into joint targets and a `prims(j)` that returns the machine shapes (lines, curves, circles, polygons) for a frame, drawn behind or in front of the body by the new `cardio` gear. `tempo.lin` gives a steady speed instead of the sine ease. Pose params `fa` / `faN` / `faF` set the foot angle per frame. Loops (`cycle`) keep a steady muscle glow rather than a pulse.
- Not yet seen on a real screen: there is no browser in this environment, so these were built and checked as joint positions and a fake-DOM mount of every figure, not as rendered pixels. Worth a look at iPhone size.
- New tests in `tests/cardioposes.test.js`; three older tests that said these ids had no figure now say the four left out still have none.

## 0.14.3 — Coach answers for missions, body programs and long-term health (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

Still no AI: every answer is rule-based, from your own data, and reuses the existing helpers (missions core/store, body-programs core/store, `longTerm` and `longevityCards`).

- **"How are my missions going?"** (only after missions have started): today's missions done out of the total and which are left, "N of the last 7 days complete" (fewer days right after starting), the weigh-in streak in days, and "You earned N XP from missions this week" (mission and mission-badge XP from the last 7 days, never before missions started: the same sums Today uses, from `weekXP` in `missions/store.js`). The second line no longer repeats the headline: "Still to do: …" or "All done today."
- **Pace text can't contradict the goal.** On Coach and `#/program`, a weekly pace outside the safe range that would round into it (0.46 lb shown as "0.5" next to "safe pace: 0.5–1.6 lb") now shows more decimals ("0.46"). New `paceNumber` in `body-programs/core.js`.
- **"How's my program going?"** (only while a body program runs): week N of M, this week's goals in the same words as `#/program` (the cut's pace line carries the safe pace), and weeks fully hit so far. With nothing running it becomes **"Which program should I start?"**: the recommended program, what it is, and a one-line why. A cut is never suggested when the safety checks block it.
- **"How's my long-term health?"** (only when a Longevity card has data): the 90-day Forge Score sentence and the up-to-three Longevity metrics with the clearest change, each in the card's own plain sentence with units. Clearest = the change measured in multiples of that metric's noise floor, so bpm and ml/kg/min compare fairly (`clearestChanges` in `longview.js`).
- **The chip list stays short.** At most 8 questions show. When more apply they are ordered by relevance: a running program and started missions move to the top, everything else keeps its place, and the least relevant fall off the end.
- **No action buttons on the new answers.** The issue asked for links to `#/program` and Awards "if the action system supports links". Coach actions are accept/reject cards that run a function, so there is no link type and they are left out. Adding one is a small follow-up.
- New helpers: `currentStreak` (`missions/badges.js`), `missionsSummary` (`missions/store.js`), `recommendedWhy` (`body-programs/core.js`).
- New tests in `tests/coach-v0143.test.js`: each answer with full, partial and empty data, the visibility rules, and the ordering cap. One older coach test now expects the seven original chips with no missions, program or Longevity data.

## 0.14.2 — YMCA machine demo figures + goal-path date range year (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Demo figures for six gym and YMCA machine moves** (new `js/ui/poses-gym.js`, added to the offline shell): **Leg Press**, **Single-Leg Leg Press**, **Calf Press on Leg Press** (side view, 45° sled), **Hip Adductor** machine (front view, so the knees moving together is what you see), and **Cable Hip Abduction** / **Adduction** (front view: ankle cuff, cable to the low pulley).
  - **Left without a figure for now: Hip Abductor Machine (`machine_hip_abductor`).** In a headless-Chrome render of the front view, the far leg drew wrong: the near thigh swung out but the far thigh stayed upright, and the far pad slid away from its knee. The solved joints are mirrored, so the fault is in how the camera projects or draws the far leg, not in the pose. It stays unmapped until that is fixed.
  - Leg press: the body lies back on the seat and back pad; the sled plate stands square to the rails and the feet are placed from the plate position, so they stay flat on it in every frame. Single-leg: the working foot presses while the other foot rests on the floor under its knee. Calf press: legs almost straight, the front of the foot pushes the plate and the heel lifts away.
  - Hip adductor machine: a seat and back pad with a pad inside each knee; the pads move with the knees and never touch them.
  - Cable: the cuff sits at the ankle and the cable runs from the cuff to the pulley on a tower. Abduction pulls out against a cable from the far side; adduction sweeps in across the standing leg, in front of it, from the working leg's own side.
  - New prop kinds in `rig.js` / `figure.js`: the leg-press sled, knee pads, and ankle cuff with cable and pulley, plus a generic `slab` block for machine frames. `rig.feet.raw` skips the foot-angle clamp for feet on a tilted plate (existing templates are unchanged).
  - Not yet seen on a real screen: these were built and checked as joint positions (plate contact, pad distances, floor, blocks), not as rendered pixels. Worth a look at iPhone size.
- **Goal path date range shows the year on both dates.** With a goal more than a year away Body said "Likely between Oct 12 and Oct 9, 2028", which read as backwards. It now shows the year on both dates whenever either one is outside this year ("between Oct 12, 2027 and Oct 9, 2028"). When the middle estimate is more than 12 months away, Body adds "That's more than a year at your current pace." The coach's goal answer (`fmtDay` in `js/coach/answers.js`) had the same problem and uses the same rule.
- New tests in `tests/gymposes.test.js` and `tests/goalpath-dates.test.js`; the home-figures coverage test counts the new ids.

## 0.14.1 — Honest Readiness bars + smoothed Trends sparklines (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Readiness bars match the verdict.** Each signal now has three steps: red (clearly off, z < −1.0), amber (a little off, −1.0 to −0.5) and green (normal or better). A Green day never draws red, and the Why? list dots follow the same colours. When a Green day has a small dip the line reads "Mostly normal for you: sleep a little short" instead of "Everything looks normal for you". The score, the level cut points and the workout changes are untouched.
- **Smoother Trends sparklines.** HRV, resting heart rate, sleep, steps and exercise minutes on Progress → Trends are drawn as a 7-day rolling mean (full windows only), the same approach as the Longevity cards. Scale readings are unchanged. The `#/metric/<key>` charts already draw a 7-day average line over the dots, so they are unchanged.
- The helper `smoothFull` moved to `js/health/trends.js` (still exported from `longview.js`). New tests in `tests/readiness-trends.test.js`.

## 0.14.0 — Body programs: cut kickoff, recomp, maintenance (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Programs card on Body:** three multi-week programs, each with one line and its length: **Cut kickoff** (4 weeks), **Recomp** (8) and **Maintenance** (4). The one that fits your goal says "Recommended". Starting one opens a plain-words confirm sheet; only one program runs at a time.
- **Weekly goals** (weeks run from the day you start): weigh in 5 / 4 / 3 days, hit your planned training days, and a weight goal: a **safe pace** for the cut ("losing 0.5–1.5 lb a week", from your targets and never past the safety caps) or **steady** (within 0.25% / 0.3% a week). The cut adds an average-steps goal, hidden without Apple Health; Recomp adds 2 workouts a week with a PR or a step up.
- **Today** gets a line under the missions card: "Cut kickoff · Week 2 of 4 · 2 of 3 goals so far". It opens the program screen (`#/program`) with a ring, a row per week (✓ or partly, the current week live), this week's goals with progress, a bar for your weight pace and a quiet **End program** link.
- **Finishing:** a completion card shows once on Today with the badge, "+250 XP" and a short summary (weeks hit, weight change, workouts, PRs). New badges **Cut Kickoff**, **Recomp** and **Steady State**; **+250 XP** for finishing and **+50 XP** for each week you hit every goal, counted through the same bonus XP as missions and never retroactive. Awards shows "Programs: N finished". Ending a program early keeps the weeks you hit but gives no finish bonus or badge.
- Stored in `settings/main`: `body_program` and `body_program_history`. Protein isn't a goal yet (food log, #33); `core.js` has the hook.
- Docs in `docs/body-programs.md`. New tests cover week boundaries from the start day, each goal (including steps hidden without Apple Health), the pace band in both units, finishing and history, XP (no retroactive pay), one program at a time and ending early.

## 0.13.1 — Health summary for your doctor (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Health summary for your doctor** at Settings → Your data (`#/report`): a clean page you can **print or save as a PDF** (on iPhone the share sheet has *Save to Files*) or **share as text**. Pick **30 days, 90 days (default) or 1 year**.
- Sections appear only when they have data: weight and body composition (start → end trend, change per week, body fat, fat-free mass, visceral fat, FFMI, a black-and-white chart), heart and fitness (resting heart rate, HRV, VO₂max with its band, walking heart rate, SpO₂), sleep (average, nights under 6 h, bedtime and how much it varies), activity and training, the Forge Score with its pillars, and neutral **notes for the doctor** from Forge's existing checks. HRV, VO₂max and FFMI get a one-line explanation.
- Weights show in your units with kg in brackets (`204.2 lb (92.6 kg)`). No name or email is on the page or in the shared text. Nothing is uploaded; it is built on the phone.
- Printing hides the nav bar, tab bar and buttons and gives black-on-white, page-friendly sections.
- Docs in `docs/report.md`. New tests cover section inclusion and exclusion with empty and partial data, the range maths, unit formatting, flag wording, privacy and the text version.

## 0.13.0 — Long-term trends and Longevity on Score (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Long term card** on Progress → Score, under the pillars: your Forge Score as weekly averages over **90 days or 1 year**, one plain sentence ("Up 6 points since July", "About the same as 3 months ago"), and one row per tracked pillar with its change and an arrow. It starts after 4 weeks of data. Weekly scores are sampled (two days a week) and cached, so a year stays fast.
- **Longevity section**: cards for **Cardio fitness** (VO₂max from Apple Health or the scale, newest per day, with a band for your age and sex marked as an estimate, plus resting heart rate and vascular age), **Resting heart rate**, **HRV** (against your own usual), **Visceral fat** and **FFMI**. Each shows only when it has data; with none, one short line says what to connect. Trends need at least 6 readings in 90 days; words follow each metric's good direction. Tapping a card opens its metric screen.
- Docs in `docs/longevity.md`. New tests cover weekly sampling (with a loose timing check), the change sentence, empty and partial states, FFMI, the VO₂max merge, direction words and the minimum-point rule.

## 0.12.2 — Home-gym demo figures; new mission badges get a moment on Today (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **9 more moves have a moving figure**, all from the home gym:
  - **Kettlebell:** halo, clean, snatch, sumo high pull and Russian twist. Clean, snatch and high pull show a hinge, a middle and a finish (rack, lockout, elbow-high), and the bell stays in the hand: it hangs under it, rests in front of the rack, or sits behind the wrist overhead, never through the arm.
  - **Dumbbell:** renegade row, Z press and side bend.
  - **Band:** shoulder dislocate (wide grip, band drawn between the hands).
- **Still no figure:** the Turkish get-up (too many phases), machines, cardio equipment, boxing and jump rope, the muscle-up and cable hip abduction and adduction. Those keep the muscle map. The kettlebell windmill (the rig can't hinge sideways) and the fire hydrant and kneeling slider fly (third try, still read wrong) are unmapped too: a wrong demo is worse than none.
- **New mission badges are celebrated.** When a weigh-in streak or body-comp badge is earned (and isn't saved yet), Today shows a small card at the very top, under the greeting, with the badge, its name, "+100 XP" and a "See awards" link; the card has a dismiss button. A badge is only saved as seen once its card has been on screen for a moment, or when you dismiss it or open Awards, so it can't vanish unseen. Badges earned before missions started are never celebrated, same as XP. The shine and the spring-in stop under reduced motion.
- Under the hood: the figure rig can tip the trunk sideways (`lean`) and point a kettlebell on its own (`kb`), and floor moves can ask for a floor line (`floor`). Tests cover every new template (finite numbers, all frames solve, nothing through the floor, hands on their grips, the bell in the hand and clear of the forearm and head) and the celebration rules.

## 0.12.1 — Demo figures for home, travel and bodyweight moves; sheets close on navigation (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **36 more moves have a moving figure.** The hotel, travel and bodyweight plans pick these a lot, so their detail and guided screens no longer show an empty box:
  - **Table, towel, doorframe and wall:** table rows (bent knees, straight legs, feet raised), doorframe row, wall and table triceps extensions, and the five towel moves (lat pulldown, floor pulldown, pull-apart, iso curl, iso lateral raise).
  - **Floor:** side plank, Copenhagen plank, superman, prone Y-T-W, reverse snow angel, side-lying leg raise, Russian twist, slider leg curl, reverse Nordic, sissy squat.
  - **Lunges and bands:** bodyweight and dumbbell lateral lunge, band lateral walk, band hip abduction and adduction.
  - **Mobility:** cat-cow, inchworm, world's greatest stretch, kneeling hip-flexor stretch, 90/90, thoracic open book.
  - **Warm-up cardio:** high knees, burpee, bear crawl, skater hops.
- Held moves (planks, towel isometrics, stretches) breathe slightly instead of freezing. Small new props: a table, a doorframe, a towel (pulled tight between the hands or under the feet) and a mini-band loop.
- **Still no figure** (by design, for now): machines, cardio equipment, boxing and jump rope, kettlebell ballistics (clean, snatch, high pull, Turkish get-up, windmill, halo), the muscle-up, cable hip abduction and adduction, and a few dumbbell odds and ends (renegade row, Z press, side bend). Those keep the muscle map.
- **Sheets no longer stay on top of the next screen.** If a button, a deep link or the back gesture changes the screen while a bottom sheet is open, the sheet closes first.
- Under the hood: the rig can roll a lying figure onto its side, shift sideways, and set each foot's width; the figure tests now cover every new template (finite numbers, nothing through the floor, hands on their grips, nothing through the table or wall).

## 0.12.0 — Daily missions, weigh-in streaks and body-comp badges (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Today's missions.** A compact card under the workout card with up to four real actions: Weigh in, Train or move (a workout, or 20+ min of cardio; on a rest day "a 20-min walk counts"), Steps, and In bed on time. Steps and bedtime only show if you have Apple Health data. Each is +20 XP, and finishing them all is +30 more; when you do, the card shrinks to one line.
- **Protein hit** is built but hidden: it switches on by itself once food logs exist.
- **XP and level.** Mission XP counts in your total and level, from the day you first open this version (nothing retroactive).
- **Seven new badges.** Weigh-in streaks (7, 30, 100 days) and, with a Withings scale, body fat down 1, 2 and 5 points and lean mass +1 kg (shown as 2.2 lb if you use lb). What you already have is saved quietly.
- **Awards** shows this week's missions as dots. **Settings → Missions** sets your steps target and bedtime.
- Derived from data you already have; the only new stored values are in `settings/main`. See `docs/missions.md`.

## 0.10.1 — Consistency and polish (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Weight now agrees everywhere.** Progress → Trends showed your last weigh-in; it now shows your weight trend, the same number as the Weight tab, Today and Coach. The row is called "Weight trend", and its small line draws the smoothed trend too.
- **Body tab is calmer before you have scale data.** The empty Body Profile card is gone (the "No body data yet" card already says what to do), and the photos invitation is one small row: "Progress photos, Take your first set".
- **Exercise sheet buttons line up.** "Watch on YouTube" is now "YouTube", so Favourite, YouTube and Share each fit on one line.
- **Library search no longer holds the screen back.** If the search box was focused, tapping Back or a tab now always changes the screen straight away.
- **Locations no longer break** if an older or imported location has no created date.
- **Coach card on Today** was already above the disclaimer and shows a one-line question; no change needed.

## 0.10.0 — Forge Coach, no AI needed (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **New Coach screen.** Tap "Ask Coach" on Today (under your insight cards) or the "Ask Coach" row on Progress. You get a list of questions to tap; typing comes later with the AI coach.
- **Seven questions, answered from your own numbers:** How did last week go? (or How is this week going? early in the week) Am I on track for my goal? Why did my weight go up (or down)? What should I train today? Am I recovered? What's my Forge Score made of? Am I getting stronger?
- **Every answer** has a one-line headline, a few short lines with the real numbers, and a "Why" that says how it was worked out. A question only shows up when there is data behind it.
- **Coach can suggest one thing**: start today's workout, make today lighter (turn Readiness back on), or start a deload week when a main lift has stalled. Nothing happens until you tap "Do it". "Not now" changes nothing, and the deload also asks you to confirm.
- A brand-new account sees "Coach needs a few weigh-ins or a workout first" with Log weight and Start workout buttons.
- The Today card shows the first question Coach can answer. "What should I train today?" names the muscles the workout trains, the muscle count matches the Body tab, the weight answer uses your units and fits the direction, and sleep times read "1 h 5 min".
- Nothing leaves your phone and nothing new is saved; the chat is forgotten when you close the app. How each answer is worked out is in `docs/coach.md`.

## 0.9.0 — Train anywhere (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **A hotel room or living room now gets a full workout.** Before, a Travel Pull day gave 2 of 6 moves and Upper gave 3 of 7. Now every day fills (138 of 138 slots across all day types, up from 104).
- **New "Around the house" list in Settings → Locations:** bath towel, sturdy table, sturdy chair or step, a backpack you can load with books or bottles, and stairs. Tick what you have. Benches and plyo boxes count as a chair, dumbbells and kettlebells count as a backpack.
- **The Travel preset is now "Travel / hotel room"** with a towel, a chair and a backpack. Home gets the whole house list. Locations you already saved are not changed; tick the new items yourself.
- **24 new moves:** table rows (three steps, easy to hard), backpack rows, curls, lateral raises, reverse flies, shrugs, goblet squats and Romanian deadlifts, a backpack suitcase carry, towel pulldown and curl holds, a sliding floor pulldown, towel pull-aparts and slider flies, reverse snow angels, chair dips, table triceps extensions, stair step-ups, and two moves that need nothing at all (doorframe row, wall triceps extension). Table moves tell you to test the table first. They show the figure silhouette instead of a photo.
- **Bench dips now need a chair or bench.** Before, they said no equipment.
- **No more empty slots:** if a slot has nothing to pick, Forge tries a close cousin first (for example a pulldown slot can become a row, a chest fly can become a push-up). The "This location doesn’t have much" note now only shows when a session has fewer than 4 moves.
- Backpack moves work like bodyweight ones: reps first, weight optional.

## 0.8.0 — Weekly progress photos (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish.

- **Your photos never leave your phone.** They are kept in a private store on this iPhone (one per signed-in account, so two people sharing a phone never see each other's). Nothing is uploaded, nothing syncs, no Forge server ever sees them.
- **Location and camera details are removed.** Every photo is redrawn and saved fresh (longest side 1600 px), which drops GPS and EXIF. A test checks this.
- **Body → Progress photos.** Take Front, Side and Back (each one is optional), from the camera or your library. Your last photo of that pose shows faintly so you can line up. Add a note; your weight trend for that date shows beside it (it is not saved with the photo).
- **Compare** any two dates for a pose: side by side, or drag a divider across the picture. Under each: weight trend, fat mass if your scale reads it, and the days between.
- **Time-lapse:** pick a pose and a range. Where your phone can record video (MP4 on newer iPhones, WebM elsewhere) you get a short video; otherwise a photo strip with every date and weight on it. Share it or save it.
- **Weekly reminder:** a small card on Today from your chosen day (Sunday unless you change it) until you take the week's photos. You can hide it for the week, or turn it off in Settings → Progress photos. It only shows once you have taken a first set.
- **Look after your photos:** delete one photo or a whole set; Settings → Progress photos has *Export all photos (zip)* as your backup and *Delete all photos on this phone*. Forge asks the phone not to clear them when space is tight. Deleting your Forge account also removes them from this phone.
- An "AI analysis" row is shown switched off for later. Nothing is sent anywhere.
- Not in this version: pinch-zoom while comparing.

## 0.7.0 — Trends, insights, weekly report, goal path and Body Profile (W2b) (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy or publish. Everything is worked out on your phone from the data you already have.

- **Progress → Trends:** every number in one grouped list (weight, body fat, fat mass, fat-free mass, muscle, water, visceral fat, standing heart rate, HRV, resting heart rate, sleep, steps, exercise minutes) with a tiny chart, today's value and how it moved per week over the last 4 weeks. An arrow only counts when the change is real (not just day-to-day wobble). Green or red shows only where it's clear what's good for your goal; the rest stays grey. Tap one for its chart.
- **Progress now has four tabs:** Weight · Trends · Score · Week. History and Awards moved to two rows at the bottom of Weight (they didn't fit next to the switcher at phone width).
- **Metric screens** switch between 7, 28, 90 days, 1 year and All, compare this period with the one before, and say in a sentence which way it's going. HRV, resting heart rate, sleep, steps and exercise minutes have their own screens too.
- **Insight cards** on Today and Body: at most three, picked by how much they matter and how recent they are. Each says what's happening, why, and one thing to try. Tap for the chart; the close button hides it for 7 days (old hides are tidied away automatically). Examples: "Likely water. Your trend hasn't changed.", "Nice cut" (fat down, muscle steady), HRV low for a week, resting heart rate up for 3 days, short sleep three nights running, wrist temperature up for two nights, or a long gap since your last weigh-in. Heart-rate and temperature cards remind you it isn't medical advice.
- **Progress → Week (weekly report):** Monday to Sunday, in your own time zone (on Sunday it says "so far this week"). Forge Score and each part vs. the week before, weight and body-fat changes, workouts done vs. planned, total weight lifted, PRs, cardio minutes, average HRV, resting heart rate and sleep, your best and worst number, and one suggestion for next week. The arrows browse older weeks. Share sends a short text summary. On Sunday and Monday Today shows a small card for it.
- **Goal path** on Body and Weight (replaces the old "around this date" line): your date to reach your goal weight with a likely range, your pace next to the usual safe limit, and, if your scale reads body composition, an estimate of the daily calorie balance behind your changes. If your trend is going the other way it says so kindly and gives no date.
- **Body Profile** on Body: lean mass and body fat on one 4×4 grid, with a bright dot for now and faint dots for earlier months. Needs your height and fat mass from the scale. The ranges are approximate and not adjusted for age (see `docs/trends.md`).
- Formulas and thresholds are written down in `docs/trends.md`.
- **Review round 1:** the Body Profile grid now fits the card (square cells, labels below, a "You" label on the dot); Today, Weight and Body give one goal date (Today's sentence and the chart's dotted line come from the Goal path); Today shows at most two compact insight cards after Daily targets (tap to open Why / Try; the sleep one is skipped when Readiness already blames sleep); a change too small to show reads "same as last week" with no sign or colour; metric screens show the unit on "vs previous"; the weigh-in list on Weight is called Weigh-ins; Share ends with "Shared from Forge" and falls back to copying; Body Profile cut points follow the commonly used FMI scheme; the training-sets control is a switch.
- **Review round 2:** the compact insight cards on Today stay closed until tapped (a global `[hidden] { display: none !important }` in `css/app.css` stops any class that sets `display` from showing a hidden element).

## 0.6.0 — A new look: near-black, calm and premium (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy. (This is Part B of issue #18, the visual restyle.)

- **One look, one place.** All colours, corner sizes, spacing and shadows now come from a single file (`css/tokens.css`). A test fails if a stray colour code shows up anywhere else.
- **Light mode.** If your phone is set to Light, Forge follows it (Today, Settings and everything else). Dark is still the default look. Text stays readable in both.
- **Softer cards, less clutter.** Cards have no outlines, big rounded corners and a hint of light on top. Section titles are plain sentence case instead of ALL CAPS. Lists look like iPhone Settings: rows with thin dividers and arrows.
- **Less lime.** Normal buttons are white pills. Lime is kept for the one main action on a screen (Start, Done set, Save), the active tab, progress, rings and records. Chips are quiet grey pills that tint when chosen, and the segmented controls (Units, Guided/List…) have a grey thumb that slides.
- **Real switches in Settings.** Sound effects and Haptic tick are iPhone switches, so they tick when you flip them.
- **No more emoji as icons.** Every icon is now drawn in the same clean style (tools, location pin, delete, warnings, flame, trophy, menu, pause, close, arrows). A test keeps emoji out of the screens.
- **Big numbers get the spotlight.** The weight trend, daily calories, the Forge Score and the Readiness card have larger numbers with a green-lime gradient and a soft glow. Everything else stays black, white and grey.
- **Friendly empty screens.** Weight, History, Body, Awards, the exercise search and Locations each show an icon, a line, a short hint and one button when there is nothing yet.
- **Toasts and pull to refresh.** Toasts are frosted capsules with an optional icon. Pull down at the top of Today, Progress or Body to refresh (it also asks Withings for new weigh-ins when connected).
- **Swipe back shows the screen behind.** Swiping from the left edge now reveals the previous screen sliding in behind, like iOS.
- **Review fixes.** The Today weight keeps its number and unit on one line (small unit). Metric → Weight uses the weights you logged by hand when the scale sent nothing, and the empty state leads with Log weight. Pull to refresh waits at most 8 seconds and asks Withings at most once every 2 minutes. The “Add a location” list looks tappable (grouped rows with arrows). Withings and Apple Health intros are short with a “Learn more”. Buttons stay on one line (shorter labels). The favourite star is an SVG icon too.
- **Home-screen icon** now has a proper 192 size for Android (maskable).

## 0.5.2 — Feels like an iPhone app: shell, navigation and motion (2026-10-09)

No Cloud Functions, `firestore.rules`, `firebase.json` or `config.js` changes; nothing to redeploy. (This is Part A of issue #18. The full visual restyle is Part B, later.)

- **No more web-page behaviour.** The page no longer rubber-bands, chrome (tabs, buttons, cards) can't be selected or long-pressed, taps have no delay, and a test makes sure form fields stay at 16px so iOS never zooms in. The background is near-black from the very first frame (no white flash), and the first screen is a grey skeleton of the page instead of a spinner.
- **New top and bottom bars.** Every screen has a big 34pt title that shrinks into a frosted bar as you scroll. Detail screens (Locations, Withings, Data check, Exercises, Timer, Metrics) get a **‹ Back** button, and swiping from the left edge goes back too. The tab bar is properly see-through with a hairline on top, and has new filled/outline icons (Settings is sliders now, not a sun). Tapping the tab you're on scrolls to the top, or returns to that tab's first screen.
- **The always-on "Synced" pill is gone.** You only see "Saving…" or "Offline" in the top bar, plus a short note if you stay offline for a few seconds. The update prompt is now a small "Update available · Reload" capsule.
- **Progress has one header.** Weight, History, Score and Awards share the "Progress" title with the switcher underneath.
- **Screen changes feel native.** Detail screens slide in from the right over the old one (which slides back and dims); going back reverses it; switching tabs crossfades. Each tab remembers its scroll position. Phones without the animation API get a quick fade instead.
- **Sheets you can drag.** Sheets have a grabber and frosted header, follow your finger, close with a flick or a long pull, and slide away smoothly with the backdrop fading along.
- **Motion polish.** One set of timings and spring curves everywhere; everything tappable dips slightly when pressed. Weight trend, calories, Forge Score and other numbers count up once per visit (tabular figures, so they don't jitter). Tabs, segmented controls and records give the haptic tick when Settings → Haptic tick is on. Reduced Motion turns all of this into plain fades.
- Review fixes: the collapsed top bar now truly blurs what scrolls under it; the back button shows the parent's title ("‹ Settings") and the duplicate in-page back links are gone; the Locations editor drives the top bar (its name, "‹ Locations" back to the list); swipe-back keeps the tab bar visible, moves a full-height screen over a dim scrim that lightens as you drag, and with Reduced Motion simply goes back with a crossfade.
- Manifest now has an `id` and the maskable icon for 192 and 512.

## 0.5.1 — Add a location from a preset (2026-10-09)

No Cloud Functions, `firestore.rules` or `config.js` changes; nothing to redeploy.

- **Settings → Locations → + Add a location** now asks what kind first: **YMCA**, **Travel / no equipment**, **Home gym** or **Custom (start empty)**. A preset comes with its equipment and weights, then opens so you can rename it or turn things off. If you already have one, it's marked **Add another**. Custom works as before.

## 0.5.0 — Apple Health, Readiness and the Forge Score (W2a) (2026-10-09)

**Cloud Functions changed** (`npm --prefix functions install`, then `firebase deploy --only functions`; four new functions, no new secrets). **`firestore.rules` and `config.js` are unchanged**, so there's nothing to republish.

**Apple Health bridge**
- **Settings → Apple Health:** *Create Shortcut token* (shown once, with a Copy button), *Make a new token* (the old one stops working at once) and *Turn it off*. Step-by-step Shortcut recipe (window "yesterday 6 pm → now", POST JSON to `healthIngest`), the *Sleep → Waking Up* automation set to Run Immediately, and an optional evening run. Notes on what iPhone can't share (ECG; wrist temperature on some iOS versions). Uses your existing Apple devices and accounts; nothing new to sign up for.
- **`healthIngest`** (POST, `Authorization: Bearer <token>`): the token is hashed (SHA-256) and looked up; only the hash is stored (`users/{uid}/private/shortcut`, `shortcut_tokens/{hash}`), never returned or logged. The payload is validated field by field and capped at 256 KB (401 / 413 / 400, with no health values in replies or logs). Late and duplicate posts merge into the same `health_daily/{day}`: newer non-empty fields win, nothing is erased by an empty value, and an unchanged post writes nothing. Accepts what Shortcuts really sends: numbers as text, lists of samples (Forge averages or adds them), sleep and workouts as lines of text.
- **`createShortcutToken`, `revokeShortcutToken`, `importHealthDays`** (signed-in callables). "Delete everything" also removes the token and the Apple status.
- **Data check:** the Apple Health screen shows the latest day, when the Shortcut and the import last ran, each kind of data (HRV, resting HR, sleep, wrist temperature, breathing, blood oxygen, steps, energy, exercise minutes, cardio fitness, workouts) with how many of the last 28 days have it, and progress toward the 14 days Readiness needs. `users/{uid}/integrations/apple` holds the status (no secrets, no values).
- **Health export import:** pick `export.zip` (or `export.xml`). Forge streams `export.xml` out of the zip **on the phone** (it never loads the whole zip), turns it into daily summaries for the last 120 days, and sends only those. Steps and energy come from one source per day so iPhone and Watch aren't double counted. Merges with Shortcut days.

**Readiness**
- A **Green / Amber / Red** card on Today with the top reason in plain words and a *Why?* list. z-scores of HRV, resting HR, sleep, |wrist temperature delta| and breathing rate against your own 28 days (needs 14 days), minus a penalty for yesterday's training load. Until then Today shows how far along it is.
- **Feeds the workout generator:** Amber takes one set off every accessory; Red makes a short, easy day (kept out of progression like a deload) and suggests mobility or a walk, with **Train as planned anyway** to override.

**Forge Score**
- **Progress → Score:** a 0–100 score shown as a 7-day average, five pillar rings (Body 25%, Recovery 20%, Sleep 15%, Training 25%, Nutrition 15%), a 14-day strip, *What moved it* (top 3 changes vs last week) and tap-through to the raw inputs behind every part. Nutrition reads "not tracked yet" and its weight is shared among the others. A small score card on Today links to it.
- Every mapping, weight and source is written down in **`docs/forge-score.md`** and unit-tested.

**Review fixes (still 0.5.0, before release)**
- **Cloud Functions changed again:** `healthIngest` (tolerant parsing, rate limit, early 413), `maintenance.js`, and one new callable `deleteAppleHealthData`. Redeploy with `firebase deploy --only functions`. `firestore.rules` and `config.js` unchanged.
- **One bad value no longer loses the whole post:** unreadable fields are dropped on their own and named in the reply (`rejected`) and in the Data check; bad sleep and workout lines are skipped. Wrist temperature in °F, `8,532` and `52,5` are understood (also in the export import, via the `degF` unit).
- **Shortcut recipe fixed:** overnight signals only from samples ending before 11 am (same rule as the export); daily totals use *Group By Day* with `*_yesterday` keys stored on the day before; the evening run sends totals only, so it can't replace the morning HRV. Copy chips for every key and URL, a "Copy Bearer + token" button, and an `APPLE_SHORTCUT_URL` slot for a one-tap install link (empty until the Shortcut is shared).
- **Withings "delete synced data" no longer deletes Apple Health.** Apple Health has its own *Delete Apple Health data from Forge* button; Delete everything still removes both.
- **`healthIngest` limits:** 413 before any work, and 30 posts an hour / 200 a day per token (429), counted on the token's own document.
- **Readiness** says "Based on yesterday" and doesn't change today's workout until this morning's data arrives; the *Why?* list actually opens and closes; neutral items are grey; wrist temperature shows in °F for imperial; *Use Readiness again* after an override (stored per account).
- **Forge Score:** no number until 3 of the 5 parts have data (Body + Training alone showed 89); "Based on N of 5 parts"; Recovery at your usual is now 75, not 100, so a Red week can't look great.

## 0.4.4 — weight.csv fixes and a first-run how-to tour (2026-10-08)

Cloud Functions changed (`firebase deploy --only functions`; same steps as 0.4.3, no new secrets). `firestore.rules` and `config.js` are unchanged, so there's nothing to republish.

**Before you use Import weight.csv (M1, M2)**
- **No more false "not safe" after Not me:** the data check now counts every weight.csv reading, including ones you marked "Not me" or deleted, as accounted for (like the API's). Marking the family's imported readings no longer turns a safe verdict into "Your weight.csv has 1084 rows; Forge has 989…".
- **No duplicates if you import first and the Withings history arrives later:** once a history import has finished, any weight.csv reading that Withings now also has (same weight, same minute, whole-hour clock offsets allowed) is removed from weight history, the bulk counts and the data check, and a note says how many. Readings that are only in the export stay. It's the same match the importer uses, and Withings readings you marked "Not me" still cover their csv twin.

**Follow-ups**
- Import toast says how many rows couldn't be read and were skipped.
- Withings task payloads are validated: a backfill task without a numeric year or end time (e.g. one queued by v0.4.0) is dropped instead of chaining empty pages.
- **Sync now** and **Data check** do what the background sync does when Withings refuses the sign-in: one forced refresh, then the "Connect again" banner (they used to just show an error).
- Type 140 is removed from the vascular age request (the row no longer says "asked 155, 140").

**First-run how-to tour**
- A brand-new account sees an 8-step tour once, right after onboarding. Each step puts a spotlight on the real button or card (the rest is dimmed) and explains it in a sentence or two: your week's rings, today's workout, logging your weight by hand, picking a location on Train, starting a workout and the guided screen (Done set, Pause, Swap, How to, what RIR means), Progress, and Settings.
- Big Back / Next buttons at the bottom of the screen (one-handed on iPhone), Skip tour any time, no animation if reduced motion is on.
- Whether it's been seen is saved in the account's profile (`tour`, `tour_seen_at`), so it doesn't come back on a new phone. Existing accounts don't get it automatically.
- **Settings → Show the how-to tour again** plays it for anyone.
- The Withings card on an account that isn't connected says a scale can only link to one Forge account for now and to log weight by hand.

## 0.4.3 — Withings live fixes (2026-10-08)

Includes everything in 0.4.2. Needs `npm --prefix functions install` and `firebase deploy --only functions` (docs/withings.md → Updating to v0.4.3). Rules and `config.js` are unchanged.

**History import**
- **Walks your whole account:** the import used to stop at Jan 7, 2025. It now asks Withings one calendar year at a time, from now back to 2009. It stops only after three empty years at or before 2009, and never goes below 2005. Each run pins its end time, and per-year page counts are set rather than added, so a retried page can't double-count. "Done" and "since …" come from what it actually found.
- **Re-import history** (Settings → Withings) re-runs the import on your existing connection, with no disconnect. It's idempotent: deletions and "Not me" stay. It refuses while an import is already moving.
- **History by year** on the Withings screen shows the import's progress.
- **The data check walks the same yearly windows**, so "Withings has" reflects your whole history. A **By year** table shows Withings vs Forge.
- **Import weight.csv** from a Withings export, for anything the API doesn't return. Readings Forge already has are skipped: same weight at the same minute, allowing whole-hour time-zone offsets. Re-importing adds nothing, and deleted readings aren't revived. Imported readings count as scale weigh-ins in the trend.

**Last weigh-in**
- The history import now sets **Last weigh-in**.
- **Arrived in** says "waiting for your next weigh-in" until a notified weigh-in arrives.

**Family weigh-ins**
- **"Is this you?"** also lists scale readings more than 15% away from your own weight. Your weight is tracked from today backwards, so a child who weighs in more often than you can't take over the reference. These readings stay out of your trend and Body stats until you decide.
- **Bulk actions:**
  - **Not me: everything under ___ lb** suggests a cutoff in the gap and previews the count and date range.
  - **Not me — whole day** clears one day.
- "Not me" readings count as accounted for in the data check.

**Fixes and follow-ups**
- **Data check accounting:**
  - Weigh-ins you deleted or marked "Not me" count as present in "Forge has".
  - "That's me" on a reading without a weight no longer tries to update a weigh-in that doesn't exist.
- **Withings responses:**
  - Status 522 (Withings timeout) is retried.
  - An invalid-token answer gets one forced refresh before asking you to reconnect.
  - A token save that lost a race no longer overwrites the newer token.
  - Type 140 is no longer requested.
- **Readings and maintenance:**
  - Readings are labelled with the model of the scale that took them.
  - Expired sign-in links are cleaned up nightly.
  - Each nightly step runs on its own, so one failure doesn't skip the rest.
- **Verdict:** says "Waiting for N more weigh-ins" when that's all that's left.
- **Weight history:** shows the time of day.
- **VO₂max:** shown as a Body metric.
- **Body CSV:** now includes ESC, NRS and VO₂max.
- **Nav cards:** the chevron sits beside the text again.
- **docs/withings.md:**
  - `npm --prefix functions install` before deploying;
  - the `~/.npm` permission fix;
  - what to do when `googleapis.com` times out (use your phone's hotspot);
  - the re-import steps.

## 0.4.2 — v0.3.2 follow-ups (2026-10-08)

No functions, rules or `config.js` changes; nothing to deploy beyond GitHub Pages.

- **Weekly goal XP with cardio:** when logged cardio completes your week after your last workout (lift Mon/Wed, run Fri), that workout now gets the +100. It's still once a week, and a week with only cardio gives none.
- **Comeback** counts logged cardio as activity, so three weeks of running followed by a lift isn't a "comeback".
- **Share card:**
  - the final number and its unit stay together ("→ 212 lb" no longer leaves "lb" alone on a line);
  - with 4 or more records, a slightly smaller font and one line each fit three before "+N more".
- **Badge art:** the aria-label is escaped.
- **Rules test:** saving `awards_seen` on settings/main is now covered.
- **docs/levels.md:** says honestly that records slow down after the first months.

## 0.4.0 — Withings, body composition, data check (W1) (2026-10-08)

**⚠️ New: Cloud Functions, and rules changed.** This version needs the one-time setup in **[docs/withings.md](docs/withings.md) → Your steps**:
- the Blaze plan with a $2 budget alert;
- Node and the Firebase tools on your Mac;
- the Withings developer app (**log in with your existing Withings account**);
- two secrets you set yourself;
- `firebase deploy --only functions,firestore:rules`.

Until then the app works as before, and Settings → Withings explains what's missing. `config.js` is unchanged.

**Withings sync**
- **Connect:** Settings → Withings → **Connect** → Withings' page (**Log in**, not "Create account") → Allow → back to Forge.
- **History:** your whole Withings history imports in the background.
- **New weigh-ins:** each one arrives on its own a few minutes after you step off. Withings notifies Forge, and Forge fetches through the official API. **Sync now** is there if one doesn't.
- **Everything from Body Comp:** weight, body fat %, fat mass, fat-free mass, muscle, water, bone and standing heart rate, plus visceral fat, BMR, metabolic age, vascular age and nerve scores if the free API returns them. Raw values are kept too, so new types can be decoded later.
- **Trend rule:** when the scale weighs you more than once a day, the trend uses the **earliest** reading. Typed-in weights on a scale day stay in your history but don't move the trend.
- **"Is this you?":** weigh-ins Withings couldn't match to you stay out of the trend until you tap **That's me** (or **Not me**).
- **Deleting sticks:** deleting a Withings weigh-in or measurement in Forge is permanent. The sync never brings it back. Deletions you make in the Withings app (last 90 days) reach Forge within a day. If Withings ever answers with far fewer weigh-ins than Forge has (more than 3, or 20% of the last 90 days), nothing is deleted, and anything removed comes back if Withings lists it again.
- **Disconnect** (optionally deleting the synced data). **Delete everything** now also removes the Withings sign-in and synced data.

**Data check** (Settings → Withings → Data check)
- **One row per metric:**
  - ✅ received: last value, date, count, and the **Withings meastype codes** that came back;
  - ⛔ not on the free API;
  - ➖ not measured by your scale;
  - ⏳ not measured yet.
- **Webhook proof:** median arrival time and weigh-ins seen out of 7.
- **History:** what Withings has vs. what Forge stored, plus a box for your Withings CSV row count.
- **Saved reports:** save a report ("subscribed", "after cancelling") and **Compare** any two.
- **Verdict:** a plain **"Safe to cancel Withings+?"** with the specific blockers.

**Body tab**
- **Body composition** tiles: latest value and 30-day change for every metric the scale sends, plus BMI, FFMI and FMI. A tile older than your latest weigh-in says **as of <date>**, and if your last weigh-ins had no body composition, a note says how to get a reading (barefoot, dry feet on the electrodes).
- **Tap a tile** for its chart: 7/30/90/365 days or all, a 7-day line, the previous period dashed, and "this period vs previous".
- **Muscle** is charted over your **training sets per week**.
- **What is this?** opens an explainer for each metric: what it is, how the scale estimates it, what moves it, typical ranges with sources, accuracy and what to do in Forge. It's our own text, in `data/metrics.json`.
- **Exports:** **Export body measurements (CSV)**, and the JSON export now includes body measurements and the connection status (never tokens).

**Levels:** the top of the curve is slower. XP for level n = 250 × (n − 1)^1.6 + 3 × (n − 1)³. Early levels are about as quick as before (level 5 in about 2 weeks at three workouts a week); Unbreakable now takes about **2 years**, not about 44 weeks. `docs/levels.md` has the table.

**Under the hood**
- **Functions** (`functions/`, Node 22, 2nd gen, us-east1, every function capped at 2 instances): OAuth start and callback, the webhook, a task-queue worker, Sync now, data check, disconnect and daily maintenance. `docs/withings.md` has what each does.
  - **Tokens:** they stay on the server (`users/{uid}/private/withings`). The rotating refresh token is renewed under a short lease and saved before use.
  - **Webhook:** it answers immediately and queues the work, returning 503 only for failures it can see before replying.
  - **History import:** one page per queued task with fixed task ids, so one request is one run. No function is triggered by Firestore writes.
- **Logging:** logs carry only codes, counts and durations, never tokens or health values.
- **Rules:**
  - `body_measures`, `health_daily` and `integrations` are readable by you and written only by functions.
  - You can mark a body measurement or Apple Health day deleted (a tombstone that can't be undone) or confirm a flagged weigh-in. Nothing else.
  - `oauth_states`, `withings_users` and `shortcut_tokens` are closed to everyone.
- **CSP:** one new origin in `connect-src`: `https://us-east1-forge-web-f2351.cloudfunctions.net`. The Connect button works under it, which is tested.
- **Tests:**
  - 155 unit tests (+12: data-check classification and verdict, compare, body formatting and series, CSV, the earliest-weigh-in rule, the level pace);
  - 40 functions tests (decoding, idempotent writes, tombstones, webhook replies, one backfill run per request and a bounded chain, token rotation and lease, OAuth state, data check, maintenance, the reconcile's safety stop, disconnect, log filtering) plus a wiring check of every function in CI;
  - 7 new rules tests, one seeded with exactly what the sync writes (a fixture the functions tests keep in step).

## 0.3.2 — XP, levels, badges, Today rings, share image (2026-10-08)

No database rule changes; just copy the files and push. Everything is worked out on your phone from your saved workouts and cardio. The one new thing saved is the list of badges you've earned (`settings/main.awards_seen`), so a badge never disappears; the existing rules already allow it. Nothing is sent anywhere.

**XP and levels**
- XP per workout:
  - **+10 per working set** (up to 40).
  - **+25 per exercise with 2+ working sets**.
  - **+50 per PR** (up to +200).
  - **+100 for the workout that hits your planned days** for the week.
  - **+100 per badge**.
- Warm-ups earn nothing. A finished workout with no working sets earns nothing and isn't a training day.
- **30 levels**, Spark → Unbreakable, at 250 × (level − 1)^1.6 XP. At three typical sessions a week that's level 10 in about 7 weeks. Full table: `docs/levels.md`. **How XP works** on the Awards tab says the same.
- The summary shows **+XP** with a breakdown (Sets · Exercises · PRs · Weekly goal · Badges), a filling level bar, and a **level-up** moment.

**Streak and badges**
- **Weekly streak:** weeks in a row where you trained on your planned days (Settings → Edit profile & targets → days a week). Logged cardio counts as a day. Miss one week a month and a **freeze** covers it automatically.
- **22 badges, each its own medal:**
  - The metal shows the tier: Ember, Steel, Gold, White heat.
  - The shape shows the family: hexagon for workouts, shield for records, medallion for tonnage, flame for streaks, diamond for the rest.
  - Each has its own engraved icon, and milestones carry their number.
  - Locked badges are grey silhouettes. A new one pops and shines on the summary, and shines again on Awards for 3 days.
- **New badges:**
  - **Full House:** 4+ sets for every major muscle group in one week.
  - **Recovery Respect:** finish a deload-week workout.
  - **Comeback:** train again after 3+ weeks away.
- **Badges stay earned.** Changing your planned days, for example, no longer takes Hot Streak away. On the first run after updating, the badges you already have are saved quietly, with no celebrations.
- **Progress → Awards:** level and XP to the next level, the streak with this week's days and the freeze, and the badge grid (earned first, newest first).

**Today rings** (top of Today)
- **Training:** days this week vs your planned days.
- **Weekly sets:** Push / Pull / Legs vs 10 / 14 / 18 sets each (beginner / intermediate / advanced). Each group counts only up to its own target. In a **deload week** the target is halved and the ring says "deload".
- **Recovery:** how fresh your six big muscles are on average.
- The rings fill on load. Closing Training or Weekly sets gets a **burst** (once a week per ring) and a glow.

**Share image**
- A 1080×1350 card (workout number and date, time, sets, volume, PRs, muscles worked, level, streak, XP) opens the iPhone share sheet, or downloads where sharing files isn't supported. It's drawn on your phone.
- Each PR shows the exercise, then what you beat, wrapped rather than cut off ("+N more records" when there isn't room).
- The image is drawn as soon as the summary opens, and the button says "Preparing image…" until it's ready, so a tap always opens the share sheet.

**Workout preview follow-ups** (from 0.3.1.2)
- **Today's card and Start** use the same plan as Train, including any Replace, Rest timer, Switch or different day you chose there.
- Swapping an exercise mid-workout keeps the rest timer you chose for that slot.

**Player polish** (from the v0.3.0 review)
- **Coach and audio:**
  - Rests are spoken in minutes and seconds ("Rest 2 minutes 30").
  - The "New record" line no longer interrupts.
  - Audio wakes up again after the phone was locked.
- **Records:** one PR card per set, and a new **volume PR** (best weight × reps in a set).
- **Starting weight:**
  - Barbells start at the empty bar.
  - Dumbbells and kettlebells start at what you used earlier today for the same kind of weight, or your lightest.
  - That weight is marked **suggested** (dimmed, with a tag) until you change it.
  - If there's no weight at all, tap **Set weight**.
- **Screen and rest timer:** the screen stays awake during a workout and lets go after 5 minutes paused. A running rest timer survives the app being closed.

**Tests:** 143 (up from 124). They cover:
- the XP plan (caps, the 2-set rule, the weekly-goal bonus with cardio and same-day workouts, badge XP);
- empty workouts;
- badges kept after 3 → 4 planned days;
- Full House, Recovery Respect and Comeback;
- unique art for all 22 badges;
- the rings, including deload;
- rest phrasing and volume PRs.

## 0.3.1.2 — Workout preview (2026-10-08)

No database rule changes; just copy the files and push. (Workouts can now save a `rest_sec` per exercise; the rules already allow it.)

**Train → Today's workout, before you press Start**
- **Chips** for the estimated time and the location, and **"6 exercises · 15 muscles"** next to a mini muscle map.
- A **Warm-up** block: a few minutes of easy cardio and mobility, plus which lifts get lighter ramp-up sets (they're built into the workout).
- **Supersets and circuits** are grouped in a box with their rounds ("Superset A · 3 rounds"), each exercise labelled A1, A2…
- **Thumbnails:** each exercise shows its silhouette at the hardest point, its first demo photo, or its muscle map.
- **⋯ on every exercise:**
  - **Replace** with a similar move you can do here.
  - **History & how-to**: opens How-To scrolled to your history.
  - **Rest timer**: Auto or 1–4 min. It's used for that exercise's working sets in the player and list view; warm-ups keep their short rest, and supersets still go straight from A1 to A2.
- **⇄ Switch** regenerates the workout with the same generator, steering away from what you were just shown. Press again for more options. When nothing else fits it goes back to the recommended picks.
- Edits last until you start, or until you change the location or day.

**Tests:** 124 (up from 119): grouping and muscle counts, Replace and Switch in the generator, and the rest-timer override.

## 0.3.1.1 — Fixes from the v0.3.1 review (2026-10-08)

No database rule changes; just copy the files and push. Includes the demo photos (`media/ex`, 175 exercises) now on main.

**Offline and weak signal**
- The How-To sheet opens straight away instead of waiting for the photo list; the **Figure | Photos** toggle appears when the list arrives (and photo-only exercises switch from the muscle map to their photos).
- Offline with a photo that isn't saved yet: you get the muscle map, not a blank white box. The service worker answers a missing photo with an error instead of hanging, and keeps the photo list (`index.json`) in the photo cache so it works offline.
- The player's demo also falls back to the muscle list if its photos can't load, and redraws once the photo list arrives after a cold start.
- **Download all demo photos** reports real counts ("All 175 saved", "Saved 120 of 175, try again on Wi-Fi", or "Couldn't save the photos"), and an exercise only counts as saved when both of its photos are.

**Silhouette fixes**
- **Bent-over rows** (barbell, Pendlay, dumbbell, kettlebell) pull all the way to the lower ribs, starting with the bar over mid-foot.
- **One-arm dumbbell row** has its own demo: far knee and hand on a bench, near arm rowing.
- **Two dumbbells** where you use two: dumbbell bench, incline, decline and floor press, overhead and seated press, lateral raise, flyes. The fly is drawn from the head end so both arms open visibly. (The curl keeps one, by design.)
- **Cable and band lat pulldowns** are drawn kneeling, as their names say.
- **Dips:** higher bars, so the bent legs clear the floor. **Overhead press** starts with the bar on the collarbones, below the chin.
- Rig: one arm can now work differently from the other (a hand braced on a bench), and benches can sit off to one side.
- 116 templates now (two new); still 221 of 280 exercises animated. `docs/silhouettes.md` updated.

**Housekeeping:** the 0.3.1 entry below now gives the right size (+52.8 KB gzipped, with why it's acceptable) and template count (114).

## 0.3.1 — Silhouettes, muscle maps, How-To (2026-10-08)

No database rule changes; just copy the files and push. Optional one-time step: run the demo-photo script (DEPLOY.md → Demo photos) and commit `media/ex`.

**Animated demos for most of the library**
- **221 of 280 exercises** now have the code-drawn silhouette, from 114 motion templates built on the approved squat, pull-up and curl look: squats, hinges, lunges, presses, push-ups, dips, rows, pulldowns, curls, triceps, raises, flyes, calves, carries, core, machines, jumps. Full list: `docs/silhouettes.md`.
- What the figure holds follows the exercise: barbell (on the back, front rack or in the hands), dumbbell, kettlebell, goblet weight, cable or band (a line to its anchor), medicine ball, ab wheel, pull-up bar, dip bars, rings. Benches, boxes, walls and seats are drawn once behind the figure.
- **Depth sorting:** limbs crossing in front of the body are drawn over it and behind it when they're behind; bars stay behind their plates; hands wrap the bar they hold.
- The demo fills the player's demo box (the view fits the whole rep). Tempo days slow the demo to match.
- Squat bar sits lower on the upper back (plate clears the head), glutes glow; the pull-up frames arms, bar and back; the curl shows only the near dumbbell; more contrast between the body and the background.
- Exercises without a silhouette show their **start/end photos** (once you've run the photo script), otherwise the muscle list.

**Muscle maps** (front/back body map ported from react-native-body-highlighter, MIT)
- **Body tab:** the recovery heatmap (red / amber / green). Tap a muscle for its %, when you last trained it and its sets this week.
- **Train:** today's muscles map plus a mini map on every exercise.
- **Summary:** the session's muscles-worked map.
- **How-To → Target:** the exercise's map.

**How-To sheet (redesigned)**
- Demo across the top with a **Figure | Photos** toggle, then **Favourite**, **Watch on YouTube** (opens a search; nothing embedded) and **Share**.
- **Instructions | Target** tabs, and **your history**: est. 1-rep max, heaviest, most reps (or longest hold) and your last four sessions.

**Demo photos**
- `scripts/fetch-demo-photos.mjs` downloads free-exercise-db's photos once, resizes them to ~480 px / ~25 KB with `sips` (or ImageMagick) into `media/ex/`, and writes `media/ex/index.json`. It also reports exact-name matches for exercises not yet linked (none today; 2 linked ids have no images).
- Offline: today's photos are cached when you start a workout, any photo is cached the first time it shows, and **Settings → Workouts → Download all demo photos (≈ N MB)** saves the rest. They live in their own cache, not the app shell.

**Workout player fixes**
- The **Workout complete** card comes back if the app is closed or reloaded while it's showing (and Today's card says **Finish**), instead of landing on set 1.
- The bottom **Undo last set** ignores taps for 650 ms after the final Done, so a double tap can't undo behind the card.

**Tests:** 119 unit tests (up from 99): rig and IK (bone lengths, planted feet, hands on bars and floors, bar over mid-foot), draw order (near/far limbs, a far arm crossing the front, grips, plates), framing, every mapped exercise solving cleanly with its own load, the muscle-map mapping and per-muscle stats, exercise records.

**Size:** v0.3.1 adds 52.8 KB gzipped of JS (20 KB of it the muscle-map paths, 9 KB the template library); since before v0.3 the total is +86.5 KB. That is over the 60 KB target, accepted because it is route-lazy: the map data and the silhouette code only load with the screens that use them (Body, Train, the player, How-To and the summary), so Today and the app shell open without them. No new libraries, no new origins in the CSP. (Corrected in 0.3.1.1; this entry first said "about 40 KB" and "75 templates".)

## 0.3.0 — Experience overhaul, drop 1 (2026-10-08)

**⚠️ Rules changed.** Publish the new `firestore.rules` (Firebase console → Firestore Database → Rules → paste → Publish) **before** opening this version. Workouts now save `paused_at`, `paused_ms` and `duration_ms`.

**Guided player (new default)**
- **Start → 3-2-1 GO** full-screen countdown, then one exercise at a time: segmented progress bar, "Exercise 2 of 6", a huge reps × weight target, big −/+ steppers (your real weight steps: owned dumbbells, rack or barbell plates), an "in the tank" row, and a giant **Done set**.
- **Full-screen rest**: shrinking ring, **Skip**, **−15 / +15**, and a card showing what's next.
- **Supersets** alternate A1 → A2 → rest. **Timed sets** (planks, carries, boxing rounds) run a countdown and complete themselves. **Boxing days** use the player with the round timer and combo callouts inside it.
- **Back / Next / Undo last set** at the bottom. First-time lifts carry set 1's weight and reps into set 2.
- Prefer the old screen? **Settings → Workouts → List view**. The list view is still one tap away inside the player (☰).

**Pause, resume, away**
- ⏸ freezes the workout clock and the rest timer. The overlay offers **Resume**, **End workout** or **Discard**. The workout time on the summary leaves pauses out.
- Come back after 10+ minutes without pausing and Forge asks: **"You were away 14 min. Count it?"** — keep it or remove it from your time.

**Feel**
- **Power-up** on every Done: button charge, burst, ring flash, "+1 set". It gets bigger on the last set of an exercise and the last set of the workout.
- **PR explosion**: a gold card with old → new (counting up), sparks and a fanfare. Tap to dismiss.
- **Sound + voice coach**: 3-2-1 beeps, "10 seconds", "Rest 2 minutes. Next: bench press, 8 reps", "Last set", "New record". Mixes with your music and stays silent when the ringer is off. Settings → Workouts → Coach audio: Off / Beeps / Voice; Sound effects on/off.
- **Haptic tick** on Done (experimental, iPhone only). Settings → Workouts.
- **Animated demos** (preview): code-drawn silhouettes with the working muscles glowing on the hardest part of the rep, for **barbell back squat, pull-up and dumbbell curl**. Approve the look and v0.3.1 brings the full library. Everything else shows the muscle list.
- **Summary screen**: "Workout #N", count-up time / sets / volume / records, muscles worked, every exercise with ✓, its records (old → new) and "vs last time". XP and levels come in v0.3.2 (draft names in `docs/levels.md`).
- **Motion system**: shared timing tokens, slide transitions between screens, fade-in sheets, rows that ease in as you scroll, skeletons while loading. **Reduce Motion** turns movement into fades.

**Navigation:** five tabs — **Today, Train, Body, Progress, Settings**. Body holds recovery (moved from Train). Progress holds **Weight** and **History**.

**Progression**
- **Tempo is no longer a dead end.** After 3 maxed-out sessions on tempo, Forge re-checks the next weight; if your last session predicts 5+ reps there, you move up (30 → 40 lb yes; 5 → 30 lb no). See `docs/workout-algorithm.md`.
- `predictedReps` now documents that it's Epley, capped at 30 reps.

**iPhone web features used** (each one is optional; the app works without it):
| Feature | Needs | If missing |
|---|---|---|
| Screen Wake Lock (screen stays on during a workout) | iOS 18.4+ home-screen app | The screen can dim and lock as normal; timers still keep correct time. |
| Haptic tick (hidden `switch` input) | iOS 18+ | No tick; everything else is identical. |
| View Transitions (screen slides) | Safari 18+ | Screens swap instantly. |
| `@starting-style` (sheets fade in) | Safari 17.5+ | Sheets appear without the entrance. |
| Scroll-driven animations (list rows ease in) | Safari 26+ | Rows are just there. |
| `text-wrap: balance / pretty` | Safari 17.5+ | Normal line breaks. |
| Audio Session `ambient` (mix with music, obey silent switch) | Safari 16.4+ | Default web-audio behaviour. |
| Speech synthesis (voice coach) | All iOS | No spoken cues; the beeps still play. |

**Review fixes (before merge)**
1. **Undo takes the PR back.** Undoing a set recomputes that exercise's records from the sets still done, so an undone PR set leaves no PR behind (tested).
2. **Sets save as the app hides.** A pending save is written immediately when the app goes to the background or is swiped away, instead of waiting out the 400 ms debounce.
3. **The last set no longer auto-finishes.** A "Workout complete" card offers **Finish** or **Undo last set**.
4. **Summary shows the right numbers straight away.** It renders the finished workout (status done, real duration, correct Workout #N) even before the database snapshot catches up, so the one-time celebration never counts up wrong numbers.
5. **The animation loop sleeps on the player.** Demos stop drawing while paused or resting, the rest ring runs one task per screen (no more copies stacking up), and demo props are built once instead of every frame.

**CI:** GitHub Actions runs the unit tests and the rules tests on every push and pull request.

**Tests:** 99 unit tests (up from 80): pause-aware clock, away gap, set queue with supersets, rest rules, set labels, validation, session stats, vs-last-time, the tempo escape (30 → 40 escapes; 5 → 30 never does), demo muscle mapping, undo removing a PR. Rules tests cover the typed pause fields.

**Size:** about 37 KB (gzipped) of new JS + CSS; no new libraries, no new origins in the CSP.

## 0.2.1 — Progression fixes (2026-10-08)

No database rule changes; just copy the files and push.

**Must-fix**
1. **Deloads and resets no longer drop from 30 lb to 5 lb.**
   - If the nearest lighter weight you own is more than 20% lighter, the weight stays the same.
   - A deload then cuts sets in half, sets reps to the bottom of the range, and RIR 3+.
   - A reset aims for the bottom of the range.
   - Where a close lighter weight exists (gym rack, barbells), it's still ~10% lighter.
2. **Deload sessions don't count as progression history.** Workouts already save `deload: true`. History now passes that flag through, and progression, the two-tough-sessions reset, and stall checks all use your last non-deload session. PRs, charts and History still show deload workouts. Bench at 200 → deload 180 → back to 200 the next session.
3. **The "big jump" ladder can't loop.**
   - It's now one-way at the same weight: reps up to the top + 8 (keeping your set count), then one more set at those reps up to 5, then tempo, which stays.
   - The normal double-progression branch also keeps the sets you've built up.
   - Weight jumps are now decided by estimated strength, not a fixed 25% rule. Small steps (+5 lb upper, +10 lb lower barbell, +5 lb machine or dumbbell) are always allowed. Bigger jumps happen when your last session predicts you can hit the bottom of the range at the new weight.
4. **Pinned exercises respect your injury note and the level cap.**
   - 5×5 day B no longer gives the barbell overhead press when your note mentions your shoulder. The slot falls back to its pattern, and if every option there stresses your shoulder, the session notes say exactly what was left out and why.
   - Exercises you picked yourself in Build my own are kept, with a warning on that exercise.

**Smaller fixes**
5. **Finishing with zero completed sets** offers **Discard** (not Save), so empty workouts don't land in History or advance the program rotation.
6. **A rejected ✓ tap** ("Enter the weight first") no longer leaves reps filled in. Checks run before anything is written.
7. **CSV exports neutralise formula injection.** Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`, while plain negative numbers stay numbers. The CSV helpers moved to `js/csv.js` with tests.
8. **SETUP:** puts Homebrew's keg-only `openjdk@21` on your PATH (and checks `java -version`) before `npm test`.
9. **CSP:** `img-src` allows `https://www.google.com`, so Firestore's offline network probe (`cleardot.gif`) isn't blocked and the console stays quiet.

**Tests:** 80 unit tests (up from 65), including:
- 40-session simulations that feed each target back in as the logged result (reaches 5 sets, then tempo, never loops, weight stays 30 lb);
- deload and reset at 30 lb at home;
- bench returning to 200 after a deload;
- stall checks skipping deloads;
- estimated-strength jumps;
- pinned injury and level filtering;
- custom-day warnings;
- CSV injection.

## 0.2.0 — Phase 1, Checkpoint B: workouts (2026-10-08)

**⚠ Publish the new `firestore.rules`** (DEPLOY.md) and **close public sign-up** (SETUP.md step 7).

**Workouts**
- **Exercise library:** 280 curated exercises with movement patterns, muscles, equipment alternatives, rep ranges, original form cues, and injury tags.
  - Calisthenics progression chains, with the no-equipment steps available at every location: push-up (9 steps), pull-up (9), muscle-up, dip, squat, hinge, L-sit, handstand, core, and ab wheel.
  - Step-by-step instructions for 177 exercises from free-exercise-db by Yuhonas (public domain, Unlicense), credited in-app and in README.
- **Deterministic generator** (no AI). Details in `docs/workout-algorithm.md`.
  - Per-muscle recovery: fatigue decays over 48–72 h and scales with sets and effort.
  - Smart mode picks the most recovered day.
  - Fills each slot only from the active location's equipment.
  - Skips injury-tagged moves.
  - Keeps main lifts consistent so they can progress, and rotates accessories.
  - Trims to your session length and supersets short sessions.
- **Progressive overload:** double progression, with load steps from each location's own weights.
  - When the next weight is too big a jump (your 5 → 30 lb dumbbells), it progresses reps, then sets, then tempo.
  - 10% reset after two bad sessions; stall detection.
  - Bodyweight chains suggest the next step.
- **Deloads:** the last week of every 4–6 week cycle (by experience), or on demand when 2+ main lifts stall.
- **Programs:**
  - Smart (adapts to recovery)
  - Full body 3×
  - Upper/lower
  - Push/pull/legs
  - 5×5
  - Hypertrophy
  - Home dumbbells
  - Boxing conditioning (shadowboxing when there's no heavy bag)
  - Build my own
- **Train tab:**
  - pick a location (defaults to the last one used);
  - see today's plan or pick a different day;
  - start or resume a workout;
  - recovery bars and program/cycle status.
- **Logger:**
  - big one-handed rows, with last session's numbers inline;
  - planned weight and reps prefilled (tap ✓ to accept);
  - reps in reserve (RIR), warm-up sets, add/remove sets, swap for a similar move doable here, reorder, add exercise;
  - plate calculator, "how to" with cues and steps, timed holds with a countdown.
  - Rest timer with ±15 s and beeps, rest after supersets, and the screen kept awake.
  - PR detection (estimated 1RM, heaviest weight, reps at a weight, most reps, longest hold) with a celebration.
- **Interval timer:**
  - boxing rounds with combo callouts (optional voice);
  - HIIT, EMOM, Tabata, and custom;
  - "log as cardio" when it finishes.
- **Cardio log:** manual entry, labelled as manual. Peloton rides go here until Phase 2/3 imports.
- **History:**
  - 12-week calendar heatmap;
  - weekly sets per muscle against a 10–20 set guide;
  - estimated 1RM / best-reps trend per exercise;
  - PR board;
  - recent workouts and cardio, with detail and delete.
- **Exercise library screen:** search, filter by movement and location, favorites, "never suggest", and custom exercises.
- **Locations:** a weight-inventory editor (dumbbell pairs and kettlebells) and the plate calculator.
- **Today:** a workout card (start, resume, or done).
- **Data:**
  - new collections `workouts` (sets live inside each workout, one level deep, with `location_id`), `cardio_sessions`, `programs`, and `exercises` (custom);
  - export adds workouts and cardio CSV;
  - delete-everything covers every collection.

**Review fixes (Checkpoint A feedback)**
1. **Rule tests:**
   - `npm test` copies the rules in first (the emulator only reads its own folder);
   - `demo-forge` project ID in both files;
   - firebase-tools ^15;
   - SETUP says Java 21+.
   - New tests: another user listing, collection-group queries, changing `user_id`, removing standard fields, deeper paths, unknown collections, type checks.
2. **Closed public sign-up:** SETUP step 7. `auth/admin-restricted-operation` now shows a plain message.
3. **`initializeAuth`** with IndexedDB and local persistence and no popup/redirect resolver, so there's no hidden apis.google.com iframe on iOS.
4. **No endless spinner:** a failed data listener (for example, rules not published) shows a clear message with a retry button.
5. **Calorie floor citation:** Harvard only, noted as more cautious than NIH/NHLBI's 1,000–1,200 (women) / 1,200–1,600 (men). Updated in targets.js, About, and README.
6. **Service worker:** the first visit no longer reloads itself. It reloads only when a service worker already controlled the page, or after you tap the update banner.
7. **`tests/run.html`** bypasses the service worker's app-page fallback.
8. **Content-Security-Policy** meta tag:
   - scripts: self + www.gstatic.com;
   - connections: self + firestore / identitytoolkit / securetoken googleapis.com (+ gstatic);
   - `object-src 'none'`, `base-uri 'self'`, `frame-src 'none'`.
9. **SETUP step references** fixed.
10. **Sync pill** uses Firestore's `hasPendingWrites` on every watched collection, so writes queued in an earlier session show as Saving… until confirmed.
11. **`weight_inventory` stored in kg** (`dumbbells_kg`, `kettlebells_kg`), shown in your units. Home: 5 and 30 lb dumbbell pairs, one 20 lb kettlebell. Locations saved by v0.1.x (in pounds) are converted automatically on first load. Age escaped in Settings.
12. **Delete everything:** if wiping the on-device copy fails after the account is gone, the app just reloads.
13. **Soft deletes add `deleted_at`.** Rules allow only known collections and add basic type checks (for example, `kg is number`, profile/settings id `main`).

## 0.1.1 — Home gym preset (2026-10-07)

- Home gym location now comes preloaded from your photos: 5 lb and 30 lb dumbbell pairs, kettlebells, resistance band with handles, jump rope, ab wheel, rotating push-up handles, and Peloton bike.
- New equipment types: ab wheel, push-up handles.
- Locations store a weight inventory (dumbbells 5 and 30 lb for now). Checkpoint B uses it for progression steps.

## 0.1.0 — Phase 1, Checkpoint A (2026-10-07)

**Added**
- Installable PWA shell: manifest, icons, offline service worker, "new version, tap to refresh" banner.
- Email and password sign-in, password reset.
- Offline-first data: Firestore's persistent on-device cache. Writes made offline survive app restarts and sync when back online. A status pill shows Synced, Saving…, or Offline.
- Onboarding: goal, body stats, activity, training days and length, experience, injuries, locations, and targets with weekly pace.
- Calorie and macro targets: Mifflin-St Jeor BMR and TDEE, safe floors (1,200 / 1,500 kcal, cited), a 1%/week loss cap (override up to 1.5%), protein at 1.6–2.2 g/kg, a "why these numbers" explanation, and safety notes for under-18s, underweight, BMI 40+, low targets, and out-of-range inputs.
- Weight: manual logging, exponentially smoothed trend (10%/day), chart with weigh-in dots, trend line, goal line, and projected goal date, plus history with delete.
- Today screen: weight trend with a 7-day arrow and sparkline, daily targets, and an install-to-Home-Screen prompt on iPhone.
- Locations (Addendum 1): Home gym, YMCA (standard equipment preloaded), and Travel / no equipment. Rename, set default, toggle equipment, add custom items, add or remove locations.
- Settings: units (lb/ft or kg/cm), edit profile and targets, export everything (JSON), export weights (CSV), delete everything (account plus cloud plus on-device copy), and version.
- Security rules: owner-only access, required standard fields, immutable `created_at` and `user_id`, closed `private` area for server-only tokens, plus rule tests.
- Unit tests: units, targets, and smoothing (29 tests), with a check that the version numbers match.

**Data model**: `users/{uid}/{profile|settings|locations|weights}/{id}`. Every record has `id`, `user_id`, `created_at`, `updated_at`, `source`, and `deleted`.
