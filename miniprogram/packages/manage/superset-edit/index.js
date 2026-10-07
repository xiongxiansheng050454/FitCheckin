const ui = require('../../../pages/ui');
Page({
  data: { form: {}, components: [], entryMode: false, identityReady: false, saving: false, error: '', dirty: false },
  onLoad(query) {
    this._query = query;
    if (query.entry === '1') {
      this.setData({ entryMode: true });
      this.getOpenerEventChannel().on('exerciseDraft', draft => { this._form = ui.clone(draft); this._account = ui.store.accountKey(); this.updateForm(); });
    }
    ui.bind(this, this.render);
  },
  onShow() { this._visible = true; if (this.data.dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '超级组还有未保存的修改' }); },
  onHide() { this._visible = false; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); },
  onUnload() { this._closed = true; ui.unbind(this); if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); },
  render(state) {
    const accountChanged = this._account && this._account !== ui.store.accountKey();
    this.setData({ identityReady: state.identityReady && !accountChanged });
    if (accountChanged) { this.setData({ error: '账号已变化，请返回后重新编辑' }); return; }
    if (this._form || this.data.entryMode || !state.identityReady) return;
    const custom = state.exercises.find(item => item.id === this._query.id);
    const source = custom || ui.domain.PRESETS.find(item => item.id === this._query.id);
    if (this._query.id && (!source || source.type !== 'superset')) { this.setData({ error: '超级组不存在或已被删除' }); return; }
    this._form = ui.clone(source || { id: ui.domain.newId('exercise'), name: '新超级组', type: 'superset', sets: 3, restSeconds: 90, muscles: [], components: [] });
    if (source && !custom) this._form.id = ui.domain.newId('exercise');
    this._expectedRevision = (state.revisions || {})['exercise:' + this._form.id] || 0;
    this._account = ui.store.accountKey(); this.updateForm();
  },
  updateForm() {
    this.setData({ form: ui.clone(this._form), components: this._form.components.map((item, index) => Object.assign(ui.exerciseView(item), { index })) });
  },
  markDirty() { this.setData({ dirty: true }); if (this._visible && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '超级组还有未保存的修改' }); },
  name(event) { if (!this._form || this.data.saving) return; this._form.name = event.detail.value; this.setData({ 'form.name': event.detail.value }); this.markDirty(); },
  field(event) { if (!this._form || this.data.saving) return; this._form[event.currentTarget.dataset.key] = event.detail.value; this.markDirty(); },
  add() {
    if (!ui.ready() || !this._form || !this.data.identityReady) return;
    if (this._form.components.length >= 10) { this.setData({ error: '每个超级组最多10个动作' }); return; }
    ui.navigate('/packages/manage/exercise-picker/index?component=1', { exerciseSelected: exercise => {
      if (this._closed || this._account !== ui.store.accountKey()) return;
      const item = ui.clone(exercise); delete item.entryId; delete item.summary; delete item.typeLabel; delete item.custom;
      item.sets = 1; item.restSeconds = 0;
      try { this._form.components.push(ui.domain.validateExercise(item)); this.setData({ error: '' }); this.markDirty(); this.updateForm(); }
      catch (error) { this.setData({ error: ui.message(error) }); }
    } });
  },
  editComponent(event) {
    if (!ui.ready() || !this._form || !this.data.identityReady) return;
    const index = Number(event.currentTarget.dataset.index), draft = this._form.components[index]; if (!draft) return;
    ui.navigate('/packages/manage/exercise-edit/index?entry=1&component=1', { exerciseEdited: item => {
      if (this._closed || this._account !== ui.store.accountKey()) return;
      const current = this._form.components.indexOf(draft); if (current < 0) return;
      item.sets = 1; item.restSeconds = 0; delete item.entryId;
      this._form.components[current] = ui.clone(item); this.markDirty(); this.updateForm();
    } }, result => result.eventChannel.emit('exerciseDraft', ui.clone(draft)));
  },
  move(event) {
    if (!this._form || !this.data.identityReady) return;
    const index = Number(event.currentTarget.dataset.index), next = index + Number(event.currentTarget.dataset.delta), items = this._form.components;
    if (next < 0 || next >= items.length) return;
    items.splice(next, 0, items.splice(index, 1)[0]); this.markDirty(); this.updateForm();
  },
  remove(event) { if (this._form && this.data.identityReady) { this._form.components.splice(Number(event.currentTarget.dataset.index), 1); this.markDirty(); this.updateForm(); } },
  async loadLatest() { if (await ui.confirm('重新加载超级组', '当前未保存的修改将被丢弃。')) { this._form = null; this.setData({ dirty: false, stale: false, error: '' }); if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); this.render(ui.store.getState()); } },
  async save() {
    if (!ui.ready() || !this._form || this.data.saving || !this.data.identityReady || this._account !== ui.store.accountKey()) return;
    this.setData({ saving: true, error: '' });
    try {
      const body = ui.domain.validateExercise(Object.assign({}, ui.clone(this._form), { sets: Number(this._form.sets), restSeconds: Number(this._form.restSeconds) }));
      if (this.data.entryMode) this.getOpenerEventChannel().emit('exerciseEdited', body);
      else await ui.store.saveExercise(body, this._expectedRevision);
      if (this._closed || this._account !== ui.store.accountKey()) return;
      this.setData({ dirty: false }); if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack({ fail: () => ui.toast({ message: '已保存，返回失败请重试' }) });
    } catch (error) { if (!this._closed) this.setData({ error: ui.message(error), stale: error.code === 'STALE_DRAFT' }); }
    finally { if (!this._closed) this.setData({ saving: false }); }
  }
});
