const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('exercise selection returns without inheriting the hidden plan draft alert', () => {
  let definition; let alertEnabled = false;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/packages/manage/plan-edit/index.js'), 'utf8'), {
    require: () => ({}), Page: page => { definition = page; },
    wx: { enableAlertBeforeUnload() { alertEnabled = true; }, disableAlertBeforeUnload() { alertEnabled = false; } }
  });
  const page = Object.assign({}, definition, { data: { dirty: false }, setData(patch) { Object.assign(this.data, patch); } });
  page.onShow();
  page.markDirty();
  assert.equal(alertEnabled, true);
  page.onHide();
  page.markDirty(); // The picker's event channel updates the hidden editor.
  assert.equal(alertEnabled, false);
  assert.equal(page.data.dirty, true);
  page.onShow();
  assert.equal(alertEnabled, true);
});
