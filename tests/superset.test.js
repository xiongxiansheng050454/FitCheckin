const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');
const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
function exercise(body, snapshot = false) {
  const value = snapshot ? { id: 'p', name: '计划', days: [[body], [], [], [], [], [], []] } : body;
  return validateOperation({ operationId: 'validate-combo', kind: snapshot ? 'template' : 'exercise', id: value.id, body: value, deleted: false, baseRevision: 0, occurredAt: '2026-10-05T08:00:00Z' }, Date.parse('2026-10-05T08:00:00Z'));
}
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const clone = value => JSON.parse(JSON.stringify(value));
const component = (id, fields = {}) => ({ ...clone(d.PRESETS.find(e => e.id === id)), sets: 1, restSeconds: 0, ...fields });
const combo = () => ({ id: 'combo', name: '胸背超级组', type: 'superset', sets: 3, restSeconds: 90, muscles: [], components: [component('bench', { weight: 40 }), component('row', { weight: 20 })] });

test('a superset is one action whose confirmed sets credit every component once', () => {
  const item = { ...d.validateExercise(combo()), entryId: 'combo-entry' };
  exercise(item, true);
  const record = { items: [item], completed: [], completedSets: { 'combo-entry': 2 }, bodyWeight: 70 };
  const totals = d.calculateRecord(record);
  assert.equal(totals.volume, 1200); assert.equal(totals.weightedVolume, 1200);
  assert.equal(totals.completedSetCount, 2); assert.equal(totals.totalSetCount, 3);
  assert.equal(totals.totalCount, 1); assert.equal(totals.completedCount, 0); assert.equal(totals.status, 'partial');
  assert.equal(totals.muscles.chest, 560); assert.equal(totals.muscles.back, 280);
  record.completedSets['combo-entry'] = 3; record.completed = ['combo-entry'];
  assert.equal(d.calculateRecord(record).status, 'complete');
  assert.equal(d.calculateRecord(record).volume, 1800);
  assert.match(d.exerciseSummary(item), /超级组|卧推/);
  assert.match(require('../miniprogram/lib/training').setLabel(item), /卧推.*划船/);
});

test('selfweight and cardio components use their own parameters and stay separate from kg volume', () => {
  const item = { ...combo(), components: [component('pushup'), component('run', { durationMinutes: 2 })], entryId: 'combo-entry' };
  exercise(item, true); d.validateExercise(item);
  assert.equal(d.usesBodyWeight(item), true);
  const record = { items: [item], completed: [], completedSets: { 'combo-entry': 2 }, bodyWeight: 70 };
  const totals = d.calculateRecord(record);
  assert.equal(totals.bodyweightVolume, 1092); assert.equal(totals.cardioMinutes, 4); assert.equal(totals.completedSetCount, 2);
  const month = d.calculateMonth([{ ...record, date: '2026-10-05' }], '2026-10');
  assert.equal(month.volume, 1092); assert.equal(month.trainingDays, 1);
  assert.equal(month.muscles.reduce((n, m) => n + m.percent, 0), 100);
});

test('supersets reject nesting, invalid child scales, child sets/rest and unbounded membership', () => {
  const bad = [
    { ...combo(), components: [] }, { ...combo(), components: [component('bench')] },
    { ...combo(), components: Array.from({ length: 11 }, () => component('bench')) },
    { ...combo(), components: [combo(), component('bench')] },
    { ...combo(), components: [component('bench', { rpe: 11 }), component('row')] },
    { ...combo(), components: [component('bench', { sets: 2 }), component('row')] },
    { ...combo(), components: [component('bench', { restSeconds: 10 }), component('row')] }
  ];
  for (const body of bad) { assert.throws(() => d.validateExercise(body)); assert.throws(() => exercise(body)); }
  assert.throws(() => exercise({ ...combo(), components: [ { ...component('bench'), entryId: 'nested' }, component('row')] }));
});

