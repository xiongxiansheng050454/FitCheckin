# IronPlan Document Database Deployment

Target: `weixing2-d7g2j6asyc5132905`; AppID: `wxe25930a2cdce35d0`; Event function: `fitcheckin`.

The backend uses CloudBase document database through `wx-server-sdk`, with the Event function's runtime credentials. It does not use PostgreSQL, SQL RPCs, or `CLOUDBASE_API_KEY`. Mini Program pages do not access the database directly. Existing PostgreSQL migrations and regression tests remain as historical artifacts; see [previous deployment](backend-postgresql-history.md).

## Shared Resources and Isolation

CloudBase's shared document instance tier shares computing resources while keeping environments' data separate. Reusing one environment for several Mini Programs also requires each AppID to be associated or granted resource-sharing access; choosing the shared tier does not authorize applications automatically. Code does not select a billing tier.

IronPlan uses dedicated collections and trusted `appId` and `ownerId` fields. Document IDs hash `(appId, ownerId, kind, entityId)` or `(appId, ownerId, operationId)`. Reads filter both identities; transaction reads verify them. The deployed `fitcheckin` function only accepts IronPlan's AppID. Future applications should use their own named function, AppID validation and collection prefix. Sharing the environment does not share fitness data; resource quotas and backend administration are shared, and privileged functions must enforce application boundaries.

Client caches and queues use `fitcheckin:<environment>:<openid>`. Old environment data remains in storage without automatic migration or replay. Historical PostgreSQL records are not imported by this change.

## Required Setup

1. Confirm the environment's document database is available. Select the shared instance tier in the CloudBase console according to the environment's plan.
2. Create `fitcheckin_entities` and `fitcheckin_operations`. Set both to **all users cannot read/write**, or custom rules `{"read":false,"write":false}`. The Event function still accesses them with runtime credentials. Creator read/write is insufficient because it permits direct document creation that bypasses server validation.
3. Create a non-unique compound index on `fitcheckin_entities`: `appId` ascending, `ownerId` ascending, `sortKey` ascending. Pull uses identity equality plus a range/order on `sortKey`. Default unique `_id` indexes handle entity and receipt lookups.
4. Deploy `cloudfunctions/fitcheckin` as an Event function. Prefer Node 18 or newer where offered; set timeout to 60 seconds and memory at least 256 MB. Install the locked dependencies remotely. Preserve `config.json` permission `wxacode.getUnlimited`. No database API Key is required.
5. From the authorized Mini Program, verify bootstrap, profile/template writes, today check/uncheck, pull, duplicate operations, stale-revision conflicts and frozen snapshots. Read rows back and restore temporary profile content. Keep receipts and tombstones for offline retries. Do not enable anonymous invocation or public HTTP access.
6. Verify direct client database reads/writes are denied. Other-AppID denial is tested locally; cross-application resource sharing requires native acceptance when the second AppID is available. Physical-phone and two-account acceptance still apply.

## Stored Documents

`fitcheckin_entities`: `_id`, `appId`, `ownerId`, `sortKey`, `kind`, `id`, `body`, `revision`, `deleted`. The five kinds remain profile, exercise, template, override and record. `sortKey` is `kind:id`; permitted IDs are ASCII and exclude `:`. Deleted entities remain as tombstones with `body:null`.

`fitcheckin_operations`: `_id`, `appId`, `ownerId`, `payload`, `result`. Entity updates and operation receipts commit in one transaction. Exact retries return the prior result; changed payloads with the same operation ID return `OPERATION_REUSED`. Conflict and immutable-record results are also persisted. Do not prune receipts without a compatible retention strategy.

Mutations read the receipt and entity by ID, check revision and immutable record snapshot, then atomically commit both writes. CloudBase retries transaction conflicts; the persistent client queue handles lost acknowledgements. Only `completed` and optional `completedSets` may change on a saved record; canonical comparison preserves array order. Legacy action-only records remain valid. Set counts must be integers from zero through the frozen planned count, belong to known entry IDs, and agree with completed action IDs. Bootstrap/pull advertise `setProgressSupported:true`; clients require it before starting or confirming sets. Server validation retains Beijing day boundaries, bodyweight requirements, counts and muscle proportions.

## API and Pagination

Actions remain `bootstrap`, `pull`, `mutate`, and `posterCode`. Native `getWXContext().APPID/OPENID` authorize requests; caller fields cannot override them. Response envelopes and schedule-history capability remain compatible.

Pull walks scoped keyset pages of at most 100 entities including tombstones. A full page yields a cursor and can lead to a final empty page. The function collects pages before returning; refreshes reconcile concurrent edits by revision. This is not a cross-page transaction snapshot. Very large accounts may eventually need client-visible pagination to remain below WeChat's response limit.

## Verification

```powershell
npm install --prefix cloudfunctions/fitcheckin --ignore-scripts
npm test
npm run check
npm run check:native -- --devtools "E:/wx_project/微信web开发者工具"
```

Local tests model document transaction atomicity, conflict retries, pagination, application/user isolation and store synchronization. An installed-SDK test runs real SDK serialization against mocked transport, and skips if function dependencies are absent. Neither substitutes for cloud permission and runtime acceptance. See [progress](progress.md) for current deployment results.

## Current Deployment and Local Management

The per-set backend update was deployed on 2026-10-05 using the local MCP connection, and the existing Event function's timeout was increased from 3 to 60 seconds. Its existing Nodejs16.13 runtime and 256 MB memory remain in place. Native calls confirmed the new capability and validation of partial set payloads, identical retry receipts and rejection of out-of-range counts. These cloud probes deliberately used an impossible base revision, so the current day's actual record was unchanged. Full set writes, snapshot protection and offline replay are covered by the local store/handler/document transaction integration suite; see [training acceptance](training-testing.md) for evidence and limitations.

On 2026-10-05, the target reported NoSQL runtime enabled and PostgreSQL unavailable. The document Event function was deployed through WeChat DevTools (7 files, 20.8 KB). Both collections' permissions were set to `ADMINONLY` and read back successfully; the non-unique `app_owner_sort` index was created and verified.

Native acceptance passed bootstrap, profile/exercise writes, duplicate receipts, reused-payload rejection, stale revision conflicts, pull and caller-identity spoof protection. Temporary exercises were tombstoned and the profile restored with canonical readback comparison. No training records or active acceptance fixtures remained. Direct Mini Program reads and writes to both collections each returned permission denial `-502003`. Today refreshed with confirmed identity, zero pending operations and no error. `posterCode` returned code 0 and a JPEG (122,248 base64 characters).

CloudBase MCP now uses a local process targeting this environment and Shanghai region. Its management API Key is saved only in the Windows user environment variable `CLOUDBASE_API_KEY`; the launcher reads it at startup. The global Codex TOML contains no credential literal. Restart Codex to load the new standard MCP connection. This session verified management operations using `scripts/cloudbase-mcp-client.js`; the previously connected remote MCP remains stale until reload and must not be used for target writes. The business Event function uses runtime credentials and requires no management API Key.
