#!/usr/bin/env bash
# Build and (optionally) install the Solar EV Android app without Gradle, using only the Android SDK.
#   android/build.sh             # build android/out/solar-ev.apk
#   android/build.sh install     # build, then install and start it on the USB / wireless adb device
# Needs JDK 17 and the Android SDK (platform-tools, platforms;android-35, build-tools;35.0.0).
# The app opens APP_URL; default http://<this PC's LAN IP>:<PORT>/app/?key=<APP_KEY> from .env.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME}/Android/Sdk}"
BT="$SDK/build-tools/35.0.0"; JAR="$SDK/platforms/android-35/android.jar"; ADB="$SDK/platform-tools/adb"
JAVA_HOME="${JAVA_HOME:-$(ls -d "/c/Program Files/Microsoft/jdk-17"* 2>/dev/null | head -1)}"
J="$JAVA_HOME/bin"
env_get() { sed -n "s/^$1=//p" ../.env 2>/dev/null | tr -d '\r' | head -1; }
if [ -z "${APP_URL:-}" ]; then
  ip=$(powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Wi-Fi,Ethernet -ErrorAction SilentlyContinue | Where-Object PrefixOrigin -in 'Dhcp','Manual' | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r' || true)
  [ -n "$ip" ] || ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  key=$(env_get APP_KEY); port=$(env_get PORT)
  APP_URL="http://$ip:${port:-8787}/app/${key:+?key=$key}"
fi
echo "App URL: $APP_URL" | sed "s/key=.*/key=…/"

rm -rf out/build && mkdir -p out/build/gen out/build/classes out/build/res/values
cp -r res/* out/build/res/
cat > out/build/res/values/config.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources><string name="app_url" translatable="false">${APP_URL//&/&amp;}</string></resources>
XML
"$BT/aapt2" compile --dir out/build/res -o out/build/res.zip
"$BT/aapt2" link -o out/build/base.apk -I "$JAR" --manifest AndroidManifest.xml out/build/res.zip \
  --java out/build/gen --min-sdk-version 30 --target-sdk-version 35 --version-code "$(date +%s | cut -c1-9)" --version-name 1.0
"$J/javac" -nowarn -source 11 -target 11 -classpath "$JAR" -d out/build/classes \
  src/ev/solar/app/*.java out/build/gen/ev/solar/app/R.java 2>&1 | grep -v "^warning\|^1 warning\|bootstrap" || true
( cd out/build && JAVA_HOME="$JAVA_HOME" "$BT/d8.bat" --lib "$JAR" --min-api 30 --output . $(find classes -name '*.class') )
( cd out/build && "$BT/aapt" add base.apk classes.dex >/dev/null )
"$BT/zipalign" -f -p 4 out/build/base.apk out/build/aligned.apk
KS=out/debug.keystore
[ -f "$KS" ] || "$J/keytool" -genkeypair -keystore "$KS" -storepass android -keypass android -alias debug \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Solar EV debug" >/dev/null 2>&1
JAVA_HOME="$JAVA_HOME" "$BT/apksigner.bat" sign --ks "$KS" --ks-pass pass:android --out out/solar-ev.apk out/build/aligned.apk
echo "Built android/out/solar-ev.apk ($(du -k out/solar-ev.apk | cut -f1) KB)"

if [ "${1:-}" = install ]; then
  "$ADB" install -r out/solar-ev.apk
  "$ADB" shell am start -n ev.solar.app/.MainActivity
fi
