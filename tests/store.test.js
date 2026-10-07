const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../miniprogram/lib/store');
const d = require('../miniprogram/lib/domain');
const clone = v => JSON.parse(JSON.stringify(v));
function fixture() {
  const disk = new Map();
  const entities = new Map();
  let online = true;
  let owner = 'user-a';
  let hold = null;
  const requests = [];
  const call = async (action, payload) => {
    if (!online) throw new Error('offline');
    if (action === 'bootstrap' || action === 'pull') return { code: 0, data: { openid: owner, scheduleHistorySupported: true, entities: Array.from(entities.values()).map(clone) } };
    const op = clone(payload.operation);
    requests.push(op);
    if (hold) { const promise = hold; hold = null; await promise; }
    const key = op.kind + ':' + op.id;
    const current = entities.get(key);
    if ((current ? current.revision : 0) !== op.baseRevision) return { code: 'CONFLICT', message: 'conflict', data: { entity: current } };
    const entity = { kind: op.kind, id: op.id, revision: op.baseRevision + 1, body: op.body, deleted: op.deleted };
    entities.set(key, entity);
    return { code: 0, data: { entity: clone(entity) } };
  };
  const options = { storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, clone(value)) }, call, now: () => new Date('2026-10-04T10:00:00Z') };
  return { options, entities, requests, disk, store: createStore(options), setOnline(v) { online = v; }, setOwner(v) { owner = v; }, hold(p) { hold = p; } };
}
test('environment switch preserves old offline edits without replaying them in the new environment', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  await f.store.saveProfile({ bodyWeight: 70 }); await f.store.retrySync();
  const legacy = clone(f.disk.get('fitcheckin:user-a'));
  const newOptions = { ...f.options, environment: 'weixing2-d7g2j6asyc5132905' };
  const next = createStore(newOptions);
  assert.equal(next.getState().profile.bodyWeight, null);
  assert.equal(next.getState().sync.pendingCount, 0);
  f.setOnline(true); await next.init();
  assert.equal(f.requests.length, 0);
  await next.saveProfile({ bodyWeight: 80 }); await next.retrySync();
  assert.equal(f.requests.length, 1);
  assert.equal(next.accountKey(), 'fitcheckin:weixing2-d7g2j6asyc5132905:user-a');
  assert.deepEqual(f.disk.get('fitcheckin:user-a'), legacy);
  f.setOnline(false);
  await next.saveProfile({ bodyWeight: 85 }); await next.retrySync();
  const restarted = createStore(newOptions); await restarted.init();
  assert.equal(restarted.getState().profile.bodyWeight, 85);
  assert.equal(restarted.getState().sync.pendingCount, 1);
  const other = createStore({ ...f.options, environment: 'another-environment' });
  assert.equal(other.getState().sync.pendingCount, 0);
  assert.equal(other.getState().profile.bodyWeight, null);
});

test('schedule history is durable, cloud synchronized and captures only changes', async () => {
  const f = fixture(); let now = new Date('2026-09-28T10:00:00Z');
  f.options.now = () => now;
  const store = createStore(f.options); await store.init(); f.setOnline(false);
  const item = { ...d.PRESETS[0], entryId: 'a' };
  const plan = { id: 'p', name: 'Plan', days: [[item], [], [item], [], [], [], []] };
  await store.saveTemplate(plan); await store.activateTemplate('p');
  assert.equal(store.getState().profile.scheduleHistory[0].mask, 5);
  await store.toggleToday('a');
  now = new Date('2026-10-01T10:00:00Z');
  await store.saveTemplate({ ...plan, days: [[], [], [], [item], [], [], []] });
  assert.deepEqual(store.getState().profile.scheduleHistory.map(e => [e.from, e.mask]), [['2026-09-28', 5], ['2026-10-01', 8]]);
  const restarted = createStore(f.options); await restarted.init();
  assert.equal(restarted.getState().profile.scheduleHistory.length, 2);
  f.setOnline(true); await restarted.retrySync();
  assert.equal(restarted.getState().sync.pendingCount, 0);
  assert.equal(f.entities.get('profile:profile').body.scheduleHistory[0].mask, 5);
});

