const rpe = require('./rpe');
const QUOTES = [
  '上一组已经算数，下一组值得好好准备。',
  '把呼吸放慢，把力量留给下一组。',
  '进步藏在每一次认真完成里。',
  '不用和别人比，比上一组更稳就很好。',
  '休息也是训练的一部分，给身体一点时间。'
];
const RETURN_QUOTES = ['休息够了，回来就很好。下一组，继续兑现你的计划。', '手机可以等一等，你的下一组已经准备好了。', '刚才那一组没有白练，回来把下一组接上。'];
function restView(rest, now) {
  const remaining = Math.max(0, Math.ceil((rest.endAt - now) / 1000));
  const overtime = Math.max(0, Math.floor((now - rest.endAt) / 1000));
  const variant = (rest.afterSet || 0) + Math.floor(rest.endAt / 86400000);
  return {
    remaining, overtime, timer: String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0'),
    progress: Math.min(100, Math.max(0, (1 - remaining / rest.duration) * 100)),
    title: remaining ? '组间恢复' : rest.away ? '休息已经结束' : '下一组，准备好了',
    quote: remaining ? QUOTES[(variant + Math.floor((rest.duration - remaining) / 15)) % QUOTES.length] : RETURN_QUOTES[variant % RETURN_QUOTES.length]
  };
}
function setLabel(item) {
  if (item.type === 'superset') return item.components.map(child => child.name + ' · ' + setLabel(child)).join(' + ');
  const intensity = rpe.label(item), suffix = intensity ? ' · ' + intensity : '';
  if (item.type === 'cardio') return (item.durationMinutes < 1 ? Math.round(item.durationMinutes * 60) + ' 秒' : item.durationMinutes + ' 分钟') + suffix;
  return item.reps + ' 次 · ' + (item.type === 'weighted' ? (item.weight ? item.weight + ' kg' : '重量待填写') : '自重 × ' + item.coefficient) + suffix;
}
module.exports = { restView, setLabel };
