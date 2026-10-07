const store = require('./lib/store');
const environment = require('./lib/environment');
App({
  globalData: { env: environment.id },
  onLaunch() {
    if (wx.cloud) wx.cloud.init({ env: this.globalData.env, traceUser: true });
    store.init();
    wx.onNetworkStatusChange(status => { if (status.isConnected) store.retrySync(); });
  },
  onShow() {
    if (this.started) store.refresh();
    this.started = true;
  }
});
