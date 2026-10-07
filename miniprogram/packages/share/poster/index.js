const ui = require('../../../pages/ui');
const { createPosterModel } = require('./model');
const { captions } = require('./render');
const runtime = require('../../../lib/poster-runtime');
const invoke = (method, options) => new Promise((resolve, reject) => wx[method](Object.assign({}, options, { success: resolve, fail: reject })));
Page({
  data: { loading: false, saving: false, imagePath: '', error: '', title: '训练海报', pending: false, captionIndex: 0, captionOptions: [], selectedCaption: '' },
  onLoad(query) { this._query = query; this.setData({ title: query.mode === 'month' ? '月度训练海报' : '今日完成海报' }); },
  onReady() { this._ready = true; this._unsubscribe = ui.store.subscribe(() => this.generate()); },
  onShow() { if (this._ready) this.generate(); },
  onUnload() { this._closed = true; if (this._unsubscribe) this._unsubscribe(); },
  async codePath() {
    return runtime.loadCode();
  },
  async generate() {
    if (!this._ready || this._closed) return;
    if (this.data.loading) { this._again = true; return; }
    let model;
    try { if (!ui.store.getState().identityReady) throw new Error('请联网确认身份后重试'); model = createPosterModel(ui.store.getState(), this._query, ui.domain.today()); }
    catch (error) { this._fingerprint = null; this.setData({ imagePath: '', error: ui.message(error), loading: false }); return; }
    const options = captions(model);
    const index = Number(this.data.captionIndex) || 0;
    model.caption = options[index] || options[0];
    this.setData({ captionOptions: options, selectedCaption: model.caption });
    const fingerprint = JSON.stringify(model);
    if (this._fingerprint === fingerprint && this.data.imagePath) return;
    this.setData({ loading: true, error: '', imagePath: '', pending: model.pending });
    try {
      const imagePath = await runtime.render(this, model);
      if (!this._closed) { this._fingerprint = fingerprint; this.setData({ imagePath }); }
    } catch (error) { if (!this._closed) this.setData({ error: ui.message(error) }); }
    finally { if (!this._closed) { this.setData({ loading: false }); if (this._again) { this._again = false; this.generate(); } } }
  },
  changeCaption(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.captionOptions.length) return;
    this.setData({ captionIndex: index }); this.generate();
  },
  preview() { if (this.data.imagePath) wx.previewImage({ urls: [this.data.imagePath] }); },
  async save() {
    if (!this.data.imagePath || this.data.saving || this.data.loading) return;
    this.setData({ saving: true, error: '' });
    try {
      const settings = await invoke('getSetting', {});
      if (settings.authSetting['scope.writePhotosAlbum'] === false) {
        if (!await ui.confirm('相册权限未开启', '允许访问相册后才能保存训练海报。')) return;
        const opened = await invoke('openSetting', {});
        if (!opened.authSetting['scope.writePhotosAlbum']) throw new Error('相册权限未开启');
      }
      await invoke('saveImageToPhotosAlbum', { filePath: this.data.imagePath });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) { this.setData({ error: '保存失败，请检查相册权限后重试' }); }
    finally { this.setData({ saving: false }); }
  },
  share() {
    if (!this.data.imagePath) return;
    if (wx.showShareImageMenu) wx.showShareImageMenu({ path: this.data.imagePath, fail: error => { if (!/cancel/.test(error.errMsg || '')) this.setData({ error: '图片分享失败，请重试' }); } });
    else this.preview();
  },
  onShareAppMessage() { return { title: 'IronPlan · 记录每一次训练', path: '/pages/today/index', imageUrl: this.data.imagePath || undefined }; }
});
