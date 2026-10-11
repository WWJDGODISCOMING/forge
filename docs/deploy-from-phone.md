# Deploy from your phone

Forge's backend (Cloud Functions and the Firestore rules) now deploys with a button on GitHub. You don't need the Mac, a cable or the iPhone hotspot. GitHub's servers do the deploy, so your home Wi-Fi blocking `googleapis.com` doesn't matter.

The website itself still updates by itself when a PR merges (GitHub Pages). This button is only for the backend.

## Every deploy (about 30 seconds of tapping, 2–5 minutes of waiting)

GitHub's iPhone app can run it (GitHub added "Run workflow" to GitHub Mobile in July 2024). Safari on github.com works the same way if the app ever gives you trouble.

1. Open the **GitHub** app and go to the **forge** repo.
2. Scroll down and tap **Actions**.
3. Tap **Deploy**.
4. Tap **Run workflow**.
5. **Use workflow from:** leave it on **main**. (Always main, even when deploying a PR branch.)
6. **What to deploy:**
   - **functions** for Cloud Functions changes (most of the time),
   - **rules** when `firestore.rules` changed,
   - **everything** for both. (It never touches the website.)
7. **Branch to deploy:** leave **main**, or type a PR's branch name to try that PR's backend before you merge it. The branch name is on the PR page, under the title.
8. Leave **Also delete live functions…** off.
9. Tap **Run workflow**.
10. Tap the new run at the top of the list. Wait for the green check ✅ (2–5 minutes for functions, under a minute for rules). The summary at the bottom says in plain words what was deployed, from which branch and commit, and whether it worked.

A red ✗ means nothing new is live, or only part of it. Tap the run, then the red step, to see why. Running it again is always safe.

**Only deploy branches you've looked at.** Their code runs on Google's side as soon as it's deployed, and it runs during the deploy too.

## One-time setup (about 5 minutes)

This tells Google to accept deploys from this one GitHub workflow, started by you, from main. No password or key is created or stored anywhere: GitHub proves who it is to Google for each run with a token that lasts minutes. Nothing here is secret, so it's fine that the repo is public.

### 1. Run the setup in Google Cloud Shell

1. On your phone or any computer, open **console.cloud.google.com** and sign in as yourself.
2. At the top, check that the project is **forge-web-f2351**.
3. Tap the **>_** icon (Activate Cloud Shell) at the top right. Wait for the black terminal at the bottom. If it asks to authorize, tap **Authorize**.
4. Copy this one line, paste it into Cloud Shell, and press Return. It runs [`scripts/deploy-setup.sh`](../scripts/deploy-setup.sh) from main. Read that file first if you'd like to see what it does.

```bash
curl -fsSL https://raw.githubusercontent.com/WWJDGODISCOMING/forge/main/scripts/deploy-setup.sh | bash
```

5. It takes 1–3 minutes. At the end it prints **All set** and two values. Keep the tab open.

If it stops with an error, copy the error and send it to me. Running the line again is always safe.

### 2. Add the two values to GitHub

These are **variables**, not secrets.

