const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const d = require('../miniprogram/lib/domain');
const clone = value => JSON.parse(JSON.stringify(value));

test('requested gym presets use minimum total reps, bodyweight coefficients and blank personal loads', () => {
  const expected = [
    ['徒手深蹲', 'bodyweight', 15, 7, 0.7], ['保加利亚分腿蹲', 'bodyweight', 16, 8, 0.85],
    ['哑铃深蹲推举', 'weighted', 8, 8], ['靠墙站姿哑铃肩上推举', 'weighted', 8, 8],
    ['哑铃弯举', 'weighted', 10, 8], ['仰卧哑铃飞鸟', 'weighted', 10, 8],
    ['哑铃肩上推举', 'weighted', 8, 8], ['双臂哑铃弯举', 'weighted', 10, 8]
  ];
  for (const [name, type, reps, rpe, coefficient] of expected) {
    const item = d.PRESETS.find(e => e.name === name); assert.ok(item, name);
    assert.equal(item.type, type); assert.equal(item.sets, 3); assert.equal(item.reps, reps); assert.equal(item.rpe, rpe);
    if (coefficient != null) assert.equal(item.coefficient, coefficient);
    if (type === 'weighted') assert.equal(item.weight, 0);
  }
  const combo = d.PRESETS.find(e => e.name === '哑铃深蹲 + 哑铃飞鸟'); assert.ok(combo);
  assert.equal(combo.type, 'superset'); assert.equal(combo.sets, 3);
  assert.deepEqual(combo.components.map(e => [e.name, e.type, e.sets, e.reps, e.rpe, e.weight, e.restSeconds]), [['哑铃深蹲', 'weighted', 1, 10, 8, 0, 0], ['哑铃飞鸟', 'weighted', 1, 10, 8, 0, 0]]);
  assert.equal(new Set(d.PRESETS.map(e => e.id)).size, d.PRESETS.length);
});

function editor(route) {
  const file = require.resolve('../miniprogram/packages/manage/' + route + '/index'), localRequire = createRequire(file);
  let definition, saved, modal;
  const ui = { ...require('../miniprogram/pages/ui'), ready: () => true, store: { accountKey: () => 'preset-owner', saveExercise: async body => { saved = clone(body); } } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: name => name.includes('pages/ui') ? ui : localRequire(name), Page: value => { definition = value; }, wx: { showToast() {}, navigateBack() {}, showModal: value => { modal = value; }, disableAlertBeforeUnload() {} } });
  return { page: { ...definition, data: clone(definition.data), setData(values) { Object.assign(this.data, values); } }, saved: () => saved, modal: () => modal };
}

test('a built-in superset can be copied and edited without changing its preset or child snapshots', async () => {
  const preset = d.PRESETS.find(e => e.name === '哑铃深蹲 + 哑铃飞鸟'); assert.ok(preset);
  const original = clone(preset), h = editor('superset-edit'); h.page._query = { id: preset.id };
  h.page.render({ exercises: [], revisions: {}, identityReady: true });
  assert.equal(h.page.data.error, ''); assert.notEqual(h.page.data.form.id, preset.id); assert.equal(h.page.data.components.length, 2);
  h.page._form.components[0].weight = 25; await h.page.save();
  assert.equal(h.saved().components[0].weight, 25); assert.equal(h.saved().components[1].weight, 0); assert.deepEqual(preset, original);
});

test('rep help explains both sides and a total of 16 is saved as 16 without automatic multiplication', async () => {
  const h = editor('exercise-edit'); h.page._query = { id: 'bulgarian-split-squat' };
  h.page.render({ exercises: [], revisions: {}, identityReady: true, loading: false }); h.page.repsHelp();
  assert.match(h.modal().content, /总次数/); assert.match(h.modal().content, /8.*16/); assert.equal(h.modal().showCancel, false);
  h.page.field({ currentTarget: { dataset: { key: 'reps' } }, detail: { value: '16' } }); await h.page.save();
  assert.equal(h.saved().reps, 16); assert.equal(h.saved().coefficient, 0.85);
});
