const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const d = require('../miniprogram/lib/domain');
const { schedule, achievement } = require('../miniprogram/lib/achievement');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { validateOperation } = require('../cloudfunctions/fitcheckin/validation');
const { createDatabase } = require('./helpers/document-db');
const copy = value => JSON.parse(JSON.stringify(value));
const bench = weight => ({ ...d.PRESETS[0], entryId: 'bench-entry', weight });
const days = weight => [[bench(weight)], [], [bench(weight)], [], [], [], []];
const cycle = (id = 'cycle-a', startWeek = '2020-10-05', weeks = ['light', 'light', 'light', 'light', 'medium', 'medium', 'medium', 'medium']) => ({ id, name: '8周渐进', startWeek, plans: [{ id: 'light', templateId: 'light-template', name: '轻度', days: days(20) }, { id: 'medium', templateId: 'medium-template', name: '中度', days: days(40) }].filter(p => weeks.includes(p.id)), weeks });
function fixture() {
  const db = createDatabase(), transport = createDocumentTransport(db, 'wxe25930a2cdce35d0');
  let clock = '2020-10-05T08:00:00Z';
  function device(owner = 'cycle-user', disk = new Map()) {
    const control = { online: true, drop: false };
    const handler = createHandler({ getWXContext: () => ({ OPENID: owner, APPID: 'wxe25930a2cdce35d0' }), transport, now: () => Date.parse(clock) });
    const options = { now: () => new Date(clock), storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, copy(value)) }, call: async (action, payload) => {
      if (!control.online) throw new Error('offline');
      const result = await handler({ action, ...payload });
      if (control.drop && action === 'mutate') { control.drop = false; throw new Error('lost reply'); }
      return result;
    } };
    return { store: createStore(options), options, disk, control, handler };
  }
  return { db, device, transport, time: value => { clock = value; } };
}

test('4 light + 4 medium weeks switch on Monday and stop after week 8', () => {
  const state = { program: { id: 'program', from: '2020-10-05', cycles: [cycle()] }, records: [], overrides: [], templates: [], profile: {} };
  assert.equal(d.resolveDay(state, '2020-10-26').items[0].weight, 20);
  assert.equal(d.resolveDay(state, '2020-11-02').items[0].weight, 40);
  assert.equal(d.resolveDay(state, '2020-11-23').weekNumber, 8);
  assert.equal(d.cycleEnd(cycle()), '2020-11-29');
  assert.equal(d.resolveDay(state, '2020-11-30').hasPlan, false);
  assert.equal(d.cycleStatus(state, '2020-11-23').needsNext, true);
  assert.equal(d.cycleStatus(state, '2020-11-30').ended.id, 'cycle-a');
  assert.equal(d.cycleEnd(cycle('year', '2020-12-28', ['light', 'light'])), '2021-01-10');
  assert.equal(d.cycleEnd(cycle('leap', '2020-02-24', ['light'])), '2020-03-01');
});

test('scheduled copies survive template deletion, week override restores, started daily snapshot wins', async () => {
  const f = fixture(), a = f.device(); await a.store.init();
  await a.store.saveTemplate({ id: 'light-template', name: 'Light', days: days(20) });
  await a.store.saveCycle(cycle()); await a.store.retrySync();
  await a.store.deleteTemplate('light-template'); await a.store.retrySync();
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-05').items[0].weight, 20);
  await a.store.saveOverride({ id: '2020-10-05', templateId: 'light-template', cycleId: 'cycle-a', planId: 'light', days: days(25) });
  await a.store.startToday('bench-entry'); await a.store.completeTodaySet('bench-entry', 0);
  await a.store.deleteOverride('2020-10-05'); await a.store.retrySync();
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-05').items[0].weight, 25);
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-07').items[0].weight, 20);
  assert.equal(d.calculateRecord(a.store.getState().records[0]).volume, 250);
  const edited = copy(a.store.getState().program.cycles[0]); edited.weeks[0] = 'medium';
  await a.store.saveCycle(edited); await a.store.retrySync();
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-05').items[0].weight, 25);
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-07').items[0].weight, 40);
  assert.equal(a.store.getState().sync.status, 'idle');
});

