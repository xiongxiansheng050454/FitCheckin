const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const copy = v => JSON.parse(JSON.stringify(v));
const run = { ...d.PRESETS.find(e => e.id === 'run'), entryId: 'run-entry' };
const bench = { ...d.PRESETS[0], weight: 40, entryId: 'bench-entry' };
const days = items => [items, [], [], [], [], [], []];
function fixture() {
  const db = createDatabase(), disk = new Map(); let online = true, clock = '2020-10-05T08:00:00Z';
  const handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'plan-update-owner' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse(clock) });
  const options = { now: () => new Date(clock), storage: { get: k => disk.get(k), set: (k, value) => disk.set(k, copy(value)) }, call: (action, payload) => online ? handler({ action, ...payload }) : Promise.reject(new Error('offline')) };
  const store = createStore(options);
  const f = { db, handler, options, store, online: value => { online = value; }, clock: value => { clock = value; } };
  f.seed = async () => { await store.init(); await store.saveProfile({ bodyWeight: 70 }); await store.saveTemplate({ id: 'p', name: 'Gym', days: days([run]) }); await store.activateTemplate('p'); await store.retrySync(); };
  f.record = () => store.getState().records[0];
  return f;
}

test('complete, undo all, change this week and explicitly update today replaces the stale running snapshot', async () => {
  const f = fixture(); await f.seed();
  await f.store.startToday(run.entryId); await f.store.completeTodaySet(run.entryId, 0); await f.store.undoTodaySet(run.entryId, 0); await f.store.retrySync();
  await f.store.saveOverride({ id: '2020-10-05', templateId: 'p', days: days([bench]) }); await f.store.retrySync();
  assert.equal(d.resolveDay(f.store.getState(), '2020-10-05').items[0].id, 'run');
  await f.store.updateTodayPlan(); await f.store.retrySync();
  assert.deepEqual(f.record().items.map(e => e.id), ['bench']); assert.equal(f.record().completed.length, 0);
  assert.equal(d.resolveDay(f.store.getState(), '2020-10-05').items[0].id, 'bench');
  assert.equal(f.store.getState().sync.status, 'idle');
  assert.equal(f.db.rows().find(row => row.kind === 'record').body.items[0].id, 'bench');
});

test('today updates append new actions while preserving completed/partial parameters, progress and volume', async () => {
  const f = fixture(); await f.seed(); await f.store.startToday(run.entryId); await f.store.completeTodaySet(run.entryId, 0); await f.store.retrySync();
  await f.store.saveOverride({ id: '2020-10-05', templateId: 'p', days: days([bench]) }); await f.store.updateTodayPlan(); await f.store.retrySync();
  assert.equal(f.record().items.length, 2); assert.equal(d.calculateRecord(f.record()).status, 'partial');
  assert.equal(d.calculateRecord(f.record()).cardioMinutes, 30);
  await f.store.startToday(bench.entryId); await f.store.completeTodaySet(bench.entryId, 0); await f.store.retrySync();
  await f.store.saveOverride({ id: '2020-10-05', templateId: 'p', days: days([{ ...bench, weight: 80 }, { ...run, entryId: 'new-run' }]) });
  await f.store.updateTodayPlan(); await f.store.retrySync();
  assert.equal(f.record().items.find(e => e.entryId === bench.entryId).weight, 40);
  assert.equal(f.record().completedSets[bench.entryId], 1); assert.equal(d.calculateRecord(f.record()).volume, 400);
  assert.equal(f.record().completedSets['new-run'] || 0, 0);
  assert.equal(f.store.getState().sync.status, 'idle');
});

test('explicit day updates survive offline restart, midnight and exact-request retry without creating historical edits', async () => {
  const f = fixture(); await f.seed(); await f.store.startToday(run.entryId); await f.store.retrySync(); f.online(false);
  await f.store.saveOverride({ id: '2020-10-05', templateId: 'p', days: days([bench]) }); await f.store.updateTodayPlan(); await f.store.retrySync();
  const restart = createStore(f.options); await restart.init(); assert.equal(restart.getState().records[0].items[0].id, 'bench');
  const pending = copy(f.db.rows().filter(row => row.kind === 'record'));
  assert.equal(pending[0].body.items[0].id, 'run');
  f.clock('2020-10-05T16:00:01Z'); f.online(true); await restart.retrySync();
  assert.equal(restart.getState().sync.status, 'idle');
  const row = f.db.rows().find(r => r.kind === 'record'); assert.equal(row.body.items[0].id, 'bench');
  const receipt = f.db.rows().find(r => r.payload && r.payload.updatePlan === true);
  const repeated = await f.handler({ action: 'mutate', operation: receipt.payload }); assert.equal(repeated.code, 0); assert.equal(repeated.data.entity.revision, row.revision);
  await assert.rejects(restart.updateTodayPlan(), /今日/);
});

