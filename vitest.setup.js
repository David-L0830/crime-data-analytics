// Barangay 178 works in Philippine calendar dates, and several helpers format
// through the host's local timezone — formatDateTime and formatClockTime call
// toLocaleString/toLocaleTimeString with no explicit timeZone. Without a pin,
// the same assertion passes here and fails in CI: GitHub Actions runs UTC, and
// '2026-08-14T05:07:00Z' renders as "1:07 PM" in Manila but "5:07 AM" in UTC.
//
// This is done in a setup file rather than the config's `test.env` block or the
// npm script. `test.env` was measured NOT to populate process.env.TZ, and an
// inline `TZ=... vitest` prefix in the npm script does not work on Windows cmd
// without adding cross-env. Assigning process.env.TZ here runs before any test
// imports a helper, and Node picks the change up.
process.env.TZ = 'Asia/Manila';
