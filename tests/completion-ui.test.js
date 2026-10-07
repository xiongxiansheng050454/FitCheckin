const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const d = require('../miniprogram/lib/domain');
const date = d.today();
function fixture(initiallyComplete = false, existingDisk) {
  const item = { ...d.PRESETS[0], weight: 40, entryId: 'a' }, disk = existingDisk || new Map([['fitcheckin:last-owner', 'owner']]);
  let page, listener, vibrates = 0, renderRequests = 0;
  let clock = Date.now(); const timers = new Map(); let timerId = 0;
  const state = { profile: { activeTemplateId: 'p', bodyWeight: 70 }, templates: [{ id: 'p', days: Array.from({ length: 7 }, () => [item]) }], overrides: [], records: initiallyComplete ? [{ date, items: [item], completed: ['a'], bodyWeight: 70 }] : [], identityReady: true, sync: { status: 'idle', pendingCount: 0 } };
  const bar = { setData(value) { Object.assign(this, value); } };
  function ensureRecord() { return state.records[0] || { date, items: [item], completed: [], completedSets: {}, bodyWeight: 70 }; }
  const ui = { ...require('../miniprogram/pages/ui'), store: { accountKey: () => 'fitcheckin:test:owner', getState: () => state, async startToday() { state.records = [ensureRecord()]; listener(state); }, async completeTodaySet(id, index) {
    const record = ensureRecord(), count = d.completedSets(record, item); assert.equal(index, count);
    record.completedSets = { a: count + 1 }; record.completed = count + 1 === item.sets ? ['a'] : []; state.records = [record]; listener(state);
  }, async undoTodaySet(id, index) { const record = ensureRecord(); assert.equal(index, d.completedSets(record, item) - 1); record.completedSets = { a: index }; record.completed = []; listener(state); } }, ready: () => true, navigate() { throw new Error('Must stay on Today'); } };
  const file = require.resolve('../miniprogram/pages/today/index'), localRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    wx: { getStorageSync: key => disk.get(key), setStorageSync: (key, value) => disk.set(key, value), vibrateShort() { vibrates++; } },
    Page(definition) { page = definition; }, Date: class extends Date { static now() { return clock; } }, setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
    require: name => name === '../ui' ? ui : name.includes('poster-runtime') ? { loadCode: async () => { renderRequests++; } } : localRequire(name)
  });
  page.data = { ...page.data }; page.setData = value => Object.assign(page.data, value); page.getTabBar = () => bar;
  listener = state => page.render(state); listener(state);
  return { page, state, listener, bar, disk, vibrates: () => vibrates, warmed: () => renderRequests, advance(ms) { clock += ms; }, tick() { [...timers.values()].forEach(fn => fn()); } };
}

const event = index => ({ currentTarget: { dataset: { id: 'a', index } } });
test('the last set instantly celebrates, warms the poster, stays on Today and fires once', async () => {
  const f = fixture();
  await f.page.startExercise(event());
  assert.equal(f.page.data.celebrationOpen, false); assert.equal(f.page.data.items[0].groups.length, 3);
  await f.page.completeSet(event(0)); f.page.skipRest();
  await f.page.completeSet(event(1)); f.page.skipRest();
  const checked = f.page.completeSet(event(2));
  assert.equal(f.page.data.celebrationOpen, true);
  assert.equal(f.vibrates(), 1);
  assert.equal(f.page.data.posterModel.volume, 1200);
  assert.equal(f.bar.hidden, true);
  await checked;
  f.page.poster(); assert.equal(f.page.data.posterOpen, true); assert.equal(f.page.data.celebrationOpen, false);
  f.page.closePoster(); assert.equal(f.bar.hidden, false);
  await f.page.undoSet(event(2));
  assert.equal(f.page.data.posterModel, null);
  await f.page.completeSet(event(2));
  assert.equal(f.vibrates(), 1); assert.equal(f.page.data.celebrationOpen, false);
  assert.equal(f.warmed(), 1);
});

