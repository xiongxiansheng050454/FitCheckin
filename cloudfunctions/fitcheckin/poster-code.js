'use strict';
function createPosterCode(getUnlimited) {
  let cached;
  return function getCode() {
    if (!cached) cached = Promise.resolve().then(() => getUnlimited({
      scene: 'ironplan', page: 'pages/today/index', checkPath: false,
      envVersion: 'release', width: 430, isHyaline: false,
      autoColor: false, lineColor: { r: 23, g: 33, b: 28 }
    })).then(result => {
      const buffer = result && result.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > 512 * 1024) throw new Error('Invalid code image');
      const png = buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      if (!png && !jpeg) throw new Error('Invalid code image');
      return { base64: buffer.toString('base64'), mimeType: png ? 'image/png' : 'image/jpeg' };
    }).catch(error => { cached = null; throw error; });
    return cached;
  };
}
module.exports = { createPosterCode };
