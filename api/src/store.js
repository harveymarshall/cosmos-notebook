// All database access lives here. It speaks DynamoDB's API through a single
// `send(operation, params)` function, so the exact same code runs against:
//   - real DynamoDB in AWS Lambda (see ../index.mjs), and
//   - the in-memory emulator in ./fake-dynamo.js for local development and tests.
//
// Single-table layout (PK / SK, plus two indexes):
//   USER#<sub>   PROFILE                profile
//   USER#<sub>   PROG#<itemId>          progress on a library item
//   USER#<sub>   OBS#<id>               observing log entry
//   POST#<id>    META                   published write-up   (GSI1: FEED / <publishedAt>#<id>)
//   POST#<id>    LIKE#<sub>             a like
//   POST#<id>    CMT#<createdAt>#<cid>  a comment
//   SUB#<id>     META                   library submission   (GSI1: SUBSTATUS#<status> / <createdAt>,
//                                                             GSI2: USER#<sub> / SUB#<createdAt>)

const strip = (item) => {
  if (!item) return item;
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, entity, ...rest } = item;
  return rest;
};

const encodeCursor = (key) => (key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null);
const decodeCursor = (cursor) => {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (key && typeof key === 'object' && !Array.isArray(key)) return key;
  } catch {}
  return undefined;
};

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class NotFound extends Error {}

