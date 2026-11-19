# Quiet Spaces — Android APK (Capacitor 8)

This branch adds a first **Android build foundation**, not a tested or signed release. Existing GitHub Pages PWA files remain the source of truth.

## 1. Back up your journal first

Before installing an APK, open the existing phone PWA, unlock it, and use **Settings → Backup & privacy → Download backup**. Keep this encrypted JSON file outside the phone as well. Do not put the file or your password in this public GitHub repository.

The APK uses its own WebView storage. It **will not inherit** Chrome PWA IndexedDB entries, skincare records, or exercise history automatically. After installing, restore the encrypted backup in the APK and check your content. **Keep the PWA installed** until imports, exports, and native backup support have been tested.

## 2. Windows 11 requirements

- Node.js **22+** (required for Capacitor 8), from https://nodejs.org/en
- Android Studio **2025.2.1+**, from https://developer.android.com/studio
- Android SDK Platform (minimum API 24; SDK 36 is the Capacitor 8 target), Build Tools, and Platform Tools
- A USB-debuggable Android phone or Android emulator; Android Studio provides a suitable JDK

## 3. First-time Android project

Open PowerShell in this repository, and run:

```powershell
npm install
npm run build:android-web
npx cap add android
npx cap open android
```

Let Android Studio perform its Gradle sync. Select **Build → Build Bundle(s) / APK(s) → Build APK(s)** to produce a debug APK at approximately:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The output is a **debug test APK**. For a stable, installable update path, generate a **signed release APK** using a long-term keystore stored privately outside GitHub. Never commit a key or a backup file.

When you later change the HTML/CSS/JavaScript:

```powershell
git pull
npm install
npm run android:sync
npm run android:open
```

Do not run `npx cap add android` again if the Android project already exists. `npm install` creates `package-lock.json`, which should be committed after you verify dependencies.

## Alternative: build a debug APK in GitHub Actions

This branch includes `.github/workflows/android-debug.yml`. On the pull request, GitHub Actions can compile a **debug-only** Android APK using Node 22 and JDK 21. If the run succeeds, open the GitHub **Actions** tab, select the **Android debug APK** run, and download the `quiet-spaces-debug-apk` artifact. Extract its ZIP to obtain `app-debug.apk`.

This is only a temporary build for initial testing. GitHub-hosted runners may create a different debug signing key on different runs; trying to install the next debug APK over the previous one can fail, and uninstalling would erase the APK's private data. **Do not move your primary journal to repeated debug APK installations.** Use a stable release signing key for long-term daily use.

## 4. How this repository is organized

- Root web assets remain the published PWA source.
- `scripts/build-android-web.mjs` stages a native copy to generated `www/`.
- `capacitor.config.json` names the app and points to `www/`.
- `android/` is generated on the first local setup; keep its source under version control but exclude build artifacts and signing keys.
- `sw.js` is intentionally excluded from the APK. The PWA update checker is skipped in the Capacitor runtime to avoid interfering with native plugins.
- Native application ID is provisionally `io.github.jeandhipixel.quietspaces`. Decide on a stable ID before distributing an APK: changing it later creates a different Android application.

## 5. What remains

**First APK test:** unlock, journal writing, tracking, offline navigation, restore from encrypted JSON, and Android Back behavior.

**Native backups:** The PWA's automatic folder backup requires Chrome's File System Access API and may not work in Android WebView. We must build a reliable native export/share and restore flow before the APK can replace your current PWA. Until then, the PWA is the primary data copy.

**Reminders:** `@capacitor/local-notifications` is installed by npm but is not yet wired to your settings. The next step is AM/PM and exercise scheduling, Android notification permission handling, cancel/reschedule behavior, and discreet lock-screen text. Delivery to the exact minute can be restricted by Android.

**Stable release:** Test on your phone, keep a private keystore, then build a signed release APK. GitHub Pages updates do not automatically update the APK.

## Official references

- https://capacitorjs.com/docs/getting-started
- https://capacitorjs.com/docs/android
- https://capacitorjs.com/docs/apis/local-notifications
- https://developer.android.com/build/build-for-release
