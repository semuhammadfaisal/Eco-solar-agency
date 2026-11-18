'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('../utils/pagination');

test('paginate supports the numeric compatibility signature', async () => {
  const result = await paginate(42, 2, 10);
  assert.equal(result.page, 2);
  assert.equal(result.limit, 10);
  assert.equal(result.skip, 10);
  assert.equal(result.total, 42);
  assert.equal(result.totalPages, 5);
});

test('paginate supports Mongoose-style query pagination', async () => {
  const calls = { skip: null, limit: null, filter: null };
  const query = {
    model: {
      async countDocuments(filter) {
        calls.filter = filter;
        return 23;
      },
    },
    getFilter() {
      return { status: 'open' };
    },
    skip(value) {
      calls.skip = value;
      return this;
    },
    limit(value) {
      calls.limit = value;
      return this;
    },
    async exec() {
      return [{ id: 1 }];
    },
  };

  const [items, total, metadata] = await paginate(query, { page: 3, limit: 10 });
  assert.deepEqual(items, [{ id: 1 }]);
  assert.equal(total, 23);
  assert.deepEqual(calls.filter, { status: 'open' });
  assert.equal(calls.skip, 20);
  assert.equal(calls.limit, 10);
  assert.equal(metadata.page, 3);
});
