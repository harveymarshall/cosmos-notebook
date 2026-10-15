// A tiny in-memory stand-in for DynamoDB's document API, used for local development
// and tests. It understands exactly the operations and expressions used by store.js —
// key conditions with "=" and begins_with, conditions with attribute_(not_)exists,
// "SET #a = :a, …" and "ADD x :n" updates, transactions, batches and paging — and it
// mimics DynamoDB's error names so store.js handles failures the same way.
//
// Pass `file` to keep the data between restarts (handy for `npm run dev`).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const INDEXES = { GSI1: ['GSI1PK', 'GSI1SK'], GSI2: ['GSI2PK', 'GSI2SK'] };

const err = (name, extra = {}) => Object.assign(new Error(name), { name, ...extra });
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const keyOf = (k) => `${k.PK}\u0001${k.SK}`;

function checkCondition(expr, existing) {
  if (!expr) return true;
  const e = expr.trim();
  if (e === 'attribute_not_exists(PK)') return !existing;
  if (e === 'attribute_exists(PK)') return !!existing;
  throw err('ValidationException', { message: `fake-dynamo: unsupported condition ${expr}` });
}

function parseKeyCondition(expr, values) {
  // "<HK> = :pk" or "<HK> = :pk AND begins_with(<RK>, :sk)"
  const m = expr.match(/^\s*(\w+)\s*=\s*(:\w+)\s*(?:AND\s+begins_with\(\s*(\w+)\s*,\s*(:\w+)\s*\))?\s*$/);
  if (!m) throw err('ValidationException', { message: `fake-dynamo: unsupported key condition ${expr}` });
  return { hashName: m[1], hashValue: values[m[2]], rangeName: m[3], prefix: m[3] ? values[m[4]] : undefined };
}

