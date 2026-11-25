# Quiet Spaces — Android local notifications (v0.2.2)

Reminders use the native `@capacitor/local-notifications` plugin already bundled in the Android v0.2.0 APK. **No APK rebuild** is required for v0.2.2 if the phone has the OTA-capable APK installed. The web/PWA version does not request browser notification access.

## Consent, privacy and data

- Open **Settings → Reminders & exercise → Reminder preferences → Enable reminders**. Android asks permission only in response to this button or **Send test notification**.
- Preferences, including the enable flag and exercise reminder time, stay inside the existing AES-GCM encrypted journal vault. No new unencrypted database, background server, personal analytics, or remote synchronization.
- Notifications use a generic title/body by default when **Use discreet wording** is enabled. Even when disabled, notification text says only *Morning care*, *Evening care*, *Strength A/B*, or *Yoga* — never names of products, private journal content or personal notes.
- Turn reminders off at any time with **Disable reminders**. Only Quiet Spaces-managed pending notifications are cancelled; notifications owned by other apps are unaffected.

## Scheduled behavior

- AM defaults to **08:00**, PM to **21:30**; both existing preferences remain editable.
- Exercise reminders default to **18:00** and are editable under **Weekly Curves → Exercise reminder time**.
- One AM reminder and one PM reminder are scheduled per day **only when an enabled product is due** for that slot (respecting daily, every N days and selected-weekday frequency). Products with **Reminder preferred** unchecked do not trigger notifications.
- Exercise notifications follow your current Weekly Curves days (Strength A/B, yoga). Strength days take precedence over yoga when a day overlaps, matching the exercise screen.
- Completed/skipped products and fully completed exercise sessions suppress future reminder notifications for that date. Changes in completion, products, schedule or wording trigger a refresh.
- All notifications are device-local and can appear while the app is closed, provided Android allows them. They are scheduled as **inexact** reminders to avoid the Android exact-alarm special permission; delivery may be delayed by power management.
- The app schedules a **rolling 14-day horizon** (up to 42 reminders). Open/unlock Quiet Spaces at least once every 1–2 weeks to extend the horizon. This version does not schedule indefinite repeating alarms.
- If you change phone time zones, reboot, alter permissions or restore a backup, reopening/unlocking the app refreshes the schedule.

## Test procedure

1. Unlock Quiet Spaces and open Settings → Reminders & exercise.
2. Choose an exercise time and tap **Save preferences**.
3. Tap **Enable reminders** and accept the Android permission request.
4. Tap **Send test notification**, then return to the Android home screen. A test reminder is queued for around 15 seconds later, but Android may delay an inexact alarm.
5. Inspect the scheduled status count. Try changing your workout time and saving it, or checking off a routine; reopen Settings to verify updated reminders.
6. Test **Disable reminders** and verify the scheduled reminders are removed.

## Limitations

- An OTA update cannot add missing native Android permissions or plugins. This version relies only on the plugin already in the installed APK.
- If Android notifications are denied or suppressed by system battery policy, the app cannot override them.
- Notifications previously delivered in the Android notification shade will not automatically disappear when a later completion is logged; only future pending reminders are cancelled.
- The app cannot read encrypted routine details while locked. Already scheduled reminders remain active, and refresh resumes after unlocking.
- **Local test**: `npm run test:notifications` verifies schedule generation, data migration and native plugin mocks. Physical-device notification delivery still requires a manual check.

Technical API reference: https://capacitorjs.com/docs/apis/local-notifications
