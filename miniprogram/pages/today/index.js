const ui = require('../ui');
const { achievement } = require('../../lib/achievement');
const { createPosterModel } = require('../../lib/poster-model');
const runtime = require('../../lib/poster-runtime');
const { restView, setLabel } = require('../../lib/training');
Page({
  data: { items: [], busy: false, error: '', activeId: '', restOpen: false, rest: {}, celebrationOpen: false, posterOpen: false, posterModel: null, posterSource: '', posterImage: '', achievement: {}, onboardingOpen: false, onboardingWeight: '', onboardingError: '', onboardingSaving: false },
  onLoad() { ui.bind(this, this.render); },
  onUnload() { this._closed = true; clearInterval(this._dayTimer); clearInterval(this._restTimer); this.keepAwake(false); ui.unbind(this); this.tabHidden(false); },
  onHide() {
    this._foreground = false; clearInterval(this._dayTimer); clearInterval(this._restTimer); this.keepAwake(false);
    if (this._training && this._training.rest) { this._training.rest.away = true; this.saveTraining(); }
    this.closeOverlays();
    this.setData({ onboardingOpen: false });
  },
  onShow() {
    this._foreground = true;
    ui.selectTab(this, 0); this.render(ui.store.getState()); clearInterval(this._dayTimer);
    this._dayTimer = setInterval(() => { if (this.data.date !== ui.domain.today()) this.render(ui.store.getState()); }, 30000);
    this.resumeRest();
  },
  onPullDownRefresh() { ui.refresh(this); },
  tabHidden(hidden) { const bar = this.getTabBar && this.getTabBar(); if (bar) bar.setData({ hidden }); },
  keepAwake(keepScreenOn) { if (this._keepAwake === keepScreenOn) return; this._keepAwake = keepScreenOn; if (wx.setKeepScreenOn) wx.setKeepScreenOn({ keepScreenOn, fail() {} }); },
  saveTraining() {
    if (!this._trainingKey) return;
    try { wx.setStorageSync(this._trainingKey, this._training); }
    catch (error) { this.setData({ error: '组进度已保存，休息计时未能落盘，请检查本机空间' }); }
  },
  restoreTraining(record, date) {
    const owner = ui.store.accountKey(), key = owner ? 'ironplan:training:' + owner : '';
    if (key !== this._trainingKey || !this._training || this._training.date !== date) {
      const saved = key && wx.getStorageSync(key);
      this._trainingKey = key;
      this._training = saved && saved.date === date ? saved : { date, activeId: '', rest: null };
    }
    const active = record && record.items.find(e => e.entryId === this._training.activeId);
    if (!active) this._training.activeId = '';
    const rest = this._training.rest;
    if (rest && (!active || rest.entryId !== active.entryId || ui.domain.completedSets(record, active) !== rest.afterSet || rest.afterSet >= active.sets || !Number.isFinite(rest.endAt) || rest.duration <= 0 || rest.duration > 3600)) {
      this._training.rest = null; this.saveTraining();
    }
    if (!this._training.rest) { clearInterval(this._restTimer); this.keepAwake(false); }
  },
  resumeRest() {
    clearInterval(this._restTimer);
    this.updateRest();
    if (this._foreground && this._training && this._training.rest && this.data.rest.remaining) this._restTimer = setInterval(() => this.updateRest(), 250);
  },
  updateRest() {
    if (this._closed || !this._training || !this._training.rest) return;
    if (this._training.date !== ui.domain.today()) { this.render(ui.store.getState()); return; }
    const rest = this._training.rest, view = restView(rest, Date.now());
    if (JSON.stringify(view) !== JSON.stringify(this.data.rest)) this.setData({ rest: view });
    if (!view.remaining) {
      clearInterval(this._restTimer); this.keepAwake(false);
      if (this._foreground && !rest.notified) {
        rest.notified = true; this.saveTraining();
        if (wx.vibrateShort) wx.vibrateShort({ type: 'heavy', fail() {} });
      }
    } else if (this._foreground) this.keepAwake(true);
  },
  finishRest() {
    if (!this._training) return;
    this._training.rest = null; this.saveTraining(); clearInterval(this._restTimer); this.keepAwake(false);
    this.setData({ restOpen: false, rest: {} }); this.tabHidden(false);
  },
  continueTraining() { if (this.data.rest.remaining === 0) this.finishRest(); },
  skipRest() { this.finishRest(); },
  closeOverlays() { this.setData({ celebrationOpen: false, posterOpen: false }); this.tabHidden(false); },
  onboardingSeen() {
    if (!this._onboardingKey) return;
    if (!wx.getStorageSync(this._onboardingKey)) wx.setStorageSync(this._onboardingKey, true);
  },
  checkOnboarding(state) {
    const account = ui.store.accountKey(), key = account ? 'ironplan:weight-onboarding:' + account : '';
    if (key !== this._onboardingKey) {
      this._onboardingKey = key;
      this.setData({ onboardingOpen: false, onboardingWeight: '', onboardingError: '', onboardingSaving: false });
    }
    if (!this._foreground || !state.identityReady || state.loading || !key) return;
    if (state.profile.bodyWeight != null) {
      if (!this.data.onboardingSaving) { this.onboardingSeen(); this.setData({ onboardingOpen: false }); }
      return;
    }
    if (wx.getStorageSync(key) || this.data.restOpen || this.data.celebrationOpen || this.data.posterOpen || this.data.onboardingOpen) return;
    this._onboardingRevision = (state.revisions || {})['profile:profile'] || 0;
    this.setData({ onboardingOpen: true, onboardingWeight: '', onboardingError: '' });
  },
  onboardingInput(event) { this.setData({ onboardingWeight: event.detail.value, onboardingError: '' }); },
  skipOnboarding() {
    if (this.data.onboardingSaving) return;
    try { this.onboardingSeen(); this.setData({ onboardingOpen: false }); this.tabHidden(false); }
    catch (error) { this.setData({ onboardingError: '暂未保存提示状态，请重试' }); }
  },
  async saveOnboardingWeight() {
    if (!ui.ready() || this.data.onboardingSaving || !this.data.onboardingOpen) return;
    const key = this._onboardingKey;
    this.setData({ onboardingSaving: true, onboardingError: '' });
    try {
      const input = this.data.onboardingWeight.trim(), weight = Number(input);
      if (!input || !Number.isFinite(weight) || weight <= 0 || weight > 500) throw new Error('请输入有效体重（大于0且不超过500kg）');
      await ui.store.saveProfile({ bodyWeight: weight }, this._onboardingRevision);
      if (this._closed || key !== this._onboardingKey || key !== 'ironplan:weight-onboarding:' + ui.store.accountKey()) return;
      this.onboardingSeen(); this.setData({ onboardingOpen: false }); this.tabHidden(false);
      wx.showToast({ title: '已保存，可在“我的”修改', icon: 'none', duration: 3000 });
    } catch (error) {
      if (key === this._onboardingKey) this.setData({ onboardingError: error.code === 'STALE_DRAFT' ? '体重已更新，请到“我的”查看最新值并修改。' : ui.message(error) });
    } finally { if (key === this._onboardingKey) this.setData({ onboardingSaving: false }); }
  },
  render(state) {
    if (this._closed) return;
    const date = ui.domain.today(), day = ui.domain.resolveDay(state, date);
    const record = state.records.find(r => r.date === date);
    this.restoreTraining(record, date);
    const totals = ui.domain.calculateRecord(record || { items: day.items, completed: [], bodyWeight: state.profile.bodyWeight });
    const allDone = totals.status === 'complete', wasDone = this.data.allDone && this.data.date === date;
    if ((this.data.date && this.data.date !== date) || !allDone || !state.identityReady) this.closeOverlays();
    const result = achievement(state, date);
    const planUpdate = ui.domain.todayPlanUpdate(state, date);
    const cycle = ui.domain.cycleStatus(state, date);
    const update = {
      date, dateLabel: date.replace(/-/g, '.') + ' ' + ui.WEEKDAYS[ui.domain.weekday(date)],
      items: day.items.map(e => {
        const count = record ? ui.domain.completedSets(record, e) : 0, active = this._training.activeId === e.entryId;
        return Object.assign(ui.exerciseView(e), { checked: count === e.sets, count, active, groups: active ? Array.from({ length: e.sets }, (_, index) => ({ index, number: index + 1, done: index < count, next: index === count, undoable: index === count - 1, label: setLabel(e) })) : [] });
      }),
      hasPlan: day.hasPlan, isOverride: day.isOverride, frozen: !!record, identityReady: state.identityReady, loading: state.loading,
      totals: ui.totalView(totals), percent: totals.totalSetCount ? Math.round(totals.completedSetCount / totals.totalSetCount * 100) : 0, allDone,
      syncLabel: ui.syncLabel(state.sync), pending: state.sync.pendingCount, achievement: result,
      missingWeight: day.items.some(ui.domain.usesBodyWeight) && !record && !state.profile.bodyWeight,
      planUpdateAvailable: !!(planUpdate && planUpdate.changed),
      planName: day.planName || (state.templates.find(t => t.id === day.templateId) || {}).name || (day.hasPlan ? '训练计划' : '待安排'),
      cycleLabel: cycle.current ? cycle.current.cycle.name + ' · 第 ' + (cycle.current.index + 1) + ' / ' + cycle.current.cycle.weeks.length + ' 周' : '',
      needsNextCycle: cycle.needsNext,
      emptyTitle: cycle.upcoming ? '下一周期尚未开始' : cycle.ended ? '周期已到期' : '今天尚未安排训练',
      emptyText: cycle.upcoming ? cycle.upcoming.startWeek + ' 开始 · ' + cycle.upcoming.name : cycle.ended ? '这一程已结束，安排下一段训练周期吧。' : '选好周模板，为接下来的每一周安排训练。',
      activeId: this._training.activeId, restOpen: !!this._training.rest
    };
    let model = null;
    if (allDone && state.identityReady) model = createPosterModel(state, { mode: 'day', date }, date);
    const key = JSON.stringify(model);
    if (key !== this._modelKey) { this._modelKey = key; update.posterModel = model; update.posterSource = model ? key : ''; update.posterImage = ''; }
    this.setData(update);
    const resting = this._training.rest;
    if (resting) {
      const next = day.items.find(e => e.entryId === resting.entryId);
      this.setData({ restNext: { name: next.name, group: resting.afterSet + 1, total: next.sets, label: setLabel(next) } });
      this.updateRest();
    }
    this.checkOnboarding(state);
    this.tabHidden(this.data.restOpen || this.data.celebrationOpen || this.data.posterOpen || this.data.onboardingOpen);
    if (state.identityReady && day.items.length && !this._warmTried) { this._warmTried = true; runtime.loadCode().catch(() => {}); }
    if (allDone && !wasDone && this._completionIntent === date) this.celebrate(date);
  },
  async startExercise(event) {
    if (!ui.ready() || this.data.busy || this.data.restOpen) return;
    if (this.data.date !== ui.domain.today()) { this.render(ui.store.getState()); return; }
    if (this.data.missingWeight) { ui.navigate('/packages/manage/settings/index?focus=weight'); return; }
    const id = event.currentTarget.dataset.id;
    if (this._training.activeId === id) { this._training.activeId = ''; this.saveTraining(); this.render(ui.store.getState()); return; }
    this.setData({ busy: true, error: '' });
    try {
      await ui.store.startToday(id);
      this._training.activeId = id; this.saveTraining(); this.render(ui.store.getState());
    } catch (error) { if (!this._closed) this.setData({ error: ui.message(error) }); }
    finally { if (!this._closed) this.setData({ busy: false }); }
  },
  async updatePlan() {
    if (!ui.ready() || this.data.busy || this.data.restOpen) return;
    const state = ui.store.getState(), date = this.data.date, account = ui.store.accountKey();
    const revision = state.revisions['record:' + date];
    if (!await ui.confirm('更新今日清单', '采用最新安排，保留已有完成组数及这些动作的参数；没有完成组数的动作可替换。')) return;
    if (date !== ui.domain.today() || account !== ui.store.accountKey()) { this.render(ui.store.getState()); ui.toast({ message: '日期或账号已变化，请重新确认今日清单' }); return; }
    this.setData({ busy: true, error: '' });
    try { await ui.store.updateTodayPlan(revision); this.render(ui.store.getState()); wx.showToast({ title: '今日清单已更新', icon: 'success' }); }
    catch (error) { this.setData({ error: ui.message(error) }); }
    finally { if (!this._closed) this.setData({ busy: false }); }
  },
  async completeSet(event) {
    if (!ui.ready() || this.data.busy || this.data.restOpen) return;
    if (this.data.date !== ui.domain.today()) { this.render(ui.store.getState()); ui.toast({ message: '已切换到新的一天，请确认今日计划' }); return; }
    const id = event.currentTarget.dataset.id, index = Number(event.currentTarget.dataset.index);
    if (id !== this._training.activeId) return;
    this._completionIntent = this.data.date; this.setData({ busy: true, error: '' });
    try {
      await ui.store.completeTodaySet(id, index);
      const state = ui.store.getState(), record = state.records.find(r => r.date === this.data.date), item = record.items.find(e => e.entryId === id);
      const count = ui.domain.completedSets(record, item);
      if (count < item.sets && item.restSeconds > 0) {
        this._training.rest = { entryId: id, afterSet: count, duration: item.restSeconds, endAt: Date.now() + item.restSeconds * 1000, notified: false, away: false };
        this.saveTraining(); this.render(state); this.resumeRest();
      }
    } catch (error) { if (!this._closed) this.setData({ error: ui.message(error) }); }
    finally { this._completionIntent = null; if (!this._closed) this.setData({ busy: false }); }
  },
  tapSetRow(event) {
    const id = event.currentTarget.dataset.id, index = Number(event.currentTarget.dataset.index);
    const item = this.data.items.find(e => e.entryId === id);
    if (item && item.active && item.count === index) return this.completeSet(event);
  },
  async undoSet(event) {
    if (!ui.ready() || this.data.busy || this.data.restOpen) return;
    if (this.data.date !== ui.domain.today()) { this.render(ui.store.getState()); return; }
    const id = event.currentTarget.dataset.id, index = Number(event.currentTarget.dataset.index);
    this.setData({ busy: true, error: '' });
    try { await ui.store.undoTodaySet(id, index); }
    catch (error) { this.setData({ error: ui.message(error) }); }
    finally { if (!this._closed) this.setData({ busy: false }); }
  },
  celebrate(date) {
    const owner = ui.store.accountKey();
    const key = 'ironplan:celebrated:' + owner;
    const sessionKey = owner + ':' + date;
    if (!owner || this._celebrated === sessionKey || wx.getStorageSync(key) === date) return;
    this._celebrated = sessionKey;
    try { wx.setStorageSync(key, date); } catch (error) { /* The session guard still prevents repeat celebrations. */ }
    this.setData({ celebrationOpen: true }); this.tabHidden(true);
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light', fail() {} });
  },
  poster() {
    this.render(ui.store.getState());
    if (ui.ready() && this.data.allDone) { this.setData({ celebrationOpen: false, posterOpen: true }); this.tabHidden(true); }
  },
  posterStatus(event) { this.setData({ posterImage: event.detail.imagePath || '' }); },
  dismissCelebration() { this.closeOverlays(); },
  closePoster() { this.closeOverlays(); },
  stop() {},
  onShareAppMessage() { return { title: 'IronPlan · ' + (this.data.achievement.encouragement || '记录每一次训练'), path: '/pages/today/index', imageUrl: this.data.posterImage || undefined }; },
  plans() { wx.switchTab({ url: '/pages/plans/index' }); },
  settings() { ui.navigate('/packages/manage/settings/index'); },
  editWeek() { ui.navigate('/packages/manage/plan-edit/index?week=' + ui.domain.weekStart(ui.domain.today())); }
});