test('one superset confirmation and undo persist offline, freeze children and synchronize exactly once', async () => {
  const db = createDatabase(), disk = new Map(); let online = true, clock = '2026-10-05T08:00:00Z';
  const handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'superset-owner' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse(clock) });
  const options = { now: () => new Date(clock), storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, clone(value)) }, call: (action, payload) => online ? handler({ action, ...payload }) : Promise.reject(new Error('offline')) };
  const store = createStore(options); await store.init(); await store.saveExercise(combo());
  await store.saveTemplate({ id: 'p', name: '超级组计划', days: [[{ ...combo(), entryId: 'combo-entry' }], [], [], [], [], [], []] });
  await store.activateTemplate('p'); await store.retrySync(); online = false;
  await store.startToday('combo-entry'); await store.completeTodaySet('combo-entry', 0);
  assert.equal(d.calculateRecord(store.getState().records[0]).volume, 600);
  const restart = createStore(options); await restart.init();
  assert.equal(d.calculateRecord(restart.getState().records[0]).volume, 600);
  await restart.undoTodaySet('combo-entry', 0); assert.equal(d.calculateRecord(restart.getState().records[0]).volume, 0);
  await restart.completeTodaySet('combo-entry', 0); await restart.retrySync(); online = true; clock = '2026-10-05T16:00:01Z'; await restart.retrySync();
  assert.equal(restart.getState().sync.status, 'idle', restart.getState().sync.message);
  const record = db.rows().find(row => row.kind === 'record'); assert.equal(d.calculateRecord(record.body).volume, 600);
  const receipt = db.rows().filter(row => row.payload && row.payload.kind === 'record').slice(-1)[0];
  assert.equal((await handler({ action: 'mutate', operation: receipt.payload })).data.entity.revision, record.revision);
  assert.equal(record.body.items[0].components[0].weight, 40);
});

function pageHarness(route, state) {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const file = require.resolve('../miniprogram/packages/manage/' + route + '/index'), localRequire = createRequire(file);
  let definition, navigation; const saved = [];
  const ui = { ...require('../miniprogram/pages/ui'), ready: () => true, store: { getState: () => state, accountKey: () => 'fixture-account', saveExercise: async body => { saved.push(clone(body)); } }, bind(page, render) { render.call(page, state); }, unbind() {}, navigate(url, events, opened) { navigation = { url, events, opened }; } };
  const wx = { showToast() {}, navigateBack() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, require: name => name.includes('pages/ui') ? ui : localRequire(name), wx });
  const channel = { on(name, callback) { channel[name] = callback; }, emit(name, body) { channel[name + 'Result'] = clone(body); } };
  const page = { ...definition, data: clone(definition.data), setData(value) { Object.assign(this.data, value); }, getOpenerEventChannel: () => channel };
  return { page, channel, saved, navigation: () => navigation };
}

test('the superset editor copies selected actions, edits each privately and saves one library action', async () => {
  const h = pageHarness('superset-edit', { exercises: [], revisions: {}, identityReady: true });
  h.page.onLoad({}); h.page.add();
  assert.match(h.navigation().url, /component=1/);
  const preset = clone(d.PRESETS[0]); h.navigation().events.exerciseSelected(preset);
  h.page.add(); h.navigation().events.exerciseSelected(clone(d.PRESETS[3]));
  assert.equal(h.page.data.components.length, 2);
  h.page.editComponent({ currentTarget: { dataset: { index: 0 } } });
  assert.match(h.navigation().url, /component=1/);
  h.navigation().events.exerciseEdited(component('bench', { weight: 40, reps: 8 }));
  assert.equal(h.page.data.components[0].weight, 40); assert.equal(d.PRESETS[0].weight, preset.weight);
  h.page.name({ detail: { value: '胸背超级组' } }); await h.page.save();
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].components[0].sets, 1); assert.equal(h.saved[0].components[0].restSeconds, 0);
  exercise(h.saved[0]);
});

test('component editor hides independent sets/rest and library routes supersets to their own editor', () => {
  const state = { exercises: [combo()], revisions: {}, identityReady: true };
  const normal = pageHarness('exercise-edit', state); normal.page.onLoad({ entry: '1', component: '1' }); normal.channel.exerciseDraft(component('bench'));
  assert.equal(normal.page.data.fields.some(field => field.key === 'sets' || field.key === 'restSeconds'), false);
  const picker = pageHarness('exercise-picker', state); picker.page.onLoad({ mode: 'manage' }); picker.page.edit({ currentTarget: { dataset: { id: 'combo' } } });
  assert.match(picker.navigation().url, /superset-edit/);
  picker.page.createSuperset(); assert.match(picker.navigation().url, /superset-edit/);
  const childPicker = pageHarness('exercise-picker', state); childPicker.page.onLoad({ component: '1' });
  assert.equal(childPicker.page.data.items.some(item => item.type === 'superset'), false);
});

