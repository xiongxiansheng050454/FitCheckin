const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createDocumentTransport } = require('../cloudfunctions/fitcheckin/document-store');
const localRequire = createRequire(require.resolve('../cloudfunctions/fitcheckin'));
let cloud;
try { cloud = localRequire('wx-server-sdk'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('installed wx-server-sdk serializes real document reads, transactions and scoped pagination correctly', { skip: !cloud }, async t => {
  const { Db } = localRequire('@cloudbase/database');
  const { EJSON } = localRequire('bson');
  cloud.init({ env: 'weixing2-d7g2j6asyc5132905' });
  const db = cloud.database({ env: 'weixing2-d7g2j6asyc5132905', throwOnNotFound: false });
  const original = Db.reqClass, rows = new Map(), transactions = new Map(), actions = [];
  t.after(() => { Db.reqClass = original; });
  const decode = value => typeof value === 'string' ? EJSON.parse(value) : value;
  Db.reqClass = class {
    async send(action, params = {}) {
      actions.push(action);
      if (action === 'database.startTransaction') {
        const transactionId = 'tx-' + actions.length;
        transactions.set(transactionId, new Map(rows));
        return { transactionId };
      }
      if (action === 'database.commitTransaction') {
        rows.clear(); for (const entry of transactions.get(params.transactionId)) rows.set(...entry);
        transactions.delete(params.transactionId); return {};
      }
      if (action === 'database.abortTransaction') { transactions.delete(params.transactionId); return {}; }
      const target = params.transactionId ? transactions.get(params.transactionId) : rows;
      const filter = decode(params.query);
      if (action === 'database.modifyDocument') {
        const key = params.collectionName + ':' + filter._id;
        target.set(key, { ...decode(params.data), _id: filter._id });
        return { data: { updated: 1, upsert_id: filter._id } };
      }
      assert.equal(action, 'database.getDocument');
      if (filter._id) {
        const row = target.get(params.collectionName + ':' + filter._id);
        return { data: { list: row ? [EJSON.stringify(row)] : [] } };
      }
      assert.equal(filter.appId, 'wxe25930a2cdce35d0');
      assert.equal(filter.ownerId, 'sdk-owner');
      assert.ok(filter.sortKey.$gt !== undefined);
      assert.deepEqual(decode(params.order), { sortKey: 1 });
      const data = [...target.entries()].filter(([key, row]) => key.startsWith(params.collectionName + ':') && row.appId === filter.appId && row.ownerId === filter.ownerId && row.sortKey > filter.sortKey.$gt).map(([, row]) => row).sort((a, b) => a.sortKey < b.sortKey ? -1 : 1).slice(0, params.limit);
      return { data: { list: data.map(row => EJSON.stringify(row)) } };
    }
  };
  const transport = createDocumentTransport(db, 'wxe25930a2cdce35d0');
  const args = { p_owner: 'sdk-owner', p_operation: { operationId: 'sdk-operation', kind: 'profile', id: 'profile', body: { id: 'profile', bodyWeight: 70, activeTemplateId: null }, deleted: false, baseRevision: 0, occurredAt: '2026-10-04T03:00:00Z' } };
  const saved = await transport('fitcheckin_mutate', args);
  assert.equal(saved.code, 0); assert.equal(saved.entity.revision, 1);
  assert.deepEqual(await transport('fitcheckin_mutate', args), saved);
  const page = await transport('fitcheckin_pull', { p_owner: 'sdk-owner', p_after_kind: '', p_after_id: '', p_limit: 100 });
  assert.deepEqual(page.entities, [saved.entity]); assert.equal(page.cursor, null);
  assert.ok(actions.includes('database.commitTransaction'));
  assert.equal(rows.size, 2);
});
