const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');

const weighted = { id: 'bench', entryId: 'a', name: '卧推', type: 'weighted', sets: 3, reps: 10, weight: 40, restSeconds: 90, muscles: [{ id: 'chest', percent: 70 }, { id: 'triceps', percent: 30 }] };
const pushup = { id: 'pushup', entryId: 'b', name: '俯卧撑', type: 'bodyweight', sets: 3, reps: 12, coefficient: 0.65, restSeconds: 60, muscles: [{ id: 'chest', percent: 100 }] };
const run = { id: 'run', entryId: 'c', name: '跑步', type: 'cardio', sets: 1, durationMinutes: 30, distanceKm: 5, intensity: '轻松', restSeconds: 0, muscles: [] };
const record = { id: '2026-10-04', date: '2026-10-04', bodyWeight: 70, items: [weighted, pushup, run], completed: ['a', 'b', 'c'] };

test('Beijing dates and Monday weeks cross year/month boundaries', () => {
  assert.equal(d.today(new Date('2026-10-03T16:00:00Z')), '2026-10-04');
  assert.equal(d.today(new Date('2026-10-03T15:59:59Z')), '2026-10-03');
  assert.equal(d.weekStart('2026-10-04'), '2026-09-28');
  assert.equal(d.weekStart('2027-01-03'), '2026-12-28');
  assert.equal(d.weekday('2026-10-05'), 0);
  assert.throws(() => d.weekStart('2026-02-30'));
});
test('leap month and month shifting', () => {
  assert.equal(d.monthDates('2024-02').length, 29);
  assert.equal(d.monthDates('2026-02').length, 28);
  assert.equal(d.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(d.shiftMonth('2026-01', -1), '2025-12');
});
test('volume uses only completed items and separates cardio', () => {
  const result = d.calculateRecord(record);
  assert.equal(result.weightedVolume, 1200);
  assert.equal(result.bodyweightVolume, 1638);
  assert.equal(result.volume, 2838);
  assert.equal(result.cardioMinutes, 30);
  assert.equal(result.cardioKm, 5);
  assert.equal(result.cardioCount, 1);
  assert.equal(result.muscles.chest, 2478);
  assert.equal(result.muscles.triceps, 360);
  assert.equal(result.status, 'complete');
  const partial = d.calculateRecord({ ...record, completed: ['a'] });
  assert.equal(partial.volume, 1200);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.cardioCount, 0);
});
test('cancel all checkboxes yields zero and no training day', () => {
  const result = d.calculateMonth([{ ...record, completed: [] }], '2026-10');
  assert.equal(result.trainingDays, 0);
  assert.equal(result.volume, 0);
  assert.ok(result.muscles.every(m => m.percent === 0));
});
test('monthly totals count cardio days, filter date and include empty dates', () => {
  const result = d.calculateMonth([record, { ...record, date: '2026-09-30' }], '2026-10');
  assert.equal(result.trainingDays, 1);
  assert.equal(result.days.length, 31);
  assert.equal(result.cardioCount, 1);
  assert.equal(result.volume, 2838);
  assert.equal(result.days[3].status, 'complete');
  assert.ok(Math.abs(result.muscles.reduce((n, m) => n + m.percent, 0) - 100) < 0.01);
});
test('template, matching override and record snapshot precedence', () => {
  const days = [[], [], [], [], [], [], [weighted]];
  const state = { profile: { activeTemplateId: 'p' }, templates: [{ id: 'p', days }], overrides: [{ id: '2026-09-28', templateId: 'p', days: [[], [], [], [], [], [], [pushup]] }], records: [] };
  assert.equal(d.resolveDay(state, '2026-10-04').items[0].id, 'pushup');
  state.records = [record];
  state.templates[0].days[6] = [];
  assert.equal(d.resolveDay(state, '2026-10-04').items.length, 3);
  assert.equal(d.resolveDay({ ...state, records: [], overrides: [] }, '2026-10-04').items.length, 0);
});
test('snapshot values do not follow changes in profile or library', () => {
  assert.equal(d.calculateRecord({ ...record, bodyWeight: 70 }).bodyweightVolume, 1638);
  const state = { profile: { activeTemplateId: 'p', bodyWeight: 100 }, templates: [], overrides: [], records: [record] };
  assert.equal(d.calculateRecord({ ...record, items: d.resolveDay(state, record.date).items }).bodyweightVolume, 1638);
});
test('strength validation rejects invalid muscle/numeric values', () => {
  assert.equal(d.validateExercise(weighted).name, '卧推');
  for (const item of [{ ...weighted, sets: 0 }, { ...weighted, reps: 1.5 }, { ...weighted, weight: -1 }, { ...weighted, muscles: [{ id: 'chest', percent: 80 }] }, { ...weighted, muscles: [{ id: 'invalid', percent: 100 }] }, { ...weighted, name: '' }]) {
    assert.throws(() => d.validateExercise(item));
  }
});
test('cardio validation allows optional distance but requires positive duration', () => {
  assert.equal(d.validateExercise({ ...run, distanceKm: 0 }).durationMinutes, 30);
  assert.throws(() => d.validateExercise({ ...run, durationMinutes: 0 }));
});
test('default muscle percentages are exactly 100', () => {
  const muscles = d.defaultMuscleWeights('chest', ['triceps', 'shoulders']);
  assert.deepEqual(muscles.map(m => m.percent), [70, 15, 15]);
  assert.deepEqual(d.defaultMuscleWeights('chest', []), [{ id: 'chest', percent: 100 }]);
});
test('presets are all valid and include required coefficient examples', () => {
  d.PRESETS.forEach(item => d.validateExercise(item));
  assert.equal(d.PRESETS.find(item => item.id === 'pushup').coefficient, 0.65);
  assert.ok(d.exerciseSummary(weighted).includes('40'));
});
