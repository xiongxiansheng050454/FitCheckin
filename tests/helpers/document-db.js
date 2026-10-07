const clone = value => JSON.parse(JSON.stringify(value));

// Models optimistic commits, including reads of absent documents and atomic rollback.
function createDatabase() {
  let rows = new Map(), versions = new Map();
  const db = {
    failReceipt: false,
    command: { gt: value => ({ greaterThan: value }) },
    collection(name) {
      return { where(filter) {
        let field, size = 100;
        const query = {
          orderBy(key, direction) { if (direction !== 'asc') throw new Error('Unexpected order'); field = key; return query; },
          limit(value) { size = value; return query; },
          async get() {
            return { data: [...rows.entries()].filter(([key, row]) => key.startsWith(name + ':') && Object.entries(filter).every(([key, value]) => typeof value === 'object' ? row[key] > value.greaterThan : row[key] === value)).map(([, row]) => clone(row)).sort((a, b) => a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0).slice(0, size) };
          }
        }; return query;
      } };
    },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const snapshot = new Map(rows), versionSnapshot = new Map(versions), seen = new Map(), writes = new Map();
        const transaction = { collection(name) { return { doc(id) {
          const key = name + ':' + id;
          return {
            async get() { seen.set(key, versionSnapshot.get(key) || 0); const value = snapshot.get(key); return { data: value ? clone(value) : null }; },
            async set({ data }) { if (db.failReceipt && name === 'fitcheckin_operations') throw new Error('receipt unavailable'); writes.set(key, clone(data)); }
          };
        } }; } };
        const result = await callback(transaction);
        if ([...seen].some(([key, version]) => (versions.get(key) || 0) !== version)) continue;
        for (const [key, row] of writes) { rows.set(key, row); versions.set(key, (versions.get(key) || 0) + 1); }
        return result;
      }
      throw new Error('Transaction conflict');
    },
    rows: () => [...rows.values()].map(clone)
  };
  return db;
}
module.exports = { createDatabase };
