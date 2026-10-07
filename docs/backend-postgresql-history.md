# IronPlan backend deployment

Poster support adds the authenticated `posterCode` action. Deploy `config.json` with `permissions.openapi = ["wxacode.getUnlimited"]`; the native deployment applies this permission. The action calls `cloud.openapi.wxacode.getUnlimited` for a fixed `pages/today/index` destination, scene `ironplan`, `envVersion: "release"` and `checkPath: false`. It returns a validated PNG/JPEG as base64, caches successful results within the function instance, and exposes a bounded error on failure. It does not receive or publish training data. The official API succeeded from the native mini program on 2026-10-04. External scanning of the release code requires a published mini program and remains a release acceptance check.

Completion feedback adds optional profile `scheduleHistory` validation and `scheduleHistorySupported:true` in bootstrap/pull responses. It uses the existing JSONB profile table and optimistic mutation RPC; no migration, new table, credentials, runtime dependency or permission change is required. Legacy profile bodies remain accepted. The client only starts history writes after receiving the capability, so frontend updates remain compatible with an older deployed function.

This compatible function update was approved and deployed on 2026-10-05 in the previous environment `weixing-d0gbveybk32254e8d`. Native bootstrap returned code 0 and the new capability flag; the original profile and zero saved training records were confirmed by readback. These results do not verify the new target environment.

Native history-field save/pull/restore passed after deployment. The final profile matched its original value, with zero training records, pending operations and conflicts. The test retains normal profile revisions and operation receipts.

## Historical PostgreSQL Target and Prerequisites

- CloudBase environment: `weixing2-d7g2j6asyc5132905`. Its AppID association is confirmed; PostgreSQL provisioning and migration history remain unverified because the current MCP credentials lack `tcb:DescribeEnvInfo`. DevTools reports no cloud functions in this environment.
- Native WeChat application: `wxe25930a2cdce35d0`.
- Event Function: `fitcheckin`, runtime `Nodejs18.15` or a supported newer Node Event runtime, timeout at least 60 seconds, memory 256 MB or greater.
- Function root: the workspace `cloudfunctions` directory. Entry: `fitcheckin/index.js` (`exports.main`). Cloud deployment installs the function's `wx-server-sdk` dependency from `package.json`.
- Secret function environment variable `CLOUDBASE_API_KEY`: a CloudBase **API Key** mapping to PostgreSQL `service_role`. A publishable key or user token is insufficient. Configure it through the CloudBase console/management API, never in a tracked file, miniprogram package, CLI argument, response, or log.
- Confirm the service role has `BYPASSRLS` using read-only role inspection. The migration enables and forces RLS with no client policies.

In the previous environment, the original migration `20261004090000` failed with PostgreSQL `42601` while compiling the mutation function; remote history and public objects were verified empty after its complete rollback. Its SQL is retained unchanged under `tests/fixtures/` to reproduce the failure without entering future migration scans. Corrected migration `20261004094500` was applied and verified there on 2026-10-04 (task `task-6abee80a`).

The previous environment's native DevTools deployment created an Event function using its default `Nodejs16.13` runtime, 256 MB memory. Its business code and installed SDK were active, timeout was configured to 60 seconds, and the server key was configured. Native bootstrap, profile/template writes, checkbox records, pull, duplicate operations, revision conflicts and immutable snapshots were verified there through actual `wx.cloud.callFunction` and PostgreSQL readback. The code uses native HTTPS and supports that runtime; new deployments should select Node 18 or newer when the deployment interface offers a runtime choice. No public HTTP gateway or anonymous access was enabled.

## Migration and deployment

