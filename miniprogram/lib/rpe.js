function scale(type) {
  return type === 'cardio' ? { min: 6, max: 20 } : { min: 0, max: 10 };
}
function description(type, value) {
  if (value === null || value === undefined) return '未设置';
  if (type !== 'cardio') return '还能完成约 ' + (10 - value) + ' 次（RIR）';
  if (value === 6) return '完全没感觉';
  if (value <= 9) return '像热身';
  if (value <= 12) return '能轻松聊天';
  if (value <= 14) return '有点喘，能说短句';
  if (value <= 16) return '只能蹦几个词';
  if (value <= 18) return '接近极限';
  return '完全撑不住';
}
function label(item) {
  return typeof item.rpe === 'number' ? 'RPE ' + item.rpe : item.intensity || '';
}
function help(type) {
  return type === 'cardio'
    ? 'RPE 是主观用力程度，有氧使用 6–20 刻度。\n\n6：完全没感觉\n7–9：像热身\n10–12：能轻松聊天\n13–14：有点喘，能说短句\n15–16：只能蹦几个词\n17–18：接近极限\n19–20：完全撑不住\n\n根据自己的感受选择，不限定速度。'
    : 'RPE 是主观用力程度，力量使用 0–10 刻度。\n\nRPE = 10 − RIR\nRIR 是完成一组后，保持动作标准还能做的次数。\n\nRPE 8：还能做约 2 次\nRPE 9：还能做约 1 次\nRPE 10：已经无法再做\n\n按自己的能力选择重量。';
}
module.exports = { scale, description, label, help };