test('reassigning a week invalidates its old override, including on another device', async () => {
  const f = fixture(), a = f.device(); await a.store.init(); await a.store.saveCycle(cycle());
  await a.store.saveOverride({ id: '2020-10-12', templateId: 'light-template', cycleId: 'cycle-a', planId: 'light', days: days(99) });
  const edit = copy(a.store.getState().program.cycles[0]); edit.weeks[1] = 'medium'; await a.store.saveCycle(edit); await a.store.retrySync();
  const b = f.device(); await b.store.init();
  assert.equal(d.resolveDay(b.store.getState(), '2020-10-12').items[0].weight, 40);
  await assert.rejects(a.store.saveOverride({ id: '2020-10-12', templateId: 'light-template', cycleId: 'cycle-a', planId: 'light', days: days(99) }), /安排已变化/);
});

test('legacy plan continues until first future cycle and never resumes after it expires', async () => {
  const f = fixture(), a = f.device(); await a.store.init();
  await a.store.saveTemplate({ id: 'legacy', name: 'Old', days: days(10) }); await a.store.activateTemplate('legacy');
  await a.store.saveCycle(cycle('future', '2020-10-19', ['medium'])); await a.store.retrySync();
  const state = a.store.getState();
  assert.equal(d.resolveDay(state, '2020-10-12').items[0].weight, 10);
  assert.equal(d.resolveDay(state, '2020-10-19').items[0].weight, 40);
  assert.equal(d.resolveDay(state, '2020-10-26').hasPlan, false);
  const history = schedule(state, '2020-10-05');
  assert.equal(history.mask, 0); assert.equal(history.weeks.length, 3);
});

test('finite schedule skips rest and unscheduled gaps; a missed scheduled day breaks continuity after template edits', async () => {
  const f = fixture(), a = f.device(); await a.store.init();
  await a.store.saveCycle(cycle('first', '2020-10-05', ['light'])); await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  f.time('2020-10-07T08:00:00Z'); await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  assert.equal(achievement(a.store.getState(), '2020-10-07').streak, 2);
  f.time('2020-10-19T08:00:00Z'); await a.store.saveCycle(cycle('second', '2020-10-19', ['medium'])); await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  assert.equal(achievement(a.store.getState(), '2020-10-19').streak, 3);
  f.time('2020-10-21T08:00:00Z'); await a.store.startToday('bench-entry'); await a.store.retrySync();
  f.time('2020-10-26T08:00:00Z'); await a.store.saveCycle(cycle('third', '2020-10-26', ['light'])); await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  assert.equal(achievement(a.store.getState(), '2020-10-26').streak, 1);
  assert.equal(achievement(a.store.getState(), '2020-10-26').restarted, true);
});

test('cycle edits survive offline restart, lost acknowledgement and Beijing midnight', async () => {
  const f = fixture(), a = f.device(); await a.store.init(); a.control.online = false;
  await a.store.saveCycle(cycle()); await a.store.retrySync();
  const restart = createStore(a.options); await restart.init();
  assert.equal(restart.getState().program.cycles[0].weeks.length, 8);
  f.time('2020-10-06T08:00:00Z'); a.control.online = true; a.control.drop = true;
  await restart.retrySync(); assert.ok(restart.getState().sync.pendingCount > 0);
  await restart.retrySync(); assert.equal(restart.getState().sync.pendingCount, 0);
  assert.equal(f.db.rows().filter(r => r.kind === 'program').length, 1);
  assert.equal(f.db.rows().find(r => r.kind === 'program').revision, 1);
  const b = f.device(); await b.store.init(); assert.deepEqual(b.store.getState().program, restart.getState().program);
});

test('editing this week after a missed day cannot erase the earlier scheduled failure', async () => {
  const f = fixture(), a = f.device(); await a.store.init(); await a.store.saveCycle(cycle('first', '2020-10-05', ['light']));
  await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  f.time('2020-10-09T08:00:00Z');
  await a.store.saveOverride({ id: '2020-10-05', cycleId: 'first', planId: 'light', templateId: 'light-template', days: [[], [], [], [], [], [], []] }); await a.store.retrySync();
  f.time('2020-10-12T08:00:00Z'); await a.store.saveCycle(cycle('second', '2020-10-12', ['light'])); await a.store.completeTodaySet('bench-entry', 0); await a.store.retrySync();
  assert.equal(achievement(a.store.getState(), '2020-10-12').streak, 1);
  assert.equal(a.store.getState().program.scheduleHistory[0].from, '2020-10-05');
});

