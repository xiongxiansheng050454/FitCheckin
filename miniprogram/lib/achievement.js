const d = require('./domain');
const DAY = 86400000;
function shift(date, delta) { return new Date(Date.parse(date + 'T00:00:00Z') + delta * DAY).toISOString().slice(0, 10); }
function mask(days) { return days.reduce((value, items, i) => value | (items.length ? 1 << i : 0), 0); }
function schedule(state, date) {
  if (state.program) {
    const weeks = new Map();
    // Legacy repetition ends at the first cycle; the saved history stays finite.
    for (let week = d.weekStart(date); week < state.program.from; week = shift(week, 7)) {
      const plan = state.overrides.find(o => o.id === week && !o.cycleId && o.templateId === state.profile.activeTemplateId) || state.templates.find(t => t.id === state.profile.activeTemplateId);
      weeks.set(week, plan ? mask(plan.days) : 0);
    }
    state.program.cycles.forEach(c => c.weeks.forEach((id, i) => {
      const week = shift(c.startWeek, i * 7);
      if (week < d.weekStart(date)) return;
      const plan = state.overrides.find(o => o.id === week && o.cycleId === c.id && o.planId === id) || c.plans.find(p => p.id === id);
      weeks.set(week, mask(plan.days));
    }));
    return { from: date, mask: 0, weeks: [...weeks].map(([week, value]) => ({ week, mask: value })).sort((a, b) => a.week.localeCompare(b.week)) };
  }
  const active = state.profile.activeTemplateId;
  const plan = state.templates.find(t => t.id === active);
  return { from: date, mask: plan ? mask(plan.days) : 0, weeks: state.overrides.filter(o => o.templateId === active && o.id >= d.weekStart(date)).map(o => ({ week: o.id, mask: mask(o.days) })).sort((a, b) => a.week.localeCompare(b.week)) };
}
function achievement(state, date) {
  const records = state.records.filter(r => r.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(records.map(r => [r.date, r]));
  const history = state.program && state.program.scheduleHistory || state.profile.scheduleHistory || [];
  const first = [records[0] && records[0].date, history[0] && history[0].from].filter(Boolean).sort()[0] || date;
  let streak = 0, broken = false, estimated = false;
  for (let cursor = date; cursor >= first; cursor = shift(cursor, -1)) {
    const record = byDate.get(cursor);
    if (record) {
      if (d.calculateRecord(record).completedSetCount) { streak++; continue; }
      if (record.items.length) { broken = true; break; }
      continue;
    }
    // Saved effective schedules protect past gaps from later template edits.
    const event = history.filter(e => e.from <= cursor).slice(-1)[0];
    let planned;
    if (event) {
      const override = event.weeks.find(w => w.week === d.weekStart(cursor));
      planned = !!((override ? override.mask : event.mask) & (1 << d.weekday(cursor)));
    } else {
      estimated = true;
      planned = d.resolveDay(state, cursor).items.length > 0;
    }
    if (planned && cursor < date) { broken = true; break; }
  }
  const current = byDate.get(date);
  const totals = d.calculateRecord(current || { items: [], completed: [] });
  const restarted = streak === 1 && broken && records.some(r => r.date < date && d.calculateRecord(r).completedSetCount);
  const milestone = streak > 0 && streak % 7 === 0;
  const previousWeek = shift(d.weekStart(date), -7), thisWeek = d.weekStart(date);
  const previous = records.filter(r => r.date >= previousWeek && r.date < thisWeek).map(d.calculateRecord);
  const bestVolume = Math.max(0, ...previous.map(t => t.volume));
  const bestMinutes = Math.max(0, ...previous.map(t => t.cardioMinutes));
  const comparison = totals.volume > 0 && bestVolume > 0 && totals.volume > bestVolume
    ? '你打破了上周的单日容量纪录！'
    : totals.volume === 0 && bestMinutes > 0 && totals.cardioMinutes > bestMinutes
      ? '有氧时长超过了上周的单日纪录！' : '';
  const variants = ['今天，练到位了。', '这份战绩，属于坚持到最后的你。', '汗没白流，每一组都算数。'];
  const variation = Number(date.slice(-2)) % variants.length;
  let encouragement = variants[variation];
  if (milestone) encouragement = '你简直是个铁人。下一程，继续！';
  else if (streak >= 7) encouragement = ['你把坚持练成了习惯。真硬核。', '坚持到今天的人，值得给自己掌声。', '第 ' + streak + ' 次兑现承诺，你很稳。'][variation];
  else if (comparison || totals.volume >= 5000) encouragement = ['今天练得太狠了！铁块都被你吓到了。', '把铁块举起来的感觉，真爽。', '今天这份容量，够硬核。'][variation];
  else if (totals.volume < 1000 && totals.cardioMinutes < 20) encouragement = ['动了就比没动强，这次打卡算数。', '轻一点也没关系，你今天来了。', '热身也算前进。今天值得记一笔。'][variation];
  return {
    streak, restarted, milestone, estimated,
    title: restarted ? '重新开始连胜，第 1 天！' : milestone ? streak + ' 个训练日连续达成！' : '连续 ' + streak + ' 个训练日！',
    encouragement, comparison,
    label: totals.volume > 0 ? '今日容量' : '今日有氧',
    value: Number(totals.volume > 0 ? totals.volume : totals.cardioMinutes).toLocaleString('en-US', { maximumFractionDigits: 1 }),
    unit: totals.volume > 0 ? 'kg' : '分钟'
  };
}
module.exports = { achievement, schedule, shift };
