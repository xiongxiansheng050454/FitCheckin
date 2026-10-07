const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const exercise = { id: 'bench', name: 'Bench', type: 'weighted', sets: 3, reps: 10, weight: 40, restSeconds: 60, muscles: [{ id: 'chest', percent: 100 }] };
const op = (operationId, changes = {}) => ({ operationId, kind: 'exercise', id: 'bench', body: exercise, deleted: false, baseRevision: 0, occurredAt: '2026-10-04T03:00:00Z', ...changes });
const mutate = (transport, operation, owner = 'owner-a') => transport('fitcheckin_mutate', { p_owner: owner, p_operation: operation });
const pull = (transport, owner = 'owner-a', kind = '', id = '') => transport('fitcheckin_pull', { p_owner: owner, p_after_kind: kind, p_after_id: id, p_limit: 100 });

test('document transactions deduplicate, detect reuse/conflicts and isolate owners and applications', async () => {
  const db = createDatabase(), transport = createDocumentTransport(db, 'app-a');
  const first = await mutate(transport, op('first')); assert.equal(first.entity.revision, 1);
  assert.deepEqual(await mutate(transport, op('first')), first);
  assert.deepEqual(await mutate(transport, op('first', { body: { ...exercise, weight: 50 } })), { code: 'OPERATION_REUSED' });
  const conflict = await mutate(transport, op('stale')); assert.equal(conflict.code, 'CONFLICT');
  await mutate(transport, op('next', { baseRevision: 1 }));
  assert.deepEqual(await mutate(transport, op('stale')), conflict);
  assert.equal((await mutate(transport, op('first'), 'owner-b')).entity.revision, 1);
  const appB = createDocumentTransport(db, 'app-b');
  assert.equal((await pull(appB)).entities.length, 0);
  assert.equal((await mutate(appB, op('first'))).entity.revision, 1);
  assert.equal((await pull(transport)).entities[0].revision, 2);
  assert.deepEqual(Object.keys((await pull(transport)).entities[0]).sort(), ['body', 'deleted', 'id', 'kind', 'revision']);
});

test('competing document writes commit once and lost acknowledgements cannot duplicate effects', async () => {
  const transport = createDocumentTransport(createDatabase(), 'app-a');
  const same = await Promise.all([mutate(transport, op('same')), mutate(transport, op('same'))]);
  assert.deepEqual(same[0], same[1]); assert.equal(same[0].entity.revision, 1);
  const writes = await Promise.all([mutate(transport, op('a', { baseRevision: 1 })), mutate(transport, op('b', { baseRevision: 1 }))]);
  assert.equal(writes.filter(r => r.code === 0).length, 1);
  assert.equal(writes.filter(r => r.code === 'CONFLICT').length, 1);
  assert.equal((await pull(transport)).entities[0].revision, 2);
});

test('receipt failure rolls back entity writes and document snapshot is immutable except completion', async () => {
  const db = createDatabase(), transport = createDocumentTransport(db, 'app-a');
  db.failReceipt = true; await assert.rejects(mutate(transport, op('rollback')));
  assert.equal(db.rows().length, 0); db.failReceipt = false;
  const body = { id: '2026-10-04', date: '2026-10-04', templateId: null, bodyWeight: 70, items: [{ ...exercise, entryId: 'entry' }], completed: ['entry'], startedAt: '2026-10-04T02:00:00Z' };
  const record = op('record', { kind: 'record', id: body.id, body });
  assert.equal((await mutate(transport, record)).code, 0);
  assert.equal((await mutate(transport, { ...record, operationId: 'cancel', baseRevision: 1, body: { ...body, completed: [] } })).code, 0);
  assert.equal((await mutate(transport, { ...record, operationId: 'changed', baseRevision: 2, body: { ...body, bodyWeight: 80 } })).code, 'IMMUTABLE_RECORD');
  const removed = await mutate(transport, op('create'));
  assert.equal(removed.code, 0);
  const tombstone = await mutate(transport, op('delete', { baseRevision: 1, deleted: true, body: null }));
  assert.equal(tombstone.entity.deleted, true); assert.equal(tombstone.entity.body, null);
  assert.equal((await pull(transport)).entities.length, 2);
});

test('document pagination includes more than 1000 records without duplicates and retains tombstones', async () => {
  const transport = createDocumentTransport(createDatabase(), 'app-a');
  for (let i = 0; i < 1005; i++) {
    const id = 'exercise-' + String(i).padStart(4, '0');
    await mutate(transport, op('op-' + i, { id, body: { ...exercise, id } }));
  }
  let cursor, all = [];
  do {
    const page = await pull(transport, 'owner-a', cursor ? cursor.kind : '', cursor ? cursor.id : '');
    all.push(...page.entities); cursor = page.cursor;
  } while (cursor);
  assert.equal(all.length, 1005); assert.equal(new Set(all.map(e => e.id)).size, 1005);
});