test('a backend without cycle capability rejects scheduling before any optimistic write', async () => {
  const disk = new Map();
  const store = createStore({ storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, copy(value)) }, call: async () => ({ code: 0, data: { openid: 'old-server', entities: [] } }) });
  await store.init();
  await assert.rejects(store.saveCycle(cycle()), e => e.code === 'SERVER_UPDATE_REQUIRED');
  assert.equal(store.getState().program, null); assert.equal(store.getState().sync.pendingCount, 0);
});

test('concurrent schedules conflict as one unit; stale drafts and overlaps cannot silently replace weeks', async () => {
  const f = fixture(), a = f.device(), b = f.device(); await a.store.init(); await b.store.init();
  a.control.online = false; b.control.online = false;
  await a.store.saveCycle(cycle()); await a.store.retrySync();
  await b.store.saveCycle(cycle('other', '2020-11-30', ['medium'])); await b.store.retrySync();
  a.control.online = true; await a.store.retrySync(); b.control.online = true; await b.store.retrySync();
  assert.equal(b.store.getState().sync.conflicts[0].kind, 'program');
  assert.equal(b.store.getState().program.cycles[0].id, 'other');
  await b.store.resolveConflict(b.store.getState().sync.conflicts[0].id, 'cloud');
  assert.equal(b.store.getState().sync.status, 'idle');
  assert.deepEqual(b.store.getState().program.scheduleHistory, a.store.getState().program.scheduleHistory);
  assert.equal(b.store.getState().program.cycles[0].id, 'cycle-a');
  await assert.rejects(b.store.saveCycle(cycle('overlap', '2020-11-02', ['medium'])), /重叠/);
  await assert.rejects(b.store.saveCycle(cycle('next', '2020-11-30', ['medium']), 0), err => err.code === 'STALE_DRAFT');
  await b.store.saveCycle(cycle('next', '2020-11-30', ['medium'])); await b.store.retrySync();
  assert.equal(b.store.getState().sync.status, 'idle');
  assert.equal(d.cycleStatus(b.store.getState(), '2020-11-23').needsNext, false);
  assert.equal(d.resolveDay(b.store.getState(), '2020-11-30').hasPlan, true);
  const isolated = f.device('other-user'); await isolated.store.init(); assert.equal(isolated.store.getState().program, null);
});

test('past week snapshots are immutable and only future cycles can be cancelled', async () => {
  const f = fixture(), a = f.device(); await a.store.init(); await a.store.saveCycle(cycle()); await a.store.retrySync();
  f.time('2020-10-12T08:00:00Z');
  const edit = copy(a.store.getState().program.cycles[0]); edit.weeks[0] = 'medium';
  await assert.rejects(a.store.saveCycle(edit), /过去/);
  await assert.rejects(a.store.deleteCycle('cycle-a'), /已开始/);
  edit.weeks[0] = 'light'; edit.startWeek = '2020-10-19'; await assert.rejects(a.store.saveCycle(edit), /移动/);
  await a.store.saveCycle(cycle('next', '2020-11-30', ['light'])); await a.store.deleteCycle('next'); await a.store.retrySync();
  assert.equal(a.store.getState().program.cycles.length, 1);
  const request = { operationId: 'forged-edit', kind: 'program', id: 'program', deleted: false, baseRevision: a.store.getState().revisions['program:program'], occurredAt: '2020-10-12T08:00:00Z', body: copy(a.store.getState().program) };
  request.body.cycles[0].weeks[0] = 'medium';
  const result = await a.handler({ action: 'mutate', operation: request }); assert.equal(result.code, 'VALIDATION');
  assert.equal(f.db.rows().find(r => r.kind === 'program').body.cycles[0].weeks[0], 'light');
});

