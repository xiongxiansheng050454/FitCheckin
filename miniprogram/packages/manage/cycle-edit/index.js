const ui = require('../../../pages/ui');
Page({
  data: { name: '', startWeek: '', rows: [], templateNames: [], templateIndex: 0, repeatCount: 1, dirty: false, saving: false, error: '', isTemplate: false, cycleTemplateNames: [] },
  onLoad(query) { this._query = query; ui.bind(this, this.render); },
  onShow() { this._visible = true; this.render(ui.store.getState()); if (this.data.dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '周期还有未保存的安排' }); },
  onHide() { this._visible = false; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); },
  onUnload() { ui.unbind(this); },
  onPullDownRefresh() { ui.refresh(this); },
  render(state) {
    const isTemplate = this._query.mode === 'template';
    this._templates = state.templates;
    this._cycleTemplates = state.cycleTemplates || [];
    this.setData({ identityReady: state.identityReady, isTemplate, templateNames: state.templates.map(t => t.name), cycleTemplateNames: this._cycleTemplates.map(t => t.name + ' · ' + t.weeks.length + '周'), currentWeek: ui.domain.weekStart(ui.domain.today()) });
    if (this.data.templateIndex >= state.templates.length) this.setData({ templateIndex: 0 });
    if (this._loaded) { this.updateRows(); this.setData({ started: !isTemplate && this._existing && this._body.startWeek <= this.data.currentWeek }); return; }
    if (!state.identityReady && !state.program) return;
    const existing = isTemplate ? this._cycleTemplates.find(t => t.id === this._query.id) : state.program && state.program.cycles.find(c => c.id === this._query.id);
    if (this._query.id && !existing) { if (!state.loading) this.setData({ error: isTemplate ? '周期模板不存在，请返回刷新' : '周期不存在，请返回刷新' }); return; }
    const suggested = ui.domain.cycleStatus(state, ui.domain.today()).nextStart;
    const startWeek = suggested < this.data.currentWeek ? this.data.currentWeek : suggested;
    if (isTemplate && existing) {
      const plans = [...new Set(existing.weeks)].map(id => { const source = state.templates.find(t => t.id === id); return { id, templateId: id, name: source ? source.name : '已删除的周模板', days: source ? ui.clone(source.days) : [[], [], [], [], [], [], []] }; });
      this._body = { id: existing.id, name: existing.name, startWeek, plans, weeks: ui.clone(existing.weeks) };
    } else this._body = existing ? ui.clone(existing) : { id: ui.domain.newId(isTemplate ? 'cycle-template' : 'cycle'), name: isTemplate ? '新周期模板' : '新训练周期', startWeek, plans: [], weeks: [] };
    if (!isTemplate && this._query.cycleTemplate && !existing) {
      const source = this._cycleTemplates.find(t => t.id === this._query.cycleTemplate);
      try { if (!source) throw new Error('周期模板已被删除，请返回刷新'); this._body = ui.domain.cycleFromTemplate(state, source, startWeek); }
      catch (error) { this.setData({ error: ui.message(error) }); return; }
    }
    this._revision = state.revisions[(isTemplate ? 'cycleTemplate:' + this._body.id : 'program:program')] || 0;
    this._existing = !!existing;
    this._loaded = true;
    this.setData({ name: this._body.name, startWeek: this._body.startWeek, started: !isTemplate && this._body.startWeek <= this.data.currentWeek && !!existing, canLoadCycleTemplate: !isTemplate && !existing, dirty: false, error: '', stale: false });
    if (!existing && this._query.template) {
      const index = this._templates.findIndex(t => t.id === this._query.template);
      if (index >= 0) { this.setData({ templateIndex: index }); this.addWeeks(); }
    }
    this.updateRows();
  },
  markDirty() { this.setData({ dirty: true }); if (this._visible && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '周期还有未保存的安排' }); },
  updateRows() {
    if (!this._body) return;
    const currentWeek = ui.domain.weekStart(ui.domain.today());
    this.setData({ rows: this._body.weeks.map((id, index) => {
      const plan = this._body.plans.find(p => p.id === id), week = ui.domain.shiftDate(this._body.startWeek, index * 7);
      return { index, number: index + 1, week, end: ui.domain.shiftDate(week, 6), name: plan.name, locked: !this.data.isTemplate && week < currentWeek, dayCount: plan.days.filter(d => d.length).length, current: !this.data.isTemplate && week === currentWeek };
    }), end: this._body.weeks.length ? ui.domain.cycleEnd(this._body) : '', weekCount: this._body.weeks.length });
  },
  nameInput(e) { this.setData({ name: e.detail.value }); this.markDirty(); },
  chooseStart(e) { if (!this._body || this.data.started) return; this._body.startWeek = ui.domain.weekStart(e.detail.value); this.setData({ startWeek: this._body.startWeek }); this.markDirty(); this.updateRows(); },
  chooseTemplate(e) { this.setData({ templateIndex: Number(e.detail.value) }); },
  repeatInput(e) { this.setData({ repeatCount: e.detail.value }); },
  async loadCycleTemplate(e) {
    if (!this._body || !this.data.canLoadCycleTemplate) return;
    const id = this._cycleTemplates[Number(e.detail.value)].id;
    if (this._body.weeks.length && !await ui.confirm('使用周期模板', '替换当前尚未保存的周安排？')) return;
    try {
      const state = ui.store.getState(), source = state.cycleTemplates.find(t => t.id === id);
      if (!source) throw new Error('周期模板已删除，请刷新');
      const body = ui.domain.cycleFromTemplate(state, source, this._body.startWeek); body.id = this._body.id; this._body = body;
      this.setData({ name: body.name, error: '' }); this.markDirty(); this.updateRows();
    } catch (error) { this.setData({ error: ui.message(error) }); }
  },
  snapshot(template) {
    // Reuse one immutable snapshot for repeated weeks, keeping payloads small.
    let plan = this._body.plans.find(p => p.templateId === template.id && p.name === template.name && JSON.stringify(p.days) === JSON.stringify(template.days));
    if (!plan) { plan = { id: ui.domain.newId('snapshot'), templateId: template.id, name: template.name, days: ui.clone(template.days) }; this._body.plans.push(plan); }
    return plan.id;
  },
  addWeeks() {
    if (!this._body) return;
    const template = this._templates[this.data.templateIndex], count = Number(this.data.repeatCount);
    if (!template) { this.setData({ error: '请先新建一个周模板' }); return; }
    if (!Number.isInteger(count) || count < 1 || this._body.weeks.length + count > 52) { this.setData({ error: '请输入有效周数，每个周期最多52周' }); return; }
    const id = this.snapshot(template); this._body.weeks.push(...Array(count).fill(id));
    this.setData({ error: '' }); this.markDirty(); this.updateRows();
  },
  replace(e) {
    const index = Number(e.currentTarget.dataset.index), template = this._templates[Number(e.detail.value)];
    if (!template || this.data.rows[index].locked) return;
    this._body.weeks[index] = this.snapshot(template); this.markDirty(); this.updateRows();
  },
  move(e) {
    const index = Number(e.currentTarget.dataset.index), target = index + Number(e.currentTarget.dataset.delta);
    if (target < 0 || target >= this._body.weeks.length || this.data.rows[index].locked || this.data.rows[target].locked) return;
    [this._body.weeks[index], this._body.weeks[target]] = [this._body.weeks[target], this._body.weeks[index]]; this.markDirty(); this.updateRows();
  },
  remove(e) { const index = Number(e.currentTarget.dataset.index); if (this.data.rows[index].locked) return; this._body.weeks.splice(index, 1); this.markDirty(); this.updateRows(); },
  templates() { wx.switchTab({ url: '/pages/plans/index', success: () => { const pages = getCurrentPages(); const page = pages[pages.length - 1]; if (page) page.setData({ view: 'templates' }); } }); },
  async loadLatest() { if (await ui.confirm('重新加载周期', '未保存的安排将丢弃。')) { this._loaded = false; this.render(ui.store.getState()); if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); } },
  async save() {
    if (!ui.ready() || this.data.saving || !this._body) return;
    this.setData({ saving: true, error: '' });
    try {
      const body = ui.clone(this._body); body.name = this.data.name;
      if (this.data.isTemplate) await ui.store.saveCycleTemplate({ id: body.id, name: body.name, weeks: body.weeks.map(id => body.plans.find(p => p.id === id).templateId) }, this._revision);
      else await ui.store.saveCycle(body, this._revision);
      this.setData({ dirty: false }); if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.showToast({ title: this.data.isTemplate ? '周期模板已保存' : '周期已安排', icon: 'success' }); wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/plans/index' }) });
    } catch (error) { this.setData({ error: ui.message(error), stale: error.code === 'STALE_DRAFT' }); }
    finally { this.setData({ saving: false }); }
  },
  async saveAsTemplate() {
    if (!ui.ready() || this.data.saving || !this._body || !this._body.weeks.length) return;
    this.setData({ saving: true, error: '' });
    try {
      await ui.store.saveCycleTemplate({ name: this.data.name, weeks: this._body.weeks.map(id => this._body.plans.find(p => p.id === id).templateId) }, 0);
      wx.showToast({ title: '已存为周期模板', icon: 'success' });
    } catch (error) { this.setData({ error: ui.message(error) }); }
    finally { this.setData({ saving: false }); }
  }
});
