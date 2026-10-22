# Forge as an iPhone app: setup, tap by tap

The same Forge code runs inside a thin native iPhone shell (Capacitor). The web app on GitHub Pages doesn't change, and nothing new is deployed to Firebase. You build the app on your Mac with Xcode and install it on your own iPhone.

| | Web app (Home Screen) | iPhone app |
|---|---|---|
| Haptics | Only the "switch trick" ticks, in some places | Real Taptic Engine taps on buttons, tabs and "rest's over" |
| Rest timer when the phone is locked | Frozen until you come back | "Rest's over · Next: Bench press" notification on the lock screen |
| Apple Health | Shortcut, or an export.zip import | Reads Apple Health directly. No Shortcut. Reads again by itself when you open Forge (every 6 hours at most) |
| Opens offline | Yes (service worker) | Yes (the files and Firebase are inside the app) |
| Withings sign-in | Leaves the app for Safari | Opens over Forge; tap Done to come back |
| Look and feel | A web page in a frame | App icon, launch screen, no bounce, no link previews, keyboard-aware sheets, portrait only |

Same account, same data, same server.

## What it costs

**Nothing, to try it on your own iPhone and your wife's.** A free Apple ID (a "Personal Team" in Xcode) is enough, **including Apple Health (HealthKit)**. Apple's [capabilities table](https://developer.apple.com/help/account/reference/supported-capabilities-ios) lists HealthKit for the free tier. Local notifications (the rest timer) need no capability at all. Only push notifications and Time Sensitive notifications are paid-only, and Forge uses neither.

The free tier has one catch: **the app stops opening after 7 days** and has to be reinstalled: double-click **Refresh Forge** (see "Every week" below). Your data is not affected.

The $99 Apple Developer Program (under your LLC) is for three things: **TestFlight** (install on both phones without a cable), **no weekly re-install**, and the **App Store** (see `docs/app-store-checklist.md`).

## One-time setup (about 45 minutes, most of it the Xcode download)

You need: a Mac with an Apple chip (M1 or newer) on **macOS Tahoe 26.6 or newer**, your iPhone and its cable, and the Forge folder (the one GitHub Desktop made).

### 1. Install Xcode
1. On the Mac, open the **App Store** (blue icon with an "A"). In the search box at the top left type **Xcode**.
2. Click **Get** (or the cloud icon), then **Install**. It's large (tens of gigabytes); this is the slow part.
3. When it finishes, click **Open**. Xcode shows a license window: click **Agree** and type your Mac password.
4. Xcode may say it needs to install "additional components" or a platform. Click **Install** and wait. When asked which platforms to download, make sure **iOS 27** is ticked, then click **Download & Install**.
5. Quit Xcode (Xcode menu at the top left → Quit).

**Your iPhone runs a beta (for example iOS 27.2 beta)?** If Xcode later says "iOS 27.2 isn't supported" or "needs a newer version of Xcode", install the matching Xcode **beta**: go to developer.apple.com/download, sign in with your Apple ID (a free one is fine), and download the Xcode beta. Open it instead of the App Store one and repeat step 3 and 4.

### 2. Check Node.js
Open **Terminal** (press ⌘-Space, type Terminal, press Return). Type `node -v` and press Return. It should show **v22** or higher. If it says "command not found" or a lower number, go to **nodejs.org**, click the big **LTS** download, open the file, and click Continue until it finishes. Then close Terminal and open it again.

### 3. Run the setup script
1. In **GitHub Desktop**, make sure the branch is the one with this app (main after the merge). Click **Repository → Open in Terminal**. A Terminal window opens already in the Forge folder.
2. Paste this one line and press Return:
   ```
   bash scripts/ios-setup.sh
   ```
3. It prints a ✓ for each thing it checks: your Mac, Xcode, Node. Then it installs and builds (a few minutes the first time; it needs the internet). If your Mac asks for its password, type it (nothing shows while you type) and press Return.
4. At the end **Xcode opens** with Forge.

If it prints a ✗, it says in plain words what to do. Fix that and paste the line again: the script is safe to run as many times as you like.

### 4. Sign in to Xcode with your Apple ID
1. In the menu bar at the top of the screen click **Xcode → Settings…** (or press ⌘-comma).
2. Click **Accounts** (the person icon at the top of the window).
3. Click the **+** at the bottom left, choose **Apple ID**, click **Continue**, and sign in with your Apple ID. Close the settings window.

### 5. Pick your team
1. In Xcode's left sidebar, click the **blue "App" icon at the very top**.
2. In the middle, under **TARGETS**, click **App**, then the **Signing & Capabilities** tab at the top.
3. Under **Signing**, next to **Team**, open the menu and pick **Your Name (Personal Team)**.
4. You should see **HealthKit** already listed below (the project comes set up). You don't type anything else.
5. **Bundle Identifier** stays `com.christianeverett.forge`. If Xcode says it "is not available", add `.test` to the end. (It becomes your LLC's ID before the App Store.)

### 6. Your iPhone
1. **Plug the iPhone into the Mac.** Unlock it. If it asks "Trust This Computer?" tap **Trust** and enter your passcode.
2. In Xcode, at the very top middle there's a device menu (it says "App > Any iOS Device" or a simulator name). Click it and choose **your iPhone**.
3. **Developer Mode:** on the iPhone open **Settings → Privacy & Security**, scroll to the bottom, tap **Developer Mode**, turn it **On**. The phone restarts. Unlock it, and when it asks, tap **Turn On** and enter your passcode.
4. In Xcode press the **▶ button** at the top left (or ⌘-R). The first build takes a few minutes. Forge appears on the phone's Home Screen with the Forge icon.
5. The phone will say "Untrusted Developer" when you open it. Go to **Settings → General → VPN & Device Management**, tap your Apple ID under "Developer App", tap **Trust**, then **Trust** again. Open Forge from the Home Screen.

### 7. Allow notifications and Apple Health
- The first rest timer asks to send notifications: tap **Allow**.
- Optional: **Settings → Apple Health → Save Forge workouts to Apple Health** (off by default) sends each workout you finish to Apple Health so it fills your Move and Exercise rings. If your Apple Watch is recording the same session, Forge links to that workout instead. After pulling 0.16.50, run **Refresh Forge** once: it adds a small native plugin (`ForgeWorkoutsPlugin.swift`).
- In Forge: **Settings → Apple Health → Connect Apple Health**. iOS shows its Health sheet: tap **Turn On All**, then **Allow**. Forge says how many days it saved, and Readiness fills in.

## Try these on the phone

1. **Sign in.** Your own account, same data as the web app.
2. **Tabs and buttons:** tap between tabs for a light tick. Start a workout and tap **Done set**: a firmer tap.
3. **Lock-screen rest timer:** finish a set, then lock the phone. When the rest ends a "Rest's over · Next: …" notification appears. While Forge is open you only hear the in-app beep.
4. **Apple Health:** the card shows which kinds arrived. Wrist temperature and cardio fitness need an Apple Watch that records them.
5. **Withings:** Settings → Withings opens over the app. Close it with **Done** and you're back in Forge. (The sign-in page is Safari's, so Forge can't close it for you.)
6. **Offline:** turn on Airplane Mode, force-quit Forge and open it. It opens and shows your data.
7. **Feel:** no rubber-band bounce, no link previews, no text highlighting on buttons, the keyboard never covers the weight or set field, a swipe from the left edge goes back once.

Tell me how the feel compares with the Home Screen web app. That's the point of this test.

## Every week: the 7-day refresh

With a free Apple ID the app **stops opening after 7 days** (it bounces back to the Home Screen or says "Unable to verify app"). Forge counts it down: **Settings → iPhone app → App refresh** shows the exact date and the days left (tap it for these steps and a **Remind me** button, which asks for notifications the first time), and Today shows a "Forge needs its weekly refresh" banner with the real deadline from the day before.

1. **Plug in** the iPhone (or have it on the same Wi-Fi, if you turned on "Show this iPhone when on Wi-Fi" in Xcode → Window → Devices and Simulators).
2. **Unlock** it and keep the screen on.
3. **Double-click "Refresh Forge"** on the Mac mini's Desktop.

It switches Forge to the `main` version, pulls the newest code, rebuilds the app, signs it again and installs it on your iPhone, without opening Xcode. It prints a ✓ for each step and ends with the real date, for example "Forge is refreshed: good until Fri, Oct 16 at 6:12 PM." (it clears Forge's old signing profile first, so every refresh really gets a fresh 7 days; if it can't get a full one, it says so). If a step fails it says in words what to do (unlock the phone, plug it in, turn on Developer Mode…). Every step's details go to `refresh-forge.log` in the Forge folder (`~/forge-app`); if it keeps failing, send refresh-forge.log in your Forge chat (not on GitHub: it has your iPhone's ID).

**Same file, any iPhone.** Plug in your wife's iPhone instead (one phone at a time) and double-click the same file: it registers her phone with your Personal Team automatically. The first time on her phone, turn on Developer Mode (Settings → Privacy & Security → Developer Mode; the phone restarts), and after the install trust your Apple ID once (Settings → General → VPN & Device Management).

The Desktop file is put there by `bash scripts/ios-setup.sh` (run that again to get a newer copy after Forge changes the refresh steps). The first time, macOS may ask you to allow it: right-click it → Open → Open. If your Forge folder isn't `~/forge-app`, open the file in a text editor and change `REPO` at the top.

**Your data stays.** It lives in your Forge account, not in the app. (Paying the $99 and using TestFlight ends this.)

## Her iPhone

Same steps, with **her iPhone plugged into your Mac**: steps 6.1 to 6.5, and she signs in to Forge with her own account. A Personal Team can have up to **3 devices**, so yours, hers and one spare. She does her own weekly re-install, so plug her phone in the same day as yours.

## When to pay the $99

Enrol the LLC in the Apple Developer Program (needs a D-U-N-S number) when you want:
- **TestFlight:** install on both phones with no cable, builds last 90 days.
- **No weekly re-install.**
- **The App Store.**

Then change the Bundle Identifier to your company's (e.g. `com.yourllc.forge`), pick the LLC as the Team, and follow `docs/app-store-checklist.md`. Archive with Xcode → Product → Archive → Distribute App → TestFlight.

## After a code change

```
bash scripts/ios-setup.sh
```
then **▶** in Xcode. (The iPhone app carries its own copy of Forge, so GitHub Pages updates don't reach it until you do this. TestFlight builds will make that automatic later.) For a quick rebuild without the checks: `npm run native:sync`.

## When something goes wrong

| What you see | What to do |
|---|---|
| Script says **Xcode N is too old** | App Store → Updates → Xcode. Needs macOS Tahoe 26.6+: System Settings → General → Software Update first. |
| Script says **Node.js is too old / not installed** | nodejs.org → LTS installer. Close and reopen Terminal. |
| Xcode: **"Signing for 'App' requires a development team"** | Step 5: pick your Personal Team on the Signing & Capabilities tab. |
| Xcode: **"Failed to register bundle identifier"** or "not available" | Add `.test` to the Bundle Identifier on the Signing & Capabilities tab. |
| Xcode: **"Developer Mode disabled"** | Phone: Settings → Privacy & Security → Developer Mode → On (step 6.3). |
| Xcode: **"iOS 27.x isn't supported" / "needs a newer Xcode"** | Install the matching Xcode beta from developer.apple.com/download (a free account works). |
| Xcode: **"Could not locate device support files"** or the phone isn't in the menu | Unplug, unlock the phone, plug in again, tap Trust. Wait a minute while Xcode "prepares" the device. |
| Xcode: **"No such module"** or a missing package | In Terminal paste `bash scripts/ios-setup.sh`, then in Xcode choose **File → Packages → Reset Package Caches** and press ▶ again. |
| Phone: **"Untrusted Developer"** | Settings → General → VPN & Device Management → your Apple ID → Trust. |
| Phone: **"Unable to verify app"** or the app closes straight away | It's the 7-day limit: double-click **Refresh Forge** ("Every week" above). |
| Xcode: **"Your account has reached the limit of 10 App IDs per 7 days"** | A free-account limit: wait a few days, or pay for the program. |
| Sign-in fails with "API key" or "referer" errors | Google Cloud console → APIs & Services → Credentials → the browser key → add `capacitor://localhost` to the allowed websites (or lift the restriction for the test). |
| No haptics | iPhone Settings → Sounds & Haptics → System Haptics on; Forge Settings → Haptic tick on. |
| No rest notification | iPhone Settings → Notifications → Forge → Allow Notifications. |
| Apple Health says nothing was shared | Settings → Health → Data Access & Devices → Forge → **Turn On All**, then **Read Apple Health now** in Forge. |
| Workout not in Fitness | Check Health → Data Access & Devices → Forge → Workouts / Active Energy (write), and that **Settings → Apple Health → Save Forge workouts to Apple Health** is on. |
| The Connect button says Apple Health isn't available | Run the script again and press ▶; if it still says so, send Claude the Xcode console lines about "Health". |

## What's in the repo

- `ios/`: the Xcode project, already set up: HealthKit entitlement (`App.entitlements`), the Apple Health privacy text and portrait-only in `Info.plist`, the Forge icon and dark launch screen. You never edit these by hand.
- `capacitor.config.json`: app name, bundle ID, launch screen and keyboard behaviour.
- `package.json` + `package-lock.json`: Capacitor 8 and its plugins (Haptics, Local Notifications, Status Bar, Browser, Splash Screen, Keyboard, `@capgo/capacitor-health`), pinned so `npm ci` installs exactly what was tested.
- `scripts/ios-setup.sh`: the one-line setup. `scripts/Refresh Forge.command`: the weekly one-click refresh (setup copies it to the Desktop). `scripts/build-www.mjs`: builds `www/`, the copy of Forge that goes inside the app (and downloads Firebase's code so it opens offline). `scripts/make-assets.mjs`: makes the 1024 px icon and the splash from `icons/icon-512.png`.
- `js/native/bridge.js`: the only place the app talks to the native side. In a browser every function there does nothing. `js/native/health.js`: HealthKit → the same daily summaries the export import makes.