function applyUpdate(item, expr, names = {}, values = {}) {
  const set = expr.match(/^\s*SET\s+(.+)$/);
  if (set) {
    for (const part of set[1].split(',')) {
      const m = part.trim().match(/^(#?\w+)\s*=\s*(:\w+)$/);
      if (!m) throw err('ValidationException', { message: `fake-dynamo: unsupported SET ${part}` });
      const name = m[1].startsWith('#') ? names[m[1]] : m[1];
      item[name] = clone(values[m[2]]);
    }
    return item;
  }
  const add = expr.match(/^\s*ADD\s+(#?\w+)\s+(:\w+)\s*$/);
  if (add) {
    const name = add[1].startsWith('#') ? names[add[1]] : add[1];
    item[name] = (Number(item[name]) || 0) + Number(values[add[2]]);
    return item;
  }
  throw err('ValidationException', { message: `fake-dynamo: unsupported update ${expr}` });
}

export function createFakeDynamo({ file } = {}) {
  const tables = new Map(); // table -> Map(key -> item)

  if (file && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const [t, items] of Object.entries(saved)) tables.set(t, new Map(items.map((i) => [keyOf(i), i])));
  }
  const persist = () => {
    if (!file) return;
    const out = {};
    for (const [t, m] of tables) out[t] = [...m.values()];
    writeFileSync(file, JSON.stringify(out));
  };
  const tbl = (name) => {
    if (!name) throw err('ValidationException', { message: 'TableName required' });
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  const ops = {
    Get({ TableName, Key }) {
      return { Item: clone(tbl(TableName).get(keyOf(Key))) };
    },

    Put({ TableName, Item, ConditionExpression }) {
      if (!Item?.PK || !Item?.SK) throw err('ValidationException', { message: 'PK and SK required' });
      const t = tbl(TableName);
      if (!checkCondition(ConditionExpression, t.get(keyOf(Item)))) throw err('ConditionalCheckFailedException');
      t.set(keyOf(Item), clone(Item));
      return {};
    },

    Delete({ TableName, Key, ConditionExpression }) {
      const t = tbl(TableName);
      if (!checkCondition(ConditionExpression, t.get(keyOf(Key)))) throw err('ConditionalCheckFailedException');
      t.delete(keyOf(Key));
      return {};
    },

    Update({ TableName, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
      const t = tbl(TableName);
      const existing = t.get(keyOf(Key));
      if (!checkCondition(ConditionExpression, existing)) throw err('ConditionalCheckFailedException');
      const item = existing ? clone(existing) : { ...Key };
      t.set(keyOf(Key), applyUpdate(item, UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues));
      return {};
    },

    Query({ TableName, IndexName, KeyConditionExpression, ExpressionAttributeValues, ScanIndexForward = true, Limit, ExclusiveStartKey }) {
      const [hk, rk] = IndexName ? INDEXES[IndexName] || [] : ['PK', 'SK'];
      if (!hk) throw err('ValidationException', { message: `Unknown index ${IndexName}` });
      const kc = parseKeyCondition(KeyConditionExpression, ExpressionAttributeValues || {});
      if (kc.hashName !== hk || (kc.rangeName && kc.rangeName !== rk)) {
        throw err('ValidationException', { message: 'Key condition does not match the key schema' });
      }
      let items = [...tbl(TableName).values()].filter(
        (i) => i[hk] === kc.hashValue && i[rk] !== undefined && (!kc.prefix || String(i[rk]).startsWith(kc.prefix))
      );
      // DynamoDB sorts by range key, then (for indexes) by table key for ties
      items.sort((a, b) => String(a[rk]).localeCompare(String(b[rk])) || keyOf(a).localeCompare(keyOf(b)));
      if (!ScanIndexForward) items.reverse();

      if (ExclusiveStartKey) {
        if (typeof ExclusiveStartKey.PK !== 'string' || typeof ExclusiveStartKey.SK !== 'string') {
          throw err('ValidationException', { message: 'The provided starting key is invalid' });
        }
        const idx = items.findIndex((i) => keyOf(i) === keyOf(ExclusiveStartKey));
        items = idx === -1 ? [] : items.slice(idx + 1);
      }
      let LastEvaluatedKey;
      if (Limit && items.length > Limit) {
        items = items.slice(0, Limit);
        const last = items[items.length - 1];
        LastEvaluatedKey = { PK: last.PK, SK: last.SK };
        if (IndexName) Object.assign(LastEvaluatedKey, { [hk]: last[hk], [rk]: last[rk] });
      }
      return { Items: clone(items), LastEvaluatedKey };
    },

    TransactWrite({ TransactItems }) {
      if (!Array.isArray(TransactItems) || TransactItems.length > 100) throw err('ValidationException');
      // Check every condition first; only write if all pass (all-or-nothing)
      const reasons = TransactItems.map((op) => {
        const [kind, p] = Object.entries(op)[0];
        const key = p.Key || { PK: p.Item.PK, SK: p.Item.SK };
        const ok = checkCondition(p.ConditionExpression, tbl(p.TableName).get(keyOf(key)));
        return { Code: ok ? 'None' : 'ConditionalCheckFailed', kind };
      });
      if (reasons.some((r) => r.Code !== 'None')) {
        throw err('TransactionCanceledException', { CancellationReasons: reasons.map(({ Code }) => ({ Code })) });
      }
      for (const op of TransactItems) {
        const [kind, p] = Object.entries(op)[0];
        if (kind === 'Put') ops.Put({ ...p, ConditionExpression: undefined });
        else if (kind === 'Delete') ops.Delete({ ...p, ConditionExpression: undefined });
        else if (kind === 'Update') ops.Update({ ...p, ConditionExpression: undefined });
        else throw err('ValidationException', { message: `fake-dynamo: unsupported transact op ${kind}` });
      }
      return {};
    },

    BatchWrite({ RequestItems }) {
      for (const [TableName, reqs] of Object.entries(RequestItems)) {
        if (reqs.length > 25) throw err('ValidationException', { message: 'Too many items in batch write' });
        for (const r of reqs) {
          if (r.DeleteRequest) ops.Delete({ TableName, Key: r.DeleteRequest.Key });
          else if (r.PutRequest) ops.Put({ TableName, Item: r.PutRequest.Item });
        }
      }
      return { UnprocessedItems: {} };
    },

    BatchGet({ RequestItems }) {
      const Responses = {};
      for (const [TableName, { Keys }] of Object.entries(RequestItems)) {
        if (Keys.length > 100) throw err('ValidationException', { message: 'Too many keys in batch get' });
        Responses[TableName] = Keys.map((k) => clone(tbl(TableName).get(keyOf(k)))).filter(Boolean);
      }
      return { Responses, UnprocessedKeys: {} };
    },
  };

  const send = async (op, params) => {
    if (!ops[op]) throw err('ValidationException', { message: `fake-dynamo: unsupported operation ${op}` });
    const result = ops[op](clone(params));
    if (op !== 'Get' && op !== 'Query' && op !== 'BatchGet') persist();
    return result;
  };
  send.dump = () => Object.fromEntries([...tables].map(([t, m]) => [t, [...m.values()]]));
  return send;
}