1. On github.com (Safari works; the GitHub app doesn't have repo settings), open the **forge** repo.
2. Tap **Settings** → **Secrets and variables** → **Actions**.
3. Tap the **Variables** tab, then **New repository variable**.
4. **Name:** `GCP_WIF_PROVIDER`. **Value:** the long line printed under `GCP_WIF_PROVIDER` (it starts with `projects/` and ends with `/providers/forge-deploy`). Tap **Add variable**.
5. Tap **New repository variable** again. **Name:** `GCP_DEPLOY_SA`. **Value:** the line under `GCP_DEPLOY_SA` (`forge-deployer@forge-web-f2351.iam.gserviceaccount.com`). Tap **Add variable**.

Done. Run your first deploy with the steps at the top.

## What the setup grants, and why

The deploy runs as a robot account, `forge-deployer`, that has no key. Google only lets a GitHub run act as it when **all** of these are true. GitHub signs each of these facts, so they can't be faked:

- the repo is `WWJDGODISCOMING/forge` (checked by its permanent numeric id, so a renamed or re-created repo doesn't count);
- the run was started by you (your numeric GitHub id);
- it was started with the Run workflow button;
- it runs `.github/workflows/deploy.yml` **as it is on main**.

So the Claude workflow, the tests workflow, a fork, or an edited copy of `deploy.yml` on a branch can't get Google access. The workflow file also checks that you're the one who started it.

The robot can do only what `firebase deploy` needs for Forge's functions, rules and indexes:

| Role | Why |
|---|---|
| Cloud Functions Admin | Create and update the functions. The deploy also checks it can set who may call new HTTPS functions (for example `foodSearch`). |
| Cloud Run Admin | 2nd-gen functions are Cloud Run services. The deploy sets their "who can call me" setting (public for the webhook, Health and callable functions). |
| Service Account User, on the functions' own account only (`…-compute@developer…`) | A function runs as that account, so deploying one means acting as it. Granted on that one account, not project-wide. Also on the old App Engine account if your project has one, because firebase-tools checks it. |
| Cloud Scheduler Admin | The 4 am `withingsMaintenance` job. |
| Cloud Tasks Queue Admin | The `withingsTask` queue (retries and rate limits). |
| Secret Manager Viewer | Check that the secrets the code uses exist and are enabled. It **can't read** their values. The functions read them at run time, using access this setup grants to the functions' account. |
| Firebase Rules Admin | Publish `firestore.rules`. |
| Cloud Datastore Index Admin | Firestore indexes (none yet), and the deploy checks this role before any Firestore deploy. It can't read your data. |
| Artifact Registry Reader | Read the build-image repo's cleanup rule. Google's build service, not the robot, writes the images. |
| Service Usage Consumer | Check that the Google APIs are on, and bill API calls to this project. |
| Custom "Forge deploy extras": `firebase.projects.get`, `serviceusage.services.generateServiceIdentity` | The deploy reads the Firebase project config, and makes sure the Pub/Sub and Eventarc service accounts exist. No narrow built-in role has these. |

Deliberately **not** granted:

- **Firebase Viewer:** it can read every Firestore document and Auth user.
- **Secret access or Secret Manager Admin.**
- **Cloud Build Editor** and **Artifact Registry Writer:** Google's build service does the builds.
- **Eventarc and Pub/Sub:** Forge has no Firestore or Pub/Sub triggers. The schedule calls the function directly.
- **Changing project permissions or turning on APIs:** the setup turns on every API the deploy needs.

The functions' account (`…-compute@developer…`) usually has broad access to your project. Anyone who can deploy code can make that code use it. That's true of every Cloud Functions deploy, which is why only you can start one.

## When the button can't do it

Use the Mac (`firebase deploy --only functions,firestore:rules` with the hotspot, see [DEPLOY.md](../DEPLOY.md)) for:

- **A new kind of trigger** the project has never had, such as the first Firestore or Storage trigger. Those need project-permission changes, which the robot can't make.
- **A new secret.** Set it in your own terminal (`firebase functions:secrets:set NAME`). Then run the setup line from step 1 again with the new name on the end, so the functions can read it:
  `curl -fsSL https://raw.githubusercontent.com/WWJDGODISCOMING/forge/main/scripts/deploy-setup.sh | bash -s -- NEW_SECRET_NAME`
  (Also ask for the name to be added to the `SECRETS=` line in `scripts/deploy-setup.sh`, so later re-runs keep it.)
- **Removing or renaming a function.** The deploy stops rather than delete a live function. To delete on purpose, run the button with **Also delete live functions…** turned on. That option also skips a few other "are you sure?" questions: functions that start retrying on failure, or a higher minimum bill.

## How it works (for the next developer)

- Workflow: `.github/workflows/deploy.yml`. Manual trigger only, one deploy at a time (`concurrency`), job environment `production`, and only the repo owner can run it.
- It checks out the `ref` input, installs `functions/` dependencies *before* signing in to Google, then signs in with `google-github-actions/auth` (Workload Identity Federation, impersonating `forge-deployer`). Then it runs a pinned `firebase-tools` with `deploy --only … --project forge-web-f2351 --non-interactive`.
- `--force` is only added when you tick "Also delete live functions". That's why setup step 6 sets the build-image cleanup rule ahead of time. Without it, a non-interactive deploy would stop on the cleanup question.
- The functions read plain settings (`WITHINGS_CLIENT_ID`, `FORGE_APP_URL`) from `functions/.env` and `functions/.env.forge-web-f2351`. The second file is on the Mac, not in git. For any setting the branch's files don't give, the workflow copies the value the live functions already use, so a deploy never changes it. A brand-new setting needs its non-secret value committed in `functions/.env`.
- Action versions are pinned to commit SHAs.
