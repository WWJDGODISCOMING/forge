#!/usr/bin/env bash
# Refresh Forge: the one-click weekly re-install of the Forge iPhone app (a free Apple ID signs it for 7 days only).
# scripts/ios-setup.sh puts a copy of this file on your Desktop. Plug in your iPhone (or have it on the same Wi-Fi
# if you paired it for that), unlock it, and double-click. It updates Forge, rebuilds the app, signs it again and
# installs it on the phone without opening Xcode. Your Forge data is not touched. Details: docs/ios-setup.md.
# The full details of every step go to refresh-forge.log in the Forge folder.

# A .command opened from Finder doesn't always get Homebrew's folders on its PATH (a working Node would look missing).
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="${FORGE_DIR:-$HOME/forge-app}"
BRANCH="main"
TEAM_FILE="$HOME/.forge-refresh-team"

wait_key() { printf '\n  Press any key to close this window. '; read -r -n 1 -s; printf '\n'; }

if [ ! -d "$REPO/.git" ]; then
  printf '\n  ✗ I can’t find the Forge folder at %s.\n    Run "bash scripts/ios-setup.sh" in your Forge folder first, or open this file in a text editor and set REPO at the top.\n' "$REPO"
  wait_key; exit 1
fi
cd "$REPO" || exit 1
LOG="$PWD/refresh-forge.log"
STEP="$(mktemp -t forge-refresh-step)" # outside the repo, so git never sees it. The output of the step that is running now: the error advice below reads only this, never the whole log
: > "$LOG"
: > "$STEP"
trap 'rm -f "$STEP"' EXIT