test('local cycle conflict resolution after midnight uses a new timestamp and retains immutable cloud weeks', async () => {
  const f = fixture(), a = f.device(); await a.store.init(); await a.store.saveCycle(cycle()); await a.store.retrySync();
  const b = f.device(); await b.store.init();
  a.control.online = false; b.control.online = false;
  const local = copy(b.store.getState().program.cycles[0]); local.name = 'Local name';
  const remote = copy(a.store.getState().program.cycles[0]); remote.name = 'Cloud name';
  await a.store.saveCycle(remote); await a.store.retrySync(); await b.store.saveCycle(local); await b.store.retrySync();
  a.control.online = true; await a.store.retrySync();
  f.time('2020-10-06T08:00:00Z'); b.control.online = true; await b.store.retrySync();
  await b.store.resolveConflict(b.store.getState().sync.conflicts[0].id, 'local');
  assert.equal(b.store.getState().sync.status, 'idle');
  assert.equal(b.store.getState().program.cycles[0].name, 'Local name');
  const c = f.device(); await c.store.init(); assert.equal(c.store.getState().program.cycles[0].name, 'Local name');
});

test('server rejects malformed cycles, missing week assignments, overlapping dates and whole-program deletion', () => {
  const valid = { operationId: 'program-op', kind: 'program', id: 'program', deleted: false, baseRevision: 0, occurredAt: '2020-10-05T08:00:00Z', body: { id: 'program', from: '2020-10-05', cycles: [cycle()] } };
  assert.doesNotThrow(() => validateOperation(valid));
  const bad = mutate => { const request = copy(valid); mutate(request); assert.throws(() => validateOperation(request)); };
  bad(o => { o.body.cycles[0].weeks[0] = 'missing'; });
  bad(o => { o.body.cycles[0].startWeek = '2020-10-06'; });
  bad(o => { o.body.cycles[0].plans[0].days[0][0].sets = 0; });
  bad(o => { o.body.cycles.push(cycle('duplicate-date')); });
  bad(o => { o.body.cycles[0].weeks = Array(53).fill('light'); });
  bad(o => { o.body.cycles[0].unknown = 'x'; });
  bad(o => { o.deleted = true; o.body = null; });
});

test('starting a cycle midweek keeps existing today snapshot and selects the current-week editor source', async () => {
  const f = fixture(); f.time('2020-10-07T08:00:00Z'); const a = f.device(); await a.store.init();
  await a.store.saveTemplate({ id: 'old', name: 'Old', days: days(10) }); await a.store.activateTemplate('old'); await a.store.startToday('bench-entry');
  await a.store.saveCycle(cycle()); await a.store.retrySync();
  assert.equal(a.store.getState().program.from, '2020-10-07');
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-07').items[0].weight, 10);
  assert.equal(d.scheduledWeek(a.store.getState(), '2020-10-05').plan.name, '轻度');
  assert.equal(d.resolveDay(a.store.getState(), '2020-10-12').items[0].weight, 20);
});

test('native cycle editor bulk-arranges 4+4 weeks, deduplicates snapshots and saves through real store/backend', async () => {
  const f = fixture(), a = f.device(); await a.store.init();
  await a.store.saveTemplate({ id: 'light-template', name: '轻度', days: days(20) });
  await a.store.saveTemplate({ id: 'medium-template', name: '中度', days: days(40) }); await a.store.retrySync();
  const ui = { domain: { ...d, today: () => '2020-10-05' }, store: a.store, clone: copy, ready: () => true, message: e => e.message };
  let definition;
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/packages/manage/cycle-edit/index.js'), 'utf8'), { require: () => ui, Page: p => { definition = p; }, wx: { showToast() {}, navigateBack() {}, disableAlertBeforeUnload() {} } });
  const page = { ...definition, data: copy(definition.data), _query: {}, setData(values) { Object.assign(this.data, values); } };
  page.render(a.store.getState()); page.setData({ repeatCount: 4 }); page.addWeeks(); page.setData({ templateIndex: 1 }); page.addWeeks();
  assert.equal(page.data.rows.length, 8); assert.equal(page._body.plans.length, 2); assert.equal(page.data.end, '2020-11-29');
  await page.save(); await a.store.retrySync();
  assert.equal(page.data.error, ''); assert.equal(a.store.getState().sync.pendingCount, 0);
  const saved = a.store.getState().program.cycles[0]; assert.equal(saved.weeks.length, 8); assert.equal(saved.plans.length, 2);
  assert.equal(d.resolveDay(a.store.getState(), '2020-11-02').items[0].weight, 40);
});
