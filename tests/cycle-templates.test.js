const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const d = require('../miniprogram/lib/domain');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
const { createDatabase } = require('./helpers/document-db');
const copy = value => JSON.parse(JSON.stringify(value));
const days = weight => [[{ ...d.PRESETS[0], entryId: 'bench-entry', weight }], [], [], [], [], [], []];
const template = () => ({ id: 'progressive', name: '8周渐进', weeks: [...Array(4).fill('light'), ...Array(4).fill('medium')] });
function fixture() {
  const db = createDatabase(), transport = createDocumentTransport(db, 'wxe25930a2cdce35d0');
  const clock = '2020-10-05T08:00:00Z';
  function device(owner = 'template-owner', disk = new Map()) {
    const control = { online: true, drop: false };
    const handler = createHandler({ getWXContext: () => ({ OPENID: owner, APPID: 'wxe25930a2cdce35d0' }), transport, now: () => Date.parse(clock) });
    const options = { now: () => new Date(clock), storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, copy(value)) }, call: async (action, payload) => {
      if (!control.online) throw new Error('offline');
      const result = await handler({ action, ...payload });
      if (action === 'mutate' && control.drop) { control.drop = false; throw new Error('lost reply'); }
      return result;
    } };
    return { store: createStore(options), options, control, handler };
  }
  async function seeded() {
    const a = device(); await a.store.init();
    await a.store.saveTemplate({ id: 'light', name: '轻度', days: days(20) });
    await a.store.saveTemplate({ id: 'medium', name: '中度', days: days(40) }); await a.store.retrySync(); return a;
  }
  return { db, device, seeded };
}
function editor(store, query) {
  const ui = { domain: { ...d, today: () => '2020-10-05' }, store, clone: copy, ready: () => true, message: e => e.message, confirm: async () => true };
  let definition;
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/packages/manage/cycle-edit/index.js'), 'utf8'), { require: () => ui, Page: page => { definition = page; }, wx: { showToast() {}, navigateBack() {}, disableAlertBeforeUnload() {} } });
  const page = { ...definition, data: copy(definition.data), _query: query, setData(values) { Object.assign(this.data, values); } };
  page.render(store.getState()); return page;
}

test('reusable 4+4 template schedules a full eight weeks after an existing four-week cycle', async () => {
  const f = fixture(), a = await f.seeded();
  await a.store.saveCycleTemplate(template());
  assert.equal(a.store.getState().program, null);
  await a.store.saveCycle(d.cycleFromTemplate(a.store.getState(), { name: 'First', weeks: Array(4).fill('light') }, '2020-10-05'));
  await a.store.retrySync();
  const page = editor(a.store, { cycleTemplate: 'progressive' });
  assert.equal(page.data.startWeek, '2020-11-02'); assert.equal(page.data.weekCount, 8);
  assert.equal(page.data.end, '2020-12-27'); assert.equal(page._body.plans.length, 2);
  await page.save(); await a.store.retrySync(); assert.equal(a.store.getState().sync.status, 'idle');
  assert.equal(a.store.getState().program.cycles.length, 2);
  assert.equal(d.resolveDay(a.store.getState(), '2020-11-23').items[0].weight, 20);
  assert.equal(d.resolveDay(a.store.getState(), '2020-11-30').items[0].weight, 40);
});

test('latest week parameters are used on reuse while edits or deletion of the cycle template preserve scheduled copies', async () => {
  const f = fixture(), a = await f.seeded(); await a.store.saveCycleTemplate(template());
  const first = d.cycleFromTemplate(a.store.getState(), template(), '2020-10-05'); await a.store.saveCycle(first); await a.store.retrySync();
  await a.store.saveTemplate({ id: 'light', name: '轻度新版', days: days(25) }); await a.store.retrySync();
  const next = d.cycleFromTemplate(a.store.getState(), template(), '2020-11-30'); await a.store.saveCycle(next); await a.store.retrySync();
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-05').items[0].weight, 20);
  assert.equal(d.resolveDay(a.store.getState(), '2020-11-30').items[0].weight, 25);
  const before = copy(a.store.getState().program);
  await a.store.saveCycleTemplate({ ...template(), weeks: ['medium'] }); await a.store.deleteCycleTemplate('progressive'); await a.store.retrySync();
  assert.deepEqual(a.store.getState().program, before);
  assert.equal(a.store.getState().cycleTemplates.length, 0);
  assert.equal(a.store.getState().sync.status, 'idle');
});

test('native editor creates, reorders, copies and saves cycle templates without scheduling any dates', async () => {
  const f = fixture(), a = await f.seeded();
  const page = editor(a.store, { mode: 'template' });
  page.setData({ repeatCount: 4, name: '8周模板' }); page.addWeeks(); page.setData({ templateIndex: 1 }); page.addWeeks();
  assert.equal(page.data.rows.length, 8); assert.equal(page.data.isTemplate, true);
  assert.equal(page.data.rows.some(r => r.locked || r.current), false);
  page.move({ currentTarget: { dataset: { index: 4, delta: -1 } } });
  assert.equal(page.data.rows[3].name, '中度');
  await page.save(); await a.store.retrySync();
  assert.equal(page.data.error, ''); assert.equal(a.store.getState().program, null);
  const saved = a.store.getState().cycleTemplates[0]; assert.equal(saved.weeks[3], 'medium'); assert.equal(saved.weeks.length, 8);
  const duplicate = await a.store.saveCycleTemplate({ name: saved.name + ' 副本', weeks: saved.weeks }, 0); await a.store.retrySync();
  assert.notEqual(duplicate.id, saved.id); assert.deepEqual(duplicate.weeks, saved.weeks);
  const manual = editor(a.store, {}); await manual.loadCycleTemplate({ detail: { value: 0 } });
  assert.equal(manual.data.weekCount, 8); assert.equal(manual.data.name, '8周模板');
});

