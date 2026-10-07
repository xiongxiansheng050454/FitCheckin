const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const bench = { ...d.PRESETS[0], weight: 40, entryId: 'bench-entry' };
const pushup = { ...d.PRESETS.find(e => e.id === 'pushup'), entryId: 'pushup-entry' };
const record = { id: '2026-10-04', date: '2026-10-04', templateId: 'p', bodyWeight: 70, items: [bench, pushup], completed: [], completedSets: { 'bench-entry': 1, 'pushup-entry': 1 }, startedAt: '2026-10-04T10:00:00.000Z' };

test('partial sets count weighted/bodyweight volume, muscles, training days and streaks without completing an exercise', () => {
  const totals = d.calculateRecord(record);
  assert.equal(totals.volume, 946);
  assert.equal(totals.completedCount, 0);
  assert.equal(totals.completedSetCount, 2);
  assert.equal(totals.totalSetCount, 6);
  assert.equal(totals.status, 'partial');
  assert.equal(totals.muscles.chest, 662.2);
  assert.equal(d.calculateMonth([record], '2026-10').trainingDays, 1);
  assert.equal(require('../miniprogram/lib/achievement').achievement({ records: [record], profile: {}, templates: [], overrides: [] }, record.date).streak, 1);
  const legacy = { ...record, completed: ['bench-entry', 'pushup-entry'] }; delete legacy.completedSets;
  assert.equal(d.calculateRecord(legacy).volume, 2838);
  const cardio = { ...d.PRESETS.find(e => e.id === 'rope'), durationMinutes: 3, entryId: 'rope' };
  assert.equal(d.calculateRecord({ items: [cardio], completed: [], completedSets: { rope: 1 } }).cardioMinutes, 3);
});

test('set progress is durable across offline restart and midnight, deduplicates requests and preserves snapshots', async () => {
  const db = createDatabase(), disk = new Map(); let online = true, clock = '2026-10-04T10:00:00Z';
  const handler = createHandler({ getWXContext: () => ({ OPENID: 'training-owner', APPID: 'wxe25930a2cdce35d0' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse(clock) });
  const options = { now: () => new Date(clock), storage: { get: k => disk.get(k), set: (k, v) => disk.set(k, JSON.parse(JSON.stringify(v))) }, call: (action, payload) => online ? handler({ action, ...payload }) : Promise.reject(new Error('offline')) };
  const store = createStore(options); await store.init();
  await store.saveTemplate({ id: 'p', name: 'Plan', days: [[], [], [], [], [], [], [bench]] });
  await store.activateTemplate('p'); await store.retrySync();
  await store.startToday('bench-entry'); await store.retrySync();
  assert.equal(d.calculateRecord(store.getState().records[0]).status, 'none');
  await store.saveTemplate({ id: 'p', name: 'Changed', days: [[], [], [], [], [], [], [{ ...bench, weight: 80 }]] });
  await store.completeTodaySet('bench-entry', 0); await store.retrySync();
  assert.equal(d.calculateRecord(store.getState().records[0]).volume, 400);
  await assert.rejects(store.completeTodaySet('bench-entry', 0));
  await assert.rejects(store.completeTodaySet('bench-entry', 2));
  online = false;
  await store.completeTodaySet('bench-entry', 1); await store.retrySync();
  const restart = createStore(options); await restart.init();
  assert.equal(d.calculateRecord(restart.getState().records[0]).volume, 800);
  clock = '2026-10-04T16:00:01Z';
  await assert.rejects(restart.completeTodaySet('bench-entry', 2));
  online = true; await restart.retrySync();
  assert.equal(restart.getState().sync.pendingCount, 0);
  const saved = db.rows().find(row => row.kind === 'record');
  assert.equal(saved.body.completedSets['bench-entry'], 2);
  assert.equal(saved.body.items[0].weight, 40);
  clock = '2026-10-04T12:00:00Z';
  await restart.undoTodaySet('bench-entry', 1); await restart.retrySync();
  await restart.completeTodaySet('bench-entry', 1); await restart.completeTodaySet('bench-entry', 2); await restart.retrySync();
  assert.deepEqual(restart.getState().records[0].completed, ['bench-entry']);
  assert.equal(d.calculateRecord(restart.getState().records[0]).status, 'complete');
});

test('server rejects forged set counts or completion flags and accepts legacy records', () => {
  const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
  const operation = body => ({ operationId: 'sets-test', kind: 'record', id: record.id, body, deleted: false, baseRevision: 0, occurredAt: '2026-10-04T12:00:00Z' });
  assert.doesNotThrow(() => validateOperation(operation(record)));
  for (const completedSets of [{ 'bench-entry': 4 }, { alien: 1 }, { 'bench-entry': 1.5 }, { 'bench-entry': -1 }]) assert.throws(() => validateOperation(operation({ ...record, completedSets })));
  assert.throws(() => validateOperation(operation({ ...record, completed: ['bench-entry'] })));
  const legacy = { ...record }; delete legacy.completedSets;
  assert.doesNotThrow(() => validateOperation(operation(legacy)));
});

test('rest uses an absolute deadline after background time and provides encouraging overtime feedback', () => {
  const { restView } = require('../miniprogram/lib/training');
  const rest = { endAt: 90000, duration: 90, away: true };
  assert.equal(restView(rest, 1000).timer, '01:29');
  assert.equal(restView(rest, 45000).remaining, 45);
  const expired = restView(rest, 125000);
  assert.equal(expired.remaining, 0);
  assert.equal(expired.overtime, 35);
  assert.match(expired.title, /结束/);
  assert.ok(expired.quote.length > 0);
});
