const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const environment = require('../miniprogram/lib/environment');

test('native initialization and backend document database both target the selected environment without a service key', async () => {
  assert.equal(environment.id, 'weixing2-d7g2j6asyc5132905');
  let app, initialized, databaseEnvironment;
  const appFile = require.resolve('../miniprogram/app');
  const appRequire = createRequire(appFile);
  vm.runInNewContext(fs.readFileSync(appFile, 'utf8'), {
    App: value => { app = value; },
    wx: { cloud: { init: value => { initialized = value.env; } }, onNetworkStatusChange() {} },
    require: name => name === './lib/store' ? { init() {} } : appRequire(name)
  });
  app.onLaunch(); assert.equal(initialized, environment.id);
  const backendFile = require.resolve('../cloudfunctions/fitcheckin');
  const backendRequire = createRequire(backendFile);
  const exports = {};
  let serverEnvironment;
  vm.runInNewContext(fs.readFileSync(backendFile, 'utf8'), {
    exports, Buffer,
    require: name => name === 'wx-server-sdk' ? {
      init: value => { serverEnvironment = value.env; },
      database: options => {
        databaseEnvironment = options.env;
        assert.equal(options.throwOnNotFound, false);
        return require('./helpers/document-db').createDatabase();
      },
      getWXContext: () => ({ OPENID: 'test-owner', APPID: 'wxe25930a2cdce35d0' }),
      openapi: { wxacode: { getUnlimited() {} } }
    } : backendRequire(name)
  });
  const result = await exports.main({ action: 'bootstrap' });
  assert.equal(result.code, 0);
  assert.equal(serverEnvironment, environment.id);
  assert.equal(databaseEnvironment, environment.id);
});