test('backend explicit plan updates retain recorded work and metadata, and ordinary writes cannot alter snapshots', async () => {
  const f = fixture(); await f.seed(); await f.store.startToday(run.entryId); await f.store.completeTodaySet(run.entryId, 0); await f.store.retrySync();
  const old = f.record(), revision = f.store.getState().revisions['record:' + old.date];
  const op = (suffix, body, flagged = true) => ({ operationId: 'update-plan-' + suffix, kind: 'record', id: old.id, body, deleted: false, baseRevision: revision, occurredAt: '2020-10-05T08:00:00Z', ...(flagged ? { updatePlan: true } : {}) });
  const next = { ...old, items: [run, bench] };
  assert.equal((await f.handler({ action: 'mutate', operation: op('ordinary', next, false) })).code, 'IMMUTABLE_RECORD');
  for (const [suffix, body] of [
    ['remove', { ...old, items: [bench], completed: [], completedSets: {} }],
    ['change', { ...old, items: [{ ...run, durationMinutes: 60 }] }],
    ['progress', { ...next, completedSets: { [run.entryId]: 0 }, completed: [] }],
    ['metadata', { ...next, startedAt: '2020-10-05T07:00:00Z' }],
    ['weight', { ...next, bodyWeight: 80 }]
  ]) {
    assert.equal((await f.handler({ action: 'mutate', operation: op(suffix, body) })).code, 'IMMUTABLE_RECORD');
  }
  const accepted = await f.handler({ action: 'mutate', operation: op('valid', next) });
  assert.equal(accepted.code, 0); assert.equal(accepted.data.entity.body.items.length, 2);
  assert.equal(d.calculateRecord(accepted.data.entity.body).cardioMinutes, 30);
});

test('native Today exposes the changed plan and its update command applies the safe candidate through the real store', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const f = fixture(); await f.seed(); await f.store.startToday(run.entryId); await f.store.retrySync();
  const file = require.resolve('../miniprogram/pages/today/index'), localRequire = createRequire(file); let definition;
  const ui = { ...require('../miniprogram/pages/ui'), domain: { ...d, today: () => '2020-10-05' }, store: f.store, ready: () => true, confirm: async () => true };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: name => name === '../ui' ? ui : name.includes('poster-runtime') ? { loadCode: async () => {} } : localRequire(name), Page: value => { definition = value; }, wx: { getStorageSync() {}, setStorageSync() {}, showToast() {} }, setInterval: () => 1, clearInterval() {} });
  const page = { ...definition, data: copy(definition.data), setData(values) { Object.assign(this.data, values); } };
  const unsubscribe = f.store.subscribe(state => page.render(state)); assert.equal(page.data.planUpdateAvailable, false);
  await f.store.saveOverride({ id: '2020-10-05', templateId: 'p', days: days([bench]) });
  assert.equal(page.data.planUpdateAvailable, true); assert.equal(page.data.items[0].id, 'run');
  await page.updatePlan(); await f.store.retrySync(); assert.equal(page.data.error, '');
  assert.equal(page.data.planUpdateAvailable, false); assert.equal(page.data.items[0].id, 'bench'); unsubscribe();
});

test('unsupported backend and forged update flags are rejected before an unsafe record mutation', async () => {
  const store = createStore({ storage: { get() {}, set() {} }, call: async () => ({ code: 0, data: { openid: 'old-backend', entities: [] } }) });
  await store.init(); await assert.rejects(store.updateTodayPlan(), e => e.code === 'SERVER_UPDATE_REQUIRED'); assert.equal(store.getState().sync.pendingCount, 0);
  const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
  const base = { operationId: 'flag', kind: 'exercise', id: run.id, body: { ...run }, deleted: false, baseRevision: 0, occurredAt: '2020-10-05T08:00:00Z' }; delete base.body.entryId;
  for (const updatePlan of [true, false, 1, 'true']) assert.throws(() => validateOperation({ ...base, updatePlan }));
});
