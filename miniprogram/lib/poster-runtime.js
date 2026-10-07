const { drawPoster, WIDTH, HEIGHT } = require('./poster-render');
function createRuntime(api) {
  let codePath = '', codePromise = null;
  const images = new Map();
  async function loadCode() {
    if (codePath) return codePath;
    if (codePromise) return codePromise;
    codePromise = (async () => {
      const fs = api.getFileSystemManager();
      const cache = api.getStorageSync('ironplan:poster-code-v1');
      if (cache && cache.path && Date.now() - cache.at < 86400000) {
        try {
          await new Promise((resolve, reject) => fs.access({ path: cache.path, success: resolve, fail: reject }));
          codePath = cache.path; return codePath;
        } catch (error) { /* Fetch again when the cached file has expired or disappeared. */ }
      }
      const response = await api.cloud.callFunction({ name: 'fitcheckin', data: { action: 'posterCode' } });
      const result = response.result;
      if (!result || result.code !== 0 || !result.data || !result.data.base64) throw new Error('小程序码获取失败，请联网后重试');
      if (!['image/png', 'image/jpeg'].includes(result.data.mimeType)) throw new Error('小程序码格式不正确');
      const path = api.env.USER_DATA_PATH + '/ironplan-poster-code.' + (result.data.mimeType === 'image/png' ? 'png' : 'jpg');
      await new Promise((resolve, reject) => fs.writeFile({ filePath: path, data: result.data.base64, encoding: 'base64', success: resolve, fail: reject }));
      codePath = path;
      try { api.setStorageSync('ironplan:poster-code-v1', { path, at: Date.now() }); } catch (error) { /* Rendering can continue without persistent caching. */ }
      return path;
    })().finally(() => { codePromise = null; });
    return codePromise;
  }
  async function render(host, model) {
    const key = JSON.stringify(model);
    if (images.has(key)) return images.get(key);
    const path = await loadCode();
    const canvas = await new Promise((resolve, reject) => host.createSelectorQuery().select('#poster-canvas').fields({ node: true }).exec(results => results[0] && results[0].node ? resolve(results[0].node) : reject(new Error('海报画布加载失败，请重试'))));
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const code = await new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('小程序码加载失败')); image.src = path; });
    drawPoster(canvas.getContext('2d'), model, code);
    const result = await new Promise((resolve, reject) => api.canvasToTempFilePath({ canvas, width: WIDTH, height: HEIGHT, destWidth: WIDTH, destHeight: HEIGHT, fileType: 'png', success: resolve, fail: reject }, host));
    images.set(key, result.tempFilePath);
    if (images.size > 3) images.delete(images.keys().next().value);
    return result.tempFilePath;
  }
  return { loadCode, render };
}
let native;
function runtime() { if (!native) native = createRuntime(wx); return native; }
module.exports = { createRuntime, loadCode: () => runtime().loadCode(), render: (host, model) => runtime().render(host, model) };
