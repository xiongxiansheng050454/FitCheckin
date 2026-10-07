# Extended verification - 2026-10-04

## Automated integration

`npm test`: 39 passed, 1 optional external PostgreSQL suite skipped, 0 failures.
`npm run check:native`: 9 WXML and 10 WXSS files compiled successfully.

`tests/full-stack.test.js` connects the real store, cloud handler and migration RPCs through PGlite. Its five scenarios verify:

- Week overrides, cardio accounting, library/template edits and cancellation preserve a started daily snapshot.
- A committed write with a lost acknowledgement retries exactly once after an offline restart across Beijing midnight; the saved occurrence and original date remain intact.
- Independent device caches detect conflicts and support both reapplying local changes and adopting cloud data.
- Different daily snapshots cannot overwrite one another when resolving a conflict.
- Switching users isolates cached data; an invalid AppID disables writes.

The clock, connectivity, identities and device storage are controlled test fixtures. These results do not represent physical-phone or two-account acceptance.

## Native DevTools and deployed cloud

- Custom weighted exercise: 4 sets, 10 reps, 12.5kg, 90-second interval, back/biceps/shoulders proportions 70/15/15.
- Sets = 0 rejected with the valid-range message. Muscle proportions 69/15/15 rejected because the total was 99%; 70/15/15 saved successfully.
- Library search and long-name wrapping passed. See extended-editor.png and extended-library.png.
- Added the custom exercise through the plan editor's picker event channel. Copied, moved and removed actions; the remaining copy retained its own entry ID.
- Saved and activated the temporary template. On 2026-10-12, created a week override by duplicating its Monday action.
- Actual PostgreSQL readback: template Monday count = 1; override Monday count = 2; both revision 1.
- Invoked the normal restore/delete page methods with automated confirmation callbacks. Restoration removed the override indicator; deletion removed the template and custom exercise.
- Final cloud readback: temporary exercise, template and override have deleted = true at revision 2. Profile has null bodyWeight and null activeTemplateId.
- A native cloud refresh returned syncStatus = idle, pendingCount = 0 and no conflicts. Today has no active plan and no test daily record. extended-initial.png shows this final clean state.

No new product defect was demonstrated by this extended run. Product source and deployed function code were unchanged.

## Remaining Acceptance

Physical-phone offline restart, foregrounding across midnight, actual two-device conflicts, two-account isolation, safe-area/layout checks on additional phones and external PostgreSQL concurrent connections still require their respective environments.

The last actual WeChat preview package analysis remains: main 57,312 bytes; management 28,982 bytes; history 2,494 bytes; total 88,788 bytes. Product package source is unchanged. Check WeChat's actual package analysis again before upload. No upload or publication was performed.
