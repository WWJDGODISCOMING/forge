// In-memory stand-in for the parts of the firebase-admin Firestore API the functions use:
// db.doc(path).get/set/update/delete, db.collection(path).get/where/limit/count, db.getAll, db.batch,
// db.runTransaction (tx.get/getAll/set/update/delete; optimistic, retried on conflict like Firestore).
// Also counts writes so tests can prove "no write when nothing changed".

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function snapshot(path, data) {
  const id = path.split('/').pop();
  return { id, exists: data !== undefined, ref: { path, id }, data: () => clone(data) };
}

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Like Firestore set(..., { merge: true }): maps merge deeply; other values replace. */
function merge(target, src) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(src)) {
    if (isMap(v) && isMap(out[k])) out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}
/** Like set(..., { mergeFields }): the listed top-level fields are replaced whole; others untouched. */
function mergeFields(target, src, fields) {
  const out = { ...(target || {}) };
  for (const f of fields) out[f] = src[f];
  return out;
}
/** update(): top-level fields replaced whole (dotted paths aren't used by the functions). */
function shallow(target, src) {
  return { ...(target || {}), ...src };
}

export function fakeDb() {
  const docs = new Map();
  const versions = new Map();
  const stats = { writes: 0, reads: 0 };
  let failNextCommits = 0;

  const write = (path, data) => {
    stats.writes++;
    versions.set(path, (versions.get(path) || 0) + 1);
    if (data === undefined) docs.delete(path);
    else docs.set(path, clone(data));
  };
  const applyOp = (op) => {
    if (op.kind === 'set') {
      const o = op.opts || {};
      write(op.path, o.mergeFields ? mergeFields(docs.get(op.path), op.data, o.mergeFields) : o.merge ? merge(docs.get(op.path), op.data) : op.data);
    } else if (op.kind === 'update') {
      if (!docs.has(op.path)) throw Object.assign(new Error(`NOT_FOUND ${op.path}`), { code: 5 });
      write(op.path, shallow(docs.get(op.path), op.data));
    } else if (op.kind === 'delete') write(op.path, undefined);
  };

  const ref = (path) => ({
    path,
    id: path.split('/').pop(),
    async get() { stats.reads++; return snapshot(path, docs.get(path)); },
    async set(data, opts) { applyOp({ kind: 'set', path, data, opts }); },
    async update(data) { applyOp({ kind: 'update', path, data }); },
    async delete() { applyOp({ kind: 'delete', path }); },
  });

  const query = (colPath, filters = [], lim = null) => ({
    where(field, op, value) { return query(colPath, [...filters, [field, op, value]], lim); },
    limit(n) { return query(colPath, filters, n); },
    select() { return query(colPath, filters, lim); }, // field masks don't matter in memory
    async get() {
      const depth = colPath.split('/').length + 1;
      let rows = [...docs.entries()]
        .filter(([p]) => p.startsWith(`${colPath}/`) && p.split('/').length === depth)
        .filter(([, d]) => filters.every(([f, op, v]) => {
          const x = d[f];
          return op === '==' ? x === v : op === '>=' ? x >= v : op === '<=' ? x <= v : op === '>' ? x > v : op === '<' ? x < v : false;
        }));
      if (lim != null) rows = rows.slice(0, lim);
      stats.reads += rows.length;
      const list = rows.map(([p, d]) => snapshot(p, d));
      return { docs: list, size: list.length, empty: list.length === 0 };
    },
    count() { const q = this; return { async get() { const s = await q.get(); return { data: () => ({ count: s.size }) }; } }; },
  });

  const db = {
    stats,
    docs,
    dump: (path) => clone(docs.get(path)),
    put: (path, data) => docs.set(path, clone(data)),
    failCommits: (n) => { failNextCommits = n; },
    doc: ref,
    collection: (path) => ({ ...query(path), doc: (id) => ref(`${path}/${id}`) }),
    async getAll(...refs) { return refs.map((r) => { stats.reads++; return snapshot(r.path, docs.get(r.path)); }); },
    batch() {
      const ops = [];
      return {
        set(r, data, opts) { ops.push({ kind: 'set', path: r.path, data, opts }); return this; },
        update(r, data) { ops.push({ kind: 'update', path: r.path, data }); return this; },
        delete(r) { ops.push({ kind: 'delete', path: r.path }); return this; },
        async commit() {
          if (failNextCommits > 0) { failNextCommits--; throw Object.assign(new Error('UNAVAILABLE'), { code: 14 }); }
          ops.forEach(applyOp);
        },
      };
    },
    async runTransaction(fn, { maxAttempts = 5 } = {}) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const seen = new Map();
        const ops = [];
        const tx = {
          async get(r) { stats.reads++; seen.set(r.path, versions.get(r.path) || 0); return snapshot(r.path, docs.get(r.path)); },
          async getAll(...refs) { return Promise.all(refs.map((r) => tx.get(r))); },
          set(r, data, opts) { ops.push({ kind: 'set', path: r.path, data, opts }); return tx; },
          update(r, data) { ops.push({ kind: 'update', path: r.path, data }); return tx; },
          delete(r) { ops.push({ kind: 'delete', path: r.path }); return tx; },
        };
        const result = await fn(tx);
        if (failNextCommits > 0) { failNextCommits--; throw Object.assign(new Error('UNAVAILABLE'), { code: 14 }); }
        const conflict = [...seen].some(([p, v]) => (versions.get(p) || 0) !== v);
        if (conflict) continue;
        ops.forEach(applyOp);
        return result;
      }
      throw Object.assign(new Error('ABORTED'), { code: 10 });
    },
  };
  return db;
}

/** A Withings API double: scripted responses per method, records calls. */
export function fakeApi(script = {}) {
  const calls = [];
  const api = {};
  for (const name of ['requestToken', 'refreshToken', 'getmeas', 'getdevice', 'getactivity', 'notifySubscribe', 'notifyList', 'notifyRevoke']) {
    api[name] = async (...args) => {
      calls.push([name, ...args]);
      const s = script[name];
      if (typeof s === 'function') return s(...args);
      if (s instanceof Error) throw s;
      return s === undefined ? {} : JSON.parse(JSON.stringify(s));
    };
  }
  api.authorizeUrl = ({ state }) => `https://account.withings.com/oauth2_user/authorize2?state=${state}`;
  api.calls = calls;
  return api;
}

/** A task queue double that records enqueues and rejects duplicate ids like Cloud Tasks does. */
export function fakeQueue() {
  const tasks = [];
  const ids = new Set();
  return {
    tasks,
    async enqueue(data, { id } = {}) {
      if (id && ids.has(id)) throw Object.assign(new Error('Task already exists'), { code: 'functions/task-already-exists' });
      if (id) ids.add(id);
      tasks.push({ data, id });
    },
    take() { return tasks.shift(); },
  };
}