say()  { printf '\n%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
stop() {
  printf '\n  ✗ %s\n' "$1"
  shift
  for line in "$@"; do printf '    %s\n' "$line"; done
  printf '\n    Fix that, then double-click Refresh Forge again.\n'
  printf '    (If it keeps happening, send refresh-forge.log in your Forge chat (not on GitHub: it has your iPhone’s ID).)\n'
  wait_key; exit 1
}
# Run a command quietly, keeping its output in $STEP (then added to the log); on failure say what was being done, in words.
step_run() { # step_run <command…>: output → $STEP and the log, returns the command's status
  { printf '\n$ %s\n' "$*"; } >> "$LOG"
  "$@" > "$STEP" 2>&1
  local rc=$?
  cat "$STEP" >> "$LOG"
  return $rc
}
run() {
  local what="$1"; shift
  printf '  … %s\n' "$what"
  if ! step_run "$@"; then
    stop "That didn’t work: $what." "The details are in refresh-forge.log (in the Forge folder)."
  fi
}
# Only the failing step's own output ($STEP) is read, with specific phrases from devicectl / xcodebuild, so a
# normal build warning can never be mistaken for a phone problem.
phone_help() {
  if grep -qiE 'The device is locked|device is locked|passcode protected' "$STEP"; then stop "$1" "Your iPhone is locked. Unlock it (and keep the screen on), then try again."
  elif grep -qiE 'Developer Mode is disabled|Developer Mode is not enabled' "$STEP"; then stop "$1" "Turn on Developer Mode: iPhone Settings → Privacy & Security → Developer Mode → On (the phone restarts)."
  elif grep -qiE 'not been trusted|is not trusted|Trust This Computer|not paired|pairing (is required|failed)' "$STEP"; then stop "$1" "Plug the iPhone in, unlock it and tap Trust when it asks."
  elif grep -qiE 'no space left|not enough (free )?space|insufficient (free )?storage' "$STEP"; then stop "$1" "The iPhone is full. Free up some space in iPhone Settings → General → iPhone Storage."
  elif grep -qiE 'Could not connect to the device|device is not connected|Unable to connect to device|connection to the device timed out' "$STEP"; then stop "$1" "Plug the iPhone into the Mac with its cable, unlock it, and wait a few seconds."
  else stop "$1" "Make sure the iPhone is plugged in and unlocked." "The details are in refresh-forge.log (in the Forge folder)."
  fi
}

say "Refreshing Forge on your iPhone"

# ---- 1. Mac, Xcode, Node ----
[ "$(uname -s)" = "Darwin" ] || stop "This has to run on your Mac."
command -v xcodebuild > /dev/null 2>&1 || stop "Xcode isn’t installed." "Run \"bash scripts/ios-setup.sh\" in the Forge folder first."
xcrun --find devicectl > /dev/null 2>&1 || stop "Xcode is too old to install on a phone from here." "Open the App Store and update Xcode."
command -v node > /dev/null 2>&1 || stop "Node.js isn’t installed." "Go to nodejs.org, download the LTS installer and open it. Then close this and double-click Refresh Forge again."
command -v git > /dev/null 2>&1 || stop "Git isn’t installed." "Run \"bash scripts/ios-setup.sh\" in the Forge folder first."
ok "Mac, Xcode and Node are ready"

# ---- 2. Your Apple team (kept before the update, which resets Xcode's local edits to the project) ----
TEAM="${FORGE_TEAM_ID:-}"
[ -n "$TEAM" ] || TEAM="$(cat "$TEAM_FILE" 2> /dev/null)"
[ -n "$TEAM" ] || TEAM="$(grep -o 'DEVELOPMENT_TEAM = [A-Z0-9]\{10\}' ios/App/App.xcodeproj/project.pbxproj 2> /dev/null | head -1 | awk '{print $3}')"
[ -n "$TEAM" ] || TEAM="$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2> /dev/null | grep -o 'teamID = [A-Z0-9]\{10\}' | head -1 | awk '{print $3}')"
[ -n "$TEAM" ] || stop "I don’t know your Apple team yet." "Open Xcode once, pick your Personal Team under App → Signing & Capabilities (docs/ios-setup.md, step 5), close Xcode, and double-click Refresh Forge again."
printf '%s\n' "$TEAM" > "$TEAM_FILE"
ok "Apple team found"

# ---- 3. Update Forge ----
# Xcode writes your team into the project file; that's the only local edit allowed (it's put back by the build below).
git checkout -- ios/App/App.xcodeproj/project.pbxproj >> "$LOG" 2>&1
run "Checking for the newest Forge (needs the internet)" git fetch origin
# Anything changed in this folder is a leftover of a build (nobody edits these files by hand): put it aside, keep going.
stash_leftovers() {
  if git stash push -u -m "Refresh Forge $(date +%Y-%m-%d)" >> "$LOG" 2>&1; then
    printf '\n(Local leftovers were put aside with git stash on %s.)\n' "$(date +%Y-%m-%d)" >> "$LOG"
    printf '  … Put aside some leftovers from an earlier build\n'
    return 0
  fi
  return 1
}
switch_to_main() {
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then git checkout "$BRANCH"; else git checkout -B "$BRANCH" "origin/$BRANCH"; fi
}
if [ "$(git rev-parse --abbrev-ref HEAD 2> /dev/null)" != "$BRANCH" ]; then
  printf '  … Switching Forge to the main version\n'
  if ! step_run switch_to_main; then
    stash_leftovers && step_run switch_to_main
  fi
  [ "$(git rev-parse --abbrev-ref HEAD 2> /dev/null)" = "$BRANCH" ] || stop "I couldn’t switch Forge to the main version." "The details are in refresh-forge.log (in the Forge folder)."
fi
if ! step_run git pull --ff-only; then
  stash_leftovers && step_run git pull --ff-only || stop "That didn’t work: getting the newest Forge." "The details are in refresh-forge.log (in the Forge folder)."
fi
ok "Forge is up to date ($(cat js/version.js | grep -o "[0-9]*\.[0-9]*\.[0-9]*" | head -1))"

# ---- 4. Build the app's copy of Forge (same steps as scripts/ios-setup.sh) ----
if [ -f node_modules/.package-lock.json ] && node -e '
const a = require("./package-lock.json").packages, b = require("./node_modules/.package-lock.json").packages;
const bad = Object.keys(b).some((k) => !a[k] || a[k].version !== b[k].version);
const miss = Object.keys(a).some((k) => k && !b[k] && !a[k].optional && !a[k].peer);
process.exit(bad || miss ? 1 : 0);' 2> /dev/null; then
  :
else
  run "Installing the app’s tools (needs the internet)" npm ci --no-audit --no-fund
fi
run "Building the app’s copy of Forge (needs the internet)" npm run native:build
run "Copying Forge into the iPhone app" npx cap sync ios
ok "Forge is built"

# ---- 5. Find the iPhone ----
DEVICES="$PWD/.devices.json"
rm -f "$DEVICES"
xcrun devicectl list devices --json-output "$DEVICES" >> "$LOG" 2>&1
UDID_NAME="$(node -e '
const fs = require("fs");
let d = []; try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).result.devices || []; } catch (e) {}
const phones = d.filter((x) => (x.hardwareProperties || {}).deviceType === "iPhone" && (x.hardwareProperties || {}).reality !== "virtual");
const state = (x) => (x.connectionProperties || {}).tunnelState;
const paired = phones.filter((x) => (x.connectionProperties || {}).pairingState === "paired");
const pick = paired.find((x) => state(x) === "connected") || paired.find((x) => state(x) !== "unavailable");
if (pick) console.log(pick.hardwareProperties.udid + "\t" + ((pick.deviceProperties || {}).name || "your iPhone"));
' "$DEVICES" 2> /dev/null)"
rm -f "$DEVICES"
if [ -z "$UDID_NAME" ]; then
  stop "I can’t see your iPhone." "Plug it into the Mac with its cable, unlock it, and tap Trust if it asks." "(Wi-Fi works too, but only if you turned on \"Show this iPhone when on Wi-Fi\" for it in Xcode → Window → Devices and Simulators.)"