1. Inspect PG objects, existing migration versions and `pg_roles`. The initial migration deliberately uses `CREATE TABLE`, so it fails on existing incompatible names instead of silently accepting them. Preserve existing data and select a newer migration version if remote history is newer.
2. For a fresh environment, plan and apply `cloudbase/migrations/20261004094500_fitcheckin_entities.sql` through the CloudBase versioned migration workflow. MCP uses `managePgDatabase(action="planMigration"/"applyMigration", envId="weixing2-d7g2j6asyc5132905", migrationVersion="20261004094500", migrationName="fitcheckin_entities", sql=<exact saved SQL>)`; application requires the normal explicit confirmation argument. First inspect the new target's history; only the previous environment is known to have this version. Do not retry failed version `20261004090000`. The corrected file adds parentheses around the `CASE` expression in the PL/pgSQL version comparison; real PostgreSQL execution verifies the correction.
3. Verify migration history and inspect all six tables (five entities plus operation receipts), the union view, and both functions. Check backend-only grants before deploying the app.
4. Create the **Event** function with name `fitcheckin`, runtime, timeout and function root above. MCP: `manageFunctions(action="createFunction", func={name:"fitcheckin",type:"Event",runtime:"Nodejs18.15",timeout:60,memorySize:256}, functionRootPath=<absolute cloudfunctions path>)`. Existing functions use `updateFunctionCode`; runtime changes require recreation.
5. Inject `CLOUDBASE_API_KEY` via `updateFunctionConfig`/console, merging existing environment variables. Keep native SDK invocation available for the approved mini program. Do not enable anonymous invocation or add a public HTTP gateway.
6. Bootstrap and mutate from the actual authorized mini program using `wx.cloud.callFunction({name:'fitcheckin',data:{action:...}})`. A console call without a native OPENID must return `AUTH_REQUIRED`. Verify a different APPID returns `FORBIDDEN`.
7. Read the resulting rows back through management tooling. Check two real users cannot see each other's entities. Verify exact retry, differing-payload operation reuse, simultaneous revisions, deletes and frozen record snapshots through the mini program path.

## REST and function interfaces

The server uses the documented PG endpoint, never NoSQL:

```text
POST https://weixing2-d7g2j6asyc5132905.api.tcloudbasegateway.com/v1/rdb/rest/rpc/fitcheckin_mutate
Authorization: Bearer <server API Key>
Content-Type: application/json

{"p_owner":"<native OPENID>","p_operation":{...operation}}

POST https://weixing2-d7g2j6asyc5132905.api.tcloudbasegateway.com/v1/rdb/rest/rpc/fitcheckin_pull
{"p_owner":"<native OPENID>","p_after_kind":"","p_after_id":"","p_limit":100}
```

`fitcheckin_pull` returns `{entities:[...],cursor:null|{kind,id}}`. The function follows every cursor; a short page or 1,000 rows does not imply completion. Keyset ordering uses the PostgreSQL `C` collation. Concurrent edits can change earlier rows during the page walk; subsequent refreshes converge using revisions. There is no cross-page transaction snapshot or incremental change token.

`fitcheckin_mutate` returns `{code:0,entity}` or `{code:'CONFLICT',entity:null|entity}`. Entity envelope: `{kind,id,body,revision,deleted}`. All five physical entity tables use `(owner_id,entity_id)` as their primary key. The only owner passed to PostgreSQL comes from `cloud.getWXContext().OPENID`, with an exact native APPID check. Event `openid`, `owner`, tokens, application IDs and alternate endpoints cannot affect authorization.

Public function actions:

```js
{ action: 'bootstrap' } // {code:0,data:{openid,entities}}
{ action: 'pull' }      // {code:0,data:{openid,entities}}
{ action: 'mutate', operation: {
  operationId, kind, id, body, deleted, baseRevision, occurredAt
} } // {code:0,data:{entity}} or {code:'CONFLICT',message,data:{entity}}
```

Other bounded error codes: `AUTH_REQUIRED`, `FORBIDDEN`, `VALIDATION`, `OPERATION_REUSED`, `IMMUTABLE_RECORD`, `DB_ERROR`. Messages exclude SQL details, credentials and runtime context. Clients resolve a conflict by issuing a **new** operation ID against the returned revision. Reusing a conflict operation ID returns its original conflict result, even if the cloud entity has since changed.

