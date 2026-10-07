function navigate(url, extra) {
  return new Promise((resolve, reject) => {
    wx.navigateTo(Object.assign({}, extra, { url, success: resolve, fail: err => { wx.showToast({ title: '页面加载失败，请联网后重试', icon: 'none' }); reject(err); } }));
  });
}
module.exports = { navigate };
