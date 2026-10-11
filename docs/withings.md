# Withings in Forge (v0.4.4, "W1")

Your Withings Body Comp weigh-ins (weight, fat, muscle, water, bone, standing heart rate, and visceral fat, BMR, metabolic age and vascular age where the free API returns them) arrive in Forge on their own, a few minutes after you step off the scale. Your whole Withings history is imported once. The **data check** shows what the free API really returns for your account and says when it's safe to let Withings+ lapse.

> **Use your existing Withings account everywhere.** Never create a new one (not for the developer dashboard, a new scale, or a "fresh start"). Withings accounts created after **October 12, 2026** need Withings+ to share data with any app, Apple Health included. Yours is older, so it's unaffected.

How it works, in one paragraph: Forge has a few small Cloud Functions in your own Firebase project (`functions/`). They hold your Withings sign-in (only on the server, never in the app), receive Withings' "new weigh-in" notifications, fetch the measurements through Withings' official API and write them to your Firestore. The app only reads them. Cost at your usage: $0 (see the cost table at the end).

---

## Your steps

Each block says **when**. Only ever send me the **non-secret** values marked 📤. Never paste a secret into chat, an email or a file in the repo.

### Now (before you weigh in again)

1. **Export your Withings data** while you're still subscribed.
   - **Withings app:** tap your **Profile** (the avatar; where it sits depends on your phone) → the **⚙️ settings** gear (top right) → **Export All Health Data** (it may be called **Download my data**) → choose your profile → **Start my archive**. Withings emails you a link to a ZIP of CSV files (`weight.csv` and others). Save the ZIP to iCloud Drive.
   - **If the app doesn't show that option:** on your Mac, go to **healthmate.withings.com** → sign in (existing account) → click your **avatar** (top right) → **Settings** → pick your user → **Download my data** → download the CSV archive. (Or go straight to **account.withings.com/export/user_select**.)
   - Also save the **PDF report** if the app offers one.
2. **Screenshot** in the Withings app (latest value and the 1-year chart): visceral fat, vascular age, Nerve Health Score, metabolic age, BMR, and any Withings+ screens you like (Health Improvement Score, weekly breakdown, BodyPath / Body Profile). The CSV doesn't include all of these.
3. **Withings → Apple Health** as a backup path: Withings app → Profile → ⚙️ → **Apple Health** (or "Health app") → turn on Weight, BMI, Body Fat %, Lean Body Mass and Heart Rate.
4. Open `weight.csv` from the export and note how many rows it has **not counting the header row** (one row per weigh-in). You'll type it into the data check later.

### Start of W1 (today)

5. **Upgrade Firebase to Blaze and add a budget alert.**
   1. Go to **console.firebase.google.com** → project **forge-web-f2351**.
   2. Click ⚙️ (next to Project Overview) → **Usage and billing** → **Details & settings** → **Modify plan** → **Blaze**.
   3. Create a **new Cloud Billing account just for Forge** with your card (so the free allowances are all yours).
   4. When it asks for a budget, enter **$2**. If it doesn't ask: **console.cloud.google.com** → **Billing** → **Budgets & alerts** → **Create budget** → project forge-web-f2351 → amount **$2** → alerts at **50%, 90%, 100%** → email you.
   - A budget only **emails** you; it doesn't stop charges. The real guards are in the code: every function is capped at 2 instances, the webhook needs a secret key, and nothing runs in a loop.

