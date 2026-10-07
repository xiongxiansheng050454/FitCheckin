const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const d = require('../miniprogram/lib/domain');
const rpe = require('../miniprogram/lib/rpe');
const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const { createStore } = require('../miniprogram/lib/store');
const copy = v => JSON.parse(JSON.stringify(v));
const operation = body => ({ operationId: 'rpe-op', kind: 'exercise', id: body.id, body, deleted: false, baseRevision: 0, occurredAt: '2020-10-05T08:00:00Z' });

test('gym presets have personal weights, time-based cardio and numeric RPE without distance or speed', () => {
  assert.ok(d.PRESETS.filter(e => e.type === 'weighted').every(e => e.weight === 0));
  assert.match(d.exerciseSummary(d.PRESETS[0]), /重量待填写/);
  assert.equal(d.PRESETS.find(e => e.id === 'run').name, '跑步机');
  for (const item of d.PRESETS.filter(e => e.type === 'cardio')) {
    assert.ok(item.durationMinutes > 0);
    assert.equal(item.distanceKm, 0); assert.equal(item.reps, 0); assert.equal(item.intensity, '');
    assert.match(d.exerciseSummary(item), /(?:分钟|秒).*RPE/);
    assert.doesNotThrow(() => validateOperation(operation(item)));
  }
});

test('domain and backend validate both RPE scales including zero, endpoints and legacy snapshots', () => {
  for (const type of ['weighted', 'bodyweight', 'cardio']) {
    const base = d.PRESETS.find(e => e.type === type), range = rpe.scale(type);
    for (const value of [range.min, range.max, 8.5, null, undefined]) {
      const item = { ...base, rpe: value };
      if (value === undefined) delete item.rpe;
      assert.doesNotThrow(() => d.validateExercise(item));
      assert.doesNotThrow(() => validateOperation(operation(item)));
    }
    for (const value of [range.min - 1, range.max + 1, '8', NaN, Infinity, {}, true]) {
      const item = { ...base, rpe: value };
      assert.throws(() => d.validateExercise(item));
      assert.throws(() => validateOperation(operation(item)));
      assert.throws(() => validateOperation({ ...operation(item), kind: 'template', id: 'p', body: { id: 'p', name: 'Plan', days: [[{ ...item, entryId: 'a' }], [], [], [], [], [], []] } }));
    }
  }
  const legacy = { ...d.PRESETS.find(e => e.id === 'run'), name: '跑步', distanceKm: 5, intensity: '轻松' }; delete legacy.rpe;
  assert.doesNotThrow(() => validateOperation(operation(legacy)));
  assert.match(d.exerciseSummary(legacy), /轻松/);
  assert.doesNotMatch(d.exerciseSummary(legacy), /km/);
  assert.match(d.exerciseSummary({ ...d.PRESETS[0], rpe: 0 }), /RPE 0/);
});

test('RPE explanations use RIR for strength and each Borg talk-test band for cardio', () => {
  assert.match(rpe.description('weighted', 8), /2 次/);
  assert.match(rpe.description('bodyweight', 10), /0 次/);
  for (const [value, text] of [[6, '完全没感觉'], [7, '像热身'], [9, '像热身'], [10, '能轻松聊天'], [12, '能轻松聊天'], [13, '有点喘'], [14, '有点喘'], [15, '蹦几个词'], [16, '蹦几个词'], [17, '接近极限'], [18, '接近极限'], [19, '完全撑不住'], [20, '完全撑不住']]) assert.ok(rpe.description('cardio', value).includes(text));
  assert.match(rpe.help('weighted'), /RIR/); assert.match(rpe.help('cardio'), /6–20/);
});

test('native editor switches RPE scales, opens help and saves personal weight/time without legacy intensity or distance', async () => {
  let definition, saved, help;
  const ui = { domain: d, clone: copy, ready: () => true, message: e => e.message, store: { saveExercise: async body => { saved = copy(body); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/packages/manage/exercise-edit/index.js'), 'utf8'), { require: id => id.endsWith('/rpe') ? rpe : ui, Page: value => { definition = value; }, wx: { showModal: value => { help = value; }, showToast() {}, navigateBack() {} } });
  const page = { ...definition, data: copy(definition.data), _query: { id: 'bench' }, setData(values) { for (const [key, value] of Object.entries(values)) { if (key === 'form.rpe') this.data.form.rpe = value; else this.data[key] = value; } } };
  page.render({ identityReady: true, exercises: [], revisions: {}, loading: false });
  assert.equal(page.data.fields.find(f => f.key === 'weight').value, '');
  page.field({ currentTarget: { dataset: { key: 'weight' } }, detail: { value: '32.5' } });
  page.rpeChange({ detail: { value: 0 } }); page.rpeHelp();
  assert.match(help.content, /RIR/); await page.save();
  assert.equal(saved.weight, 32.5); assert.equal(saved.rpe, 0);
  page.type({ detail: { value: 2 } }); assert.equal(page.data.rpeRange.min, 6); assert.equal(page.data.rpeRange.max, 20);
  assert.ok(page.data.fields.every(f => !['reps', 'distanceKm', 'intensity', 'weight'].includes(f.key)));
  page._form.distanceKm = 5; page._form.intensity = '每小时10公里';
  page.rpeChange({ detail: { value: 20 } }); page.rpeHelp(); await page.save();
  assert.match(help.content, /轻松聊天/);
  assert.equal(saved.rpe, 20); assert.equal(saved.distanceKm, 0); assert.equal(saved.intensity, ''); assert.deepEqual(saved.muscles, []);
  page.type({ detail: { value: 1 } }); assert.equal(page.data.rpeRange.min, 0); assert.equal(page.data.form.rpe, 8);
});

test('RPE survives offline persistence and cloud snapshots while later plan changes leave completed sets intact', async () => {
  const db = createDatabase(), disk = new Map(); let online = true;
  const handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'rpe-owner' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse('2020-10-05T08:00:00Z') });
  const options = { now: () => new Date('2020-10-05T08:00:00Z'), storage: { get: k => disk.get(k), set: (k, v) => disk.set(k, copy(v)) }, call: (action, payload) => online ? handler({ action, ...payload }) : Promise.reject(new Error('offline')) };
  const store = createStore(options); await store.init();
  const item = { ...d.PRESETS[0], weight: 32.5, rpe: 8, entryId: 'a' }, plan = { id: 'p', name: 'Gym', days: [[item], [], [], [], [], [], []] };
  await store.saveTemplate(plan); await store.activateTemplate('p'); await store.retrySync(); online = false;
  await store.startToday('a'); await store.completeTodaySet('a', 0);
  const restart = createStore(options); await restart.init(); online = true; await restart.retrySync();
  assert.equal(restart.getState().sync.pendingCount, 0);
  await restart.saveTemplate({ ...plan, days: [[{ ...item, rpe: 10, weight: 40 }], [], [], [], [], [], []] }); await restart.retrySync();
  const record = restart.getState().records[0]; assert.equal(record.items[0].rpe, 8); assert.equal(d.calculateRecord(record).volume, 325);
  const remote = db.rows().find(row => row.kind === 'record'); assert.equal(remote.body.items[0].rpe, 8);
});