Deletes require `body:null`; revisions increase and tombstones remain visible during pull. Profiles and records cannot be deleted. Operation receipts retain the complete JSONB payload and original result indefinitely so old offline retries remain idempotent; do not prune receipts or tombstones without designing a compatible retention protocol. Object key order and equivalent JSONB number representations do not change payload equality; changing any logical field, including `occurredAt` or `baseRevision`, is rejected when an operation ID is reused.

## Validation and dates

Nested schema validation is authoritative in the Event Function. Unknown entity/operation fields are rejected. Names are 1..60 characters; IDs use ASCII letters, digits, `_` and `-` with at most 100 characters. Payloads are at most 512 KiB. Exercises require their relevant fields plus `sets`, `restSeconds` and `muscles`; provided irrelevant fields must also be well formed. Bounds: sets 1..100, reps 1..10000 for strength, weight 0..2000 kg, bodyweight coefficient >0..2, rest 0..3600 seconds, cardio duration >0..1440 minutes, distance 0..2000 km. Intensity is text of at most 60 characters. Body weight is null or >0..500 kg. Strength muscles use the eight approved domain IDs, unique positive percentages totaling 100. Cardio accepts an empty muscle array.

Templates and overrides contain exactly seven arrays of at most 50 exercise snapshots each. `entryId` values must be unique per day. Override IDs must be valid Monday dates. Record completed IDs must be unique members of their immutable snapshot. A bodyweight record requires a snapshotted body weight.

Record ID, `date`, operation occurrence and `startedAt` use the same **Asia/Shanghai** day. `startedAt` cannot follow occurrence; occurrence cannot be in the future. An old operation persisted offline is accepted later as long as its original occurrence belongs to that record day. The server cannot independently prove when an offline operation was first persisted; the mini program enforces today-only creation/editing, while the backend preserves snapshots and rejects mismatched dates. Every record field except `completed` is compared in the database transaction after its first creation; unchecking everything retains the snapshot.

The database transaction uses separate operation and entity advisory locks, validates ownership arguments, retains successful/conflicting/immutable results, and serializes absent-row creation as well as updates. A service key is a privileged credential; the function is the boundary that validates client nested fields. Direct `anon`/`authenticated` access to tables, view and RPC is revoked.

## Verification

Install the root development dependencies and run the backend suites:

```powershell
npm install
node --test tests/backend.test.js tests/backend-pglite.test.js
```

`backend-pglite.test.js` runs PostgreSQL through `@electric-sql/pglite` without an external server. It reproduces the original `42601`, verifies rollback, applies the corrected migration, executes both RPCs, and checks retries, payload reuse, revisions, tombstones, owner isolation, frozen records, Beijing date rules, 1,005-row pagination and backend-only grants. These tests run as part of `npm test`; they do not skip when a server is unavailable.

The optional external multi-connection PostgreSQL suite was removed on 2026-10-05 after the application switched to document database. The retained PGlite tests use one connection and do not verify simultaneous external PostgreSQL connections.

After deployment verify role privileges, for example:

```sql
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role');
SELECT has_table_privilege('anon','public.fitcheckin_records','SELECT'),
       has_table_privilege('authenticated','public.fitcheckin_entities','SELECT'),
       has_function_privilege('anon','public.fitcheckin_mutate(text,jsonb)','EXECUTE'),
       has_function_privilege('authenticated','public.fitcheckin_pull(text,text,text,integer)','EXECUTE');
-- All four privilege results must be false.
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname IN ('fitcheckin_profiles','fitcheckin_exercises','fitcheckin_templates',
                   'fitcheckin_overrides','fitcheckin_records','fitcheckin_operations');
```

Native DevTools identity and real CloudBase PostgREST smoke tests passed. Two physical devices using distinct WeChat accounts and simultaneous external PostgreSQL connections remain unverified. Large accounts return all entities in one Event Function response; monitor the platform response-size/time limits as records grow and introduce an explicitly versioned paginated public sync protocol before that limit is reached.
