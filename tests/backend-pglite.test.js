'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const readMigration = version => fs.readFileSync(path.join(__dirname, `../cloudbase/migrations/${version}_fitcheckin_entities.sql`), 'utf8');
const roles = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;';
const exercise = { id: 'bench', name: 'Bench', type: 'weighted', sets: 3, reps: 10, weight: 40, restSeconds: 60, muscles: [{ id: 'chest', percent: 100 }] };
const operation = (operationId, extra = {}) => ({ operationId, kind: 'exercise', id: 'bench', body: exercise, deleted: false, baseRevision: 0, occurredAt: '2020-10-04T03:00:00Z', ...extra });
async function mutate(db, owner, op) {
  const result = await db.query('SELECT public.fitcheckin_mutate($1, $2::jsonb) AS result', [owner, JSON.stringify(op)]);
  return result.rows[0].result;
}
async function pull(db, owner, cursor = { kind: '', id: '' }) {
  const result = await db.query('SELECT public.fitcheckin_pull($1,$2,$3,100) AS result', [owner, cursor.kind, cursor.id]);
  return result.rows[0].result;
}

test('PostgreSQL reproduces failed PL/pgSQL CASE parsing and executes the corrected migration', async () => {
  const db = new PGlite();
  try {
    await db.exec(roles);
    const failedSql = fs.readFileSync(path.join(__dirname, 'fixtures/20261004090000_fitcheckin_entities.sql'), 'utf8');
    await assert.rejects(db.exec(failedSql), error => error.code === '42601' && /syntax error at end of input/.test(error.message));
    await db.exec('ROLLBACK;');
    const rolledBack = await db.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fitcheckin_%'");
    assert.equal(rolledBack.rows[0].count, 0);
    await db.exec(readMigration('20261004094500'));
    const tables = await db.query("SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fitcheckin_%'");
    assert.equal(tables.rows[0].count, 6);
    const functions = await db.query("SELECT count(*)::integer AS count FROM pg_proc WHERE proname IN ('fitcheckin_mutate','fitcheckin_pull')");
    assert.equal(functions.rows[0].count, 2);
  } finally { await db.close(); }
});

test('embedded PostgreSQL executes dedupe, revision conflicts, owner isolation, frozen records, pagination and grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(roles); await db.exec(readMigration('20261004094500')); await db.exec('SET ROLE service_role;');
    const first = await mutate(db, 'owner-a', operation('same')); assert.equal(first.code, 0); assert.equal(first.entity.revision, 1);
    assert.deepEqual(await mutate(db, 'owner-a', operation('same')), first);
    assert.equal((await mutate(db, 'owner-a', operation('same', { body: { ...exercise, weight: 50 } }))).code, 'OPERATION_REUSED');
    const second = await mutate(db, 'owner-a', operation('second', { baseRevision: 1 })); assert.equal(second.entity.revision, 2);
    const conflict = await mutate(db, 'owner-a', operation('stale', { baseRevision: 1 })); assert.equal(conflict.code, 'CONFLICT'); assert.equal(conflict.entity.revision, 2);
    assert.deepEqual(await mutate(db, 'owner-a', operation('stale', { baseRevision: 1 })), conflict);
    assert.equal((await mutate(db, 'owner-b', operation('same'))).entity.revision, 1);
    const deleted = await mutate(db, 'owner-a', operation('delete', { body: null, deleted: true, baseRevision: 2 }));
    assert.equal(deleted.entity.deleted, true); assert.equal(deleted.entity.body, null); assert.equal(deleted.entity.revision, 3);
    assert.equal((await pull(db, 'owner-b')).entities[0].revision, 1);
    const record = { id: '2020-10-04', date: '2020-10-04', templateId: 'plan', bodyWeight: 70, items: [{ ...exercise, entryId: 'entry' }], completed: ['entry'], startedAt: '2020-10-04T02:00:00Z' };
    assert.equal((await mutate(db, 'owner-a', operation('record', { kind: 'record', id: record.id, body: record }))).code, 0);
    const cancelled = await mutate(db, 'owner-a', operation('cancel', { kind: 'record', id: record.id, body: { ...record, completed: [] }, baseRevision: 1 })); assert.equal(cancelled.code, 0);
    assert.equal((await mutate(db, 'owner-a', operation('snapshot', { kind: 'record', id: record.id, body: { ...record, bodyWeight: 100 }, baseRevision: 2 }))).code, 'IMMUTABLE_RECORD');
    assert.equal((await mutate(db, 'owner-a', operation('record-delete', { kind: 'record', id: record.id, body: null, deleted: true, baseRevision: 2 }))).code, 'VALIDATION');
    assert.equal((await mutate(db, 'owner-a', operation('bad-date', { kind: 'record', id: record.id, body: record, occurredAt: '2020-10-03T15:59:59Z', baseRevision: 2 }))).code, 'VALIDATION');
    await db.exec("INSERT INTO public.fitcheckin_exercises (owner_id,entity_id,body,revision,deleted) SELECT 'many-owner','exercise-' || lpad(i::text,4,'0'),NULL,1,true FROM generate_series(1,1005) AS i;");
    let cursor = { kind: '', id: '' }; const entities = [];
    do { const page = await pull(db, 'many-owner', cursor); entities.push(...page.entities); cursor = page.cursor; } while (cursor);
    assert.equal(entities.length, 1005); assert.equal(new Set(entities.map(entity => entity.id)).size, 1005);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role};`);
      await assert.rejects(db.query('SELECT * FROM public.fitcheckin_records'), error => error.code === '42501');
      await assert.rejects(db.query('SELECT * FROM public.fitcheckin_entities'), error => error.code === '42501');
      await assert.rejects(pull(db, 'owner-a'), error => error.code === '42501');
      await assert.rejects(mutate(db, 'owner-a', operation('forbidden')), error => error.code === '42501');
    }
  } finally { await db.close(); }
});
