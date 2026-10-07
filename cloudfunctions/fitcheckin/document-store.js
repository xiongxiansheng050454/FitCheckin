'use strict';
const { createHash } = require('node:crypto');
const { validateOperation, validateProgramTransition } = require('./validation');
const ENTITIES = 'fitcheckin_entities';
const OPERATIONS = 'fitcheckin_operations';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const documentId = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const envelope = row => row ? { kind: row.kind, id: row.id, body: row.body, revision: row.revision, deleted: row.deleted } : null;
const snapshot = body => { const copy = { ...body }; delete copy.completed; delete copy.completedSets; return copy; };
function canUpdatePlan(before, after) {
  const metadata = body => { const value = snapshot(body); delete value.items; delete value.bodyWeight; return value; };
  if (!equal(metadata(before), metadata(after))) return false;
  if (before.bodyWeight !== after.bodyWeight && before.bodyWeight !== null) return false;
  const count = (body, item) => body.completedSets ? body.completedSets[item.entryId] || 0 : body.completed.includes(item.entryId) ? item.sets : 0;
  for (const old of before.items) {
    if (!count(before, old)) continue;
    const next = after.items.find(item => item.entryId === old.entryId);
    if (!next || !equal(old, next) || count(before, old) !== count(after, next)) return false;
  }
  return after.items.every(next => { const old = before.items.find(item => item.entryId === next.entryId); return count(after, next) === (old ? count(before, old) : 0); });
}

function createDocumentTransport(db, appId) {
  function checkScope(row, owner) {
    if (row && (row.appId !== appId || row.ownerId !== owner)) throw new Error('Invalid document scope');
    return row;
  }
  async function mutate(owner, operation) {
    validateOperation(operation);
    const entityId = documentId([appId, owner, operation.kind, operation.id]);
    const receiptId = documentId([appId, owner, operation.operationId]);
    return db.runTransaction(async transaction => {
      const receiptRef = transaction.collection(OPERATIONS).doc(receiptId);
      const receipt = checkScope((await receiptRef.get()).data, owner);
      if (receipt) {
        return equal(receipt.payload, operation) ? receipt.result : { code: 'OPERATION_REUSED' };
      }
      const entityRef = transaction.collection(ENTITIES).doc(entityId);
      const current = checkScope((await entityRef.get()).data, owner);
      if (current && (current.kind !== operation.kind || current.id !== operation.id)) throw new Error('Invalid entity identity');
      let result;
      if (operation.baseRevision !== (current ? current.revision : 0)) result = { code: 'CONFLICT', entity: envelope(current) };
      else if (operation.kind === 'record' && (operation.updatePlan ? !current || !canUpdatePlan(current.body, operation.body) : current && !equal(snapshot(current.body), snapshot(operation.body)))) result = { code: 'IMMUTABLE_RECORD' };
      else {
        if (operation.kind === 'program') validateProgramTransition(current && current.body, operation.body, operation.occurredAt);
        const entity = { kind: operation.kind, id: operation.id, body: operation.deleted ? null : operation.body, revision: operation.baseRevision + 1, deleted: operation.deleted };
        await entityRef.set({ data: { ...entity, appId, ownerId: owner, sortKey: operation.kind + ':' + operation.id } });
        result = { code: 0, entity };
      }
      await receiptRef.set({ data: { appId, ownerId: owner, payload: operation, result } });
      return result;
    });
  }
  async function pull(owner, args) {
    if (!Number.isInteger(args.p_limit) || args.p_limit < 1 || args.p_limit > 100) throw new Error('Invalid page size');
    const after = args.p_after_kind ? args.p_after_kind + ':' + args.p_after_id : '';
    const response = await db.collection(ENTITIES).where({ appId, ownerId: owner, sortKey: db.command.gt(after) }).orderBy('sortKey', 'asc').limit(args.p_limit).get();
    if (!Array.isArray(response.data)) throw new Error('Invalid document response');
    const entities = response.data.map(row => envelope(checkScope(row, owner)));
    const last = entities[entities.length - 1];
    return { entities, cursor: entities.length === args.p_limit ? { kind: last.kind, id: last.id } : null };
  }
  return async (action, args) => {
    const owner = args.p_owner;
    if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid owner');
    if (action === 'fitcheckin_mutate') return mutate(owner, args.p_operation);
    if (action === 'fitcheckin_pull') return pull(owner, args);
    throw new Error('Unknown document operation');
  };
}
module.exports = { createDocumentTransport };
