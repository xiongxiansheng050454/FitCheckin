function nativeCycleTemplateUI() {
  const app = getApp(), probe = { pending: true, stage: 'starting', checks: [] };
  app._cycleTemplateUIProbe = probe;
  const originalCall = wx.cloud.callFunction;
  const owner = 'ct-ui-' + Date.now(), account = 'fitcheckin:' + app.globalData.env + ':' + owner;
  const entities = new Map(), copy = value => JSON.parse(JSON.stringify(value));
  const page = () => getCurrentPages().slice(-1)[0];
  const waitFor = async condition => { const end = Date.now() + 10000; while (!condition()) { if (Date.now() > end) throw new Error('Native template acceptance timeout'); await new Promise(resolve => setTimeout(resolve, 60)); } };
  const ensure = (condition, name) => { if (!condition) throw new Error(name); probe.checks.push(name); };
  const event = id => ({ currentTarget: { dataset: { id } } });
  const checkpoint = stage => new Promise((resolve, reject) => { probe.stage = stage; const timer = setTimeout(() => reject(new Error('Screenshot checkpoint timeout')), 120000); app._cycleTemplateUIAdvance = () => { clearTimeout(timer); resolve(); }; });
  (async () => {
    try {
      if (page().route !== 'pages/today/index') await new Promise((resolve, reject) => wx.switchTab({ url: '/pages/today/index', success: resolve, fail: reject }));
      await waitFor(() => page().data.identityReady && page().data.pending === 0);
      const date = page().data.date, ms = Date.parse(date + 'T00:00:00Z'), day = (new Date(ms).getUTCDay() + 6) % 7;
      const week = new Date(ms - day * 86400000).toISOString().slice(0, 10);
      const exercise = weight => ({ id: 'bench', entryId: 'ct-entry', name: '杠铃卧推', type: 'weighted', sets: 3, reps: 10, weight, coefficient: 1, restSeconds: 90, durationMinutes: 0, distanceKm: 0, intensity: '', muscles: [{ id: 'chest', percent: 100 }] });
      const days = weight => [[exercise(weight)], [], [exercise(weight)], [], [], [], []];
      const put = (kind, body) => entities.set(kind + ':' + body.id, { kind, id: body.id, body, revision: 1, deleted: false });
      put('profile', { id: 'profile', bodyWeight: 70, activeTemplateId: null });
      put('template', { id: 'ct-ui-light', name: '轻度 · 基础训练', days: days(20) });
      put('template', { id: 'ct-ui-medium', name: '中度 · 渐进负荷', days: days(40) });
      put('program', { id: 'program', from: date, cycles: [{ id: 'ct-ui-first', name: '正在执行的4周周期', startWeek: week, plans: [{ id: 'ct-snapshot', templateId: 'ct-ui-light', name: '轻度 · 基础训练', days: days(20) }], weeks: Array(4).fill('ct-snapshot') }] });
      wx.cloud.callFunction = options => {
        if (options.name !== 'fitcheckin' || options.data.action === 'posterCode') return originalCall.call(wx.cloud, options);
        const data = options.data;
        if (data.action === 'bootstrap' || data.action === 'pull') return Promise.resolve({ result: { code: 0, data: { openid: owner, entities: copy([...entities.values()]), scheduleHistorySupported: true, setProgressSupported: true, cyclesSupported: true, cycleTemplatesSupported: true } } });
        const op = data.operation, key = op.kind + ':' + op.id, current = entities.get(key);
        if ((current ? current.revision : 0) !== op.baseRevision) return Promise.resolve({ result: { code: 'CONFLICT', data: { entity: copy(current) } } });
        const entity = { kind: op.kind, id: op.id, body: copy(op.body), deleted: op.deleted, revision: op.baseRevision + 1 };
        entities.set(key, entity); return Promise.resolve({ result: { code: 0, data: { entity: copy(entity) } } });
      };
      await page().onPullDownRefresh();
      await new Promise((resolve, reject) => wx.switchTab({ url: '/pages/plans/index', success: resolve, fail: reject }));
      await waitFor(() => page().data.templates.some(t => t.id === 'ct-ui-light'));
      page().setData({ view: 'templates' }); await new Promise(resolve => setTimeout(resolve, 200));
      const buttons = await new Promise(resolve => wx.createSelectorQuery().in(page()).selectAll('.template-title .small-button').boundingClientRect(resolve).exec());
      probe.buttonHeights = buttons.map(b => b.height);
      ensure(buttons.length === 2 && Math.abs(buttons[0].height - buttons[1].height) <= 1, 'library-and-new-have-equal-height');
      await checkpoint('weekly');
      page().createCycleTemplate(); await waitFor(() => page().route === 'packages/manage/cycle-edit/index' && page()._loaded);
      const edit = page(); edit.nameInput({ detail: { value: '8周渐进训练' } }); edit.repeatInput({ detail: { value: 4 } }); edit.addWeeks(); edit.chooseTemplate({ detail: { value: 1 } }); edit.addWeeks();
      ensure(edit.data.isTemplate && edit.data.weekCount === 8 && edit.data.rows.every(r => !r.locked && !r.current), 'undated-template-has-eight-editable-weeks');
      await edit.save(); await waitFor(() => page().route === 'pages/plans/index' && page().data.cycleTemplates.length === 1 && page().data.syncLabel === '已同步');
      const saved = page().data.cycleTemplates[0]; ensure(saved.weekCount === 8 && !saved.missing, 'template-save-and-reference-validation');
      page().setData({ view: 'cycleTemplates' }); await checkpoint('templates');
      page().arrangeCycleTemplate(event(saved.id)); await waitFor(() => page().route === 'packages/manage/cycle-edit/index' && page()._loaded);
      const arrangement = page(), expected = new Date(Date.parse(week + 'T00:00:00Z') + 28 * 86400000).toISOString().slice(0, 10);
      ensure(arrangement.data.weekCount === 8 && arrangement.data.startWeek === expected && !arrangement.data.isTemplate, 'full-template-follows-existing-four-week-cycle');
      await checkpoint('arrange');
      await arrangement.save(); await waitFor(() => page().route === 'pages/plans/index' && page().data.cycles.length === 2 && page().data.syncLabel === '已同步');
      const program = entities.get('program:program').body;
      ensure(program.cycles[1].weeks.length === 8 && program.cycles[1].plans.length === 2, 'native-store-persists-full-eight-week-cycle');
      probe.programCounts = program.cycles.map(c => c.weeks.length);
    } catch (error) { probe.error = error.message; }
    finally {
      wx.cloud.callFunction = originalCall;
      if (page().route !== 'pages/plans/index') await new Promise(resolve => wx.switchTab({ url: '/pages/plans/index', success: resolve, fail: resolve }));
      page().setData({ view: 'cycles' });
      try { await page().onPullDownRefresh(); await waitFor(() => page().data.identityReady && !page().data.templates.some(t => t.id === 'ct-ui-light') && page().data.syncLabel === '已同步'); probe.restored = true; }
      catch (error) { probe.cleanupError = error.message; }
      if (probe.restored) wx.removeStorageSync(account);
      delete app._cycleTemplateUIAdvance; probe.pending = false; probe.stage = 'finished';
    }
  })();
  return { started: true, isolatedTransport: true };
}
