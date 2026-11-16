# Quiet Pages — private Android journal (PWA)

Quiet Pages is a small installable web app, not an APK. Its **code** is hosted as static files, while **journal entries stay encrypted in the browser's local storage on your device**. No server/API, no analytics, no third-party libraries.

## Install on an Android phone (easy route: GitHub Pages)

1. Create a **new public GitHub repository** named `quiet-pages` (or any other name).
2. Upload all the files **inside** this ZIP's `QuietPages-PWA` folder to the **root of the repository**. Include the `icons` folder. Don't just upload the ZIP itself.
3. In GitHub, open **Settings → Pages**. Under **Build and deployment**, select **Deploy from a branch**, then `main` and `/(root)`, and save.
4. Visit the HTTPS site GitHub Pages shows you, typically `https://YOURNAME.github.io/quiet-pages/`, using **Chrome on your Android phone**. GitHub may need time to publish the first deployment.
5. Open Chrome's **⋮ menu → Install app** (or **Add to Home screen**). Launch Quiet Pages from your app launcher/home screen.
6. Open the app **online at least once** before switching offline. Once cached, it opens without Internet.
7. Create a strong password you can remember. Save an **encrypted backup** occasionally via **Backup & privacy**.

**Important:** your GitHub repository contains the application code only, **not** your diary entries. Don't upload backup files, journals or passwords to the repository. A public repository is fine for these generic app files, but if someone gains control of the hosted JavaScript they could change what the app does on a future visit. Only use a hosting account you trust, and protect it with MFA.

## Test locally on Windows

Open this folder in a terminal and run:

```sh
py -m http.server 8000
```

Then visit `http://localhost:8000` in Chrome on your computer. `localhost` is allowed for service workers and encryption. If Python is not installed, a local static-file server extension in VS Code will work at `localhost`.

## Features

- Daily journal: date navigation, custom title, free-text entry.
- Mood check-in: Great, Good, Okay, Low, Rough.
- Search and browse prior entries.
- Automatic encrypted saving (short debounce as you type).
- Password-derived AES-256-GCM encryption (PBKDF2-SHA-256; 310,000 iterations).
- Export and restore **encrypted** backups (`.json`).
- Works offline after the first online visit via Service Worker.
- No account, network data synchronization, permission requests, or advertisements.

## Security and limitations

- This is a personal prototype, **not independently security-audited**. Use a strong, unique password; your password is never stored, but its strength matters against offline guessing attacks on an exported backup.
- Lost passwords **cannot be reset or recovered**. Journal data cannot be decrypted without them.
- Uninstalling or clearing Chrome's site data, changing origin/website address, or device loss can permanently erase entries. Browser storage may also be cleared by the system. **Export regular backups.** Do not rely on browser storage as the only copy.
- The app's code is publicly hosted; encryption only protects the journal text at rest. Do not assume it protects you against malware, a compromised phone, or malicious changes to your hosting account.
- No biometrics, multi-device sync, image attachments, or built-in reminder notifications in v1.
- Journal content remains decrypted in memory while the diary is unlocked. Tap the lock button when finished.
- The app uses browser localStorage, which has a size limit (typically several MB). It is designed for a modest text-only journal.
- Each date supports one entry. Past and future dates are allowed.
- This app does not require an Android SDK or Play Store account. For a fully native APK later, the app would need an Android project and an APK build/signing step.

## Files

- `index.html` — user interface.
- `styles.css` — responsive design.
- `app.js` — editor, encryption, backups.
- `sw.js` — offline shell cache.
- `manifest.webmanifest` — Android app installation metadata.
- `icons/` — app icons.

## Everyday use

Wait until **All changes saved** appears before you force-close Chrome or power off your phone. For extra protection against phone loss or cleared site data, export an encrypted backup regularly and keep a copy outside the phone. You will need the same password to restore it.