test('local edit survives offline restart and retries in order', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  await f.store.saveProfile({ bodyWeight: 70 });
  assert.equal(f.store.getState().profile.bodyWeight, 70);
  assert.equal(f.store.getState().sync.pendingCount, 1);
  const restarted = createStore(f.options); await restarted.init();
  assert.equal(restarted.getState().profile.bodyWeight, 70);
  f.setOnline(true); await restarted.retrySync();
  assert.equal(restarted.getState().sync.pendingCount, 0);
  assert.equal(f.entities.get('profile:profile').body.bodyWeight, 70);
});
test('in-flight reply cannot overwrite newer local edits', async () => {
  const f = fixture(); await f.store.init();
  let release; const held = new Promise(resolve => { release = resolve; }); f.hold(held);
  await f.store.saveProfile({ bodyWeight: 70 });
  await f.store.saveProfile({ bodyWeight: 75 });
  assert.equal(f.store.getState().profile.bodyWeight, 75);
  release(); await f.store.retrySync();
  assert.equal(f.store.getState().profile.bodyWeight, 75);
  assert.equal(f.entities.get('profile:profile').body.bodyWeight, 75);
});
test('conflict retains local changes and local choice rebases', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  await f.store.saveProfile({ bodyWeight: 70 });
  f.entities.set('profile:profile', { kind: 'profile', id: 'profile', body: { id: 'profile', bodyWeight: 80, activeTemplateId: null }, revision: 3, deleted: false });
  f.setOnline(true); await f.store.retrySync();
  const conflict = f.store.getState().sync.conflicts[0];
  assert.equal(f.store.getState().profile.bodyWeight, 70);
  await f.store.resolveConflict(conflict.id, 'local'); await f.store.retrySync();
  assert.equal(f.entities.get('profile:profile').body.bodyWeight, 70);
  assert.equal(f.entities.get('profile:profile').revision, 4);
});
test('cloud choice discards pending changes of only conflicting entity', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  await f.store.saveProfile({ bodyWeight: 70 });
  f.entities.set('profile:profile', { kind: 'profile', id: 'profile', body: { id: 'profile', bodyWeight: 80, activeTemplateId: null }, revision: 2, deleted: false });
  f.setOnline(true); await f.store.retrySync();
  await f.store.resolveConflict(f.store.getState().sync.conflicts[0].id, 'cloud');
  assert.equal(f.store.getState().profile.bodyWeight, 80);
});
test('switching confirmed identity isolates state and queued edits', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false); await f.store.saveProfile({ bodyWeight: 70 });
  f.setOwner('user-b'); f.setOnline(true); const second = createStore(f.options); await second.init();
  assert.equal(second.getState().profile.bodyWeight, null);
  assert.equal(second.getState().sync.pendingCount, 0);
  assert.ok(f.disk.has('fitcheckin:user-a'));
});
test('first-ever offline identity cannot write to made-up account', async () => {
  const f = fixture(); f.setOnline(false); await f.store.init();
  await assert.rejects(f.store.saveProfile({ bodyWeight: 70 }), /联网/);
  assert.equal(f.store.getState().identityReady, false);
});
test('today record freezes template and weight even after cancellation', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  const push = { ...d.PRESETS.find(x => x.id === 'pushup'), entryId: 'entry-a' };
  await f.store.saveProfile({ bodyWeight: 70 });
  const plan = { id: 'p', name: '力量周', days: [[], [], [], [], [], [], [push]] };
  await f.store.saveTemplate(plan); await f.store.activateTemplate('p');
  await f.store.toggleToday('entry-a');
  await f.store.saveProfile({ bodyWeight: 80 });
  await f.store.saveTemplate({ ...plan, days: [[], [], [], [], [], [], []] });
  assert.equal(f.store.getState().records[0].bodyWeight, 70);
  assert.equal(d.calculateRecord(f.store.getState().records[0]).volume, 1638);
  await f.store.toggleToday('entry-a');
  assert.equal(f.store.getState().records[0].items.length, 1);
  assert.equal(f.store.getState().records[0].completed.length, 0);
});
test('missing bodyweight blocks first snapshot that contains selfweight', async () => {
  const f = fixture(); await f.store.init(); f.setOnline(false);
  const push = { ...d.PRESETS.find(x => x.id === 'pushup'), entryId: 'entry-a' };
  await f.store.saveTemplate({ id: 'p', name: '周计划', days: [[], [], [], [], [], [], [push]] });
  await f.store.activateTemplate('p');
  await assert.rejects(f.store.toggleToday('entry-a'), e => e.code === 'BODY_WEIGHT_REQUIRED');
});
test('initialization and concurrent retries share a single authentication/drain lock', async () => {
  const f = fixture();
  let release; const held = new Promise(resolve => { release = resolve; });
  let bootstraps = 0;
  const original = f.options.call;
  const store = createStore({ ...f.options, call: async (action, payload) => {
    if (action === 'bootstrap') { bootstraps += 1; await held; }
    return original(action, payload);
  } });
  const operations = [store.init(), store.retrySync(), store.retrySync()];
  await Promise.resolve(); const started = bootstraps; release(); await Promise.all(operations);
  assert.equal(started, 1);
});
test('stale editor draft cannot use refreshed entity baseline silently', async () => {
  const f = fixture(); await f.store.init();
  const template = { id: 'p', name: '版本一', days: [[], [], [], [], [], [], []] };
  await f.store.saveTemplate(template); await f.store.retrySync();
  f.entities.set('template:p', { kind: 'template', id: 'p', body: { ...template, name: '云端版本二' }, revision: 2, deleted: false });
  await f.store.refresh();
  await assert.rejects(f.store.saveTemplate(template, 1), e => e.code === 'STALE_DRAFT');
  assert.equal(f.store.getState().templates[0].name, '云端版本二');
});

test('offline record survives midnight restart with original occurrence and cannot be backfilled', async () => {
  const f = fixture();
  let clock = '2026-10-04T15:59:59Z';
  f.options.now = () => new Date(clock);
  const store = createStore(f.options); await store.init();
  const bench = { ...d.PRESETS.find(x => x.id === 'bench'), entryId: 'sunday-entry' };
  await store.saveTemplate({ id: 'p', name: 'Weekly', days: [[{ ...bench, entryId: 'monday-entry' }], [], [], [], [], [], [bench]] });
  await store.activateTemplate('p'); await store.retrySync();
  f.setOnline(false); await store.toggleToday('sunday-entry'); await store.retrySync();
  clock = '2026-10-04T16:00:01Z';
  const restarted = createStore(f.options); await restarted.init();
  await assert.rejects(restarted.toggleToday('sunday-entry'), /动作不存在/);
  f.setOnline(true); await restarted.retrySync();
  const persisted = f.entities.get('record:2026-10-04');
  assert.deepEqual(persisted.body.completed, ['sunday-entry']);
  assert.equal(persisted.body.startedAt, '2026-10-04T15:59:59.000Z');
  assert.equal(f.requests.find(op => op.kind === 'record').occurredAt, '2026-10-04T15:59:59.000Z');
  assert.equal(restarted.getState().sync.pendingCount, 0);
  assert.equal(restarted.getState().records.length, 1);
});
