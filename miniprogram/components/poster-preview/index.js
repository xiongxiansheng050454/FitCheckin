const runtime = require('../../lib/poster-runtime');
const { captions } = require('../../lib/poster-render');
const ui = require('../../pages/ui');
const invoke = (method, options) => new Promise((resolve, reject) => wx[method](Object.assign({}, options, { success: resolve, fail: reject })));
Component({
  properties: { source: { type: String, value: '', observer: 'updateModel' }, visible: { type: Boolean, value: false } },
  data: { model: null, imagePath: '', loading: false, error: '', saving: false, captionIndex: 0, captionOptions: [], selectedCaption: '', canShareImage: false },
  lifetimes: {
    ready() { this._ready = true; this.setData({ canShareImage: typeof wx.showShareImageMenu === 'function' }); this.updateModel(this.data.source); },
    detached() { this._closed = true; this._version = (this._version || 0) + 1; }
  },
  methods: {
    updateModel(source) {
      if (!this._ready || this._closed) return;
      let model;
      try { model = source ? JSON.parse(source) : null; }
      catch (error) { this.setData({ error: '海报数据加载失败，请重试', loading: false }); return; }
      if (!model) {
        this._wanted = null; this._key = ''; this._version = (this._version || 0) + 1;
        this.setData({ model: null, imagePath: '', loading: false, error: '' });
        this.triggerEvent('status', { imagePath: '' }); return;
      }
      if (this._period !== model.period) { this._period = model.period; this.setData({ captionIndex: 0 }); }
      const options = captions(model), caption = options[this.data.captionIndex] || options[0];
      const next = Object.assign({}, model, { caption }), key = JSON.stringify(next);
      if (this._key === key) return;
      this._key = key; this._version = (this._version || 0) + 1;
      this._wanted = { model: next, version: this._version };
      this.setData({ model, captionOptions: options, selectedCaption: caption, imagePath: '', loading: true, error: '' });
      this.triggerEvent('status', { imagePath: '' });
      // Let the native completion feedback paint before starting Canvas work.
      wx.nextTick(() => { if (!this._closed) this.pump(); });
    },
    async pump() {
      if (this._running || !this._wanted || this._closed) return;
      this._running = true;
      const job = this._wanted; this._wanted = null;
      try {
        const imagePath = await runtime.render(this, job.model);
        if (!this._closed && job.version === this._version) {
          this.setData({ imagePath, loading: false });
          this.triggerEvent('status', { imagePath });
        }
      } catch (error) {
        if (!this._closed && job.version === this._version) this.setData({ error: ui.message(error), loading: false });
      } finally { this._running = false; if (!this._closed && this._wanted) this.pump(); }
    },
    retry() { this._key = ''; this.updateModel(this.data.source); },
    changeCaption(event) {
      const index = Number(event.detail.value);
      if (!Number.isInteger(index) || index < 0 || index >= this.data.captionOptions.length) return;
      this.setData({ captionIndex: index }); this._key = ''; this.updateModel(this.data.source);
    },
    close() { this.triggerEvent('close'); },
    stop() {},
    preview() { if (this.data.imagePath) wx.previewImage({ urls: [this.data.imagePath] }); },
    share() {
      if (!this.data.imagePath || !wx.showShareImageMenu) return;
      wx.showShareImageMenu({ path: this.data.imagePath, fail: error => { if (!/cancel/.test(error.errMsg || '')) this.setData({ error: '图片分享失败，请重试' }); } });
    },
    async save() {
      if (!this.data.imagePath || this.data.saving || this.data.loading) return;
      const filePath = this.data.imagePath;
      this.setData({ saving: true, error: '' });
      try {
        const settings = await invoke('getSetting', {});
        if (settings.authSetting['scope.writePhotosAlbum'] === false) {
          if (!await ui.confirm('相册权限未开启', '允许访问相册后才能保存训练海报。')) return;
          const opened = await invoke('openSetting', {});
          if (!opened.authSetting['scope.writePhotosAlbum']) throw new Error('相册权限未开启');
        }
        await invoke('saveImageToPhotosAlbum', { filePath });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      } catch (error) { if (!this._closed) this.setData({ error: '保存失败，请检查相册权限后重试' }); }
      finally { if (!this._closed) this.setData({ saving: false }); }
    }
  }
});
