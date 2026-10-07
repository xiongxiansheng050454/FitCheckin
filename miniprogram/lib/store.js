const d = require('./domain');
const { schedule } = require('./achievement');
const clone = value => JSON.parse(JSON.stringify(value));
const keyOf = value => value.kind + ':' + value.id;
const defaultProfile = () => ({ id: 'profile', bodyWeight: null, activeTemplateId: null });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
  return value;
}

function createStore(options) {
  const storage = options.storage;
  const call = options.call;
  const now = options.now || (() => new Date());
  const namespace = 'fitcheckin:' + (options.environment ? options.environment + ':' : '');
  let owner = storage.get(namespace + 'last-owner') || null;
  const accountKey = () => owner ? namespace + owner : null;
  let entities = {};
  let queue = [];
  let conflicts = [];
  let identityReady = false;
  let scheduleHistorySupported = false;
  let setProgressSupported = false;
  let cyclesSupported = false;
  let cycleTemplatesSupported = false;
  let todayPlanUpdateSupported = false;
  let supersetsSupported = false;
  let loading = false;
  let lastError = '';
  let flushing = null;
  let initializing = null;
  const listeners = new Set();

  function restore(account) {
    const cached = storage.get(namespace + account);
    entities = cached && cached.entities ? clone(cached.entities) : {};
    queue = cached && cached.queue ? clone(cached.queue) : [];
    conflicts = cached && cached.conflicts ? clone(cached.conflicts) : [];
    scheduleHistorySupported = !!(cached && cached.scheduleHistorySupported);
    setProgressSupported = !!(cached && cached.setProgressSupported);
    cyclesSupported = !!(cached && cached.cyclesSupported);
    cycleTemplatesSupported = !!(cached && cached.cycleTemplatesSupported);
    todayPlanUpdateSupported = !!(cached && cached.todayPlanUpdateSupported);
    supersetsSupported = !!(cached && cached.supersetsSupported);
  }
  if (owner) restore(owner);
  function persist() {
    if (!owner) return;
    storage.set(accountKey(), { version: 1, entities: clone(entities), queue: clone(queue), conflicts: clone(conflicts), scheduleHistorySupported, setProgressSupported, cyclesSupported, cycleTemplatesSupported, todayPlanUpdateSupported, supersetsSupported });
    storage.set(namespace + 'last-owner', owner);
  }
  function getState() {
    const state = { profile: defaultProfile(), program: null, exercises: [], templates: [], cycleTemplates: [], overrides: [], records: [], revisions: {}, identityReady, loading, cyclesSupported, cycleTemplatesSupported, todayPlanUpdateSupported, sync: { status: conflicts.length ? 'conflict' : lastError ? 'error' : flushing ? 'syncing' : queue.length ? 'pending' : 'idle', pendingCount: queue.length, message: lastError, conflicts: clone(conflicts) } };
    const lists = { exercise: 'exercises', template: 'templates', cycleTemplate: 'cycleTemplates', override: 'overrides', record: 'records' };
    Object.keys(entities).forEach(key => {
      const entity = entities[key];
      state.revisions[key] = entity.revision;
      if (entity.deleted || !entity.body) return;
      if (entity.kind === 'profile') state.profile = clone(entity.body);
      else if (entity.kind === 'program') state.program = clone(entity.body);
      else if (lists[entity.kind]) state[lists[entity.kind]].push(clone(entity.body));
    });
    return state;
  }
  function notify() { const state = getState(); listeners.forEach(fn => { try { fn(state); } catch (err) { console.error('IronPlan view update failed:', err.message); } }); }
  function subscribe(fn) { listeners.add(fn); fn(getState()); return () => listeners.delete(fn); }
  function unwrap(response) {
    if (!response || response.code !== 0) throw d.error(response && response.message || '云端暂不可用，请稍后重试', response && response.code || 'NETWORK');
    return response.data;
  }
  function mergeRemote(data) {
    if (!data || typeof data.openid !== 'string' || !data.openid) throw d.error('微信身份确认失败', 'AUTH_REQUIRED');
    if (owner !== data.openid) { owner = data.openid; restore(owner); }
    scheduleHistorySupported = data.scheduleHistorySupported === true;
    setProgressSupported = data.setProgressSupported === true;
    cyclesSupported = data.cyclesSupported === true;
    cycleTemplatesSupported = data.cycleTemplatesSupported === true;
    todayPlanUpdateSupported = data.todayPlanUpdateSupported === true;
    supersetsSupported = data.supersetsSupported === true;
    identityReady = true;
    const pending = new Set(queue.map(keyOf));
    (data.entities || []).forEach(entity => {
      const key = keyOf(entity);
      if (!pending.has(key) && (!entities[key] || entity.revision >= entities[key].revision)) entities[key] = clone(entity);
    });
    persist();
  }
  async function init() {
    if (initializing) return initializing;
    loading = true; notify();
    initializing = retrySync().then(() => getState()).finally(() => { loading = false; notify(); });
    return initializing;
  }
  function assertIdentity() { if (!owner || !identityReady) throw d.error('请先联网确认微信身份', 'AUTH_REQUIRED'); }
  function captureSchedule(operation) {
    if (!scheduleHistorySupported || !['profile', 'template', 'override', 'record', 'program'].includes(operation.kind)) return;
    if (d.today(operation.occurredAt) !== d.today(now())) return;
    const state = getState(), profile = state.profile;
    const history = state.program && state.program.scheduleHistory || profile.scheduleHistory || [];
    if (!profile.activeTemplateId && !history.length && !state.program) return;
    const event = schedule(state, d.today(now()));
    const last = history[history.length - 1];
    if (last && last.mask === event.mask && JSON.stringify(last.weeks) === JSON.stringify(event.weeks)) return;
    const next = history.filter(e => e.from < event.from).concat(event);
    if (next.length > 4096) throw d.error('训练安排历史已达上限');
    if (state.program) {
      if (operation.kind === 'program') operation.body.scheduleHistory = next;
      else {
        const key = 'program:program', current = entities[key];
        const op = { operationId: d.newId('op'), kind: 'program', id: 'program', body: Object.assign({}, state.program, { scheduleHistory: next }), deleted: false, baseRevision: current.revision, occurredAt: operation.occurredAt };
        entities = Object.assign({}, entities, { [key]: { kind: 'program', id: 'program', body: op.body, deleted: false, revision: op.baseRevision + 1 } });
        queue = queue.concat(op);
      }
    } else if (operation.kind === 'profile') operation.body.scheduleHistory = next;
    else {
      const key = 'profile:profile', current = entities[key];
      const op = { operationId: d.newId('op'), kind: 'profile', id: 'profile', body: Object.assign({}, profile, { scheduleHistory: next }), deleted: false, baseRevision: current ? current.revision : 0, occurredAt: operation.occurredAt };
      entities = Object.assign({}, entities, { [key]: { kind: 'profile', id: 'profile', body: op.body, deleted: false, revision: op.baseRevision + 1 } });
      queue = queue.concat(op);
    }
  }
  function enqueue(kind, id, body, deleted, occurrence, expectedRevision, updatePlan) {
    if (!deleted && d.hasSuperset(body) && !supersetsSupported) throw d.error('请联网刷新后再保存超级组', 'SERVER_UPDATE_REQUIRED');
    assertIdentity();
    const key = kind + ':' + id;
    const current = entities[key];
    if (expectedRevision !== undefined && expectedRevision !== (current ? current.revision : 0)) throw d.error('内容已有新版本，请保留草稿并重新加载后再保存', 'STALE_DRAFT');
    const op = { operationId: d.newId('op'), kind, id, body: deleted ? null : clone(body), deleted: !!deleted, baseRevision: current ? current.revision : 0, occurredAt: occurrence || now().toISOString() };
    if (updatePlan) op.updatePlan = true;
    const previousEntities = entities;
    const previousQueue = queue;
    entities = Object.assign({}, entities, { [key]: { kind, id, body: op.body, deleted: op.deleted, revision: op.baseRevision + 1 } });
    queue = queue.concat(op);
    try { captureSchedule(op); persist(); } catch (err) {
      entities = previousEntities; queue = previousQueue;
      throw d.error('本机存储失败，请检查剩余空间后重试', 'STORAGE_FULL');
    }
    notify();
    if (!conflicts.length) Promise.resolve().then(() => retrySync()).catch(() => {});
    return clone(body);
  }
  async function drain() {
    mergeRemote(unwrap(await call(identityReady ? 'pull' : 'bootstrap', {})));
    if (conflicts.length) return;
    const actor = owner;
    while (queue.length && !conflicts.length) {
      const op = clone(queue[0]);
      const response = await call('mutate', { operation: op });
      if (actor !== owner) return;
      if (response && response.code === 'CONFLICT') {
        const local = entities[keyOf(op)];
        conflicts.push({ id: op.operationId, kind: op.kind, entityId: op.id, local: local ? clone(local) : null, cloud: response.data && response.data.entity || null });
        persist(); notify(); return;
      }
      const saved = unwrap(response).entity;
      if (!saved || saved.kind !== op.kind || saved.id !== op.id) throw d.error('云端返回的数据不完整', 'INVALID_RESPONSE');
      queue = queue.filter(item => item.operationId !== op.operationId);
      // Never replace an optimistic edit with the acknowledgement of an older operation.
      if (!queue.some(item => keyOf(item) === keyOf(op)) && (!entities[keyOf(op)] || saved.revision >= entities[keyOf(op)].revision)) entities[keyOf(op)] = clone(saved);
      persist(); notify();
    }
  }
  async function retrySync() {
    if (flushing) return flushing;
    lastError = '';
    flushing = Promise.resolve().then(drain).catch(err => {
      if (['AUTH_REQUIRED', 'FORBIDDEN', 'APPID_MISMATCH'].includes(err.code)) identityReady = false;
      else if (owner) identityReady = true;
      lastError = err.code === 'VALIDATION' || err.code === 'IMMUTABLE_RECORD' ? err.message : owner ? '同步失败，已保存在本机，点击重试' : '首次使用需要联网确认微信身份';
    }).finally(() => { flushing = null; notify(); });
    notify();
    return flushing;
  }
  async function refresh() { await retrySync(); return getState(); }
  function normalizeDays(days) {
    if (!Array.isArray(days) || days.length !== 7) throw d.error('周计划需要包含周一到周日');
    return days.map(items => {
      if (!Array.isArray(items) || items.length > 50) throw d.error('每天最多安排50个动作');
      const ids = new Set();
      return items.map(item => {
        const next = d.validateExercise(item);
        next.id = next.id || d.newId('exercise'); next.entryId = next.entryId || d.newId('entry');
        if (ids.has(next.entryId)) throw d.error('同一天的动作标识不能重复');
        ids.add(next.entryId); return next;
      });
    });
  }
  async function saveProfile(body, expectedRevision) {
    const next = Object.assign({}, getState().profile, body, { id: 'profile' });
    if (next.bodyWeight !== null && (typeof next.bodyWeight !== 'number' || !Number.isFinite(next.bodyWeight) || next.bodyWeight <= 0 || next.bodyWeight > 500)) throw d.error('请输入有效体重（0至500kg）');
    if (next.activeTemplateId && !getState().templates.some(item => item.id === next.activeTemplateId)) throw d.error('计划不存在');
    return enqueue('profile', 'profile', next, false, undefined, expectedRevision);
  }
  async function saveExercise(body, expectedRevision) { const item = d.validateExercise(body); item.id = item.id || d.newId('exercise'); delete item.entryId; return enqueue('exercise', item.id, item, false, undefined, expectedRevision); }
  async function deleteExercise(id) { return enqueue('exercise', id, null, true); }
  async function saveTemplate(body, expectedRevision) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) throw d.error('计划名称需要1至60个字');
    const template = { id: body.id || d.newId('plan'), name, days: normalizeDays(body.days) };
    return enqueue('template', template.id, template, false, undefined, expectedRevision);
  }
  async function deleteTemplate(id) {
    if (getState().cycleTemplates.some(t => t.weeks.includes(id))) throw d.error('此周模板被周期模板引用，请先替换引用');
    if (getState().profile.activeTemplateId === id) await saveProfile({ activeTemplateId: null });
    return enqueue('template', id, null, true);
  }
  async function activateTemplate(id) { return saveProfile({ activeTemplateId: id }); }
  async function saveCycleTemplate(body, expectedRevision) {
    assertIdentity();
    if (!cycleTemplatesSupported) throw d.error('云端周期模板需要更新，请联网刷新后重试', 'SERVER_UPDATE_REQUIRED');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) throw d.error('周期模板名称需要1至60个字');
    if (!Array.isArray(body.weeks) || !body.weeks.length || body.weeks.length > 52) throw d.error('周期模板需要1至52周');
    const state = getState();
    if (body.weeks.some(id => !state.templates.some(t => t.id === id))) throw d.error('周模板已删除，请替换对应周的模板后保存');
    const next = { id: body.id || d.newId('cycle-template'), name, weeks: clone(body.weeks) };
    return enqueue('cycleTemplate', next.id, next, false, undefined, expectedRevision);
  }
  async function deleteCycleTemplate(id, expectedRevision) { return enqueue('cycleTemplate', id, null, true, undefined, expectedRevision); }
  async function saveCycle(cycle, expectedRevision) {
    assertIdentity();
    if (!cyclesSupported) throw d.error('云端周期安排需要更新，请联网刷新后重试', 'SERVER_UPDATE_REQUIRED');
    const state = getState(), date = d.today(now()), currentWeek = d.weekStart(date);
    const program = state.program ? clone(state.program) : { id: 'program', from: cycle.startWeek > date ? cycle.startWeek : date, cycles: [] };
    const old = program.cycles.find(c => c.id === cycle.id);
    if (!old && cycle.startWeek < currentWeek) throw d.error('新周期只能从本周或未来开始');
    if (d.weekStart(cycle.startWeek) !== cycle.startWeek) throw d.error('周期需从周一开始');
    if (cycle.startWeek > d.shiftDate(currentWeek, 728)) throw d.error('请在未来两年内安排周期');
    if (!cycle.name || !cycle.name.trim() || cycle.name.trim().length > 60) throw d.error('周期名称需要1至60个字');
    if (!Array.isArray(cycle.weeks) || !cycle.weeks.length || cycle.weeks.length > 52) throw d.error('每个周期需要安排1至52周');
    const used = new Set(cycle.weeks);
    const plans = cycle.plans.filter(p => used.has(p.id)).map(p => ({ id: p.id, templateId: p.templateId, name: p.name, days: normalizeDays(p.days) }));
    if (new Set(plans.map(p => p.id)).size !== plans.length || cycle.weeks.some(id => !plans.some(p => p.id === id))) throw d.error('请为每一周选择模板');
    const next = { id: cycle.id || d.newId('cycle'), name: cycle.name.trim(), startWeek: cycle.startWeek, plans, weeks: clone(cycle.weeks) };
    if (old) {
      if (old.startWeek <= currentWeek && next.startWeek !== old.startWeek) throw d.error('已开始的周期不能移动起始周');
      old.weeks.forEach((id, i) => {
        if (d.shiftDate(old.startWeek, i * 7) >= currentWeek) return;
        const before = old.plans.find(p => p.id === id), after = next.plans.find(p => p.id === next.weeks[i]);
        if (!after || JSON.stringify(canonical(before)) !== JSON.stringify(canonical(after))) throw d.error('过去的周安排不能修改');
      });
    }
    program.cycles = program.cycles.filter(c => c.id !== next.id).concat(next).sort((a, b) => a.startWeek.localeCompare(b.startWeek));
    program.cycles.forEach((c, i) => { if (i && c.startWeek <= d.cycleEnd(program.cycles[i - 1])) throw d.error('周期日期与已有安排重叠，请调整起始周'); });
    if (program.cycles.reduce((n, c) => n + c.weeks.length, 0) > 520 || program.cycles.length > 100 || JSON.stringify(program).length > 150000) throw d.error('周期安排内容过多，请减少周数或动作');
    if (next.startWeek < program.from && program.from > date) program.from = next.startWeek > date ? next.startWeek : date;
    if (schedule(Object.assign({}, state, { program }), date).weeks.length > 520) throw d.error('待执行的周安排过多');
    return enqueue('program', 'program', program, false, undefined, expectedRevision);
  }
  async function deleteCycle(id, expectedRevision) {
    const state = getState(), program = clone(state.program), cycle = program && program.cycles.find(c => c.id === id);
    if (!cycle) throw d.error('周期不存在');
    if (cycle.startWeek <= d.weekStart(d.today(now()))) throw d.error('已开始的周期会保留，只能取消未来周期');
    program.cycles = program.cycles.filter(c => c.id !== id);
    return enqueue('program', 'program', program, false, undefined, expectedRevision);
  }
  async function saveOverride(body, expectedRevision) {
    if (d.weekStart(body.id) !== body.id) throw d.error('单周调整需要以周一为起始日期');
    if (body.id < d.weekStart(d.today(now()))) throw d.error('不能修改过去周的计划');
    const state = getState(), selected = d.scheduledWeek(state, body.id);
    if (state.program && body.id >= d.weekStart(state.program.from)) {
      if (!selected || selected.cycle.id !== body.cycleId || selected.plan.id !== body.planId) throw d.error('这一周的安排已变化，请重新打开编辑');
    } else if (!state.templates.some(item => item.id === body.templateId)) throw d.error('请选择对应的周模板');
    const next = { id: body.id, templateId: body.templateId, days: normalizeDays(body.days) };
    if (body.cycleId) next.cycleId = body.cycleId;
    if (body.planId) next.planId = body.planId;
    return enqueue('override', next.id, next, false, undefined, expectedRevision);
  }
  async function deleteOverride(id) { if (id < d.weekStart(d.today(now()))) throw d.error('历史周不能修改'); return enqueue('override', id, null, true); }
  function todayRecord(entryId) {
    assertIdentity();
    const date = d.today(now()); const state = getState();
    let record = state.records.find(item => item.date === date);
    if (!record) {
      const day = d.resolveDay(state, date);
      if (!day.items.some(item => item.entryId === entryId)) throw d.error('动作不存在，请刷新今日计划');
      if (day.items.some(d.usesBodyWeight) && !state.profile.bodyWeight) throw d.error('请先在“我的”填写体重', 'BODY_WEIGHT_REQUIRED');
      record = { id: date, date, templateId: day.templateId, bodyWeight: state.profile.bodyWeight, items: day.items, completed: [], startedAt: now().toISOString() };
    }
    if (!record.items.some(item => item.entryId === entryId)) throw d.error('当天快照中没有这个动作');
    return record;
  }
  async function startToday(entryId) {
    assertIdentity();
    if (!setProgressSupported) throw d.error('云端训练记录需要更新，请联网刷新后重试', 'SERVER_UPDATE_REQUIRED');
    const record = todayRecord(entryId);
    if (!getState().records.some(r => r.date === record.date)) {
      record.completedSets = {};
      return enqueue('record', record.date, record, false);
    }
    return record;
  }
  async function changeTodaySet(entryId, index, done) {
    assertIdentity();
    if (!setProgressSupported) throw d.error('云端训练记录需要更新，请联网刷新后重试', 'SERVER_UPDATE_REQUIRED');
    const record = todayRecord(entryId), item = record.items.find(e => e.entryId === entryId);
    const count = d.completedSets(record, item);
    if (!Number.isInteger(index) || index < 0 || index >= item.sets || index !== (done ? count : count - 1)) throw d.error(done ? '请按顺序完成下一组，已完成的组不会重复记录' : '只能撤销最后完成的一组');
    if (!record.completedSets) record.completedSets = Object.fromEntries(record.items.map(e => [e.entryId, d.completedSets(record, e)]));
    record.completedSets[entryId] = count + (done ? 1 : -1);
    record.completed = record.items.filter(e => record.completedSets[e.entryId] === e.sets).map(e => e.entryId);
    return enqueue('record', record.date, record, false);
  }
  async function toggleToday(entryId) {
    const record = todayRecord(entryId);
    const completed = new Set(record.completed);
    if (completed.has(entryId)) completed.delete(entryId); else completed.add(entryId);
    record.completed = Array.from(completed);
    if (record.completedSets) record.completedSets[entryId] = completed.has(entryId) ? record.items.find(e => e.entryId === entryId).sets : 0;
    return enqueue('record', record.date, record, false);
  }
  async function updateTodayPlan(expectedRevision) {
    assertIdentity();
    if (!todayPlanUpdateSupported) throw d.error('请联网下拉刷新后再更新今日清单', 'SERVER_UPDATE_REQUIRED');
    const result = d.todayPlanUpdate(getState(), d.today(now()));
    if (!result) throw d.error('今日尚未开始训练，无需更新清单');
    if (!result.changed) return result.record;
    const record = result.record;
    if (record.items.length > 50) throw d.error('保留已完成动作后超出50个，请减少新安排的动作');
    if (record.items.some(d.usesBodyWeight) && !record.bodyWeight) throw d.error('请先在“我的”填写体重', 'BODY_WEIGHT_REQUIRED');
    record.items.forEach(item => d.validateExercise(item));
    return enqueue('record', record.date, record, false, undefined, expectedRevision, true);
  }
  async function resolveConflict(id, choice) {
    const conflict = conflicts.find(item => item.id === id);
    if (!conflict) throw d.error('冲突已处理，请刷新');
    if (!['cloud', 'local'].includes(choice)) throw d.error('请选择保留哪份数据');
    const key = conflict.kind + ':' + conflict.entityId;
    const latest = clone(entities[key]); const affected = queue.filter(item => keyOf(item) === key);
    if (choice === 'local' && conflict.kind === 'record' && conflict.cloud && !conflict.cloud.deleted) {
      const localSnapshot = d.recordSnapshot(latest.body);
      const cloudSnapshot = d.recordSnapshot(conflict.cloud.body);
      if (JSON.stringify(canonical(localSnapshot)) !== JSON.stringify(canonical(cloudSnapshot))) throw d.error('两台设备的训练快照不同，请采用云端记录', 'SNAPSHOT_CONFLICT');
    }
    if (choice === 'local' && conflict.kind === 'program' && conflict.cloud) {
      const before = conflict.cloud.body, after = latest.body, date = d.today(now()), week = d.weekStart(date);
      if (after.from !== before.from && !(after.from < before.from && after.from >= date)) throw d.error('两台设备的历史安排不同，请采用云端周期', 'SCHEDULE_CONFLICT');
      before.cycles.forEach(old => {
        if (old.startWeek > week) return;
        const next = after.cycles.find(c => c.id === old.id);
        if (!next || next.startWeek !== old.startWeek) throw d.error('已开始的云端周期需要保留，请采用云端周期', 'SCHEDULE_CONFLICT');
        old.weeks.forEach((id, i) => {
          if (d.shiftDate(old.startWeek, i * 7) >= week) return;
          const a = old.plans.find(p => p.id === id), b = next.plans.find(p => p.id === next.weeks[i]);
          if (!b || JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) throw d.error('两台设备的历史周不同，请采用云端周期', 'SCHEDULE_CONFLICT');
        });
      });
    }
    const saved = { entities: clone(entities), queue: clone(queue), conflicts: clone(conflicts) };
    queue = queue.filter(item => keyOf(item) !== key); conflicts = conflicts.filter(item => item.id !== id);
    if (conflict.cloud) entities[key] = clone(conflict.cloud); else delete entities[key];
    try {
      if (choice === 'local') { const last = affected[affected.length - 1]; enqueue(conflict.kind, conflict.entityId, latest.body, latest.deleted, conflict.kind === 'record' && last ? last.occurredAt : undefined); }
      else persist();
    } catch (err) { entities = saved.entities; queue = saved.queue; conflicts = saved.conflicts; throw err; }
    lastError = ''; notify(); await retrySync();
  }
  return { accountKey, init, getState, subscribe, refresh, retrySync, saveProfile, saveExercise, deleteExercise, saveTemplate, deleteTemplate, activateTemplate, saveCycleTemplate, deleteCycleTemplate, saveCycle, deleteCycle, saveOverride, deleteOverride, startToday, completeTodaySet: (id, index) => changeTodaySet(id, index, true), undoTodaySet: (id, index) => changeTodaySet(id, index, false), toggleToday, updateTodayPlan, resolveConflict };
}
const native = createStore({
  environment: require('./environment').id,
  storage: { get: key => typeof wx === 'undefined' ? null : wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
  call: async (action, payload) => {
    if (typeof wx === 'undefined' || !wx.cloud) throw new Error('Cloud unavailable');
    const response = await wx.cloud.callFunction({ name: 'fitcheckin', data: Object.assign({ action }, payload) });
    return response.result;
  }
});
module.exports = native;
module.exports.createStore = createStore;
