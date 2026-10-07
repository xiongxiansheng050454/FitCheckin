# IronPlan poster verification - 2026-10-04

## Initial Native Workflow

Created a temporary Sunday plan with bench press 40kg x 10 x 3 and a 30-minute, 5km run. Completed both through the real today page. Daily totals were 1200kg, 2 completed actions, 30 cardio minutes and 5km; the completion notice exposed the poster button.

The deployed `posterCode` action returned code 0 and a valid official JPEG image (122288 base64 characters). Native Canvas 2D generated the day and month posters; exported image dimensions were 750 x 1200. Screenshots: poster-day-native.png and poster-month-native.png. Both showed the official code, IronPlan branding and correct statistics. The month poster marked October 4 complete and showed chest/shoulders/triceps estimates of 70/15/15. Muscle rendering includes all eight categories when present.

Cancelled one action to verify the daily poster entry is gated. Temporary data was removed after testing and the original profile restored. No mini program upload or publication was performed.

## Automated Coverage

`tests/poster.test.js` verifies frozen daily calculations (including 1200kg bench plus 1638kg pushups), incomplete/current-date gating, month selection, cardio-only and partial training days, pending-data labels, official image validation, failed-request retries, cache deduplication, native authorization, safe public errors, bounded text layout, all eight muscle groups, and album permission denial/retry with platform stubs.

Native WXML/WXSS compilation and project checks passed. Actual final WeChat preview package analysis: main 58105 bytes, management 28982, history 2494, sharing 13841, total 103422. Every package meets the 2MB limit; total is below 30MB.

Final `npm test`: 47 passed, 1 optional external PostgreSQL test skipped, 0 failures. Native compilation: 10 WXML and 11 WXSS files. Cleanup readback: temporary record count 0, template deleted, original profile restored; local queue 0 and conflicts 0.

## Social Poster Revision

The final canvas is 750 x 1320. The capacity number starts at 228px with weight 900, in lime against a dark header; larger values shrink to remain complete. Estimate labels move to the footer. Monthly muscle shares use a colorful donut. Both modes have five selectable captions; changing the caption regenerated the native exported image at a different path. Branding appears once, and the official code is drawn intact at 244 x 244 with dedicated white space. Its central avatar belongs to the official code and is not redrawn.

Native visual samples used temporary in-memory records, without saving workouts or changing cloud data. Daily sample: bench 1200kg plus pushups 1638kg, total 2838kg, and 30 cardio minutes/5km. Monthly sample: September 2026, 12 training days, 34056kg, 270 cardio minutes/45km, with chest/shoulders/triceps 70/15/15 and both partial and complete days. Returning to Today confirmed records 0, pending operations 0, conflicts 0 and the original unset profile.

Final raw native exports: [daily](poster-social-day.png) and [monthly](poster-social-month.png). Final page screenshots: poster-social-day-native.png and poster-social-month-native.png. These are layout fixtures, not actual user training history. Phone saving/sharing and external scanning after publication remain unverified.

## Acceptance Boundaries

Native DevTools image generation and layout were verified. Album permission transitions are automated with mocked platform callbacks, not a physical-phone album acceptance test. Actual image sharing and saving in WeChat on iOS/Android, older-version image menu behavior, external scanning after publication and additional device layouts remain to be verified on phones. Official QR generation success does not prove a currently unpublished release can be opened by another user.
