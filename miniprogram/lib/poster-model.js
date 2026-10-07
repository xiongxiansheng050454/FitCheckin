const d = require('./domain');
function createPosterModel(state, query, today) {
  let totals, items = [], muscles, days = [];
  if (query.mode === 'day') {
    if (query.date !== today) throw d.error('只能生成今日完成海报');
    const record = state.records.find(r => r.date === query.date);
    totals = record && d.calculateRecord(record);
    if (!totals || totals.status !== 'complete') throw d.error('请先完成今日全部训练');
    items = record.items.map(item => ({ name: item.name, summary: d.exerciseSummary(item) }));
    muscles = d.MUSCLES.map(m => ({ name: m.name, volume: totals.muscles[m.id] || 0 }));
  } else if (query.mode === 'month') {
    totals = d.calculateMonth(state.records, query.month);
    if (!totals.trainingDays) throw d.error('所选月份还没有训练记录');
    muscles = totals.muscles;
    days = totals.days.map(day => ({ date: day.date, status: day.status }));
  } else throw d.error('海报类型不正确');
  const muscleTotal = muscles.reduce((sum, m) => sum + m.volume, 0);
  return {
    mode: query.mode, period: query.mode === 'day' ? query.date : query.month,
    volume: totals.volume, weightedVolume: totals.weightedVolume, bodyweightVolume: totals.bodyweightVolume,
    completedCount: totals.completedCount, trainingDays: totals.trainingDays || 1,
    cardioMinutes: totals.cardioMinutes, cardioKm: totals.cardioKm, cardioCount: totals.cardioCount,
    items, days, muscles: muscles.filter(m => m.volume > 0).map(m => ({ name: m.name, percent: m.volume * 100 / muscleTotal })).sort((a, b) => b.percent - a.percent),
    pending: !!(state.sync.pendingCount || state.sync.status === 'conflict' || state.sync.status === 'error')
  };
}
module.exports = { createPosterModel };
