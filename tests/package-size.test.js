const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyze } = require('../scripts/check-package-size');

test('size checker separates packages and blocks one over 2MB', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fitcheckin-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'mini/packages/manage'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify({ miniprogramRoot: 'mini', packOptions: { ignore: [{ type: 'file', value: 'ignored.png' }] } }));
  fs.writeFileSync(path.join(root, 'mini/app.json'), JSON.stringify({ subPackages: [{ root: 'packages/manage', pages: [] }] }));
  fs.writeFileSync(path.join(root, 'mini/ignored.png'), Buffer.alloc(3 * 1024 * 1024));
  fs.writeFileSync(path.join(root, 'mini/packages/manage/large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1));
  const result = analyze(root);
  assert.equal(result.packages[1].bytes, 2 * 1024 * 1024 + 1);
  assert.equal(result.violations.length, 1);
  assert.ok(result.packages[0].bytes < 1024);
});
