'use strict';

const MUSCLES = new Set(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'glutes', 'legs', 'core']);
const KINDS = new Set(['profile', 'exercise', 'template', 'cycleTemplate', 'override', 'record', 'program']);
const EXERCISE_FIELDS = ['id', 'name', 'type', 'sets', 'reps', 'weight', 'coefficient', 'restSeconds', 'durationMinutes', 'distanceKm', 'intensity', 'rpe', 'muscles', 'components'];
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

class ValidationError extends Error {
  constructor(message) { super(message); this.code = 'VALIDATION'; }
}
function check(ok, message) { if (!ok) throw new ValidationError(message); }
function object(value, fields, label, required = fields) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${label}\u683c\u5f0f\u9519\u8bef`);
  check(Object.keys(value).every(key => fields.includes(key)) && required.every(key => Object.prototype.hasOwnProperty.call(value, key)), `${label}\u5b57\u6bb5\u9519\u8bef`);
}
function number(value, min, max, label, integer = false) {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), `${label}\u8d85\u51fa\u8303\u56f4`);
}
function identifier(value, label = '\u6807\u8bc6') { check(typeof value === 'string' && ID.test(value), `${label}\u683c\u5f0f\u9519\u8bef`); }
function text(value, label) { check(typeof value === 'string' && value.trim().length > 0 && value.length <= 60, `${label}\u9700\u4e3a1\u523060\u4e2a\u5b57\u7b26`); }
function bodyWeight(value) { if (value !== null) { number(value, 0, 500, '\u4f53\u91cd'); check(value > 0, '\u4f53\u91cd\u9700\u5927\u4e8e0'); } }
function date(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '\u65e5\u671f\u683c\u5f0f\u9519\u8bef');
  const ms = Date.parse(`${value}T00:00:00Z`);
  check(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value && value >= '2000-01-01' && value <= '2199-12-31', '\u65e5\u671f\u4e0d\u5b58\u5728');
  return ms;
}
function timestamp(value) {
  check(typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)), '\u65f6\u95f4\u683c\u5f0f\u9519\u8bef');
  date(value.slice(0, 10));
  const time = value.slice(11, 19).split(':').map(Number);
  check(time[0] <= 23 && time[1] <= 59 && time[2] <= 59, '\u65f6\u95f4\u683c\u5f0f\u9519\u8bef');
  return Date.parse(value);
}
function beijingDay(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); }
function exercise(value, snapshot = false) {
  const required = ['id', 'name', 'type', 'sets', 'restSeconds', 'muscles', ...(snapshot ? ['entryId'] : [])];
  object(value, snapshot ? [...EXERCISE_FIELDS, 'entryId'] : EXERCISE_FIELDS, '\u52a8\u4f5c', required);
  identifier(value.id); text(value.name, '\u52a8\u4f5c\u540d\u79f0');
  if (value.type === 'superset') {
    object(value, ['id', 'name', 'type', 'sets', 'restSeconds', 'muscles', 'components', ...(snapshot ? ['entryId'] : [])], '超级组');
    number(value.sets, 1, 100, '组数', true); number(value.restSeconds, 0, 3600, '整组休息', true);
    check(Array.isArray(value.muscles) && value.muscles.length === 0, '超级组肌群由内部动作设置');
    check(Array.isArray(value.components) && value.components.length >= 2 && value.components.length <= 10, '超级组需要2至10个动作');
    value.components.forEach(child => {
      check(child && child.type !== 'superset' && child.sets === 1 && child.restSeconds === 0, '内部动作不能嵌套或单独设置组数和间隔');
      exercise(child);
    });
    if (snapshot) identifier(value.entryId, '计划动作标识');
    return;
  }
  check(value.components === undefined, '普通动作不能包含内部动作');
  check(['weighted', 'bodyweight', 'cardio'].includes(value.type), '\u52a8\u4f5c\u7c7b\u578b\u9519\u8bef');
  number(value.sets, 1, 100, '\u7ec4\u6570', true);
  if (value.reps !== undefined) number(value.reps, 0, 10000, '\u6b21\u6570', true);
  if (value.weight !== undefined) number(value.weight, 0, 2000, '\u91cd\u91cf');
  if (value.coefficient !== undefined) number(value.coefficient, 0, 2, '\u81ea\u91cd\u7cfb\u6570');
  number(value.restSeconds, 0, 3600, '\u4f11\u606f\u65f6\u95f4', true);
  if (value.durationMinutes !== undefined) number(value.durationMinutes, 0, 1440, '\u6709\u6c27\u65f6\u95f4');
  if (value.distanceKm !== undefined) number(value.distanceKm, 0, 2000, '\u8ddd\u79bb');
  if (value.intensity !== undefined) check(typeof value.intensity === 'string' && value.intensity.length <= 60, '\u5f3a\u5ea6\u683c\u5f0f\u9519\u8bef');
  if (value.rpe !== undefined && value.rpe !== null) number(value.rpe, value.type === 'cardio' ? 6 : 0, value.type === 'cardio' ? 20 : 10, 'RPE');
  check(value.type === 'cardio' ? value.durationMinutes > 0 : value.reps >= 1, '\u6b21\u6570\u6216\u6709\u6c27\u65f6\u95f4\u9700\u5927\u4e8e0');
  if (value.type === 'weighted') number(value.weight, 0, 2000, '\u91cd\u91cf');
  if (value.type === 'bodyweight') check(typeof value.coefficient === 'number' && value.coefficient > 0 && value.coefficient <= 2, '\u81ea\u91cd\u7cfb\u6570\u9700\u5927\u4e8e0');
  check(Array.isArray(value.muscles) && (value.type === 'cardio' || value.muscles.length > 0) && value.muscles.length <= MUSCLES.size, '\u808c\u7fa4\u914d\u7f6e\u9519\u8bef');
  const seen = new Set(); let total = 0;
  for (const muscle of value.muscles) {
    object(muscle, ['id', 'percent'], '\u808c\u7fa4');
    check(MUSCLES.has(muscle.id) && !seen.has(muscle.id), '\u808c\u7fa4\u672a\u77e5\u6216\u91cd\u590d');
    number(muscle.percent, 0, 100, '\u808c\u7fa4\u767e\u5206\u6bd4');
    check(muscle.percent > 0, '\u808c\u7fa4\u767e\u5206\u6bd4\u9700\u5927\u4e8e0');
    seen.add(muscle.id); total += muscle.percent;
  }
  check((value.type === 'cardio' && value.muscles.length === 0) || Math.abs(total - 100) < 0.000001, '\u808c\u7fa4\u767e\u5206\u6bd4\u603b\u548c\u9700\u4e3a100');
  if (snapshot) identifier(value.entryId, '\u8ba1\u5212\u52a8\u4f5c\u6807\u8bc6');
}
function items(value) {
  check(Array.isArray(value) && value.length <= 50, '\u6bcf\u65e5\u6700\u591a50\u4e2a\u52a8\u4f5c');
  const seen = new Set();
  for (const item of value) { exercise(item, true); check(!seen.has(item.entryId), '\u52a8\u4f5c\u6807\u8bc6\u91cd\u590d'); seen.add(item.entryId); }
}
function days(value) { check(Array.isArray(value) && value.length === 7, '\u5468\u8ba1\u5212\u9700\u4e3a7\u5929'); value.forEach(items); }
const shift = (value, count) => new Date(date(value) + count * 86400000).toISOString().slice(0, 10);
const monday = value => shift(value, -((new Date(date(value)).getUTCDay() + 6) % 7));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {});
  return value;
}
function program(value, occurrence) {
  object(value, ['id', 'from', 'cycles', 'scheduleHistory'], '周期安排', ['id', 'from', 'cycles']);
  check(value.id === 'program', '周期安排标识错误'); date(value.from);
  if (value.scheduleHistory !== undefined) scheduleHistory(value.scheduleHistory, occurrence);
  check(Array.isArray(value.cycles) && value.cycles.length <= 100, '周期数量过多');
  let lastEnd = '', count = 0;
  const ids = new Set();
  value.cycles.forEach(cycle => {
    object(cycle, ['id', 'name', 'startWeek', 'plans', 'weeks'], '训练周期');
    identifier(cycle.id); text(cycle.name, '周期名称');
    check(!ids.has(cycle.id), '周期标识重复'); ids.add(cycle.id);
    check(monday(cycle.startWeek) === cycle.startWeek && cycle.startWeek > lastEnd, '周期必须从周一开始且不能重叠');
    check(Array.isArray(cycle.weeks) && cycle.weeks.length >= 1 && cycle.weeks.length <= 52, '每个周期需要1至52周');
    check(Array.isArray(cycle.plans) && cycle.plans.length >= 1 && cycle.plans.length <= 52, '模板快照数量错误');
    const plans = new Set();
    cycle.plans.forEach(plan => {
      object(plan, ['id', 'templateId', 'name', 'days'], '周模板快照');
      identifier(plan.id); identifier(plan.templateId); text(plan.name, '模板名称'); days(plan.days);
      check(!plans.has(plan.id), '周模板快照标识重复'); plans.add(plan.id);
    });
    check(cycle.weeks.every(id => typeof id === 'string' && plans.has(id)) && cycle.plans.every(p => cycle.weeks.includes(p.id)), '每周必须指定有效的模板快照');
    lastEnd = shift(cycle.startWeek, cycle.weeks.length * 7 - 1);
    count += cycle.weeks.length;
  });
  check(count <= 520, '累计周安排过多');
}
function validateProgramTransition(previous, next, occurredAt) {
  const currentDate = beijingDay(timestamp(occurredAt)), currentWeek = monday(currentDate);
  if (previous) {
    check(next.from === previous.from || (next.from < previous.from && next.from >= currentDate), '周期生效日期不可修改');
    previous.cycles.forEach(old => {
      const cycle = next.cycles.find(c => c.id === old.id);
      if (old.startWeek <= currentWeek) {
        check(cycle && cycle.startWeek === old.startWeek, '已开始的周期不可删除或移动');
        old.weeks.forEach((id, i) => {
          if (shift(old.startWeek, i * 7) >= currentWeek) return;
          const before = old.plans.find(p => p.id === id), after = cycle.plans.find(p => p.id === cycle.weeks[i]);
          check(JSON.stringify(canonical(before)) === JSON.stringify(canonical(after)), '过去的周安排不可修改');
        });
      }
    });
  } else check(next.from >= currentDate, '新周期不能追溯生效');
  next.cycles.forEach(cycle => {
    check(cycle.startWeek <= shift(currentWeek, 728), '请在未来两年内安排周期');
    if (!previous || !previous.cycles.some(c => c.id === cycle.id)) check(cycle.startWeek >= currentWeek, '新周期不能从过去开始');
  });
}
function scheduleHistory(value, occurrence) {
  check(Array.isArray(value) && value.length <= 4096, '训练安排历史格式错误');
  let previous = '';
  value.forEach(entry => {
    object(entry, ['from', 'mask', 'weeks'], '训练安排');
    date(entry.from);
    check(entry.from > previous && entry.from <= beijingDay(occurrence), '训练安排日期错误');
    previous = entry.from;
    number(entry.mask, 0, 127, '训练日位图', true);
    check(Array.isArray(entry.weeks) && entry.weeks.length <= 520, '单周安排过多');
    let lastWeek = '';
    entry.weeks.forEach(week => {
      object(week, ['week', 'mask'], '单周安排');
      check(new Date(date(week.week)).getUTCDay() === 1 && week.week > lastWeek, '单周安排日期错误');
      lastWeek = week.week; number(week.mask, 0, 127, '训练日位图', true);
    });
  });
}
function validateOperation(operation, now = Date.now()) {
  object(operation, ['operationId', 'kind', 'id', 'body', 'deleted', 'baseRevision', 'occurredAt', 'updatePlan'], '\u64cd\u4f5c', ['operationId', 'kind', 'id', 'body', 'deleted', 'baseRevision', 'occurredAt']);
  identifier(operation.operationId, '\u64cd\u4f5c\u6807\u8bc6'); identifier(operation.id); check(KINDS.has(operation.kind), '\u5b9e\u4f53\u7c7b\u578b\u9519\u8bef');
  check(typeof operation.deleted === 'boolean', '\u5220\u9664\u6807\u8bb0\u9519\u8bef');
  if (operation.updatePlan !== undefined) check(operation.updatePlan === true && operation.kind === 'record' && !operation.deleted, '今日清单更新标记错误');
  number(operation.baseRevision, 0, Number.MAX_SAFE_INTEGER - 1, '\u7248\u672c', true);
  const occurred = timestamp(operation.occurredAt);
  check(occurred <= now, '\u64cd\u4f5c\u65f6\u95f4\u4e0d\u80fd\u5728\u672a\u6765');
  check(Buffer.byteLength(JSON.stringify(operation), 'utf8') <= 512 * 1024, '\u64cd\u4f5c\u5185\u5bb9\u8fc7\u5927');
  if (operation.kind === 'profile') check(operation.id === 'profile', '\u7528\u6237\u8d44\u6599\u6807\u8bc6\u9519\u8bef');
  if (operation.kind === 'program') check(operation.id === 'program', '周期安排标识错误');
  if (operation.kind === 'override') check(new Date(date(operation.id)).getUTCDay() === 1, '\u5468\u8986\u76d6\u9700\u4ece\u5468\u4e00\u5f00\u59cb');
  if (operation.kind === 'record') check(date(operation.id) && operation.id === beijingDay(occurred), '\u8bad\u7ec3\u65e5\u671f\u9700\u4e0e\u64cd\u4f5c\u5f53\u65e5\u4e00\u81f4');
  if (operation.deleted) {
    check(!['record', 'profile', 'program'].includes(operation.kind), '\u8bad\u7ec3\u8bb0\u5f55\u548c\u7528\u6237\u8d44\u6599\u4e0d\u53ef\u5220\u9664');
    check(operation.body === null, '\u5220\u9664\u64cd\u4f5c\u5185\u5bb9\u9700\u4e3a\u7a7a'); return operation;
  }
  const body = operation.body;
  const fields = {
    profile: ['id', 'bodyWeight', 'activeTemplateId', 'scheduleHistory'], exercise: EXERCISE_FIELDS,
    program: ['id', 'from', 'cycles', 'scheduleHistory'], template: ['id', 'name', 'days'], cycleTemplate: ['id', 'name', 'weeks'], override: ['id', 'templateId', 'days', 'cycleId', 'planId'],
    record: ['id', 'date', 'templateId', 'bodyWeight', 'items', 'completed', 'startedAt', 'completedSets']
  };
  object(body, fields[operation.kind], '\u5185\u5bb9', operation.kind === 'exercise' ? ['id', 'name', 'type', 'sets', 'restSeconds', 'muscles'] : operation.kind === 'profile' ? ['id', 'bodyWeight', 'activeTemplateId'] : fields[operation.kind].filter(key => !['completedSets', 'cycleId', 'planId', 'scheduleHistory'].includes(key))); check(body.id === operation.id, '\u5185\u5bb9\u6807\u8bc6\u4e0d\u4e00\u81f4');
  if (operation.kind === 'profile') {
    bodyWeight(body.bodyWeight); if (body.activeTemplateId !== null) identifier(body.activeTemplateId);
    if (body.scheduleHistory !== undefined) scheduleHistory(body.scheduleHistory, occurred);
  } else if (operation.kind === 'exercise') exercise(body);
  else if (operation.kind === 'template') { text(body.name, '\u8ba1\u5212\u540d\u79f0'); days(body.days); }
  else if (operation.kind === 'cycleTemplate') {
    text(body.name, '周期模板名称');
    check(Array.isArray(body.weeks) && body.weeks.length >= 1 && body.weeks.length <= 52, '周期模板需要1至52周');
    body.weeks.forEach(id => identifier(id, '周模板标识'));
  }
  else if (operation.kind === 'program') program(body, occurred);
  else if (operation.kind === 'override') { identifier(body.templateId); if (body.cycleId !== undefined) { identifier(body.cycleId); identifier(body.planId); } else check(body.planId === undefined, '单周快照标识错误'); days(body.days); }
  else {
    check(body.date === operation.id, '\u8bad\u7ec3\u65e5\u671f\u9519\u8bef');
    if (body.templateId !== null) identifier(body.templateId);
    bodyWeight(body.bodyWeight); items(body.items);
    const started = timestamp(body.startedAt);
    check(started <= occurred && beijingDay(started) === body.date, '\u8bad\u7ec3\u5f00\u59cb\u65f6\u95f4\u9519\u8bef');
    check(Array.isArray(body.completed) && body.completed.length <= body.items.length && new Set(body.completed).size === body.completed.length, '\u5b8c\u6210\u52a8\u4f5c\u9519\u8bef');
    const ids = new Set(body.items.map(item => item.entryId));
    check(body.completed.every(id => ids.has(id)), '\u5b8c\u6210\u52a8\u4f5c\u4e0d\u5728\u5feb\u7167\u4e2d');
    if (body.completedSets !== undefined) {
      object(body.completedSets, [...ids], '组进度', []);
      body.items.forEach(item => {
        const count = Object.prototype.hasOwnProperty.call(body.completedSets, item.entryId) ? body.completedSets[item.entryId] : 0;
        number(count, 0, item.sets, '完成组数', true);
        check(body.completed.includes(item.entryId) === (count === item.sets), '动作完成状态与组进度不一致');
      });
    }
    check(body.bodyWeight !== null || !body.items.some(item => item.type === 'bodyweight' || item.type === 'superset' && item.components.some(child => child.type === 'bodyweight')), '\u81ea\u91cd\u8bad\u7ec3\u9700\u5148\u8bbe\u7f6e\u4f53\u91cd');
  }
  return operation;
}

module.exports = { validateOperation, validateProgramTransition, ValidationError, beijingDay };
