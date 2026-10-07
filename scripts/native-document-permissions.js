function nativeDocumentPermissions() {
  const app = getApp(), state = { pending: true, environment: app.globalData.env, checks: [] };
  app._documentPermissions = state;
  const database = wx.cloud.database({ env: app.globalData.env });
  const denied = error => error.errCode === -502003 || /permission denied|没有权限|无权限/i.test(error.errMsg || '');
  (async () => {
    for (const name of ['fitcheckin_entities', 'fitcheckin_operations']) {
      try {
        await database.collection(name).limit(1).get();
        state.checks.push({ collection: name, readDenied: false });
      } catch (error) { state.checks.push({ collection: name, readDenied: denied(error), errorCode: error.errCode }); }
      const reference = database.collection(name).doc('permission-probe-' + Date.now());
      try {
        await reference.set({ data: { marker: 'permission-acceptance' } });
        state.checks.push({ collection: name, writeDenied: false });
        await reference.remove();
      } catch (error) { state.checks.push({ collection: name, writeDenied: denied(error), errorCode: error.errCode }); }
    }
    state.pending = false;
  })().catch(error => { state.error = error.errCode || 'permissions-test-failed'; state.pending = false; });
  return { started: true, environment: app.globalData.env };
}
