const rpe = require('./rpe');
const MUSCLES = [
  { id: 'chest', name: '胸' }, { id: 'back', name: '背' },
  { id: 'shoulders', name: '肩' }, { id: 'biceps', name: '肱二头' },
  { id: 'triceps', name: '肱三头' }, { id: 'glutes', name: '臀' },
  { id: 'legs', name: '腿' }, { id: 'core', name: '核心' }
];
const DAY_MS = 86400000;
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const pad = value => String(value).padStart(2, '0');

function error(message, code) {
  const result = new Error(message);
  result.code = code || 'VALIDATION';
  return result;
}
function dateMillis(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error('日期格式不正确');
  const parts = date.split('-').map(Number);
  const ms = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw error('日期不存在');
  return ms;
}
function today(now) {
  const ms = now === undefined ? Date.now() : new Date(now).getTime();
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}
function weekday(date) { return (new Date(dateMillis(date)).getUTCDay() + 6) % 7; }
function weekStart(date) { return new Date(dateMillis(date) - weekday(date) * DAY_MS).toISOString().slice(0, 10); }
function shiftDate(date, days) { return new Date(dateMillis(date) + days * DAY_MS).toISOString().slice(0, 10); }
function cycleEnd(cycle) { return shiftDate(cycle.startWeek, cycle.weeks.length * 7 - 1); }
function cycleFromTemplate(state, template, startWeek) {
  const plans = [], ids = new Map();
  const weeks = template.weeks.map(id => {
    if (ids.has(id)) return ids.get(id);
    const source = state.templates.find(t => t.id === id);
    if (!source) throw error('周期模板中的周模板已删除，请先编辑并替换');
    const plan = { id: newId('snapshot'), templateId: source.id, name: source.name, days: clone(source.days) };
    plans.push(plan); ids.set(id, plan.id); return plan.id;
  });
  return { id: newId('cycle'), name: template.name, startWeek, plans, weeks };
}
function scheduledWeek(state, date) {
  const program = state.program;
  if (!program || weekStart(date) < weekStart(program.from)) return null;
  const week = weekStart(date);
  const cycle = program.cycles.find(c => c.startWeek <= week && cycleEnd(c) >= week);
  if (!cycle) return null;
  const index = Math.floor((dateMillis(week) - dateMillis(cycle.startWeek)) / (7 * DAY_MS));
  const plan = cycle.plans.find(p => p.id === cycle.weeks[index]);
  return { cycle, plan, index, week };
}
function cycleStatus(state, date) {
  const cycles = state.program ? state.program.cycles : [];
  const current = scheduledWeek(state, date);
  const upcoming = cycles.find(c => c.startWeek > date);
  const ended = cycles.filter(c => cycleEnd(c) < date).slice(-1)[0];
  return { current, upcoming, ended, needsNext: !!(current && current.index === current.cycle.weeks.length - 1 && !upcoming), nextStart: cycles.length ? shiftDate(cycleEnd(cycles[cycles.length - 1]), 1) : weekStart(date) };
}
function monthOf(date) { dateMillis(date); return date.slice(0, 7); }
function monthDates(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw error('月份不正确');
  const parts = month.split('-').map(Number);
  const count = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => month + '-' + pad(i + 1));
}
function shiftMonth(month, delta) {
  monthDates(month);
  const parts = month.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1)).toISOString().slice(0, 7);
}
let sequence = 0;
function newId(prefix) { sequence += 1; return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + sequence.toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
function defaultMuscleWeights(primary, secondary) {
  const ids = Array.from(new Set((secondary || []).filter(id => id !== primary)));
  if (!ids.length) return [{ id: primary, percent: 100 }];
  const share = round(30 / ids.length);
  return [{ id: primary, percent: 70 }].concat(ids.map((id, i) => ({ id, percent: i === ids.length - 1 ? round(30 - share * i) : share })));
}
function numeric(value, label, min, max, integer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw error(label + '超出有效范围');
  return value;
}
function validateExercise(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('动作格式不正确');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 60) throw error('动作名称需要1至60个字');
  if (!['weighted', 'bodyweight', 'cardio', 'superset'].includes(input.type)) throw error('请选择动作类型');
  const item = Object.assign({}, input, { name, muscles: clone(input.muscles || []) });
  numeric(item.sets, '组数', 1, 100, true);
  item.restSeconds = numeric(item.restSeconds === undefined ? 0 : item.restSeconds, '间隔秒数', 0, 3600, true);
  if (item.type === 'superset') {
    if (Object.keys(item).some(key => !['id', 'entryId', 'name', 'type', 'sets', 'restSeconds', 'muscles', 'components'].includes(key))) throw error('超级组参数格式不正确');
    if (!Array.isArray(item.components) || item.components.length < 2 || item.components.length > 10) throw error('超级组需要2至10个动作');
    if (!Array.isArray(item.muscles) || item.muscles.length) throw error('超级组肌群由内部动作分别设置');
    item.components = item.components.map(child => {
      if (!child || child.type === 'superset' || child.entryId !== undefined || child.sets !== 1 || child.restSeconds !== 0) throw error('内部动作不设组数和间隔，也不能嵌套超级组');
      return validateExercise(child);
    });
    return item;
  }
  if (item.components !== undefined) throw error('普通动作不能包含内部动作');
  item.reps = item.reps === undefined ? 0 : item.reps;
  item.weight = item.weight === undefined ? 0 : item.weight;
  item.coefficient = item.coefficient === undefined ? 1 : item.coefficient;
  item.durationMinutes = item.durationMinutes === undefined ? 0 : item.durationMinutes;
  item.distanceKm = item.distanceKm === undefined ? 0 : item.distanceKm;
  item.intensity = item.intensity === undefined ? '' : item.intensity;
  numeric(item.reps, '次数', item.type === 'cardio' ? 0 : 1, 10000, true);
  numeric(item.weight, '重量', 0, 2000);
  numeric(item.coefficient, '体重系数', item.type === 'bodyweight' ? 0.001 : 0, 2);
  numeric(item.durationMinutes, '时长', item.type === 'cardio' ? 0.01 : 0, 1440);
  numeric(item.distanceKm, '距离', 0, 2000);
  if (typeof item.intensity !== 'string' || item.intensity.length > 60) throw error('强度需要60字以内');
  if (item.rpe !== undefined && item.rpe !== null) {
    const range = rpe.scale(item.type);
    numeric(item.rpe, 'RPE', range.min, range.max);
  }
  if (item.type !== 'cardio') {
    if (!Array.isArray(item.muscles) || !item.muscles.length || item.muscles.length > MUSCLES.length) throw error('请选择训练肌群');
    const seen = new Set();
    item.muscles.forEach(m => {
      if (!MUSCLES.some(group => group.id === m.id) || seen.has(m.id)) throw error('肌群重复或不存在');
      seen.add(m.id);
      numeric(m.percent, '肌群比例', 0.01, 100);
    });
    if (Math.abs(item.muscles.reduce((sum, m) => sum + m.percent, 0) - 100) >= 0.000001) throw error('肌群比例合计必须为100%');
  } else {
    item.muscles = [];
  }
  return item;
}
function exerciseSummary(item) {
  if (item.type === 'superset') return item.sets + '组 · ' + item.components.map(child => child.name + '（' + exerciseSummary(child).replace(/^1组(?: × | · )/, '') + '）').join(' + ');
  const intensity = rpe.label(item), suffix = intensity ? ' · ' + intensity : '';
  if (item.type === 'cardio') return item.sets + '组 · ' + (item.durationMinutes < 1 ? Math.round(item.durationMinutes * 60) + '秒' : item.durationMinutes + '分钟') + suffix;
  return item.sets + '组 × ' + item.reps + '次 · ' + (item.type === 'weighted' ? (item.weight ? item.weight + 'kg' : '重量待填写') : '自重 × ' + item.coefficient) + suffix;
}
function usesBodyWeight(item) { return item.type === 'bodyweight' || item.type === 'superset' && item.components.some(usesBodyWeight); }
function hasSuperset(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.type === 'superset') return true;
  return Object.keys(value).some(key => hasSuperset(value[key]));
}
function makePreset(id, name, type, primary, secondary, fields) {
  return validateExercise(Object.assign({ id, name, type, sets: 3, reps: 10, weight: 0, coefficient: 1, restSeconds: 60, durationMinutes: 0, distanceKm: 0, intensity: '', rpe: type === 'cardio' ? 12 : 8, muscles: type === 'cardio' ? [] : defaultMuscleWeights(primary, secondary) }, fields));
}
const PRESETS = [
  makePreset('bench', '杠铃卧推', 'weighted', 'chest', ['triceps', 'shoulders'], { restSeconds: 90 }),
  makePreset('squat', '杠铃深蹲', 'weighted', 'legs', ['glutes', 'core'], { restSeconds: 120 }),
  makePreset('deadlift', '硬拉', 'weighted', 'back', ['glutes', 'legs'], { reps: 8, restSeconds: 120 }),
  makePreset('row', '哑铃划船', 'weighted', 'back', ['biceps'], {}),
  makePreset('press', '哑铃肩推', 'weighted', 'shoulders', ['triceps'], {}),
  makePreset('curl', '二头弯举', 'weighted', 'biceps', [], { reps: 12 }),
  makePreset('triceps', '绳索下压', 'weighted', 'triceps', [], { reps: 12 }),
  makePreset('power-clean', '高翻', 'weighted', 'legs', ['glutes', 'back', 'shoulders'], { reps: 3, restSeconds: 120, rpe: 6 }),
  makePreset('box-squat', '箱式深蹲', 'weighted', 'legs', ['glutes', 'core'], { reps: 5, restSeconds: 120, rpe: 7 }),
  makePreset('high-pull', '高拉', 'weighted', 'back', ['legs', 'shoulders'], { reps: 3, restSeconds: 120, rpe: 6 }),
  makePreset('pushup', '俯卧撑', 'bodyweight', 'chest', ['triceps', 'shoulders'], { coefficient: 0.65, reps: 12 }),
  makePreset('pullup', '引体向上', 'bodyweight', 'back', ['biceps'], { coefficient: 1, reps: 6, restSeconds: 90 }),
  makePreset('body-squat', '自重深蹲', 'bodyweight', 'legs', ['glutes'], { coefficient: 0.6, reps: 15 }),
  makePreset('parallel-bar-dip', '双杠臂屈伸', 'bodyweight', 'chest', ['triceps', 'shoulders'], { reps: 10, coefficient: 0.8, restSeconds: 120, rpe: 8 }),
  makePreset('pike-pushup', '派克俯卧撑', 'bodyweight', 'shoulders', ['triceps', 'chest'], { reps: 12, coefficient: 0.7, restSeconds: 90, rpe: 8 }),
  makePreset('inverted-row', '反向划船', 'bodyweight', 'back', ['biceps'], { sets: 3, reps: 12, coefficient: 0.7, restSeconds: 90, rpe: 8 }),
  makePreset('glute-bridge', '臀桥', 'bodyweight', 'glutes', ['legs', 'core'], { reps: 20, coefficient: 0.4, restSeconds: 60, rpe: 7 }),
  makePreset('reverse-lunge', '后撤步弓步蹲', 'bodyweight', 'legs', ['glutes', 'core'], { reps: 24, coefficient: 0.9, restSeconds: 90, rpe: 8 }),
  makePreset('seated-calf-raise', '坐姿提踵', 'bodyweight', 'legs', [], { sets: 4, reps: 25, coefficient: 0.6, restSeconds: 60, rpe: 8 }),
  makePreset('standing-calf-raise', '站姿提踵', 'bodyweight', 'legs', [], { sets: 4, reps: 20, coefficient: 1, restSeconds: 60, rpe: 8 }),
  makePreset('box-jump', '跳箱', 'bodyweight', 'legs', ['glutes', 'core'], { sets: 4, reps: 8, coefficient: 1, restSeconds: 120, rpe: 8 }),
  makePreset('dragon-flag', '龙旗', 'bodyweight', 'core', [], { reps: 6, coefficient: 1, restSeconds: 120, rpe: 9 }),
  makePreset('burpee', '波比跳', 'bodyweight', 'legs', ['chest', 'shoulders', 'core'], { sets: 4, reps: 12, coefficient: 0.8, restSeconds: 90, rpe: 9 }),
  makePreset('run', '跑步机', 'cardio', null, [], { sets: 1, reps: 0, durationMinutes: 30, restSeconds: 0 }),
  makePreset('rope', '跳绳', 'cardio', null, [], { sets: 8, reps: 0, durationMinutes: 1, restSeconds: 60, rpe: 14 }),
  makePreset('elliptical', '椭圆机', 'cardio', null, [], { sets: 1, reps: 0, durationMinutes: 30, restSeconds: 0 }),
  makePreset('spinning-bike', '动感单车', 'cardio', null, [], { sets: 1, reps: 0, durationMinutes: 30, restSeconds: 0 }),
  makePreset('rowing-machine', '划船机', 'cardio', null, [], { sets: 1, reps: 0, durationMinutes: 25, restSeconds: 0 }),
  makePreset('battle-rope', '战绳', 'cardio', null, [], { sets: 10, reps: 0, durationMinutes: 0.5, restSeconds: 60, rpe: 15 }),
  makePreset('air-squat', '徒手深蹲', 'bodyweight', 'legs', ['glutes', 'core'], { reps: 15, rpe: 7, coefficient: 0.7 }),
  makePreset('bulgarian-split-squat', '保加利亚分腿蹲', 'bodyweight', 'legs', ['glutes'], { reps: 16, coefficient: 0.85 }),
  validateExercise({ id: 'dumbbell-squat-fly', name: '哑铃深蹲 + 哑铃飞鸟', type: 'superset', sets: 3, restSeconds: 60, muscles: [], components: [
    makePreset('dumbbell-squat', '哑铃深蹲', 'weighted', 'legs', ['glutes', 'core'], { sets: 1, reps: 10, restSeconds: 0 }),
    makePreset('dumbbell-fly', '哑铃飞鸟', 'weighted', 'chest', ['shoulders'], { sets: 1, reps: 10, restSeconds: 0 })
  ] }),
  makePreset('dumbbell-thruster', '哑铃深蹲推举', 'weighted', 'legs', ['shoulders', 'triceps', 'core'], { reps: 8 }),
  makePreset('wall-dumbbell-overhead-press', '靠墙站姿哑铃肩上推举', 'weighted', 'shoulders', ['triceps', 'core'], { reps: 8 }),
  makePreset('dumbbell-curl', '哑铃弯举', 'weighted', 'biceps', [], { reps: 10 }),
  makePreset('lying-dumbbell-fly', '仰卧哑铃飞鸟', 'weighted', 'chest', ['shoulders'], { reps: 10 }),
  makePreset('dumbbell-overhead-press', '哑铃肩上推举', 'weighted', 'shoulders', ['triceps'], { reps: 8 }),
  makePreset('bilateral-dumbbell-curl', '双臂哑铃弯举', 'weighted', 'biceps', [], { reps: 10 })
];
function resolveDay(state, date) {
  const record = (state.records || []).find(item => item.date === date);
  if (record) return { templateId: record.templateId, items: clone(record.items), isOverride: false, hasPlan: true };
  if (state.program && date >= state.program.from) {
    const selected = scheduledWeek(state, date);
    if (!selected) return { templateId: null, items: [], isOverride: false, hasPlan: false };
    const override = (state.overrides || []).find(o => o.id === selected.week && o.cycleId === selected.cycle.id && o.planId === selected.plan.id);
    return { templateId: selected.plan.templateId, planName: selected.plan.name, cycleName: selected.cycle.name, cycleId: selected.cycle.id, weekNumber: selected.index + 1, weekCount: selected.cycle.weeks.length, items: clone((override || selected.plan).days[weekday(date)]), isOverride: !!override, hasPlan: true };
  }
  const active = state.profile && state.profile.activeTemplateId;
  const template = (state.templates || []).find(item => item.id === active);
  const override = (state.overrides || []).find(item => item.id === weekStart(date) && !item.cycleId && item.templateId === active);
  const plan = override || template;
  return { templateId: active || null, items: plan ? clone(plan.days[weekday(date)]) : [], isOverride: !!override, hasPlan: !!plan };
}
function completedSets(record, item) {
  if (record.completedSets) return Object.prototype.hasOwnProperty.call(record.completedSets, item.entryId) ? record.completedSets[item.entryId] : 0;
  return (record.completed || []).includes(item.entryId) ? item.sets : 0;
}
function todayPlanUpdate(state, date) {
  const record = (state.records || []).find(r => r.date === date);
  if (!record) return null;
  const planned = resolveDay(Object.assign({}, state, { records: [] }), date);
  const locked = record.items.filter(item => completedSets(record, item) > 0);
  const items = planned.items.map(item => clone(locked.find(old => old.entryId === item.entryId) || item));
  locked.forEach(item => { if (!items.some(next => next.entryId === item.entryId)) items.push(clone(item)); });
  const counts = {};
  items.forEach(item => { const old = record.items.find(e => e.entryId === item.entryId), count = old ? completedSets(record, old) : 0; if (count) counts[item.entryId] = count; });
  const next = Object.assign({}, clone(record), { items, completedSets: counts, completed: items.filter(item => counts[item.entryId] === item.sets).map(item => item.entryId) });
  if (next.bodyWeight === null && items.some(usesBodyWeight)) next.bodyWeight = state.profile.bodyWeight;
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.keys(value).sort().reduce((result, key) => { result[key] = stable(value[key]); return result; }, {}) : value;
  return { record: next, changed: JSON.stringify(stable(record.items)) !== JSON.stringify(stable(items)) || record.bodyWeight !== next.bodyWeight };
}
function recordSnapshot(record) {
  const copy = Object.assign({}, record); delete copy.completed; delete copy.completedSets; return copy;
}
function calculateRecord(record) {
  const result = { volume: 0, weightedVolume: 0, bodyweightVolume: 0, cardioMinutes: 0, cardioKm: 0, cardioCount: 0, completedCount: 0, completedSetCount: 0, totalSetCount: 0, totalCount: record.items.length, muscles: {}, status: 'none' };
  record.items.forEach(item => {
    result.totalSetCount += item.sets;
    const count = completedSets(record, item);
    if (!count) return;
    result.completedSetCount += count;
    if (count === item.sets) result.completedCount += 1;
    const parts = item.type === 'superset' ? item.components : [item];
    parts.forEach(part => {
      if (part.type === 'cardio') {
        result.cardioCount += 1;
        result.cardioMinutes += part.durationMinutes * count;
        result.cardioKm += (part.distanceKm || 0) * count;
        return;
      }
      const volume = count * part.reps * (part.type === 'weighted' ? part.weight : (record.bodyWeight || 0) * part.coefficient);
      result[part.type === 'weighted' ? 'weightedVolume' : 'bodyweightVolume'] += volume;
      part.muscles.forEach(m => { result.muscles[m.id] = (result.muscles[m.id] || 0) + volume * m.percent / 100; });
    });
  });
  result.volume = round(result.weightedVolume + result.bodyweightVolume);
  ['weightedVolume', 'bodyweightVolume', 'cardioMinutes', 'cardioKm'].forEach(key => { result[key] = round(result[key]); });
  Object.keys(result.muscles).forEach(id => { result.muscles[id] = round(result.muscles[id]); });
  if (result.completedSetCount) result.status = result.completedCount === result.totalCount ? 'complete' : 'partial';
  return result;
}
function calculateMonth(records, month) {
  const selected = records.filter(record => record.date.slice(0, 7) === month);
  const indexed = {};
  selected.forEach(record => { indexed[record.date] = record; });
  const result = { volume: 0, weightedVolume: 0, bodyweightVolume: 0, cardioMinutes: 0, cardioKm: 0, cardioCount: 0, completedCount: 0, trainingDays: 0, days: [], muscles: [], records: clone(selected) };
  const muscles = {};
  result.days = monthDates(month).map(date => {
    const totals = calculateRecord(indexed[date] || { items: [], completed: [] });
    ['volume', 'weightedVolume', 'bodyweightVolume', 'cardioMinutes', 'cardioKm', 'cardioCount', 'completedCount'].forEach(key => { result[key] += totals[key]; });
    if (totals.completedSetCount) result.trainingDays += 1;
    Object.keys(totals.muscles).forEach(id => { muscles[id] = (muscles[id] || 0) + totals.muscles[id]; });
    return Object.assign({ date }, totals);
  });
  ['volume', 'weightedVolume', 'bodyweightVolume', 'cardioMinutes', 'cardioKm'].forEach(key => { result[key] = round(result[key]); });
  const muscleTotal = Object.keys(muscles).reduce((sum, id) => sum + muscles[id], 0);
  result.muscles = MUSCLES.map(group => ({ id: group.id, name: group.name, volume: round(muscles[group.id] || 0), percent: muscleTotal ? (muscles[group.id] || 0) * 100 / muscleTotal : 0 })).sort((a, b) => b.volume - a.volume);
  return result;
}
module.exports = { MUSCLES, PRESETS, today, weekday, weekStart, shiftDate, cycleEnd, cycleFromTemplate, scheduledWeek, cycleStatus, monthOf, monthDates, shiftMonth, newId, validateExercise, exerciseSummary, usesBodyWeight, hasSuperset, resolveDay, todayPlanUpdate, calculateRecord, calculateMonth, completedSets, recordSnapshot, defaultMuscleWeights, error };