test('existing cycles can be saved as a template without modifying their schedule or history', async () => {
  const f = fixture(), a = await f.seeded();
  const cycle = d.cycleFromTemplate(a.store.getState(), template(), '2020-10-05'); await a.store.saveCycle(cycle); await a.store.retrySync();
  const before = copy(a.store.getState().program);
  const page = editor(a.store, { id: cycle.id }); await page.saveAsTemplate(); await a.store.retrySync();
  assert.equal(page.data.error, ''); assert.deepEqual(a.store.getState().program, before);
  assert.deepEqual(a.store.getState().cycleTemplates[0].weeks, template().weeks);
});

test('cycle templates survive offline restart and deduplicated lost replies; different owners cannot see them', async () => {
  const f = fixture(), a = await f.seeded(); a.control.online = false;
  await a.store.saveCycleTemplate(template()); await a.store.retrySync();
  const restart = createStore(a.options); await restart.init();
  assert.equal(restart.getState().cycleTemplates[0].weeks.length, 8);
  a.control.online = true; a.control.drop = true; await restart.retrySync(); await restart.retrySync();
  assert.equal(restart.getState().sync.status, 'idle');
  assert.equal(f.db.rows().find(r => r.kind === 'cycleTemplate').revision, 1);
  const b = f.device(); await b.store.init(); assert.deepEqual(b.store.getState().cycleTemplates, restart.getState().cycleTemplates);
  const other = f.device('other-owner'); await other.store.init(); assert.equal(other.store.getState().cycleTemplates.length, 0);
});

test('cycle template conflicts retain local contents, resolve by version and reject stale drafts', async () => {
  const f = fixture(), a = await f.seeded(); await a.store.saveCycleTemplate(template()); await a.store.retrySync();
  const b = f.device(); await b.store.init(); b.control.online = false;
  await b.store.saveCycleTemplate({ ...template(), name: 'Local', weeks: ['light', 'medium'] }, 1); await b.store.retrySync();
  await a.store.saveCycleTemplate({ ...template(), name: 'Remote' }, 1); await a.store.retrySync();
  b.control.online = true; await b.store.retrySync();
  assert.equal(b.store.getState().sync.conflicts[0].kind, 'cycleTemplate');
  assert.equal(b.store.getState().cycleTemplates[0].name, 'Local');
  await b.store.resolveConflict(b.store.getState().sync.conflicts[0].id, 'local'); assert.equal(b.store.getState().sync.status, 'idle');
  await a.store.refresh(); assert.equal(a.store.getState().cycleTemplates[0].name, 'Local');
  await assert.rejects(a.store.saveCycleTemplate(template(), 1), e => e.code === 'STALE_DRAFT');
});

test('referenced weekly templates cannot be deleted locally; remote missing references can be repaired in the editor', async () => {
  const f = fixture(), a = await f.seeded(); await a.store.saveCycleTemplate(template()); await a.store.retrySync();
  await assert.rejects(a.store.deleteTemplate('light'), /引用/);
  // A second device with an older cache may delete a week before seeing its new references.
  const result = await a.handler({ action: 'mutate', operation: { operationId: 'remote-delete', kind: 'template', id: 'light', body: null, deleted: true, baseRevision: 1, occurredAt: '2020-10-05T08:00:00Z' } });
  assert.equal(result.code, 0); await a.store.refresh();
  assert.throws(() => d.cycleFromTemplate(a.store.getState(), template(), '2020-10-05'), /已删除/);
  const page = editor(a.store, { mode: 'template', id: 'progressive' }); assert.equal(page.data.rows[0].name, '已删除的周模板');
  for (let index = 0; index < 4; index++) page.replace({ currentTarget: { dataset: { index } }, detail: { value: 0 } });
  await page.save(); await a.store.retrySync(); assert.equal(page.data.error, '');
  assert.ok(a.store.getState().cycleTemplates[0].weeks.every(id => id === 'medium'));
  await a.store.deleteCycleTemplate('progressive'); await a.store.deleteTemplate('medium'); await a.store.retrySync();
  assert.equal(a.store.getState().templates.length, 0); assert.equal(a.store.getState().sync.status, 'idle');
});

test('cycle template validation rejects malformed references, empty/overlong sequences and unsupported backends', async () => {
  const valid = { operationId: 'op-template', kind: 'cycleTemplate', id: 'progressive', deleted: false, body: template(), baseRevision: 0, occurredAt: '2020-10-05T08:00:00Z' };
  assert.doesNotThrow(() => validateOperation(valid));
  for (const weeks of [[], Array(53).fill('light'), [null], [1], ['not valid'], [template()]]) assert.throws(() => validateOperation({ ...valid, body: { ...template(), weeks } }));
  assert.throws(() => validateOperation({ ...valid, body: { ...template(), startWeek: '2020-10-05' } }));
  const store = createStore({ storage: { get: () => null, set() {} }, call: async () => ({ code: 0, data: { openid: 'old', entities: [], cyclesSupported: true } }) });
  await store.init(); await assert.rejects(store.saveCycleTemplate(template()), e => e.code === 'SERVER_UPDATE_REQUIRED');
  assert.equal(store.getState().sync.pendingCount, 0);
});
