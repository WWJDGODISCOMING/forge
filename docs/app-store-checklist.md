# App Store checklist (for when Forge goes to TestFlight and the App Store)

Not needed to try the app on your own iPhone. Do these when the LLC has joined the Apple Developer Program.

- [ ] **Bundle ID moves to the LLC.** Change `com.christianeverett.forge` (Xcode → App target → Signing & Capabilities, and `appId` in `capacitor.config.json`) to the LLC's, e.g. `com.yourllc.forge`; pick the LLC as the Team; run `bash scripts/ios-setup.sh`. Create the same ID in App Store Connect. Nothing in Firebase depends on it, but Firebase's allowed domains for sign-in stay `capacitor://localhost`.
- [ ] **Privacy policy URL.** A public page (GitHub Pages is fine) that says what Forge stores (account email, workouts, weights, Apple Health daily summaries, Withings data if connected), where (your Firebase project), who can see it (only the account), that it isn't sold, shared for ads or used for tracking, and how to delete it (Settings → Delete account). App Store Connect requires the URL, and so does HealthKit.
- [ ] **App Privacy label (App Store Connect → App Privacy).**
  - **Health & Fitness → Health** and **Fitness**: collected, **linked to the user**, purpose **App Functionality**, **not used for tracking**.
  - **Contact Info → Email Address** (sign-in), **Identifiers → User ID**: linked, App Functionality, not used for tracking.
  - **Body → Weight** and other **User Content** (workouts, notes): linked, App Functionality, not used for tracking.
  - No third-party analytics or ad SDKs ship in the app, so there is nothing else to declare. Re-check this if one is ever added.
- [ ] **Account deletion** is required for apps with sign-in (5.1.1(v)). It's already there: **Settings → Delete account** (removes the data and the sign-in). Tell the reviewer where it is in the review notes.
- [ ] **HealthKit rules (5.1.3).** Health data is never used for advertising, marketing or data mining, and is never sold or given to data brokers. Forge writes only finished Forge workouts plus their active energy to Apple Health, and only when the user turns on Settings → Apple Health → Save Forge workouts. Forge reads Apple Health on the phone and saves daily summaries and each Apple Watch workout (time, length, calories, average and max heart rate, source name) to the user's own account. Resting energy stays on the phone. Say this in the review notes and keep it true.
- [ ] **Purpose strings** (already in `ios/App/App/Info.plist`):
  - `NSHealthShareUsageDescription` names every kind of data read, says that daily summaries and Apple Watch workouts are saved to the user's own account, and that Forge writes only finished Forge workouts with their active energy, only when turned on.
  - `NSHealthUpdateUsageDescription` is **required** since 0.16.50: Forge saves finished workouts and their active energy to Apple Health (the local `ForgeWorkouts` plugin asks for write access to Workouts and Active Energy). The text says exactly that. Keep it true: don't write anything else (no heart rate, no copies of Watch data).
- [ ] **HealthKit review notes.** Say what the Health data is used for (Readiness and the Forge Score), that Forge works without it, and give the reviewer a demo account with some data.
- [ ] **Screenshots** (6.9" and 6.5" iPhone), app icon (the 1024 px one is already in the project), age rating, category (Health & Fitness), support URL.
- [ ] **Export compliance.** Already answered in the project (`ITSAppUsesNonExemptEncryption` = false: the app only uses HTTPS).
- [ ] **Notifications.** The rest timer uses local notifications only: no push entitlement, nothing to configure.
- [ ] **Medical wording.** Readiness and insights say "not medical advice" in the app; keep it that way in the description. Don't claim to diagnose or treat anything.
- [ ] **Archive and upload.** Xcode → Product → Archive → Distribute App → App Store Connect → TestFlight first (internal testing for you and your wife).