test('background return recomputes rest, vibrates once at expiry and preserves the session after a page restart', async () => {
  const f = fixture(); f.page.onShow(); await f.page.startExercise(event()); await f.page.completeSet(event(0));
  assert.equal(f.page.data.restOpen, true); assert.equal(f.page.data.rest.remaining, 90);
  assert.equal(f.page.data.totals.volume, '400'); assert.equal(f.page.data.celebrationOpen, false);
  await f.page.completeSet(event(1)); assert.equal(f.state.records[0].completedSets.a, 1);
  f.page.onHide(); f.advance(35000); f.page.onShow();
  assert.equal(f.page.data.rest.remaining, 55); assert.equal(f.vibrates(), 0);
  f.page.onHide(); f.advance(90000); f.page.onShow();
  assert.equal(f.page.data.rest.remaining, 0); assert.equal(f.page.data.rest.overtime, 35);
  assert.match(f.page.data.rest.title, /结束/); assert.equal(f.vibrates(), 1);
  f.page.onHide(); f.page.onShow(); assert.equal(f.vibrates(), 1);
  f.page._training = null; f.page.render(f.state); assert.equal(f.page.data.rest.remaining, 0); assert.equal(f.page.data.activeId, 'a');
  f.page.continueTraining(); assert.equal(f.page.data.restOpen, false); assert.equal(f.bar.hidden, false);
  await f.page.completeSet(event(1)); assert.equal(f.state.records[0].completedSets.a, 2);
  f.page.onHide();
});

test('loading or syncing an already completed day never opens a celebration', () => {
  const f = fixture(true); f.listener(f.state); f.listener(f.state);
  assert.equal(f.vibrates(), 0); assert.equal(f.page.data.celebrationOpen, false);
});

test('whole-row confirmation only accepts the next set and the foreground rest timer vibrates once', async () => {
  const f = fixture(); f.page.onShow(); await f.page.startExercise(event());
  await f.page.tapSetRow(event(1)); assert.equal(f.page.data.totals.volume, '0');
  await f.page.tapSetRow(event(0)); assert.equal(f.page.data.totals.volume, '400');
  f.advance(90000); f.tick(); assert.equal(f.vibrates(), 1); assert.equal(f.page.data.rest.remaining, 0);
  f.tick(); assert.equal(f.vibrates(), 1);
  f.page.continueTraining(); await f.page.tapSetRow(event(0)); assert.equal(f.page.data.totals.volume, '400');
  f.page.onHide();
});

test('background render discards old results after cancellation and retries failed work', async () => {
  let component, release, fails = false, calls = 0;
  const runtime = { render: async (host, model) => { calls++; assert.ok(Array.isArray(model.items)); if (fails) throw new Error('offline'); return new Promise(resolve => { release = resolve; }); } };
  const file = require.resolve('../miniprogram/components/poster-preview/index'), localRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Component(definition) { component = definition; }, wx: { nextTick: fn => fn() },
    require: name => name.includes('poster-runtime') ? runtime : name.includes('/pages/ui') ? { message: e => e.message } : localRequire(name)
  });
  Object.assign(component, component.methods);
  component.data = { ...component.data, model: null }; component._ready = true;
  component.setData = value => Object.assign(component.data, value); component.triggerEvent = () => {};
  const model = JSON.stringify({ mode: 'day', period: date, volume: 1200, weightedVolume: 1200, cardioMinutes: 0, items: [{ name: 'bench' }] });
  component.data.source = model; component.updateModel(model);
  const job = component._running;
  assert.equal(job, true); assert.equal(component.data.loading, true);
  component.updateModel(''); release('old.png'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(component.data.imagePath, '');
  fails = true; component.updateModel(model); await new Promise(resolve => setImmediate(resolve));
  assert.equal(component.data.error, 'offline');
  fails = false; component.retry(); release('new.png'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(component.data.imagePath, 'new.png'); assert.equal(calls, 3);
});
