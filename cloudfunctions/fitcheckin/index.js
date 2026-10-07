'use strict';

const { validateOperation, ValidationError } = require('./validation');
const { createDocumentTransport } = require('./document-store');
const ENV_ID = 'weixing2-d7g2j6asyc5132905';
const APP_ID = 'wxe25930a2cdce35d0';
const MESSAGES = {
  AUTH_REQUIRED: '\u8bf7\u4ece\u5fae\u4fe1\u5c0f\u7a0b\u5e8f\u91cd\u65b0\u767b\u5f55',
  FORBIDDEN: '\u5c0f\u7a0b\u5e8f\u8eab\u4efd\u4e0d\u5339\u914d',
  DB_ERROR: '\u4e91\u7aef\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  CONFLICT: '\u4e91\u7aef\u5185\u5bb9\u5df2\u53d8\u66f4\uff0c\u8bf7\u5904\u7406\u51b2\u7a81',
  OPERATION_REUSED: '\u64cd\u4f5c\u6807\u8bc6\u5df2\u7528\u4e8e\u4e0d\u540c\u5185\u5bb9',
  IMMUTABLE_RECORD: '\u8bad\u7ec3\u5feb\u7167\u4e0d\u53ef\u4fee\u6539',
  VALIDATION: '\u64cd\u4f5c\u5185\u5bb9\u4e0d\u5408\u6cd5'
};

function safeEntity(entity) {
  if (entity === null) return null;
  if (!entity || !['profile', 'exercise', 'template', 'cycleTemplate', 'override', 'record', 'program'].includes(entity.kind) || typeof entity.id !== 'string' || !Number.isSafeInteger(entity.revision) || entity.revision < 1 || typeof entity.deleted !== 'boolean') throw new Error('Invalid entity response');
  return { kind: entity.kind, id: entity.id, body: entity.deleted ? null : entity.body, revision: entity.revision, deleted: entity.deleted };
}
function createHandler({ getWXContext, transport, now = Date.now, getPosterCode }) {
  return async event => {
    try {
      const identity = getWXContext();
      if (!identity || typeof identity.OPENID !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.OPENID)) return { code: 'AUTH_REQUIRED', message: MESSAGES.AUTH_REQUIRED };
      if (identity.APPID !== APP_ID) return { code: 'FORBIDDEN', message: MESSAGES.FORBIDDEN };
      if (!event || !['bootstrap', 'pull', 'mutate', 'posterCode'].includes(event.action)) throw new ValidationError('\u672a\u77e5\u64cd\u4f5c');
      if (event.action === 'posterCode') {
        try { return { code: 0, data: await getPosterCode() }; }
        catch (error) { return { code: 'POSTER_CODE_ERROR', message: '\u5c0f\u7a0b\u5e8f\u7801\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u8054\u7f51\u540e\u91cd\u8bd5' }; }
      }
      const owner = identity.OPENID;
      if (event.action === 'mutate') {
        const operation = validateOperation(event.operation, now());
        const result = await transport('fitcheckin_mutate', { p_owner: owner, p_operation: operation });
        if (result.code === 0 || result.code === 'CONFLICT') return { code: result.code, ...(result.code ? { message: MESSAGES.CONFLICT } : {}), data: { entity: safeEntity(result.entity) } };
        const code = Object.prototype.hasOwnProperty.call(MESSAGES, result.code) ? result.code : 'DB_ERROR';
        return { code, message: MESSAGES[code] };
      }
      const entities = []; let cursor = null; const seen = new Set();
      do {
        const result = await transport('fitcheckin_pull', {
          p_owner: owner, p_after_kind: cursor ? cursor.kind : '', p_after_id: cursor ? cursor.id : '', p_limit: 100
        });
        if (!result || !Array.isArray(result.entities)) throw new Error('Invalid pull response');
        entities.push(...result.entities.map(safeEntity));
        cursor = result.cursor;
        if (cursor) {
          if (typeof cursor.kind !== 'string' || typeof cursor.id !== 'string') throw new Error('Invalid cursor');
          const key = JSON.stringify([cursor.kind, cursor.id]);
          if (seen.has(key)) throw new Error('Repeated cursor');
          seen.add(key);
        }
      } while (cursor);
      return { code: 0, data: { openid: owner, entities, scheduleHistorySupported: true, setProgressSupported: true, cyclesSupported: true, cycleTemplatesSupported: true, todayPlanUpdateSupported: true, supersetsSupported: true } };
    } catch (error) {
      return error instanceof ValidationError ? { code: error.code, message: error.message } : { code: 'DB_ERROR', message: MESSAGES.DB_ERROR };
    }
  };
}
let handler;
exports.main = async event => {
  if (!handler) {
    const cloud = require('wx-server-sdk');
    cloud.init({ env: ENV_ID });
    const getPosterCode = require('./poster-code').createPosterCode(options => cloud.openapi.wxacode.getUnlimited(options));
    const transport = createDocumentTransport(cloud.database({ env: ENV_ID, throwOnNotFound: false }), APP_ID);
    handler = createHandler({ getWXContext: () => cloud.getWXContext(), transport, getPosterCode });
  }
  return handler(event);
};
exports.createHandler = createHandler;
