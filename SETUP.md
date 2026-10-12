# Setup (one time, about 30 minutes)

You'll create a GitHub repo for the app files and a Firebase project for sign-in and data. Phase 1 costs $0 and needs no secrets.

> **Updating from an earlier version?** Skip this file and follow [DEPLOY.md](DEPLOY.md). Version 0.2.0 changes `firestore.rules`, so publish the new rules too (DEPLOY → "If an update changes firestore.rules"). Also do step 7 below (close public sign-up) if you haven't yet.

## 1. Put the files on GitHub

1. Install **GitHub Desktop** on your Mac: https://desktop.github.com, then sign in with your GitHub account.
2. In GitHub Desktop: **File → New Repository…**
   - Name: `forge`
   - Local path: pick a folder you'll remember (for example `Documents/GitHub`)
   - Click **Create Repository**.
3. Unzip the zip I sent. Drag **everything inside** the unzipped `forge` folder (not the folder itself) into the new `forge` repo folder in Finder.
4. Back in GitHub Desktop, type `Initial version` in the **Summary** box (bottom left) → **Commit to main** → **Publish repository**.
5. In the publish window, **uncheck "Keep this code private"** (free GitHub Pages needs a public repo; your data is never in the repo) → **Publish Repository**.

## 2. Turn on GitHub Pages

1. Go to `https://github.com/YOUR-USERNAME/forge` → **Settings** (top tab) → **Pages** (left menu).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait 1–2 minutes and refresh. The page shows your address: `https://YOUR-USERNAME.github.io/forge/`. You'll see an "Almost there" screen until you finish step 6.

## 3. Create the Firebase project

1. Go to https://console.firebase.google.com → **Create a project** (or **Add project**).
2. Name it `forge` → **Continue**.
3. **Turn OFF Google Analytics** (the app has no trackers) → **Create project** → **Continue**.
4. On the project home page, click the **web icon `</>`** ("Add app" → Web).
5. Nickname: `forge-web`. **Leave "Also set up Firebase Hosting" unchecked.** → **Register app**.
6. You'll see a code block with `const firebaseConfig = { apiKey: ..., ... }`. Open `config.js` in your repo folder (TextEdit works: right-click → Open With → TextEdit) and replace each `PASTE_...` value with the matching value. Keep the quotes. Save.
7. **Continue to console.**

These config values are not secrets. Every Firebase web app ships them publicly. The security rules (step 5) and closed sign-up (step 7) are what protect your data.

## 4. Turn on email sign-in

1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → switch on the first toggle (**Email/Password**) → **Save**. Leave "Email link" off.
3. **Settings** tab → **Authorized domains** → **Add domain** → type `YOUR-USERNAME.github.io` → **Add**.

## 5. Create the database and lock it down

1. Left menu: **Build → Firestore Database → Create database**.
2. If asked for an edition, pick **Standard**.
3. Location: **us-east1 (South Carolina)**, the closest to Atlanta. *This can't be changed later.* → **Next**.
4. Choose **Start in production mode** → **Create**.
5. Open the **Rules** tab. Delete everything in the editor, paste the full contents of `firestore.rules` from your repo, and click **Publish**.

If you skip this step, the app shows "Can't read your data… Did you publish the security rules?" instead of loading.

## 6. Push the config and install on your iPhone

1. GitHub Desktop: Summary `Add Firebase config` → **Commit to main** → **Push origin**.
2. Wait 1–2 minutes. On your iPhone, open **Safari** (it must be Safari) and go to `https://YOUR-USERNAME.github.io/forge/`.
3. Tap the **Share** button → **Add to Home Screen** → **Add**.
4. Open **Forge from your Home Screen** (not from Safari) and **create your account** there.

Why install first: iPhone can erase data for websites you haven't opened in 7 days. Apps added to the Home Screen are exempt.

## 7. Close public sign-up (do this right after you create your account)

Your app's address is public, so anyone who finds it could otherwise make an account in your Firebase project. They could never see your data, but there's no reason to let them in.

1. Firebase console → **Build → Authentication** → **Settings** tab → **User actions**.
2. **Uncheck "Enable create (sign-up)"**.
3. **Leave "Enable delete" checked**, because Settings → Delete everything needs it.
4. **Save**.

