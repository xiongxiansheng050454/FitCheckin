function nativeDocumentAcceptance() {
  const app = getApp();
  const state = { pending: true, environment: app.globalData.env, checks: [] };
  app._documentAcceptance = state;
  const prefix = 'accept-' + Date.now();
  const call = async (action, data) => (await wx.cloud.callFunction({ name: 'fitcheckin', data: Object.assign({ action }, data) })).result;
  const ensure = (condition, name) => { if (!condition) throw new Error(name); state.checks.push(name); };
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out; }, {}) : value;
  const operation = (suffix, kind, id, body, baseRevision, deleted) => ({ operationId: prefix + '-' + suffix, kind, id, body, baseRevision, deleted: !!deleted, occurredAt: new Date().toISOString() });
  (async () => {
    let original, exercise, profileChanged = false, exerciseSaved = false, profileRevision;
    try {
      const initial = await call('bootstrap');
      ensure(initial.code === 0, 'bootstrap');
      original = initial.data.entities.find(e => e.kind === 'profile' && e.id === 'profile');
      const savedProfile = original ? original.body : { id: 'profile', bodyWeight: null, activeTemplateId: null };
      profileRevision = original ? original.revision : 0;
      const changed = await call('mutate', { operation: operation('profile', 'profile', 'profile', Object.assign({}, savedProfile, { bodyWeight: 70 }), profileRevision) });
      ensure(changed.code === 0, 'profile-write'); profileChanged = true; profileRevision = changed.data.entity.revision;
      const id = prefix + '-exercise';
      exercise = { id, name: 'Temporary acceptance fixture', type: 'weighted', sets: 3, reps: 10, weight: 40, restSeconds: 60, muscles: [{ id: 'chest', percent: 100 }] };
      const firstOp = operation('exercise', 'exercise', id, exercise, 0);
      const first = await call('mutate', { operation: firstOp });
      ensure(first.code === 0 && first.data.entity.revision === 1, 'exercise-write'); exerciseSaved = true;
      const duplicate = await call('mutate', { operation: firstOp });
      ensure(duplicate.code === 0 && duplicate.data.entity.revision === 1, 'duplicate-receipt');
      const reused = await call('mutate', { operation: Object.assign({}, firstOp, { body: Object.assign({}, exercise, { weight: 50 }) }) });
      ensure(reused.code === 'OPERATION_REUSED', 'payload-reuse-denied');
      const conflict = await call('mutate', { operation: operation('stale', 'exercise', id, exercise, 0) });
      ensure(conflict.code === 'CONFLICT' && conflict.data.entity.revision === 1, 'stale-revision-conflict');
      const pulled = await call('pull');
      ensure(pulled.code === 0 && pulled.data.entities.some(e => e.kind === 'exercise' && e.id === id && e.body.weight === 40), 'cloud-readback');
      const spoof = await call('pull', { owner: 'another-owner', APPID: 'another-app' });
      ensure(spoof.code === 0 && spoof.data.openid === initial.data.openid, 'caller-cannot-override-identity');
    } catch (error) { state.error = error.message || 'acceptance-failed'; }
    finally {
      try {
        if (exerciseSaved) {
          const removed = await call('mutate', { operation: operation('remove', 'exercise', exercise.id, null, 1, true) });
          ensure(removed.code === 0 && removed.data.entity.deleted, 'fixture-tombstoned');
        }
        if (profileChanged) {
          const restored = await call('mutate', { operation: operation('restore', 'profile', 'profile', original ? original.body : { id: 'profile', bodyWeight: null, activeTemplateId: null }, profileRevision) });
          ensure(restored.code === 0, 'profile-restored');
        }
        const final = await call('pull');
        ensure(final.code === 0, 'final-readback');
        state.records = final.data.entities.filter(e => e.kind === 'record' && !e.deleted).length;
        const finalProfile = final.data.entities.find(e => e.kind === 'profile');
        state.profileRestored = JSON.stringify(canonical(finalProfile && finalProfile.body)) === JSON.stringify(canonical(original ? original.body : { id: 'profile', bodyWeight: null, activeTemplateId: null }));
        state.activeFixtures = final.data.entities.filter(e => e.id.indexOf(prefix) === 0 && !e.deleted).length;
      } catch (error) { state.cleanupError = error.message || 'cleanup-failed'; }
      state.pending = false;
    }
  })();
  return { started: true, environment: app.globalData.env };
}
