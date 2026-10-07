const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('../miniprogram/lib/poster-runtime');

test('official image prefetch deduplicates requests, retries failures and survives a new runtime', async () => {
  const disk = new Map(); let requests = 0, fail = true, writes = 0;
  const api = {
    env: { USER_DATA_PATH: '/private' }, getStorageSync: key => disk.get(key), setStorageSync: (key, value) => disk.set(key, value),
    getFileSystemManager: () => ({ access(o) { o.success(); }, writeFile(o) { writes++; o.success(); } }),
    cloud: { async callFunction() { requests++; if (fail) throw new Error('offline'); return { result: { code: 0, data: { base64: 'image', mimeType: 'image/png' } } }; } }
  };
  const r = createRuntime(api);
  await assert.rejects(Promise.all([r.loadCode(), r.loadCode()]), /offline/); assert.equal(requests, 1);
  fail = false;
  const paths = await Promise.all([r.loadCode(), r.loadCode()]);
  assert.deepEqual(paths, ['/private/ironplan-poster-code.png', '/private/ironplan-poster-code.png']);
  assert.equal(requests, 2); assert.equal(writes, 1);
  assert.equal(await createRuntime(api).loadCode(), paths[0]); assert.equal(requests, 2);
  disk.get('ironplan:poster-code-v1').at = 0;
  await createRuntime(api).loadCode(); assert.equal(requests, 3);
});