If anyone (including you) tries "Create an account" now, the app says new accounts are turned off. Signing in still works.

## 7b. Two-step sign-in: one-time switch (optional, do it once on your Mac)

Settings → Privacy & security → **Two-step sign-in** asks for a 6-digit authenticator code (Apple Passwords works) as well as your password. Until you flip this switch on your Firebase project, the row just says "Two-step sign-in needs a one-time switch on your Firebase project". Signing in is never affected.

Use your own signed-in Google account. Nothing secret goes in the repo.

1. **Upgrade to Identity Platform** (needed for authenticator codes; it is free at this size, the free tier is 50,000 monthly active users). Firebase console → **Build → Authentication** → **Settings** → **Upgrade**, and accept. If you don't see Upgrade, it's already done. Your accounts and passwords carry over unchanged.
2. In Terminal on your Mac, sign in to Google Cloud once (skip if `gcloud auth list` already shows you): `gcloud auth login`
3. Paste this whole command and press Return. It turns on authenticator codes and tolerates a code that is one 30-second step early or late:

```sh
curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/forge-web-f2351/config?updateMask=mfa" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: forge-web-f2351" \
  -H "Content-Type: application/json" \
  -d '{"mfa":{"state":"ENABLED","providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
```

4. It prints a block of JSON that includes `"state": "ENABLED"`. If it prints an error instead, copy it to the review bot.
5. In Forge: **Settings → Privacy & security → Two-step sign-in → Add to Passwords**, then type the code it shows.

If you ever lose the code, sign-in is blocked for that account until a second factor is removed in the Firebase console (Authentication → Users → the account → remove the second factor). Turn it on for your own account first, check it works, then tell Hannah how to turn on hers.

## 8. Check it works

1. Finish onboarding. The top-right pill should say **Synced**.
2. Turn on **Airplane Mode**. The pill says **Offline · saved on this phone**.
3. Go to **Train** → **Start workout** → log a few sets → **Finish workout**. Log two weigh-ins.
4. Close the app completely (swipe it away), reopen it, and confirm everything is still there. The pill should say **Saving…** while those offline changes are still queued.
5. Turn Airplane Mode off. Within a few seconds the pill says **Synced**.
6. On your Mac, open the same address in a browser and sign in. The workout and weigh-ins are there.

### Content-Security-Policy check (iPhone)

The app tells the browser exactly which servers it may talk to (Firebase and Google's script server only). To confirm that didn't break anything:

- **Sign in, sign out, and sign in again.** That covers the Auth servers.
- **Synced** appears after a change, and the **Airplane Mode round trip** above works. That covers the Firestore servers.
- **Exercise library → tap any exercise.** The "Step by step" instructions load (a local file).
- **Settings → Export everything** opens the share sheet.
- The **"New version ready"** banner appears after your next update. That's the service worker.

If any of these fails right after an update, tell me what you saw. The likely cause is a server missing from the policy line in `index.html`.

## Costs and accounts so far

| Item | Cost |
|---|---|
| GitHub (public repo + Pages) | $0 |
| Firebase Auth, Firestore (free usage) | $0 |

**Coming in Checkpoint C:** a small Cloud Function to keep your USDA key private. It runs on your Blaze billing account, linked to this project (Firebase console → ⚙️ → **Usage and billing** → **Details & settings** → **Modify plan**), with a $1 budget alert. A budget alert only warns you; it doesn't stop charges. Expected cost at your usage: $0.

## Tests

- **Math, generator, and progression tests:** run `node tests/run.js` from the repo folder (needs Node), or open `https://YOUR-USERNAME.github.io/forge/tests/run.html` in any browser.
- **Security rule tests (optional):** these run against the local Firebase emulator only. The `demo-forge` project ID means they can never touch your real project. They need **Node 20+ and Java 21+**. With Homebrew, in Terminal:

  ```
  brew install node openjdk@21
  echo 'export PATH="$(brew --prefix openjdk@21)/bin:$PATH"' >> ~/.zshrc
  source ~/.zshrc
  java -version
  ```

  `openjdk@21` is "keg-only", so Homebrew doesn't put it on your PATH; the `echo` line does that permanently. `java -version` should say 21. Then:

  ```
  cd path/to/forge/tests/rules
  npm install
  npm test
  ```
