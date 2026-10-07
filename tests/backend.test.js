'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { validateOperation, beijingDay } = require('../cloudfunctions/fitcheckin/validation');
const NOW = Date.parse('2026-10-04T04:00:00.000Z');
const identity = { OPENID: 'native-owner', APPID: 'wxe25930a2cdce35d0' };
const exercise = () => ({ id: 'bench', name: 'Bench', type: 'weighted', sets: 3, reps: 10, weight: 40, restSeconds: 60, muscles: [{ id: 'chest', percent: 100 }] });
const operation = (kind = 'exercise', body = exercise()) => ({ operationId: 'op-1', kind, id: body.id, body, deleted: false, baseRevision: 0, occurredAt: '2026-10-04T03:00:00.000Z' });
const record = () => ({ id: '2026-10-04', date: '2026-10-04', templateId: 'plan-1', bodyWeight: 70, items: [{ ...exercise(), entryId: 'entry-1' }], completed: ['entry-1'], startedAt: '2026-10-04T02:00:00Z' });
const handler = (transport, context = identity) => createHandler({ getWXContext: () => context, transport, now: () => NOW });

test('native identity is mandatory; caller identity cannot authorize or override owner', async () => {
  let calls = 0;
  const denied = handler(() => { calls++; }, {});
  assert.equal((await denied({ action: 'bootstrap', OPENID: identity.OPENID, APPID: identity.APPID })).code, 'AUTH_REQUIRED');
  assert.equal((await handler(() => { calls++; }, { ...identity, APPID: 'another-app' })({ action: 'pull' })).code, 'FORBIDDEN');
  assert.equal(calls, 0);
  const h = handler(async (rpc, args) => {
    assert.equal(rpc, 'fitcheckin_mutate'); assert.equal(args.p_owner, identity.OPENID);
    return { code: 0, entity: { kind: 'exercise', id: 'bench', body: exercise(), revision: 1, deleted: false, owner_id: 'secret-internal' } };
  });
  const result = await h({ action: 'mutate', owner: 'attacker', operation: operation() });
  assert.equal(result.code, 0);
  assert.equal(JSON.stringify(result).includes('secret-internal'), false);
});

test('all pull pages are collected, including tombstones and more than 1000 entities', async () => {
  let calls = 0;
  const h = handler(async (rpc, args) => {
    assert.equal(rpc, 'fitcheckin_pull'); assert.equal(args.p_owner, identity.OPENID);
    const start = calls++ * 100;
    if (start) assert.equal(args.p_after_id, `id-${start - 1}`);
    return {
      entities: Array.from({ length: start === 1000 ? 3 : 100 }, (_, i) => ({ kind: 'exercise', id: `id-${start + i}`, body: null, revision: 2, deleted: true, owner_id: identity.OPENID })),
      cursor: start < 1000 ? { kind: 'exercise', id: `id-${start + 99}` } : null
    };
  });
  const response = await h({ action: 'bootstrap' });
  assert.equal(response.code, 0); assert.equal(response.data.entities.length, 1003); assert.equal(calls, 11);
  assert.equal(response.data.openid, identity.OPENID);
  assert.deepEqual(Object.keys(response.data.entities[0]).sort(), ['body', 'deleted', 'id', 'kind', 'revision']);
});

test('PG errors and response metadata cannot leak credentials; invalid pagination fails closed', async () => {
  const h = handler(async () => { throw new Error('Authorization Bearer sensitive-key SQL internals'); });
  const result = await h({ action: 'pull' });
  assert.equal(result.code, 'DB_ERROR'); assert.equal(JSON.stringify(result).includes('sensitive-key'), false);
  const looping = handler(async () => ({ entities: [], cursor: { kind: 'exercise', id: 'same' } }));
  assert.equal((await looping({ action: 'pull' })).code, 'DB_ERROR');
});

