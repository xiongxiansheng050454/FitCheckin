# Per-Set Training and Rest Acceptance

Implemented on 2026-10-05 in environment `weixing2-d7g2j6asyc5132905`.

## Behavior

Starting an action freezes the complete day snapshot and expands its planned sets. No volume is earned until the user confirms a performed set. The entire next-set row and its explicit completion button are tappable; future/completed rows cannot double-count. Confirmations must be sequential. The last confirmed set can be undone. Each set uses frozen planned reps, weight/coefficient or cardio duration/distance. At least one confirmed set counts as a training day and preserves continuity.

Confirmed non-final sets with a positive interval open a native full-screen rest view. It shows the remaining time, next set, today's accumulated volume, completed/planned sets and encouragement that changes every 15 seconds. The user can explicitly end rest early. A zero interval or an action's final set skips rest. The final set of the entire day triggers the existing native celebration and background poster preparation.

The local rest deadline, active action and notification state are saved under environment/user identity. Hide stops timers and screen wake; show recomputes from `endAt`. After expiry, the view stays ready until the user continues and displays encouraging return copy. Foreground expiry and overdue return each notify once for that rest. No background execution or notification is promised. Reopening the page/app restores a matching session. Midnight, account changes and conflicting group counts discard stale rest. Set progress remains in the persistent cloud sync queue; already-saved operations can synchronize after midnight, but new historical confirmations are forbidden.

## Automated Results

`npm test`: 71 passed, zero failures, zero skips. New cases verify 400 kg for one 40 kg/10 rep bench set and 546 kg for one 70 kg/0.65/12 rep push-up set, partial muscle allocation, cardio partial duration, training days/continuity, no credit on start, ordered confirmations, duplicate rejection, offline restart/midnight replay, frozen values after plan edits, completion consistency, timestamp recovery, row tapping, foreground expiry and vibration deduplication. Existing document transactions, account/environment isolation, conflicts and poster tests remain enabled.

`npm run check` passed. Native compilers passed 11 WXML and 12 WXSS files. Actual WeChat preview: main 100,821 bytes; management 28,982; history 2,580; sharing 6,457; total 138,840 bytes. All packages meet the 2 MB individual and 30 MB total hard limits and development budgets.

## Native Evidence

`scripts/native-training-ui.js` runs the real Today page and store against an isolated in-memory transport identity. It verifies expansion without credit, 400/800/1,200 kg increments, full-screen rest, overdue return, one-time vibration calls, final celebration and stored counts. Its cleanup restored the real cloud transport, account and zero pending operations, then removed its local test cache/session/celebration mark. It did not create cloud training fixtures or alter the user's real profile, plans or records.

Screenshots: [expanded sets](training-sets.png), [expired return](training-returned.png), [completion](training-complete.png). [Countdown layout](training-countdown.png) is a temporary native layout sample showing 01:29; its frame data was restored immediately afterward. The countdown computation and timer progression were verified by automated lifecycle tests; the native rest also naturally reached expiry while the screenshot workflow ran.

The actual new cloud function advertised `setProgressSupported:true`. Native cloud probes sent a valid one-set payload with an impossible base revision and received `CONFLICT`, then received the same receipt on retry. Invalid count 4 for a 3-set plan returned `VALIDATION`. Readback confirmed the real day's record was unchanged. A conflict receipt remains for retry consistency; there was no training record to remove. This verifies real cloud schema validation and receipt behavior without modifying current workout data; the full write path was exercised in the local transaction integration test.

## Phone Acceptance Remaining

Actual vibration feel, screen wake/lock, WeChat backgrounding or process termination and simultaneous devices still require physical-device acceptance. The current native screenshot viewport was 528x1142 pixels. No Mini Program upload or publication was performed.
