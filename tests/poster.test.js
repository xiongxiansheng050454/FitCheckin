'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/lib/domain');
const { createPosterModel } = require('../miniprogram/packages/share/poster/model');
const { createPosterCode } = require('../cloudfunctions/fitcheckin/poster-code');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { drawPoster, captions, HEIGHT } = require('../miniprogram/packages/share/poster/render');
const fs = require('node:fs');
const vm = require('node:vm');
const date = '2026-10-04';
const bench = { ...d.PRESETS.find(x => x.id === 'bench'), weight: 40, entryId: 'bench-1' };
const pushup = { ...d.PRESETS.find(x => x.id === 'pushup'), entryId: 'pushup-1' };
const run = { ...d.PRESETS.find(x => x.id === 'run'), distanceKm: 5, entryId: 'run-1' };
const record = { date, items: [bench, pushup, run], completed: ['bench-1', 'pushup-1', 'run-1'], bodyWeight: 70 };
const state = records => ({ records, sync: { pendingCount: 0, status: 'idle' } });

test('daily poster uses frozen record totals and requires a complete current day', () => {
  const model = createPosterModel(state([record]), { mode: 'day', date }, date);
  assert.equal(model.volume, 2838);
  assert.equal(model.weightedVolume, 1200);
  assert.equal(model.bodyweightVolume, 1638);
  assert.equal(model.cardioMinutes, 30);
  assert.equal(model.cardioKm, 5);
  assert.equal(model.completedCount, 3);
  assert.equal(model.items.length, 3);
  assert.throws(() => createPosterModel(state([{ ...record, completed: ['bench-1'] }]), { mode: 'day', date }, date), /全部训练/);
  assert.throws(() => createPosterModel(state([record]), { mode: 'day', date }, '2026-10-05'), /今日/);
  assert.throws(() => createPosterModel(state([]), { mode: 'day', date }, date), /全部训练/);
});

test('monthly poster supports cardio-only and partial days, selected months and pending labels', () => {
  const model = createPosterModel(state([{ ...record, items: [run], completed: ['run-1'] }]), { mode: 'month', month: '2026-10' }, date);
  assert.equal(model.volume, 0);
  assert.equal(model.trainingDays, 1);
  assert.equal(model.cardioCount, 1);
  assert.equal(model.days.length, 31);
  const pending = state([{ ...record, completed: ['bench-1'] }]);
  pending.sync.pendingCount = 1;
  assert.equal(createPosterModel(pending, { mode: 'month', month: '2026-10' }, date).pending, true);
  assert.throws(() => createPosterModel(state([record]), { mode: 'month', month: '2026-09' }, date), /没有训练/);
  assert.throws(() => createPosterModel(state([record]), { mode: 'month', month: '2026-13' }, date), /月份/);
});

test('official poster code caches only successful image results and retries failures', async () => {
  let calls = 0;
  const image = Buffer.from('89504e470d0a1a0a0000000000000000', 'hex');
  const getCode = createPosterCode(async options => {
    calls++;
    assert.deepEqual(options, { scene: 'ironplan', page: 'pages/today/index', checkPath: false, envVersion: 'release', width: 430, isHyaline: false, autoColor: false, lineColor: { r: 23, g: 33, b: 28 } });
    if (calls === 1) throw new Error('official API error');
    return { buffer: image };
  });
  await assert.rejects(getCode());
  const results = await Promise.all([getCode(), getCode()]);
  assert.equal(calls, 2);
  assert.equal(results[0].mimeType, 'image/png');
  assert.equal(results[0].base64, image.toString('base64'));
  assert.deepEqual(results[1], results[0]);
  await assert.rejects(createPosterCode(async () => ({ buffer: Buffer.from('{"errcode":1}') }))());
});

test('poster code requires native identity and exposes a bounded error', async () => {
  let calls = 0;
  const identity = { OPENID: 'native-user', APPID: 'wxe25930a2cdce35d0' };
  const getPosterCode = async () => { calls++; throw new Error('secret backend detail'); };
  const handler = createHandler({ getWXContext: () => identity, getPosterCode });
  const failed = await handler({ action: 'posterCode' });
  assert.equal(failed.code, 'POSTER_CODE_ERROR');
  assert.ok(!JSON.stringify(failed).includes('secret'));
  identity.APPID = 'wrong';
  assert.equal((await handler({ action: 'posterCode' })).code, 'FORBIDDEN');
  assert.equal(calls, 1);
});