test('the real Today page confirms a whole superset once, rests once and undoes all its component volume', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const db = createDatabase(), disk = new Map(), now = () => new Date('2026-10-05T08:00:00Z');
  const handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'today-superset' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => now().getTime() });
  const store = createStore({ now, storage: { get: k => disk.get(k), set: (k, v) => disk.set(k, clone(v)) }, call: (action, payload) => handler({ action, ...payload }) });
  await store.init(); await store.saveProfile({ bodyWeight: 70 });
  await store.saveTemplate({ id: 'p', name: '超级组', days: [[{ ...combo(), entryId: 'combo-entry' }], [], [], [], [], [], []] }); await store.activateTemplate('p'); await store.retrySync();
  const file = require.resolve('../miniprogram/pages/today/index'), localRequire = createRequire(file); let definition;
  const ui = { ...require('../miniprogram/pages/ui'), domain: { ...d, today: () => '2026-10-05' }, store, ready: () => true };
  const wx = { getStorageSync: k => disk.get(k), setStorageSync: (k, v) => disk.set(k, clone(v)), setKeepScreenOn() {}, vibrateShort() {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, require: name => name === '../ui' ? ui : name.includes('poster-runtime') ? { loadCode: async () => {} } : localRequire(name), wx, setInterval: () => 1, clearInterval() {} });
  const page = { ...definition, data: clone(definition.data), _foreground: true, setData(values) { Object.assign(this.data, values); } };
  const unsubscribe = store.subscribe(state => page.render(state));
  const event = index => ({ currentTarget: { dataset: { id: 'combo-entry', index } } });
  await page.startExercise(event()); assert.equal(page.data.items.length, 1); assert.equal(page.data.items[0].groups.length, 3);
  await page.completeSet(event(0)); assert.equal(page.data.totals.volume, '600'); assert.equal(page.data.restOpen, true); assert.equal(page._training.rest.duration, 90);
  page.skipRest(); await page.undoSet(event(0)); assert.equal(page.data.totals.volume, '0'); assert.equal(page.data.totals.completedSetCount, 0);
  await page.completeSet(event(0)); page.skipRest(); await page.completeSet(event(1)); page.skipRest(); await page.completeSet(event(2));
  assert.equal(page.data.allDone, true); assert.equal(page.data.restOpen, false); assert.equal(page.data.posterModel.volume, 1800); assert.equal(page.data.totals.completedCount, 1);
  await store.retrySync(); assert.equal(store.getState().sync.status, 'idle'); assert.equal(db.rows().find(r => r.kind === 'record').body.completedSets['combo-entry'], 3);
  const record = store.getState().records[0], revision = store.getState().revisions['record:' + record.date];
  const altered = clone(record); altered.items[0].components[0].weight = 80;
  const operation = { operationId: 'change-frozen-child', kind: 'record', id: record.date, body: altered, deleted: false, baseRevision: revision, occurredAt: now().toISOString() };
  assert.equal((await handler({ action: 'mutate', operation })).code, 'IMMUTABLE_RECORD');
  assert.equal((await handler({ action: 'mutate', operation: { ...operation, operationId: 'change-frozen-child-explicit', updatePlan: true } })).code, 'IMMUTABLE_RECORD');
  unsubscribe();
});

test('missing bodyweight inside a superset blocks starting, and an old backend cannot queue supersets', async () => {
  const disk = new Map(), store = createStore({ now: () => new Date('2026-10-05T08:00:00Z'), storage: { get: k => disk.get(k), set: (k, v) => disk.set(k, clone(v)) }, call: async () => ({ code: 0, data: { openid: 'old-backend', entities: [] } }) });
  await store.init(); await assert.rejects(store.saveExercise(combo()), e => e.code === 'SERVER_UPDATE_REQUIRED');
  assert.equal(store.getState().sync.pendingCount, 0);
  const db = createDatabase(), handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'no-weight' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse('2026-10-05T08:00:00Z') });
  const fresh = createStore({ now: () => new Date('2026-10-05T08:00:00Z'), storage: { get() {}, set() {} }, call: (action, payload) => handler({ action, ...payload }) });
  await fresh.init(); await fresh.saveTemplate({ id: 'p', name: '自重组', days: [[{ ...combo(), components: [component('pushup'), component('row')], entryId: 'combo-entry' }], [], [], [], [], [], []] }); await fresh.activateTemplate('p');
  await assert.rejects(fresh.startToday('combo-entry'), e => e.code === 'BODY_WEIGHT_REQUIRED');
  assert.equal(fresh.getState().records.length, 0);
});