6. **Install the tools on your Mac** (one time). Open **Terminal** (Spotlight → "Terminal") and paste one line at a time.
   1. Check for Homebrew:
      ```
      brew --version
      ```
      If you see `command not found`, install it (it asks for your Mac password; nothing appears while you type it):
      ```
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      ```
      At the end it prints **"Next steps"** with two `echo … >> ~/.zprofile` / `eval …` lines. Run exactly those lines, then close Terminal and open a new window. `brew --version` should now work.
   2. Install Node 22 and put it on your PATH (Homebrew installs `node@22` "keg-only", so it isn't on your PATH by itself):
      ```
      brew install node@22
      echo "export PATH=\"$(brew --prefix node@22)/bin:\$PATH\"" >> ~/.zprofile
      source ~/.zprofile
      node -v
      ```
      `node -v` should print `v22.something`. (If you already have another Node, this one now comes first.)
   3. Install the Firebase tools and sign in:
      ```
      npm install -g firebase-tools
      firebase --version
      firebase login
      ```
      `firebase login` opens your browser: sign in with the Google account that owns the Firebase project and click **Allow**.
   4. Go to your Forge folder (drag the folder from Finder onto the Terminal window after typing `cd `):
      ```
      cd ~/Documents/GitHub/forge
      firebase projects:list
      ```
      You should see **forge-web-f2351** in the list. The repo's `.firebaserc` already points at it.

7. **Register the Withings developer app** (with your existing login).
   1. Go to **developer.withings.com** → **Log in** with your **existing** Withings account (same email as the scale). Don't create an account.
   2. Open the **Dashboard** → **Create an application** (choose the **Public API** / "Health Data API" integration, free plan).
   3. Name **Forge (personal)**. Description **Personal fitness app for my own data**. Contact: your email. Accept the terms.
   4. **Callback URL**: Withings checks it with a quick request when you save. The functions don't exist yet, so for now enter:
      ```
      https://wwjdgodiscoming.github.io/forge/
      ```
      You'll change it after the deploy (step 11).
   5. Save. Copy the **Client ID** 📤 (send it to me; it's not secret). The **Client Secret** stays with you: you'll paste it into Terminal in step 9 and nowhere else.

### After the W1 PR is merged

8. **GitHub Desktop** → **Fetch origin** → **Pull origin**, so your folder has the merged code (including `functions/`).
9. **Store the two secrets** (Terminal, in the Forge folder). Each command asks for the value at a hidden prompt (nothing shows while you paste; press Return):
   ```
   firebase functions:secrets:set WITHINGS_CLIENT_SECRET
   ```
   Paste the **Client Secret** from step 7.
   ```
   openssl rand -hex 24
   firebase functions:secrets:set WITHINGS_WEBHOOK_KEY
   ```
   Copy the 48-character line the first command printed, and paste it at the second command's prompt. (It's the secret key in the address Withings uses to notify Forge. You never need it again.)
   - If it says the Secret Manager API isn't enabled, answer **Y** to enable it.
10. **Deploy the functions and the rules.** First install the functions' packages (the deploy fails without them), then deploy:
    ```
    npm --prefix functions install
    firebase deploy --only functions,firestore:rules
    ```
    - The install creates `functions/package-lock.json`. **Commit it** (GitHub Desktop) so every deploy uses the same package versions.
    - If `npm` says **EACCES** / permission denied under `~/.npm` (it happens after an earlier `sudo npm install`), fix the folder's owner once, then run the install again:
      ```
      sudo chown -R $(whoami) ~/.npm
      ```
    - If the deploy stops with **timeouts connecting to `googleapis.com`** (`ETIMEDOUT`, `ECONNRESET`), it's the network, not Forge: some Wi-Fi networks block or throttle Google's APIs. Switch your Mac to another network (your **phone's hotspot** works) and run the deploy again.
    - It asks for **WITHINGS_CLIENT_ID**: paste the Client ID. (It saves it in `functions/.env.forge-web-f2351`; that's fine to commit, it isn't secret.)
    - Say **Y** to enabling any Google APIs it lists (Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, Cloud Tasks, Cloud Scheduler, Eventarc).
    - When it asks how many days to keep container images, enter **1** (keeps storage at $0).
    - The first deploy takes 3–6 minutes. At the end it prints function URLs. 📤 Send me that last part (the URLs aren't secret).
11. **Point Withings at the real callback.** developer.withings.com → your app → **Edit** → set the Callback URL to:
    ```
    https://us-east1-forge-web-f2351.cloudfunctions.net/withingsOAuthCallback
    ```
    → Save. (Withings' check now reaches the function and passes.)
12. **Connect.** In Forge (after the "New version ready" refresh; Settings shows **0.4.0**): **Settings → Withings → Connect Withings → Continue to Withings** → **Log in** (not "Create account") → **Allow** → "Withings connected" → switch back to Forge. Settings → Withings shows the history import counting up.
13. When the import says ✓, open **Data check → Run check**. Type the `weight.csv` row count into the box. Then **Save report** (name: `subscribed`). 📤 Send me a screenshot.
14. Weigh in normally every morning for 7 days. Each weigh-in should appear on its own within ~5 minutes. The data check shows "Weigh-ins seen n/7" and the median.

### W2a (v0.5.0): Apple Health, Readiness, Forge Score

Everything here uses the iPhone, Apple Watch and Apple Health you **already have**. Nothing to create or sign up for.

15. **Deploy the new functions** (Mac, on your hotspot if Wi-Fi blocks Google): `npm --prefix functions install`, then `firebase deploy --only functions`. No new secrets, and `firestore.rules` didn't change. Refresh Forge until Settings shows **0.5.0**.
16. **Seed your history first.** Health app → your picture (top right) → **Export All Health Data** → save `export.zip` to Files. In Forge: **Settings → Apple Health → Choose export.zip**. Forge reads the zip **on your phone** and sends only small daily summaries (the last 120 days); the zip never leaves the phone. Readiness needs 14 days of HRV / resting heart rate / sleep; this gives them on day one.
17. **Create the Shortcut token.** Settings → Apple Health → **Create Shortcut token** → **Copy token** (it's shown once; make a new one any time, the old one stops working).
18. **Add or build the Shortcut.** If the screen shows **Add the Shortcut**, tap it and paste the token when Shortcuts asks. Otherwise build it from the steps on that screen (about 10 minutes, once; every key has a **Copy** chip): overnight signals (HRV, resting HR, breathing, wrist temperature, SpO₂) with *End Date is after yesterday 6 pm* and *before today 11 am*; daily totals (steps, active energy, exercise minutes) with *Group By: Day*, today's under `steps` and yesterday's finished total under `steps_yesterday` (same for the other two); a *Dictionary*; then *Get Contents of URL* → `POST` JSON to `https://us-east1-forge-web-f2351.cloudfunctions.net/healthIngest` with header `Authorization: Bearer <token>` (the token sheet has a button that copies it whole). Run it once and allow each Health type when iOS asks. The **Data check** on the Apple Health screen then lists what arrived (HRV, resting HR, sleep, wrist temperature, steps, …).
    - If *Wrist Temperature* isn't in Shortcuts on your iOS version, skip it. Forge accepts everything else, and the zip import fills in temperature history.
    - ECG isn't available to Shortcuts at all (a manual log comes later).
19. **Run it every morning on its own.** Shortcuts → Automation → **Sleep → Waking Up** → Run Shortcut → *Forge Health* → **Run Immediately**. Optional: a second shortcut, *Forge Evening*, that sends only `day` and the daily totals, on a 9 pm automation (so it can't replace this morning's HRV). If the phone is locked a run can fail; the next one fills the gap (late and duplicate posts merge into the same day).
20. **Look at Today.** After 14 days of data you get a Green / Amber / Red *Readiness* card with the reason in plain words, and **Progress → Score** shows your Forge Score. How every part is scored: [docs/forge-score.md](forge-score.md).

What the Shortcut sends (for reference): `day` (the wake-up day, `yyyy-MM-dd`) plus any of `hrv_sdnn_ms`, `rhr_bpm`, `resp_rate`, `wrist_temp_c`, `spo2_avg_pct`, `steps`, `active_kcal`, `exercise_min`, `vo2max`, `walking_hr_avg` (a number, or a list of values: Forge averages or adds them for you), `sleep_text` (one line per sleep stage: `Core,start,end`) and `workouts_text` (`type,start,minutes,kcal,heart rate`). Also accepted: `steps_yesterday`, `active_kcal_yesterday`, `exercise_min_yesterday` (stored on the day before). Numbers may be text, in °F, with `8,532` or `52,5` formatting. A value Forge can't read is skipped on its own (the reply lists `rejected` field names and the Data check says so); the rest of the post is saved. Replies: `200`, `401` (wrong or turned-off token), `400` (missing or invalid `day`, or nothing readable), `413` (over 256 KB), `429` (more than 30 posts an hour or 200 a day on one token).

---

## Verification gate (Withings+ access ends November 1)

| By | What | Who |
|---|---|---|
| Oct 9 | "Now" steps 1–4 done (export ZIP and screenshots saved, Apple Health on) | You |
| Oct 9 | Blaze + $2 budget, Mac tools, Withings developer app; Client ID sent | You |
| Oct 10 | W1 PR ready for review | Me |
| Oct 11 | Merged, secrets set, deployed, connected. **History import matches the CSV** (± manual entries) | You |
| Oct 11 | **Data check while still subscribed → Save report "subscribed"**. Decide on each ⛔ metric: view it in the free Withings app, or enter it by hand monthly | You |
| Oct 12–18 | **7 weigh-ins in a row, each in Forge on its own in ≤ 5 min** (data check median), plus one **Sync now** and one overnight maintenance run (Settings → Withings → "Last synced" moves to ~4 am) | You weigh in; send me the data-check screenshot |
| Oct 15 → Oct 31 | W2 (Watch data, Readiness, Forge Score) runs next to Withings+; note anything Withings+ tells you that Forge doesn't | You |
| Oct 31 | Final data check → **Save report** ("last day") | You |
| Nov 2 | Data check again → **Save report** ("after cancelling") → tick both → **Compare**. Expect "Nothing lost" | You |

---

## What runs where

| Function | Trigger | What it does |
|---|---|---|
| `withingsAuthStart` | Connect button (callable, signed in) | One-time `state` (10 min) → the Withings sign-in link |
| `withingsOAuthCallback` | Withings sends you back (HTTPS) | HEAD → 200 (Withings' URL check). Exchanges the code first (it dies in 30 s), stores tokens server-side, links your Withings user to your Forge account, saves the scale model, subscribes to weigh-in notifications, queues the history import |
| `withingsWebhook` | Withings notification (HTTPS POST, `?k=` secret key) | Checks the key, finds you, **queues one sync task and answers 200 immediately**. Withings' docs give no exact timeout and count slow or ≥ 400 replies as failures, so no Withings or heavy Firestore work happens here. Answers 503 only when it can tell before replying that something failed (lookup or queueing), so Withings retries |
| `withingsTask` | Cloud Tasks queue | The worker: one incremental sync per notification / Sync now, or **one history page per task** (the next page is queued with a fixed id, so a retried page can't start a second chain) |
| `withingsSyncNow` | Sync now (callable) | Incremental sync, at most every 10 minutes |
| `withingsDataCheck` | Run check / Save report (callable) | The probe below |
| `withingsDisconnect` | Disconnect / Delete everything (callable) | Revokes the notification, deletes tokens; optionally deletes all synced data |
| `withingsMaintenance` | Daily 04:00 New York (Cloud Scheduler) | Refreshes the token, re-subscribes if Withings dropped the subscription, catches up, notices weigh-ins deleted in the Withings app (last 90 days) and restores any it removed that Withings lists again, resumes a stalled import. **Safety stop:** if Withings' answer is empty, or more than **3 weigh-ins or 20% of the last 90 days (whichever is more)** would go, it removes nothing; the data check shows the last run |

No function is triggered by Firestore writes, so nothing a function writes can set off another run.

**Deleting things.** Deleting a weigh-in or body measurement in Forge marks it deleted (a tombstone). The sync never writes a tombstoned measurement back, whatever Withings sends later. To remove everything Withings-related: Settings → Withings → Disconnect → "Also delete the synced data", or Delete everything.

**Same-day weigh-ins.** If the scale weighed you more than once in a day, your trend uses the **earliest** reading (morning, before food and training). Weights you type in on a day that has a scale reading stay in your history but don't move the trend.

**"Is this you?"** Withings marks a measurement as uncertain when it can't tell who stepped on. Forge keeps those out of your trend until you tap **That's me** (or **Not me**, which deletes it from Forge).

---

### Updating to v0.4.4

21. **Pull and deploy again** (the Cloud Functions changed): `npm --prefix functions install`, then `firebase deploy --only functions`. Refresh Forge until Settings shows **0.4.4**. Nothing else to publish.
22. **Import weight.csv is safe to use now.** If Withings later brings the same readings in, Forge removes the csv copies and says how many; "Not me" on imported readings no longer breaks the data check.

### Updating to v0.4.3 (history fix)

16. **Pull and deploy** (GitHub Desktop → Fetch → Pull), then in Terminal:
    ```
    npm --prefix functions install
    firebase deploy --only functions
    ```
    Then refresh Forge until Settings shows **0.4.3**.
17. **Check what Withings returns before re-importing:** Settings → Withings → **Data check → Run check**. Open **By year**. If Withings lists weigh-ins back to 2009/2010, the API has your whole history.
18. **Settings → Withings → Re-import history.** You stay connected. It walks your history one year at a time, from now back to 2009 (and three empty years further, to be sure). **History by year** fills in as it goes. Nothing is duplicated, and weigh-ins you deleted or marked "Not me" stay gone. It takes a few minutes.
19. **If By year shows nothing before 2025** (the free API doesn't return your older readings): Settings → Withings → **Import weight.csv** → pick `weight.csv` from your export. Rows Forge already has from Withings are skipped. Importing the same file twice adds nothing.
20. **Family weigh-ins:** under **Is this you?**, use **Not me: everything under ___ lb**. It suggests a number between the family's readings and your lightest one, and shows how many it covers before you tap. **Not me — whole day** clears one day at a time. Then run the data check again: "Forge has" counts the ones you marked "Not me" as accounted for.

## If something doesn't start

**The history import or notifications never start** (Settings → Withings shows *Last problem: `backfill_enqueue`*, or the webhook never logs a weigh-in). The functions hand work to a Cloud Tasks queue, which needs the project's default service account to be allowed to add tasks. New Google Cloud projects sometimes don't grant this automatically:

1. **console.cloud.google.com** → project **forge-web-f2351** → ☰ → **IAM & Admin → IAM**.
2. Find **Default compute service account** (`…-compute@developer.gserviceaccount.com`) → the pencil ✏️ → **Add another role** → **Cloud Tasks Enqueuer** → **Add another role** → **Service Account User** → **Save**.
3. Forge → Settings → Withings → **Re-import history** (no need to disconnect).

**"Couldn't reach Forge's server functions"**: the functions aren't deployed yet (step 10), or the deploy failed. Run step 10 again and send me the last 20 lines.

**Only you can use it.** Make sure sign-up is closed (SETUP.md step 7: Firebase console → Authentication → Settings → User actions → untick **Enable create (sign-up)**), so nobody else can make an account and use your functions.

## Data check states

- ✅ **Received**: last value, date, count, and the **Withings meastype codes** that came back (1 = weight, 4 = height, 5 = fat-free mass, 6 = fat %, 8 = fat mass, 11 = heart rate, 76 = muscle, 77 = water, 88 = bone, 170 = visceral fat, 226 = BMR, 227 = metabolic age, 155/140 = vascular age, 167 = Nerve Health Score…), so you can match each row with the Withings app.
- ⛔ **Not on the free API**: your scale measures it, but the free API sent nothing. Still free to view in the Withings app.
- ➖ **Not measured by your scale**: Body Comp has no segmental data, ECG, SpO₂ or water split.
- ⏳ **Not measured yet**: only when the scale model is unknown and the metric needs a guided measurement (the Nerve Health Score). For Body Comp, a metric the scale measures that the API doesn't return is ⛔. Body Comp records pulse wave velocity and the nerve scores.

The verdict at the bottom says **Safe to cancel** only when: the core body metrics are flowing, the history import is complete (Forge has every **weigh-in** Withings returned, and matches your weight.csv row count if you typed it; heart-rate-only and nerve-only readings aren't weigh-ins, so they're not compared), Withings notifications point at Forge with the right key, and at least 7 weigh-ins arrived on their own with a median ≤ 5 minutes.

---

## Cost

| Item | Your usage | Free allowance | Expected |
|---|---|---|---|
| Function calls | ~150 a month | 2 million a month | $0 |
| Function compute | seconds a day | 400,000 GB-s | $0 |
| Cloud Tasks | ~100 a month (+ the one-time import) | 1 million operations a month | $0 |
| Secret Manager | 2 secrets, a few hundred reads | 6 versions, 10,000 reads | $0 |
| Cloud Scheduler | 1 job | 3 per billing account | $0 |
| Firestore | ≤ 5,000 writes for the import, then a few a day | 20,000 writes a day | $0 |
| Artifact Registry | 1 function image (1-day cleanup) | 0.5 GB | $0 |
| Withings API | 1 user | 10 users on the free plan | $0 |