test('poster layout contains long names, large totals and all eight muscle groups', () => {
  const drawn = [];
  const ctx = { font: '', measureText(value) { return { width: Array.from(value).length * Number(/(\d+)px/.exec(this.font)[1]) * 0.6 }; },
    fillText(value, x, y) { drawn.push({ value, x, y, width: this.measureText(value).width }); }, fillRect() {}, drawImage() {}, beginPath() {}, arc() {}, stroke() {} };
  const model = createPosterModel(state([record]), { mode: 'day', date }, date);
  model.volume = 999999999999;
  model.items = [{ name: 'Long exercise name '.repeat(12), summary: 'Workout parameters '.repeat(12) }];
  drawPoster(ctx, model, {});
  assert.ok(drawn.every(item => item.x + item.width <= 750 && item.y < HEIGHT));
  assert.ok(drawn.some(item => item.value.endsWith('…')));
  drawn.length = 0;
  const monthly = createPosterModel(state([record]), { mode: 'month', month: '2026-10' }, date);
  monthly.muscles = d.MUSCLES.map(m => ({ name: m.name, percent: 12.5 }));
  drawPoster(ctx, monthly, {});
  assert.ok(d.MUSCLES.every(m => drawn.some(item => item.value === m.name)));
  assert.ok(drawn.every(item => item.x + item.width <= 750 && item.y < HEIGHT));
});

test('social captions offer five choices and use cardio minutes instead of zero kilograms', () => {
  const daily = createPosterModel(state([record]), { mode: 'day', date }, date);
  assert.equal(captions(daily).length, 5);
  assert.ok(captions(daily)[0].includes('2,838kg'));
  const cardio = createPosterModel(state([{ ...record, items: [run], completed: ['run-1'] }]), { mode: 'day', date }, date);
  assert.ok(captions(cardio)[0].includes('30.0分钟'));
  assert.ok(captions(cardio).every(value => !value.includes('0kg')));
  assert.equal(captions({ ...daily, mode: 'month', trainingDays: 12 }).length, 5);
  assert.ok(captions({ ...daily, mode: 'month', trainingDays: 12 })[0].includes('12 天'));
});

test('hero number is complete, branding appears once, ring segments cover 100% and the code is larger', () => {
  const drawn = [], arcs = [], images = [];
  const ctx = { font: '', measureText(value) { return { width: Array.from(value).length * Number(/(\d+)px/.exec(this.font)[1]) * 0.6 }; },
    fillText(value) { drawn.push({ value, font: this.font }); }, fillRect() {}, drawImage(...args) { images.push(args); }, beginPath() {}, arc(...args) { arcs.push(args); }, stroke() {} };
  const model = createPosterModel(state([record]), { mode: 'month', month: '2026-10' }, date);
  drawPoster(ctx, model, {});
  assert.equal(drawn.filter(x => x.value === 'IronPlan').length, 1);
  const hero = drawn.find(x => x.value === '2,838');
  assert.ok(/^900 /.test(hero.font));
  assert.ok(Number(/(\d+)px/.exec(hero.font)[1]) >= 200);
  assert.equal(arcs.length, model.muscles.length);
  assert.ok(Math.abs(arcs.reduce((sum, arc) => sum + arc[4] - arc[3], 0) - Math.PI * 2) < 1e-8);
  assert.deepEqual(images[0].slice(1), [458, 1060, 244, 244]);
});

test('album denial preserves the poster; granted settings retry saves the same image', async () => {
  let page, permission = false, saves = 0, opens = 0;
  const wx = {
    getSetting(options) { options.success({ authSetting: { 'scope.writePhotosAlbum': false } }); },
    openSetting(options) { opens++; options.success({ authSetting: { 'scope.writePhotosAlbum': permission } }); },
    saveImageToPhotosAlbum(options) { saves++; assert.equal(options.filePath, 'poster.png'); options.success({}); },
    showToast() {}
  };
  const ui = { confirm: async () => true, store: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/packages/share/poster/index'), 'utf8'), {
    wx, Page: definition => { page = definition; }, require: name => name.includes('/pages/ui') ? ui : require('node:module').createRequire(require.resolve('../miniprogram/packages/share/poster/index'))(name)
  });
  page.data = { imagePath: 'poster.png', loading: false, saving: false };
  page.setData = update => Object.assign(page.data, update);
  await page.save();
  assert.equal(saves, 0);
  assert.equal(page.data.saving, false);
  assert.equal(page.data.imagePath, 'poster.png');
  assert.ok(page.data.error.includes('相册权限'));
  permission = true; await page.save();
  assert.equal(saves, 1);
  assert.equal(opens, 2);
  assert.equal(page.data.error, '');
});
