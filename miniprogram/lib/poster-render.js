const d = require('./domain');
const WIDTH = 750, HEIGHT = 1320;
const colors = { ink: '#111510', lime: '#D8FF3E', green: '#18864B', muted: '#6A756D', rule: '#E4EBE5', gold: '#C4A34A' };
const MUSCLE_COLORS = ['#FF7955', '#38BDF8', '#FAAE43', '#33C99B', '#E6688F', '#57A3EA', '#BCCE48', '#B8CDD0'];
function number(value, digits) { return Number(value || 0).toFixed(digits || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function captions(model) {
  const strength = model.volume > 0;
  const effort = strength ? number(model.volume) + 'kg' : number(model.cardioMinutes, 1) + '分钟';
  if (model.mode === 'month') return [
    '练了 ' + model.trainingDays + ' 天，这个月没白练。',
    '这个月，把坚持练成了战绩。',
    effort + '，是这个月的战利品。',
    '练了 ' + model.trainingDays + ' 天，谁下个月一起？',
    '这个月，每次训练都算数。'
  ];
  return [
    '今天练了 ' + effort + '，谁在练？',
    model.weightedVolume > 0 ? '把铁块举起来的感觉，真爽。' : strength ? '把自己撑起来的感觉，真爽。' : '出完这身汗的感觉，真爽。',
    '这 ' + effort + '，是今天的战利品。',
    '今天，练到位了。',
    '汗没白流，每一组都算数。'
  ];
}
function drawPoster(ctx, model, code) {
  function font(size, weight) { ctx.font = (weight || 400) + ' ' + size + 'px "PingFang SC", sans-serif'; }
  function text(value, x, y, size, color, maxWidth, weight) {
    value = String(value); let fontSize = size; font(fontSize, weight);
    if (maxWidth && ctx.measureText(value).width > maxWidth) {
      fontSize = Math.max(Math.ceil(size * 0.75), Math.floor(size * maxWidth / ctx.measureText(value).width)); font(fontSize, weight);
    }
    if (maxWidth && ctx.measureText(value).width > maxWidth) {
      const chars = Array.from(value);
      while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
      value = chars.join('') + '…';
    }
    ctx.fillStyle = color || colors.ink; ctx.fillText(value, x, y);
  }
  function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }
  function caption(value) {
    font(38, 800);
    const lines = []; let line = '';
    Array.from(value).forEach(char => {
      if (ctx.measureText(line + char).width > 654 && line) { lines.push(line); line = char; } else line += char;
    });
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((content, i) => text(content, 48, 508 + i * 47, 38, colors.ink, 654, 800));
  }
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  rect(0, 0, WIDTH, HEIGHT, '#FFFFFF'); rect(0, 0, WIDTH, 446, colors.ink);
  text('IronPlan', 48, 88, 54, '#FFFFFF', 390, 900);
  text(model.mode === 'day' ? '今日战绩' : '月度战绩', 566, 81, 24, colors.lime, 136, 700);
  text(model.period.replace(/-/g, '.'), 48, 139, 25, '#B4BEB0');
  const strength = model.volume > 0;
  const value = number(strength ? model.volume : model.cardioMinutes, strength ? 0 : 1);
  let heroSize = 228; font(heroSize, 900);
  // Keep the full result readable even for unusually large monthly totals.
  if (ctx.measureText(value).width > 662) { heroSize = Math.max(36, Math.floor(heroSize * 662 / ctx.measureText(value).width)); font(heroSize, 900); }
  ctx.fillStyle = colors.lime; ctx.fillText(value, 42, 330);
  text(strength ? 'kg  /  训练容量' : 'min  /  有氧训练', 48, 423, 25, '#FFFFFF', 654, 700);
  caption(model.caption || captions(model)[0]);
  const metrics = model.mode === 'day'
    ? [[model.completedCount, '完成动作'], [number(model.cardioMinutes, 1), '有氧 · 分钟'], [model.cardioCount, '有氧动作']]
    : [[model.trainingDays, '训练天数'], [model.completedCount, '完成动作'], [number(model.cardioMinutes, 1), '有氧 · 分钟']];
  metrics.forEach((m, i) => { const x = 48 + i * 226; text(m[0], x, 611, 39, colors.ink, 200, 800); text(m[1], x, 644, 21, colors.muted); });
  rect(48, 667, 654, 1, colors.rule);
  if (model.mode === 'day') {
    model.items.slice(0, 4).forEach((item, i) => {
      const y = 712 + i * 68;
      text(String(i + 1).padStart(2, '0'), 48, y, 24, colors.green, 44, 800);
      text(item.name, 104, y, 27, colors.ink, 598, 700);
      text(item.summary, 104, y + 28, 21, colors.muted, 598);
    });
    if (model.items.length > 4) text('另完成 ' + (model.items.length - 4) + ' 个动作', 104, 998, 22, colors.muted);
    text('力量 ' + number(model.weightedVolume) + '  /  自重 ' + number(model.bodyweightVolume) + ' kg', 48, 1031, 20, colors.muted, 654);
  } else {
    text('出勤战绩', 48, 710, 24, colors.ink, 292, 700);
    text('肌群战绩', 410, 710, 24, colors.ink, 292, 700);
    ['一', '二', '三', '四', '五', '六', '日'].forEach((label, i) => text(label, 55 + i * 44, 750, 18, colors.muted));
    const padding = d.weekday(model.period + '-01');
    model.days.forEach((day, i) => {
      const slot = padding + i, x = 48 + slot % 7 * 44, y = 778 + Math.floor(slot / 7) * 29;
      if (day.status !== 'none') rect(x, y - 18, 33, 25, day.status === 'complete' ? colors.green : colors.gold);
      text(Number(day.date.slice(-2)), x + 4, y, 18, day.status === 'none' ? colors.muted : day.status === 'partial' ? colors.ink : '#FFFFFF', 29);
    });
    text('绿色完成 · 金色部分完成', 48, 964, 17, colors.muted, 306);
    const cx = 553, cy = 823, radius = 77;
    ctx.lineWidth = 30; ctx.lineCap = 'butt';
    let angle = -Math.PI / 2;
    if (!model.muscles.length) {
      ctx.beginPath(); ctx.strokeStyle = colors.rule; ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.textAlign = 'center'; text('有氧', cx, cy + 9, 32, colors.ink, 90, 800); ctx.textAlign = 'left';
    }
    model.muscles.forEach(muscle => {
      const next = angle + Math.PI * 2 * muscle.percent / 100;
      const index = d.MUSCLES.findIndex(m => m.name === muscle.name);
      ctx.beginPath(); ctx.strokeStyle = MUSCLE_COLORS[index]; ctx.arc(cx, cy, radius, angle, next); ctx.stroke(); angle = next;
    });
    if (model.muscles.length) {
      ctx.textAlign = 'center';
      text(model.muscles[0].name, cx, cy, 30, colors.ink, 86, 800);
      text(model.muscles[0].percent.toFixed(0) + '%', cx, cy + 34, 27, colors.muted, 86, 700);
      ctx.textAlign = 'left';
    }
    model.muscles.forEach((muscle, i) => {
      const x = i < 4 ? 410 : 566, y = 944 + i % 4 * 26;
      const index = d.MUSCLES.findIndex(m => m.name === muscle.name);
      rect(x, y - 12, 10, 10, MUSCLE_COLORS[index]);
      text(muscle.name, x + 17, y, 17, colors.ink, 65);
      text(muscle.percent.toFixed(0) + '%', x + 89, y, 17, colors.muted, 47);
    });
    text('力量 ' + number(model.weightedVolume) + '  /  自重 ' + number(model.bodyweightVolume) + ' kg', 48, 1015, 18, colors.muted, 306);

  }
  rect(48, 1062, 350, 1, colors.rule);
  text('一起练，别停。', 48, 1132, 37, colors.ink, 348, 800);
  text('扫码加入下一场训练', 48, 1178, 22, colors.green, 350);
  text('容量含自重估算', 48, 1227, 18, colors.muted);
  text('肌群比例为估算', 48, 1254, 18, colors.muted);
  if (model.pending) text('本机记录 · 待同步', 48, 1290, 18, colors.muted, 350);
  // Preserve the official code as-is, with a dedicated white area around it.
  rect(432, 1044, 296, 276, '#FFFFFF');
  ctx.drawImage(code, 458, 1060, 244, 244);
}
module.exports = { drawPoster, captions, number, WIDTH, HEIGHT };
