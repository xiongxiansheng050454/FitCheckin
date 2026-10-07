'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/document-db');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const d = require('../miniprogram/lib/domain');
const copy = value => JSON.parse(JSON.stringify(value));

test('store and cloud handler integrate through document transactions (local database model)', async t => {
  const db = createDatabase();
  const transport = createDocumentTransport(db, 'wxe25930a2cdce35d0');
  // Use a past Sunday for simulated cross-midnight offline operations.
  let clock = '2020-10-04T08:00:00Z';
  function device(owner, disk = new Map()) {
    const control = { online: true, dropReply: false, owner, appid: 'wxe25930a2cdce35d0' };
    const handler = createHandler({ getWXContext: () => ({ OPENID: control.owner, APPID: control.appid }), transport, now: () => Date.parse(clock) });
    const options = {
      now: () => new Date(clock),
      storage: { get: key => disk.get(key), set: (key, value) => disk.set(key, copy(value)) },
      call: async (action, payload) => {
        if (!control.online) throw new Error('offline');
        const response = await handler({ action, ...payload });
        if (action === 'mutate' && control.dropReply) { control.dropReply = false; throw new Error('lost acknowledgement'); }
        return response;
      }
    };
    return { control, disk, options, store: createStore(options) };
  }
  const bench = { ...d.PRESETS.find(e => e.id === 'bench'), weight: 40, entryId: 'bench-entry' };
  const week = items => [[], [], [], [], [], [], items];

  await t.test('week override, cardio, template/library edits and cancellation preserve the started snapshot', async () => {
    const a = device('workflow'); await a.store.init();
    const cardio = { ...d.PRESETS.find(e => e.id === 'rope'), sets: 3, durationMinutes: 3, id: 'custom-cardio', name: 'Custom cardio', entryId: 'cardio-entry', distanceKm: 0.2 };
    const library = { ...cardio }; delete library.entryId;
    await a.store.saveExercise(library);
    await a.store.saveTemplate({ id: 'plan', name: 'Weekly', days: week([bench, cardio]) });
    await a.store.saveProfile({ bodyWeight: 70, activeTemplateId: 'plan' });
    await a.store.saveOverride({ id: '2020-09-28', templateId: 'plan', days: week([{ ...bench, weight: 50 }, cardio]) });
    await a.store.retrySync();
    assert.equal(d.resolveDay(a.store.getState(), '2020-10-04').items[0].weight, 50);
    await a.store.toggleToday('bench-entry'); await a.store.retrySync();
    await a.store.saveProfile({ bodyWeight: 80 });
    await a.store.saveExercise({ ...library, durationMinutes: 10 });
    await a.store.saveTemplate({ id: 'plan', name: 'Changed', days: week([]) });
    await a.store.deleteOverride('2020-09-28'); await a.store.retrySync();
    await a.store.toggleToday('cardio-entry'); await a.store.retrySync();
    const restarted = createStore(a.options); await restarted.init();
    const record = restarted.getState().records[0];
    const month = d.calculateMonth([record], '2020-10');
    assert.equal(record.bodyWeight, 70);
    assert.equal(record.items[0].weight, 50);
    assert.equal(month.volume, 1500);
    assert.equal(month.cardioMinutes, 9);
    assert.equal(month.cardioKm, 0.6);
    assert.equal(month.cardioCount, 1);
    assert.equal(month.trainingDays, 1);
    await restarted.toggleToday('bench-entry'); await restarted.toggleToday('cardio-entry'); await restarted.retrySync();
    assert.equal(d.calculateMonth(restarted.getState().records, '2020-10').trainingDays, 0);
    assert.equal(restarted.getState().records[0].items.length, 2);
    assert.equal(restarted.getState().sync.status, 'idle');
  });

  await t.test('lost acknowledgement and offline midnight restart replay the same operation exactly once', async () => {
    clock = '2020-10-04T15:59:58Z';
    const a = device('offline'); await a.store.init();
    await a.store.saveTemplate({ id: 'plan', name: 'Weekly', days: week([bench]) });
    await a.store.activateTemplate('plan'); await a.store.retrySync();
    clock = '2020-10-04T15:59:59Z';
    a.control.dropReply = true;
    await a.store.toggleToday('bench-entry'); await a.store.retrySync();
    assert.equal(a.store.getState().sync.pendingCount, 1);
    a.control.online = false;
    clock = '2020-10-04T16:00:01Z';
    const restarted = createStore(a.options); await restarted.init();
    assert.equal(restarted.getState().records[0].date, '2020-10-04');
    await assert.rejects(restarted.toggleToday('bench-entry'), /动作不存在/);
    a.control.online = true; await restarted.retrySync();
    assert.equal(restarted.getState().sync.pendingCount, 0);
    const rows = db.rows().filter(row => row.ownerId === 'offline' && row.kind === 'record');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revision, 1);
    assert.equal(rows[0].body.startedAt, '2020-10-04T15:59:59.000Z');
    clock = '2020-10-04T08:00:00Z';
  });

  await t.test('two devices resolve profile conflicts with both local and cloud choices', async () => {
    const a = device('conflicts'); await a.store.init();
    await a.store.saveProfile({ bodyWeight: 60 }); await a.store.retrySync();
    const b = device('conflicts'); await b.store.init(); b.control.online = false;
    await b.store.saveProfile({ bodyWeight: 70 }); await b.store.retrySync();
    await a.store.saveProfile({ bodyWeight: 80 }); await a.store.retrySync();
    b.control.online = true; await b.store.retrySync();
    assert.equal(b.store.getState().profile.bodyWeight, 70);
    assert.equal(b.store.getState().sync.conflicts.length, 1);
    await b.store.resolveConflict(b.store.getState().sync.conflicts[0].id, 'local');
    await a.store.refresh(); assert.equal(a.store.getState().profile.bodyWeight, 70);
    b.control.online = false; await b.store.saveProfile({ bodyWeight: 65 }); await b.store.retrySync();
    await a.store.saveProfile({ bodyWeight: 75 }); await a.store.retrySync();
    b.control.online = true; await b.store.retrySync();
    await b.store.resolveConflict(b.store.getState().sync.conflicts[0].id, 'cloud');
    assert.equal(b.store.getState().profile.bodyWeight, 75);
    assert.equal(b.store.getState().sync.pendingCount, 0);
  });

  await t.test('different record snapshots cannot overwrite each other during conflict resolution', async () => {
    const a = device('snapshots'); await a.store.init();
    await a.store.saveTemplate({ id: 'plan', name: 'Weekly', days: week([bench]) });
    await a.store.saveProfile({ bodyWeight: 70, activeTemplateId: 'plan' }); await a.store.retrySync();
    const b = device('snapshots'); await b.store.init(); b.control.online = false;
    await b.store.toggleToday('bench-entry'); await b.store.retrySync();
    await a.store.saveProfile({ bodyWeight: 80 }); await a.store.retrySync();
    await a.store.toggleToday('bench-entry'); await a.store.retrySync();
    b.control.online = true; await b.store.retrySync();
    const id = b.store.getState().sync.conflicts[0].id;
    await assert.rejects(b.store.resolveConflict(id, 'local'), e => e.code === 'SNAPSHOT_CONFLICT');
    assert.equal(b.store.getState().records[0].bodyWeight, 70);
    await b.store.resolveConflict(id, 'cloud');
    assert.equal(b.store.getState().records[0].bodyWeight, 80);
    assert.equal(b.store.getState().sync.status, 'idle');
  });

  await t.test('dated schedules survive plan edits and synchronize to an independent device', async () => {
    const previousClock = clock; clock = '2020-09-28T08:00:00Z';
    const a = device('streak'); await a.store.init();
    const plan = { id: 'streak-plan', name: 'Monday Wednesday', days: [[bench], [], [bench], [], [], [], []] };
    await a.store.saveTemplate(plan); await a.store.activateTemplate(plan.id);
    await a.store.toggleToday(bench.entryId); await a.store.retrySync();
    clock = '2020-10-01T08:00:00Z';
    await a.store.saveTemplate({ ...plan, days: [[], [], [], [bench], [], [], []] });
    await a.store.toggleToday(bench.entryId); await a.store.retrySync();
    const b = device('streak'); await b.store.init();
    assert.deepEqual(b.store.getState().profile.scheduleHistory.map(e => [e.from, e.mask]), [['2020-09-28', 5], ['2020-10-01', 8]]);
    assert.equal(require('../miniprogram/lib/achievement').achievement(b.store.getState(), '2020-10-01').streak, 1);
    assert.equal(b.store.getState().sync.pendingCount, 0); clock = previousClock;
  });

  await t.test('identity changes isolate cached data and wrong app authorization disables writes', async () => {
    const a = device('identity-a'); await a.store.init();
    await a.store.saveExercise({ ...bench, id: 'private-exercise', entryId: undefined }); await a.store.retrySync();
    a.control.owner = 'identity-b';
    const b = createStore(a.options); await b.init();
    assert.equal(b.getState().exercises.length, 0);
    a.control.owner = 'identity-a'; await b.refresh();
    assert.equal(b.getState().exercises.length, 1);
    a.control.appid = 'wrong-app'; await b.refresh();
    assert.equal(b.getState().identityReady, false);
    await assert.rejects(b.saveProfile({ bodyWeight: 90 }), e => e.code === 'AUTH_REQUIRED');
  });
});
