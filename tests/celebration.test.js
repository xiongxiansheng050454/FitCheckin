const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');
const { achievement } = require('../miniprogram/lib/achievement');
const item = { ...d.PRESETS[0], weight: 40, entryId: 'bench' };
const record = (date, completed = ['bench']) => ({ id: date, date, items: [item], completed, bodyWeight: 70 });
const state = (records, mask = 5) => ({ records, profile: { activeTemplateId: 'p', scheduleHistory: [{ from: '2026-09-01', mask, weeks: [] }] }, templates: [], overrides: [] });

test('streak skips planned rest days and breaks on a missed planned day', () => {
  assert.equal(achievement(state([record('2026-09-28'), record('2026-09-30')]), '2026-09-30').streak, 2);
  const broken = achievement(state([record('2026-09-23'), record('2026-09-30')]), '2026-09-30');
  assert.equal(broken.streak, 1);
  assert.equal(broken.restarted, true);
  assert.match(broken.title, /重新开始/);
  assert.equal(achievement(state([record('2026-09-28')]), '2026-09-29').streak, 1);
});

test('week overrides and historical schedule changes cannot erase missed sessions', () => {
  const s = state([record('2026-09-28'), record('2026-10-01')]);
  s.profile.scheduleHistory.push({ from: '2026-10-01', mask: 8, weeks: [] });
  assert.equal(achievement(s, '2026-10-01').streak, 1);
  const overridden = state([record('2026-09-28'), record('2026-09-30')]);
  overridden.profile.scheduleHistory[0].weeks = [{ week: '2026-09-28', mask: 7 }];
  assert.equal(achievement(overridden, '2026-09-30').streak, 1);
});

test('partial training preserves a streak but cancelled sessions and future records do not', () => {
  const partial = { ...record('2026-09-28'), items: [item, { ...item, entryId: 'second' }] };
  assert.equal(achievement(state([partial, record('2026-09-30')]), '2026-09-30').streak, 2);
  assert.equal(achievement(state([record('2026-09-28', []), record('2026-09-30'), record('2026-10-05')]), '2026-09-30').streak, 1);
});

test('milestones, self records and cardio feedback use real data instead of user rankings', () => {
  const records = Array.from({ length: 7 }, (_, i) => record('2026-09-' + (24 + i)));
  const milestone = achievement(state(records, 127), '2026-09-30');
  assert.equal(milestone.streak, 7);
  assert.equal(milestone.milestone, true);
  assert.match(milestone.encouragement, /铁人/);
  const high = record('2026-09-30'); high.items = [{ ...item, weight: 80 }];
  assert.match(achievement(state([record('2026-09-23'), high]), '2026-09-30').comparison, /上周/);
  const run = { ...d.PRESETS.find(x => x.id === 'run'), entryId: 'run' };
  const cardio = achievement(state([{ ...record('2026-09-30'), items: [run], completed: ['run'] }]), '2026-09-30');
  assert.equal(cardio.unit, '分钟');
  assert.equal(cardio.value, '30');
  assert.ok(!JSON.stringify(cardio).includes('80%'));
});
