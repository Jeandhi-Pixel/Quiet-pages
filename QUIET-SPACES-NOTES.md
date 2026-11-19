# Quiet Spaces integration notes

Feature branch only — not deployed until reviewed and merged.

The journal's original IndexedDB name and encryption envelope remain unchanged. Routine data is encrypted as part of the existing journal payload and therefore included in its normal encrypted backups. Legacy backup files lacking a `routines` field open with default routines.

Products, schedules, AM/PM time windows, history, and weekly exercises are editable in the application. No OS notification permission is requested in this phase; reminder preferences are placeholders for later Capacitor local notifications.

Before merging: test upgrade on a copy of the existing profile, encrypted exports/imports, local restore points, offline service-worker upgrade, and mobile layout. Export a current encrypted journal backup first.