test('server validates nested snapshots, names, counts, percentages and unknown fields', () => {
  const valid = operation(); assert.equal(validateOperation(valid, NOW), valid);
  const malformed = [
    { ...valid, baseRevision: 0.5 }, { ...valid, owner: 'attacker' }, { ...valid, operationId: '' },
    { ...valid, body: { ...exercise(), sets: 101 } }, { ...valid, body: { ...exercise(), reps: 10001 } },
    { ...valid, body: { ...exercise(), weight: Infinity } }, { ...valid, body: { ...exercise(), weight: -1 } },
    { ...valid, body: { ...exercise(), name: 'x'.repeat(61) } },
    { ...valid, body: { ...exercise(), muscles: [{ id: 'chest', percent: 80 }] } },
    { ...valid, body: { ...exercise(), muscles: [{ id: 'forearms', percent: 100 }] } },
    { ...valid, body: { ...exercise(), muscles: [{ id: 'chest', percent: 50 }, { id: 'chest', percent: 50 }] } },
    { ...valid, body: { ...exercise(), intensity: 3 } },
    { ...valid, body: { ...exercise(), owner: 'attacker' } }
  ];
  malformed.forEach(op => assert.throws(() => validateOperation(op, NOW), { code: 'VALIDATION' }));
  assert.doesNotThrow(() => validateOperation(operation('exercise', { ...exercise(), type: 'cardio', durationMinutes: 30, reps: 0, muscles: [], intensity: 'easy' }), NOW));
  const days = Array.from({ length: 7 }, () => []);
  assert.doesNotThrow(() => validateOperation(operation('template', { id: 'plan', name: 'Plan', days }), NOW));
  assert.throws(() => validateOperation(operation('template', { id: 'plan', name: 'Plan', days: days.slice(1) }), NOW));
  const oversize = Array.from({ length: 51 }, (_, i) => ({ ...exercise(), entryId: `entry-${i}` }));
  assert.throws(() => validateOperation(operation('template', { id: 'plan', name: 'Plan', days: [oversize, ...days.slice(1)] }), NOW));
  assert.throws(() => validateOperation(operation('override', { id: '2026-10-04', templateId: 'plan', days }), NOW));
});

test('schedule history accepts legacy profiles and validates dated masks and overrides', () => {
  const profile = { id: 'profile', bodyWeight: null, activeTemplateId: null };
  assert.doesNotThrow(() => validateOperation(operation('profile', profile), NOW));
  const schedule = { from: '2026-10-01', mask: 5, weeks: [{ week: '2026-10-05', mask: 2 }] };
  assert.doesNotThrow(() => validateOperation(operation('profile', { ...profile, scheduleHistory: [schedule] }), NOW));
  for (const invalid of [
    [{ ...schedule, mask: 128 }], [{ ...schedule, from: '2026-10-05' }],
    [{ ...schedule, weeks: [{ week: '2026-10-06', mask: 1 }] }],
    [schedule, schedule], [{ ...schedule, weeks: [{ week: '2026-10-05', mask: -1 }] }]
  ]) assert.throws(() => validateOperation(operation('profile', { ...profile, scheduleHistory: invalid }), NOW), { code: 'VALIDATION' });
});

test('Beijing date boundary allows durable past submissions and rejects fabricated dates', () => {
  assert.equal(beijingDay(Date.parse('2026-10-03T15:59:59Z')), '2026-10-03');
  assert.equal(beijingDay(Date.parse('2026-10-03T16:00:00Z')), '2026-10-04');
  const body = record(); const op = operation('record', body);
  assert.doesNotThrow(() => validateOperation(op, NOW + 20 * 86400000));
  assert.throws(() => validateOperation({ ...op, occurredAt: '2026-10-05T00:00:00Z' }, NOW));
  assert.throws(() => validateOperation({ ...op, occurredAt: '2026-10-03T15:59:59Z' }, NOW));
  assert.throws(() => validateOperation({ ...op, body: { ...body, completed: ['missing'] } }, NOW));
  assert.throws(() => validateOperation({ ...op, body: { ...body, completed: ['entry-1', 'entry-1'] } }, NOW));
  assert.throws(() => validateOperation({ ...op, occurredAt: '2026-02-30T03:00:00Z' }, NOW));
  assert.throws(() => validateOperation({ ...op, deleted: true, body: null }, NOW));
  assert.doesNotThrow(() => validateOperation({ ...op, body: { ...body, completed: [] } }, NOW));
});

test('conflicts and immutable-snapshot results use bounded public error envelopes', async () => {
  const cloudEntity = { kind: 'exercise', id: 'bench', body: exercise(), revision: 7, deleted: false };
  const result = await handler(async () => ({ code: 'CONFLICT', entity: cloudEntity, password: 'never-return' }))({ action: 'mutate', operation: operation() });
  assert.equal(result.code, 'CONFLICT'); assert.deepEqual(result.data.entity, cloudEntity);
  assert.equal(JSON.stringify(result).includes('never-return'), false);
  for (const code of ['OPERATION_REUSED', 'IMMUTABLE_RECORD']) {
    const response = await handler(async () => ({ code, debug: 'secret' }))({ action: 'mutate', operation: operation() });
    assert.equal(response.code, code); assert.equal(response.debug, undefined);
  }
});

test('the backend accepts every normalized domain preset without widening validation', () => {
  const { PRESETS } = require('../miniprogram/lib/domain');
  PRESETS.forEach(body => assert.doesNotThrow(() => validateOperation(operation('exercise', body), NOW)));
});
