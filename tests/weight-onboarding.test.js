const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const d = require('../miniprogram/lib/domain');
const { createStore } = require('../miniprogram/lib/store');
const { createHandler } = require('../cloudfunctions/fitcheckin');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const { createDatabase } = require('./helpers/document-db');
const copy = value => JSON.parse(JSON.stringify(value));

function pageFixture(store, disk = new Map()) {
  const file = require.resolve('../miniprogram/pages/today/index'), localRequire = createRequire(file);
  let definition; const toasts = [], bar = {};
  const ui = { ...require('../miniprogram/pages/ui'), store, ready: () => store.getState().identityReady };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: name => name === '../ui' ? ui : name.includes('poster-runtime') ? { loadCode: async () => {} } : localRequire(name),
    Page: page => { definition = page; }, setInterval: () => 1, clearInterval() {},
    wx: { getStorageSync: key => disk.get(key), setStorageSync: (key, value) => disk.set(key, copy(value)), showToast: value => toasts.push(value), setKeepScreenOn() {} }
  });
  const page = { ...definition, data: copy(definition.data), setData(values) { Object.assign(this.data, values); }, getTabBar() { return { setData: values => Object.assign(bar, values) }; } };
  return { page, disk, toasts, bar };
}
function stateFixture() {
  let owner = 'a';
  const state = { profile: { id: 'profile', bodyWeight: null }, records: [], templates: [], overrides: [], revisions: {}, identityReady: false, loading: true, sync: { status: 'idle', pendingCount: 0 } };
  const store = { accountKey: () => 'fitcheckin:env:' + owner, getState: () => state };
  return { state, store, owner: value => { owner = value; } };
}

test('weight onboarding waits for confirmed loaded identity, opens once and persists skip per account/environment', () => {
  const f = stateFixture(), ui = pageFixture(f.store); ui.page.onShow();
  assert.equal(ui.page.data.onboardingOpen, false);
  f.state.identityReady = true; ui.page.render(f.state); assert.equal(ui.page.data.onboardingOpen, false);
  f.state.loading = false; ui.page.render(f.state); assert.equal(ui.page.data.onboardingOpen, true); assert.equal(ui.bar.hidden, true);
  ui.page.onboardingInput({ detail: { value: '68.5' } }); ui.page.render(f.state); assert.equal(ui.page.data.onboardingWeight, '68.5');
  ui.page.skipOnboarding(); assert.equal(ui.page.data.onboardingOpen, false);
  const restart = pageFixture(f.store, ui.disk); restart.page.onShow(); assert.equal(restart.page.data.onboardingOpen, false);
  f.owner('b'); restart.page.render(f.state); assert.equal(restart.page.data.onboardingOpen, true); assert.equal(restart.page.data.onboardingWeight, '');
  f.store.accountKey = () => 'fitcheckin:other-env:b'; restart.page.render(f.state); assert.equal(restart.page.data.onboardingOpen, true);
  assert.equal(ui.disk.size, 1);
});

test('existing weight suppresses onboarding; account switches clear drafts and rest delays the prompt', () => {
  const f = stateFixture(); f.state.identityReady = true; f.state.loading = false; f.state.profile.bodyWeight = 70;
  const ui = pageFixture(f.store); ui.page.onShow(); assert.equal(ui.page.data.onboardingOpen, false);
  f.state.profile.bodyWeight = null; ui.page.render(f.state); assert.equal(ui.page.data.onboardingOpen, false);
  f.owner('new'); ui.page.onHide(); ui.page.render(f.state); assert.equal(ui.page.data.onboardingOpen, false);
  ui.page.onShow(); assert.equal(ui.page.data.onboardingOpen, true);
  ui.page.setData({ onboardingOpen: false, restOpen: true }); ui.page.checkOnboarding(f.state); assert.equal(ui.page.data.onboardingOpen, false);
  ui.page.setData({ restOpen: false }); ui.page.checkOnboarding(f.state); assert.equal(ui.page.data.onboardingOpen, true);
});

test('first weight validates inline, persists offline through the real queue and reminds about My without changing history', async () => {
  const db = createDatabase(), disk = new Map(); let online = true;
  const handler = createHandler({ getWXContext: () => ({ APPID: 'wxe25930a2cdce35d0', OPENID: 'onboarding-owner' }), transport: createDocumentTransport(db, 'wxe25930a2cdce35d0'), now: () => Date.parse('2020-10-05T08:00:00Z') });
  const options = { environment: 'onboarding-env', now: () => new Date('2020-10-05T08:00:00Z'), storage: { get: k => disk.get(k), set: (k, value) => disk.set(k, copy(value)) }, call: (action, payload) => online ? handler({ action, ...payload }) : Promise.reject(new Error('offline')) };
  const store = createStore(options); await store.init(); const ui = pageFixture(store, disk); const unsubscribe = store.subscribe(state => ui.page.render(state)); ui.page.onShow();
  for (const weight of ['', '0', '-1', '501', 'not-a-number']) {
    ui.page.onboardingInput({ detail: { value: weight } }); await ui.page.saveOnboardingWeight();
    assert.match(ui.page.data.onboardingError, /有效体重/); assert.equal(ui.page.data.onboardingOpen, true);
  }
  assert.equal(store.getState().sync.pendingCount, 0); online = false;
  ui.page.onboardingInput({ detail: { value: '68.5' } }); await ui.page.saveOnboardingWeight(); await store.retrySync();
  assert.equal(store.getState().profile.bodyWeight, 68.5); assert.equal(store.getState().sync.pendingCount, 1);
  assert.equal(ui.page.data.onboardingOpen, false); assert.match(ui.toasts[0].title, /我的/);
  const restart = createStore(options); await restart.init(); assert.equal(restart.getState().profile.bodyWeight, 68.5);
  const next = pageFixture(restart, disk); next.page.onShow(); assert.equal(next.page.data.onboardingOpen, false);
  online = true; await restart.retrySync(); assert.equal(restart.getState().sync.pendingCount, 0);
  assert.equal(db.rows().find(row => row.kind === 'profile').body.bodyWeight, 68.5);
  assert.equal(db.rows().some(row => row.kind === 'record'), false); unsubscribe();
});

test('stale profile and account switches cannot apply onboarding weight to a different account', async () => {
  const f = stateFixture(); f.state.identityReady = true; f.state.loading = false;
  let resolveSave, revision;
  f.store.saveProfile = async (body, expectedRevision) => { revision = expectedRevision; throw Object.assign(new Error('stale'), { code: 'STALE_DRAFT' }); };
  const ui = pageFixture(f.store); ui.page.onShow(); ui.page.onboardingInput({ detail: { value: '70' } });
  await ui.page.saveOnboardingWeight(); assert.equal(revision, 0); assert.match(ui.page.data.onboardingError, /我的/);
  assert.equal(ui.disk.size, 0);
  f.store.saveProfile = () => new Promise(resolve => { resolveSave = resolve; });
  const pending = ui.page.saveOnboardingWeight(); f.owner('b'); ui.page.render(f.state); resolveSave(); await pending;
  assert.equal(ui.toasts.length, 0); assert.equal(ui.disk.size, 0); assert.equal(ui.page.data.onboardingOpen, true);
});