export function createStore({ send, table }) {
  const T = table;

  async function queryAll(params, max = 1000) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await send('Query', { TableName: T, ...params, ExclusiveStartKey });
      items.push(...(res.Items || []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey && items.length < max);
    return items;
  }

  const userPrefix = (sub, prefix) =>
    queryAll({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': prefix },
    });

  const get = async (PK, SK) => (await send('Get', { TableName: T, Key: { PK, SK } })).Item;
  const put = (Item, extra = {}) => send('Put', { TableName: T, Item, ...extra });
  const del = (PK, SK) => send('Delete', { TableName: T, Key: { PK, SK } });

  return {
    // ---------- profiles ----------
    async getProfile(sub) {
      return strip(await get(`USER#${sub}`, 'PROFILE'));
    },
    async putProfile(sub, profile) {
      await put({ PK: `USER#${sub}`, SK: 'PROFILE', entity: 'profile', sub, ...profile });
    },

    // ---------- progress ----------
    async listProgress(sub) {
      return (await userPrefix(sub, 'PROG#')).map(strip);
    },
    async getProgress(sub, itemId) {
      return strip(await get(`USER#${sub}`, `PROG#${itemId}`));
    },
    async putProgress(sub, item) {
      await put({ PK: `USER#${sub}`, SK: `PROG#${item.itemId}`, entity: 'progress', ...item });
    },
    async deleteProgress(sub, itemId) {
      await del(`USER#${sub}`, `PROG#${itemId}`);
    },

    // ---------- journal entries (one per session, filed under a library item) ----------
    //   USER#<sub>   JRN#<itemId>#<entryId>
    async listEntries(sub, itemId) {
      return (await userPrefix(sub, `JRN#${itemId}#`))
        .map(strip)
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
    },
    async getEntry(sub, itemId, id) {
      return strip(await get(`USER#${sub}`, `JRN#${itemId}#${id}`));
    },
    async putEntry(sub, entry) {
      await put({ PK: `USER#${sub}`, SK: `JRN#${entry.itemId}#${entry.id}`, entity: 'journal', ...entry });
    },
    async deleteEntry(sub, itemId, id) {
      await del(`USER#${sub}`, `JRN#${itemId}#${id}`);
    },
    async deleteEntries(sub, itemId) {
      const items = await userPrefix(sub, `JRN#${itemId}#`);
      for (const group of chunk(items, 25)) {
        let request = { [T]: group.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })) };
        for (let attempt = 0; attempt < 5 && request && Object.keys(request).length; attempt++) {
          request = (await send('BatchWrite', { RequestItems: request })).UnprocessedItems;
        }
      }
      return items.length;
    },

    // ---------- observations ----------
    async listObservations(sub) {
      return (await userPrefix(sub, 'OBS#')).map(strip).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    },
    async getObservation(sub, id) {
      return strip(await get(`USER#${sub}`, `OBS#${id}`));
    },
    async putObservation(sub, obs) {
      await put({ PK: `USER#${sub}`, SK: `OBS#${obs.id}`, entity: 'observation', ...obs });
    },
    async deleteObservation(sub, id) {
      await del(`USER#${sub}`, `OBS#${id}`);
    },

    // ---------- community posts ----------
    async getPost(postId) {
      return strip(await get(`POST#${postId}`, 'META'));
    },

    /** Create the post, or update its content while keeping its likes, comments and original date. */
    async upsertPost(post) {
      const base = { PK: `POST#${post.postId}`, SK: 'META', entity: 'post' };
      try {
        await put(
          {
            ...base,
            ...post,
            likeCount: 0,
            commentCount: 0,
            GSI1PK: 'FEED',
            GSI1SK: `${post.publishedAt}#${post.postId}`,
          },
          { ConditionExpression: 'attribute_not_exists(PK)' }
        );
        return 'created';
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
      }
      const fields = ['title', 'body', 'status', 'authorName', 'updatedAt', 'meta'];
      await send('Update', {
        TableName: T,
        Key: { PK: base.PK, SK: 'META' },
        UpdateExpression: `SET ${fields.map((f, i) => `#f${i} = :v${i}`).join(', ')}`,
        ExpressionAttributeNames: Object.fromEntries(fields.map((f, i) => [`#f${i}`, f])),
        ExpressionAttributeValues: Object.fromEntries(fields.map((f, i) => [`:v${i}`, post[f] ?? null])),
        ConditionExpression: 'attribute_exists(PK)',
      });
      return 'updated';
    },

    /** Removes a post with all of its likes and comments. */
    async deletePost(postId) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `POST#${postId}` },
      });
      for (const group of chunk(items, 25)) {
        let request = {
          [T]: group.map((i) => ({ DeleteRequest: { Key: { PK: i.PK, SK: i.SK } } })),
        };
        for (let attempt = 0; attempt < 5 && request && Object.keys(request).length; attempt++) {
          const res = await send('BatchWrite', { RequestItems: request });
          request = res.UnprocessedItems;
        }
      }
      return items.length > 0;
    },

    async listFeed({ limit = 20, cursor } = {}) {
      const res = await send('Query', {
        TableName: T,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'FEED' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      });
      return { posts: (res.Items || []).map(strip), cursor: encodeCursor(res.LastEvaluatedKey) };
    },

    // ---------- likes ----------
    /** Returns true if the like was added, false if it already existed. */
    async like(postId, sub, at) {
      try {
        await send('TransactWrite', {
          TransactItems: [
            {
              Put: {
                TableName: T,
                Item: { PK: `POST#${postId}`, SK: `LIKE#${sub}`, entity: 'like', sub, at },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Update: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: 'META' },
                UpdateExpression: 'ADD likeCount :one',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':one': 1 },
              },
            },
          ],
        });
        return true;
      } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        const reasons = err.CancellationReasons || [];
        if (reasons[1]?.Code === 'ConditionalCheckFailed') throw new NotFound('post');
        return false;
      }
    },

    async unlike(postId, sub) {
      try {
        await send('TransactWrite', {
          TransactItems: [
            {
              Delete: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: `LIKE#${sub}` },
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
            {
              Update: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: 'META' },
                UpdateExpression: 'ADD likeCount :minus',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':minus': -1 },
              },
            },
          ],
        });
        return true;
      } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        return false;
      }
    },

    /** Which of these posts has this person liked? */
    async likedBy(sub, postIds) {
      const liked = new Set();
      for (const group of chunk([...new Set(postIds)], 100)) {
        let keys = group.map((id) => ({ PK: `POST#${id}`, SK: `LIKE#${sub}` }));
        for (let attempt = 0; attempt < 5 && keys && keys.length; attempt++) {
          const res = await send('BatchGet', { RequestItems: { [T]: { Keys: keys } } });
          for (const item of res.Responses?.[T] || []) liked.add(item.PK.slice(5));
          keys = res.UnprocessedKeys?.[T]?.Keys;
        }
      }
      return [...liked];
    },

    // ---------- comments ----------
    async listComments(postId) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `POST#${postId}`, ':sk': 'CMT#' },
      });
      return items.map((i) => ({ ...strip(i), commentId: i.SK.slice(4) }));
    },

    async addComment(postId, comment) {
      const commentId = `${comment.createdAt.replace(/\D/g, '')}-${comment.id}`; // sortable, URL-safe
      try {
        await send('TransactWrite', {
          TransactItems: [
            { Put: { TableName: T, Item: { PK: `POST#${postId}`, SK: `CMT#${commentId}`, entity: 'comment', ...comment } } },
            {
              Update: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: 'META' },
                UpdateExpression: 'ADD commentCount :one',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':one': 1 },
              },
            },
          ],
        });
      } catch (err) {
        if (err.name === 'TransactionCanceledException') throw new NotFound('post');
        throw err;
      }
      return { ...comment, commentId };
    },

    async getComment(postId, commentId) {
      const item = await get(`POST#${postId}`, `CMT#${commentId}`);
      return item ? { ...strip(item), commentId } : undefined;
    },

    async deleteComment(postId, commentId) {
      try {
        await send('TransactWrite', {
          TransactItems: [
            {
              Delete: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: `CMT#${commentId}` },
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
            {
              Update: {
                TableName: T,
                Key: { PK: `POST#${postId}`, SK: 'META' },
                UpdateExpression: 'ADD commentCount :minus',
                ConditionExpression: 'attribute_exists(PK)',
                ExpressionAttributeValues: { ':minus': -1 },
              },
            },
          ],
        });
        return true;
      } catch (err) {
        if (err.name === 'TransactionCanceledException') return false;
        throw err;
      }
    },

    // ---------- library submissions ----------
    async putSubmission(s) {
      await put({
        PK: `SUB#${s.id}`,
        SK: 'META',
        entity: 'submission',
        ...s,
        GSI1PK: `SUBSTATUS#${s.status}`,
        GSI1SK: s.createdAt,
        GSI2PK: `USER#${s.authorSub}`,
        GSI2SK: `SUB#${s.createdAt}`,
      });
    },
    async getSubmission(id) {
      return strip(await get(`SUB#${id}`, 'META'));
    },
    async listSubmissionsByStatus(status, { newestFirst = false, max = 500 } = {}) {
      return (
        await queryAll(
          {
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: { ':pk': `SUBSTATUS#${status}` },
            ScanIndexForward: !newestFirst,
          },
          max
        )
      ).map(strip);
    },
    async listSubmissionsByUser(sub) {
      return (
        await queryAll({
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
          ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'SUB#' },
          ScanIndexForward: false,
        })
      ).map(strip);
    },
  };
}
