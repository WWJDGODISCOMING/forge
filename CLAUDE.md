# Working agreement for Claude on Forge

Forge is Christian Everett's personal fitness app. It's a PWA on GitHub Pages plus Firebase project `forge-web-f2351` and Cloud Functions in `functions/`. The goal is to beat Fitbod, Workouts for Men and Withings+ on features and polish, not just to be correct.

## Who does what
- **Christian (owner):** merges PRs, and does anything that needs his own devices or accounts: deploying Cloud Functions and `firestore.rules` (he taps the **Deploy** button in GitHub Actions on his phone, see `docs/deploy-from-phone.md`; the Mac with the iPhone hotspot is only a fallback), the Firebase or Google Cloud console, the Withings developer dashboard, and secrets. He does not want to relay messages between us or be asked to check in.
- **His review bot (comments as WWJDGODISCOMING, tags @claude):** it writes specs, opens issues, opens PRs from your branches, reviews them, renders the UI at iPhone size, and sends you fixes. It speaks for Christian on scope and priorities.
- **You (Claude):** build, test, push to your branch, and report back in the issue/PR comment.

## How we work without Christian
- Don't wait on Christian for anything except a merge or a step only he can do. If you need a product decision, make the sensible call that fits the brief, note it in your summary, and keep going. The review bot will correct course if needed.
- Every summary ends with: what changed, test results, anything skipped and why, and **whether Cloud Functions or `firestore.rules` changed** (those need Christian to run the Deploy button: say which choice, `functions`, `rules` or `everything`, and the branch name if it should be tried before merge).
- Don't edit `.github/workflows/deploy.yml` (you can't push workflow files anyway). A new `defineString`/`defineInt` setting must have its non-secret value committed in `functions/.env`, or the button can't deploy it. A new secret needs Christian's one-time step; say so in the summary (see docs/deploy-from-phone.md → "When the button can't do it").
- Keep `config.js` as committed. Never commit secrets or tokens. The repo is public.
- **Privacy:** never commit Christian's real health data, Withings exports, photos, or GPS. Use synthetic fixtures in tests.
- Run `node tests/run.js` and `npm --prefix functions install && npm --prefix functions test` before pushing. Rules tests run in CI.
- **Your run ends the moment you stop to wait.** Never start tests or renders in the background or with a monitor and then say you're waiting: run them in the foreground (Bash allows up to 15 min). Make the edits first with Edit/Write (not python or cat heredocs), commit and push them, then run the checks, push any follow-up fixes, and only then write your final message. A run that ends with nothing pushed can't be reviewed.
- Bump `js/version.js` and `sw.js` and add a CHANGELOG entry for each release.
- UX bar: iPhone-first, one-handed use, big tap targets, plain friendly words, respects reduced motion and safe areas. Christian's wife also uses the app (her own account).

## Roadmap (in order; specs and reviews live in `notes/`)
1. v0.4.4: M1/M2 + first-run tour (PR #14).
2. **W2a:** Apple Health ingest (`healthIngest`, Shortcut token, Apple Health zip import), Readiness, Forge Score. Target about Oct 15–17, 2026.
3. **W2b:** trends, weekly report, insights. Must ship before **Nov 1, 2026**, when Christian's Withings+ access ends. See `notes/brief-addendum-3-withings-plus-replacement.md`.
4. Food logging (Checkpoint C; needs a USDA FoodData Central key from Christian).
5. Weekly progress photos (stored on the device only, time-lapse export, on-device comparisons, opt-in AI analysis).
6. Home gym equipment profile from Christian's photos, plus YMCA and full bodyweight coverage.
7. AI coach.
8. Phase 3: native wrapper (Capacitor).

The review bot will open an issue for each item with the spec. If you finish early, propose the next step in your summary.

## Self-review checklist (required in every PR)
Before you say a PR is ready, complete this list and paste it, ticked, into the PR body. Don't tick what you didn't do; say why instead.

- [ ] `node tests/run.js` passes (unit + layout).
- [ ] `npm --prefix functions install && npm --prefix functions test` passes.
- [ ] Rules tests pass (`tests/rules`, runs in CI; note if they only ran in CI).
- [ ] Every changed screen rendered with the in-repo headless harness (`tests/layout/`): `LAYOUT_ROUTES=<routes> npm run screens` saves PNGs to `screens/` at 390x844 plus the iPhone Duo folded (466x678, 678x466) and unfolded (626x890, 890x626) sizes, dark and light. CI uploads them as the `screens` artifact of the `tests` workflow; link the artifact (or attach the key shots) in the PR.
- [ ] Text contrast 4.5:1 or better on every changed element, light and dark.
- [ ] Reduce Motion respected (no movement-based animation; crossfade or none).
- [ ] Haptics on meaningful touches via `js/ui/haptic.js` (no-op on the web).
- [ ] No secrets, tokens or personal health data (synthetic fixtures only).
- [ ] Health copy gives general guidance and never diagnoses.
- [ ] Each acceptance criterion for this item in `QUEUE.md`, checked one by one.
- [ ] Version bumped (`js/version.js`, `sw.js`) to the version `QUEUE.md` reserves, plus a CHANGELOG entry.
- [ ] Says whether Cloud Functions or `firestore.rules` changed.

After opening the PR, update this item's `Status` in `QUEUE.md` to `in-review (PR #<n>)` **in that same PR**. Work on one `QUEUE.md` item per PR only.