fi
UDID="${UDID_NAME%%$'\t'*}"
NAME="${UDID_NAME#*$'\t'}"
ok "Found your iPhone: $NAME"

# ---- 6. Build, sign and install ----
BUILD="$PWD/build/ios"
APP="$BUILD/Build/Products/Debug-iphoneos/App.app"
BUNDLE_ID="com.christianeverett.forge"
# -allowProvisioningDeviceRegistration lets a phone Xcode hasn't seen yet (your wife's) be added to the Personal Team.
build_app() {
  step_run xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -destination "id=$UDID" -derivedDataPath "$BUILD" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic build
}
build_failed() {
  if grep -qE 'No Account for Team|Signing for "App" requires a development team|No profiles for '"'$BUNDLE_ID'" "$STEP"; then
    stop "Xcode isn’t signed in to your Apple ID." "Open Xcode → Settings → Accounts, sign in with your Apple ID, close Xcode, then try again."
  elif grep -qiE 'The device is locked|passcode protected|Developer Mode is disabled|Could not connect to the device' "$STEP"; then phone_help "The Mac couldn’t reach your iPhone."
  elif grep -qiE '10 App IDs|App ID limit|maximum number of (registered )?App IDs' "$STEP"; then
    stop "Apple’s free-account limit was reached (10 new app IDs per 7 days)." "Wait a few days and try again."
  else
    stop "The app didn’t build." "The details are in refresh-forge.log (in the Forge folder)."
  fi
}
# Xcode reuses a still-valid cached signing profile, which would re-embed the one that runs out soon. Remove only
# Forge's cached profiles (matched by their app ID inside); -allowProvisioningUpdates then fetches a fresh 7-day one.
remove_forge_profiles() {
  local dir f appid removed=0
  for dir in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
    [ -d "$dir" ] || continue
    for f in "$dir"/*.mobileprovision "$dir"/*.provisionprofile; do
      [ -f "$f" ] || continue
      appid="$(security cms -D -i "$f" 2> /dev/null | plutil -extract Entitlements.application-identifier raw -o - - 2> /dev/null)"
      case "$appid" in
        *."$BUNDLE_ID") rm -f "$f" && removed=$((removed + 1)); printf 'Removed the old signing profile %s (%s)\n' "$f" "$appid" >> "$LOG" ;;
      esac
    done
  done
  printf 'Removed %s old Forge signing profile(s).\n' "$removed" >> "$LOG"
}
read_expiry() { security cms -D -i "$APP/embedded.mobileprovision" 2> /dev/null | plutil -extract ExpirationDate raw -o - - 2> /dev/null; }
has_expiry() { node -e 'try { process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).expires ? 0 : 1); } catch (e) { process.exit(1); }' "$APP/public/app-install.json" 2> /dev/null; }

remove_forge_profiles
printf '  … Building and signing the app (a few minutes)\n'
build_app || build_failed

# The signing profile says exactly when the app stops opening. Put that date into the app (Settings and the
# Today banner show it), then build again: only the app's files changed, so this is quick.
EXPIRES="$(read_expiry)"
if [ -n "$EXPIRES" ] && [ -d ios/App/App/public ]; then
  if node -e '
const fs = require("fs"), f = process.argv[1];
const j = JSON.parse(fs.readFileSync(f, "utf8"));
j.expires = new Date(process.argv[2]).toISOString();
fs.writeFileSync(f, JSON.stringify(j) + "\n");' ios/App/App/public/app-install.json "$EXPIRES" >> "$LOG" 2>&1; then
    build_app || build_failed
    # A changed file inside the "public" folder reference isn't always re-copied on an incremental build: check it, and
    # nudge once if it wasn't. The countdown inside the app must agree with the profile.
    if ! has_expiry; then
      printf '\nThe expiry date was not copied into the app; touching the public folder and building once more.\n' >> "$LOG"
      touch ios/App/App/public ios/App/App/public/app-install.json
      build_app || build_failed
    fi
    has_expiry || {
      printf '\nNote: the app’s own countdown could not be updated (it will count 7 days from the build). The real date is shown below.\n' >> "$LOG"
      COUNTDOWN_OFF=1
    }
  fi
fi
[ -d "$APP" ] || stop "The app didn’t build." "The details are in refresh-forge.log (in the Forge folder)."
ok "The app is built and signed"

printf '  … Installing on %s (keep it unlocked)\n' "$NAME"
if ! step_run xcrun devicectl device install app --device "$UDID" "$APP"; then
  phone_help "The install on $NAME didn’t work."
fi
ok "Installed on $NAME"

# The real end date comes from the signing profile; "7 more days" is only said when it can't be read.
EXP_EPOCH=""
[ -n "$EXPIRES" ] && EXP_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$EXPIRES" +%s 2> /dev/null)"
if [ -n "$EXP_EPOCH" ]; then
  LEFT=$((EXP_EPOCH - $(date +%s)))
  PRETTY="$(date -r "$EXP_EPOCH" '+%a, %b %-d at %-I:%M %p')"
  if [ "$LEFT" -lt $((6 * 86400)) ]; then
    printf '\nForge is installed, but it is NOT a full refresh: it only lasts until %s.\n' "$PRETTY"
    printf 'Xcode handed back an older signing than expected. Double-click Refresh Forge again in a minute; if this keeps happening, send refresh-forge.log in your Forge chat (not on GitHub: it has your iPhone’s ID).\n'
  else
    printf '\nForge is refreshed: good until %s.\n' "$PRETTY"
  fi
else
  printf '\nForge is refreshed: good for 7 more days.\n'
fi
# Start Forge again so a copy that was already open doesn't keep showing the old version. The phone must be unlocked;
# if this Xcode has no --terminate-existing, or the launch fails, the last line asks you to reopen it yourself.
RELAUNCHED=""
if xcrun devicectl device process launch --help 2> /dev/null | grep -q -- '--terminate-existing'; then
  step_run xcrun devicectl device process launch --terminate-existing --device "$UDID" "$BUNDLE_ID" && RELAUNCHED=1
fi
[ -n "${COUNTDOWN_OFF:-}" ] && printf '(The countdown inside Forge may be off by a day or so this time.)\n'
if [ -n "$RELAUNCHED" ]; then printf '(Forge was restarted on the phone, so it already shows the new version.)\n'; else printf '(If Forge was open on the phone, close and reopen it.)\n'; fi
printf '(Your Forge data is untouched. Open Forge on the phone. If it says "Untrusted Developer", trust your Apple ID once in Settings → General → VPN & Device Management.)\n'
wait_key
exit 0
