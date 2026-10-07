function nativeTrainingUI() {
  const app = getApp(), page = getCurrentPages().slice(-1)[0];
  if (page.route !== 'pages/today/index') throw new Error('Open Today before acceptance');
  const state = { pending: true, stage: 'starting', checks: [] };
  app._trainingUIProbe = state;
  const originalCall = wx.cloud.callFunction, originalVibrate = wx.vibrateShort;
  const owner = 'training-ui-' + Date.now(), account = 'fitcheckin:' + app.globalData.env + ':' + owner;
  const date = page.data.date, entities = new Map(); let vibrates = 0;
  const bench = { id: 'bench', entryId: 'bench-entry', name: '杠铃卧推', type: 'weighted', sets: 3, reps: 10, weight: 40, coefficient: 1, restSeconds: 90, durationMinutes: 0, distanceKm: 0, intensity: '', muscles: [{ id: 'chest', percent: 100 }] };
  entities.set('profile:profile', { kind: 'profile', id: 'profile', revision: 1, deleted: false, body: { id: 'profile', bodyWeight: 70, activeTemplateId: 'training-probe' } });
  entities.set('template:training-probe', { kind: 'template', id: 'training-probe', revision: 1, deleted: false, body: { id: 'training-probe', name: '逐组训练验收', days: Array.from({ length: 7 }, () => [bench]) } });
  const copy = value => JSON.parse(JSON.stringify(value));
  const waitFor = async condition => { const until = Date.now() + 8000; while (!condition()) { if (Date.now() > until) throw new Error('Native acceptance wait timeout'); await new Promise(resolve => setTimeout(resolve, 50)); } };
  const ensure = (condition, name) => { if (!condition) throw new Error(name); state.checks.push(name); };
  const checkpoint = stage => new Promise((resolve, reject) => { state.stage = stage; const timer = setTimeout(() => reject(new Error('Screenshot checkpoint timeout')), 180000); app._trainingUIAdvance = () => { clearTimeout(timer); resolve(); }; });
  const event = index => ({ currentTarget: { dataset: { id: bench.entryId, index } } });
  wx.cloud.callFunction = options => {
    if (options.name !== 'fitcheckin' || options.data.action === 'posterCode') return originalCall.call(wx.cloud, options);
    const data = options.data;
    if (data.action === 'bootstrap' || data.action === 'pull') return Promise.resolve({ result: { code: 0, data: { openid: owner, entities: copy([...entities.values()]), scheduleHistorySupported: true, setProgressSupported: true } } });
    const op = data.operation, key = op.kind + ':' + op.id, current = entities.get(key);
    if ((current ? current.revision : 0) !== op.baseRevision) return Promise.resolve({ result: { code: 'CONFLICT', data: { entity: copy(current) } } });
    const entity = { kind: op.kind, id: op.id, revision: op.baseRevision + 1, body: copy(op.body), deleted: op.deleted };
    entities.set(key, entity); return Promise.resolve({ result: { code: 0, data: { entity: copy(entity) } } });
  };
  wx.vibrateShort = options => { vibrates++; if (originalVibrate) originalVibrate.call(wx, options); };
  (async () => {
    try {
      page.onPullDownRefresh(); await waitFor(() => page.data.items.some(e => e.entryId === bench.entryId));
      await page.startExercise(event());
      ensure(page.data.items[0].groups.length === 3 && page.data.totals.volume === '0', 'start-expands-without-credit');
      await checkpoint('sets');
      await page.completeSet(event(0));
      ensure(page.data.restOpen && page.data.totals.volume === '400' && !page.data.allDone, 'first-set-rest-and-volume');
      await waitFor(() => page.data.pending === 0);
      await checkpoint('rest');
      page.onHide(); page._training.rest.endAt = Date.now() - 35000; page.onShow();
      ensure(page.data.rest.remaining === 0 && page.data.rest.overtime >= 35 && vibrates === 1, 'background-overtime-vibration');
      page.onHide(); page.onShow(); ensure(vibrates === 1, 'expiry-not-repeated');
      await checkpoint('returned');
      page.continueTraining(); await page.completeSet(event(1));
      ensure(page.data.totals.volume === '800' && page.data.restOpen, 'second-set-volume');
      page._training.rest.endAt = Date.now() - 1; page.updateRest(); page.continueTraining();
      await page.completeSet(event(2));
      ensure(page.data.allDone && page.data.celebrationOpen && !page.data.restOpen && page.data.totals.volume === '1200', 'last-set-celebration');
      await waitFor(() => page.data.pending === 0);
      ensure(entities.get('record:' + date).body.completedSets['bench-entry'] === 3, 'three-sets-persisted-to-test-transport');
      await checkpoint('complete');
    } catch (error) { state.error = error.message; }
    finally {
      page.closeOverlays(); page.finishRest();
      wx.cloud.callFunction = originalCall; wx.vibrateShort = originalVibrate;
      page.onPullDownRefresh();
      try { await waitFor(() => page.data.identityReady && !page.data.items.some(e => e.entryId === bench.entryId) && page.data.pending === 0); state.restored = true; }
      catch (error) { state.cleanupError = error.message; }
      wx.removeStorageSync(account); wx.removeStorageSync('ironplan:training:' + account); wx.removeStorageSync('ironplan:celebrated:' + account);
      delete app._trainingUIAdvance; state.pending = false; state.stage = 'finished';
    }
  })();
  return { started: true, testTransport: true };
}
