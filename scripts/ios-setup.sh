#!/usr/bin/env bash
# One-line setup for the Forge iPhone app on your Mac. From the Forge folder, paste:
#
#     bash scripts/ios-setup.sh
#
# It checks your Mac, installs what the app needs, builds the app's copy of Forge, and opens Xcode. Safe to run again
# any time (do that every week when the app stops opening, and after pulling new changes). It never changes your
# Forge data, and it prints plain words, not error dumps: the full details go to ios-setup.log.
# Steps are described in docs/ios-setup.md.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
LOG="$PWD/ios-setup.log"
: > "$LOG"

say()  { printf '\n%s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
stop() {
  printf '\n  ✗ %s\n' "$1"
  shift
  for line in "$@"; do printf '    %s\n' "$line"; done
  printf '\n    Fix that, then run this again: bash scripts/ios-setup.sh\n'
  printf '    (If it keeps happening, send Claude the file ios-setup.log in this folder.)\n\n'
  exit 1
}
# Run a command quietly; on failure say what was being done, in words.
run() {
  local what="$1"; shift
  printf '  … %s\n' "$what"
  if ! "$@" >> "$LOG" 2>&1; then
    stop "That didn’t work: $what." "The details are in ios-setup.log (in the Forge folder)."
  fi
}

say "Forge iPhone app setup"

# ---- 1. Your Mac ----
[ "$(uname -s)" = "Darwin" ] || stop "This has to run on your Mac, in Terminal." "Open Terminal on the Mac, go to the Forge folder and paste the line again."
[ "$(uname -m)" = "arm64" ] || stop "Xcode 27 needs a Mac with an Apple chip (M1 or newer)." "This Mac has an Intel chip, so it can’t build the app."
ok "Mac with an Apple chip"

# ---- 2. Xcode 27 ----
command -v xcodebuild > /dev/null 2>&1 || stop "Xcode isn’t installed." "Open the App Store on your Mac, search for Xcode, tap Get, and wait for it to finish (it’s large)." "Then open Xcode once, let it install what it asks for, and run this again."
XVER="$(xcodebuild -version 2> /dev/null | head -1 | sed -E 's/^Xcode ([0-9]+).*/\1/')"
case "$XVER" in
  ''|*[!0-9]*) stop "Xcode is installed but not set up yet." "Open Xcode once, agree to its terms, let it install its extras, then run this again." ;;
esac
[ "$XVER" -ge 27 ] || stop "Xcode $XVER is too old: the Forge app needs Xcode 27 or newer." "Open the App Store, search for Xcode and tap Update." "(Xcode 27 needs macOS Tahoe 26.6 or newer: update the Mac first in System Settings → General → Software Update.)" "If your iPhone is on an iOS beta, install the matching Xcode beta from developer.apple.com/download (a free Apple ID works)."
ok "Xcode $XVER"

if ! xcodebuild -license check > /dev/null 2>&1; then
  say "Xcode needs you to accept its license once. Your Mac will ask for its password (nothing shows while you type)."
  sudo xcodebuild -license accept || stop "The Xcode license wasn’t accepted." "Run this again and type your Mac password when asked."
fi
if ! xcodebuild -checkFirstLaunchStatus > /dev/null 2>&1; then
  say "Finishing Xcode’s first-time install (Mac password again, then a minute or two)."
  sudo xcodebuild -runFirstLaunch || stop "Xcode couldn’t finish its first-time install." "Open Xcode, let it install its components, then run this again."
fi
ok "Xcode license and first-launch done"

# ---- 3. Node 22 ----
command -v node > /dev/null 2>&1 || stop "Node.js isn’t installed." "Go to nodejs.org, download the LTS installer (version 22 or newer), open it, and click through." "Then close Terminal, open it again, and run this."
NVER="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
[ "$NVER" -ge 22 ] 2> /dev/null || stop "Node.js $NVER is too old: the app’s tools need version 22 or newer." "Go to nodejs.org, download the LTS installer, open it, and click through." "Then close Terminal, open it again, and run this."
ok "Node.js $(node -v)"

[ -f package-lock.json ] || stop "This isn’t the Forge folder (package-lock.json is missing)." "In Terminal, go to the Forge folder first (GitHub Desktop → Repository → Open in Terminal)."

# ---- 4. Install, build, sync ----
say "Installing and building (the first time takes a few minutes; it needs the internet)"
if [ -f node_modules/.package-lock.json ] && node -e '
const a = require("./package-lock.json").packages, b = require("./node_modules/.package-lock.json").packages;
const bad = Object.keys(b).some((k) => !a[k] || a[k].version !== b[k].version);
const miss = Object.keys(a).some((k) => k && !b[k] && !a[k].optional && !a[k].peer);
process.exit(bad || miss ? 1 : 0);' 2> /dev/null; then
  ok "The app’s tools are already installed"
else
  run "Installing the app’s tools" npm ci --no-audit --no-fund
fi
run "Building the app’s copy of Forge and downloading Firebase" npm run native:build
if [ ! -d ios ]; then
  run "Creating the Xcode project (first time only)" npx cap add ios
  run "Making the app icon and launch screen" npx capacitor-assets generate --ios --iconBackgroundColor '#040B0E' --splashBackgroundColor '#040B0E' --splashBackgroundColorDark '#040B0E'
  say "  ! The ios folder was missing, so it was made from scratch. In Xcode you must also add HealthKit by hand:"
  say "    App target → Signing & Capabilities → + Capability → HealthKit, and set the app to portrait only. (docs/ios-setup.md has the details.)"
fi
run "Copying Forge into the Xcode project" npx cap sync ios
ok "Forge is built and copied into the iPhone app"

# ---- 5. Open Xcode ----
say "Opening Xcode…"
npx cap open ios >> "$LOG" 2>&1 || stop "Xcode didn’t open." "Open the file ios/App/App.xcodeproj by double-clicking it in Finder."
# ---- 6. The weekly refresh button ----
if [ -d "$HOME/Desktop" ] && cp "scripts/Refresh Forge.command" "$HOME/Desktop/Refresh Forge.command" 2>> "$LOG" && chmod +x "$HOME/Desktop/Refresh Forge.command"; then
  ok "“Refresh Forge” is on your Desktop (double-click it every week)"
else
  say "  ! I couldn’t put “Refresh Forge” on your Desktop. Copy scripts/Refresh Forge.command there yourself."
fi

cat << 'DONE'

All set. In Xcode:
  1. Top left, click the blue "App" icon in the sidebar, then the "App" target, then "Signing & Capabilities".
  2. Team: pick "Your Name (Personal Team)".
  3. Plug in your iPhone, unlock it, tap Trust, and choose it in the device menu at the top.
  4. Press the ▶ button.
The full tap-by-tap guide is docs/ios-setup.md.

DONE
