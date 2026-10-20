#!/bin/bash
# Builds a double-clickable Mac app for this game, inside the game folder: <game>/<App Name>.app
# Usage: tools/make-app.sh "<App Name>" "<emoji>"
# Example: tools/make-app.sh "Bubble Pop" "🫧"
set -euo pipefail
GAMEDIR="$(cd "$(dirname "$0")/.." && pwd)"
GAME="$(basename "$GAMEDIR")"
NAME="${1:?app name, e.g. \"Bubble Pop\"}"
EMOJI="${2:-🎮}"

APP="$GAMEDIR/$NAME.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BUILD="$TMP/$NAME.app"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

cat > "$BUILD/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>local.kidgames.$GAME</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$BUILD/Contents/MacOS/launch" <<'LAUNCH'
#!/bin/bash
# The app lives in the game folder; fall back to where it was built if it was moved.
GAMEDIR="$(cd "$(dirname "$0")/../../.." && pwd)"
[ -x "$GAMEDIR/tools/launch.sh" ] || GAMEDIR="__GAMEDIR__"
exec "$GAMEDIR/tools/launch.sh"
LAUNCH
sed -i '' "s|__GAMEDIR__|$GAMEDIR|" "$BUILD/Contents/MacOS/launch"
chmod +x "$BUILD/Contents/MacOS/launch"

# icon
swift "$GAMEDIR/tools/make-icon.swift" "$EMOJI" "$TMP/icon.png"
ICONSET="$TMP/AppIcon.iconset"
mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$BUILD/Contents/Resources/AppIcon.icns"

# replace any previous build of this app
if [ -d "$APP" ]; then mv "$APP" "$TMP/old.app"; fi
mv "$BUILD" "$APP"
touch "$APP"
echo "Built $APP"
