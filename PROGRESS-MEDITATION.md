# Quiet Spaces — Progress calendar and meditation (v0.2.3)

This feature adds two top-level tabs: **Meditation** and **Progress**. It runs entirely offline in the existing web app and the OTA-enabled Android APK. **No Android plugin or native permission change is required.**

## Progress

- **Monthly calendar:** browse previous/next months or jump to today. Each date shows colored dots for activity recorded on that day.
- **Journal (green):** any existing journal entry with a title, body or mood counts as a journal day.
- **Exercise (purple):** any Weekly Curves exercise marked **Done** counts as an exercise day. The detail panel reports how many exercises were marked done.
- **Skincare (rose):** any skin/haircare application marked **Done** counts as a skincare day. A product marked **Skipped** does not count.
- **Meditation (gold):** any logged meditation duration counts as a meditation day. The panel displays the minutes.
- Tap a date to see its four details. Select **Log meditation for this day** to open the meditation form on that date.
- Monthly summary shows **active days**, journal days, exercise days, skincare days, meditation days, and total meditation minutes. Each day counts once per category regardless of the number of actions recorded.
- These are records of actions, not grades, streaks or medical measures. You can navigate historic months even if no activities were logged.

## Meditation

- Choose a date or tap Today.
- Select a duration of 5, 10, 15, 20 or 30 minutes, or enter any whole number from **1 to 600 minutes**.
- Tap Save meditation to record the duration. One **total duration per day** is stored; saving again replaces that date's previous value.
- Tap Remove entry to clear a day's meditation time after confirmation.
- Recent meditations lists up to 12 recorded days; tap one to edit it.

## Encrypted data, compatibility, and backups

- Meditation data is added as `routines.meditations` inside the **existing encrypted vault**. It uses the same journal AES-GCM encryption, IndexedDB save path, backup export, restore points and restore format.
- The vault format remains `version:1` and existing `routines.version:1`; older encrypted backups without meditation data open with an empty meditation history while preserving existing entries, product routines, workout completions and notification settings.
- An invalid date, non-integer duration, duration outside 1–600 minutes, or malformed history is ignored when a restored vault is normalized.
- The calendar only reads encrypted data **after unlocking**. No tracking data, journal text or meditation history is uploaded to GitHub, Capgo, or the update server.
- A failed meditation save restores the previous in-memory value and shows an error; do not force-close before the save confirmation.

## OTA deployment

- Merge the feature branch, then publish v0.2.3 using a separate `ota/requests/v0.2.3.json` release request.
- Your phone's **Settings → Reminders & exercise → About & updates → Check for updates** will offer v0.2.3. Because the new code uses only web assets, a new APK is not required.
- After the update installs, unlock the app and look for the Meditation and Progress tiles below the original three tiles. Verify a sample 10-minute meditation creates a gold marker in the monthly calendar.

## Regression checks

- `npm run test:progress` covers old data migration, date/duration validation, calendar counting, encrypted save hooks, editing/removing meditation days, and failed-save rollback.
- `npm run test:notifications` continues validating existing Android reminder scheduling.
- GitHub Actions stages progress.js for offline Android usage and performs full Capacitor Android compilation and OTA ZIP packaging checks.
