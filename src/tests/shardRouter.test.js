const { test } = require('node:test');
const assert = require('node:assert/strict');

// shardRouter -> config/db creates a pg Pool per shard at require time,
// which needs SHARD_*_URL env vars present (it doesn't actually connect
// until a query runs, so dummy values are fine for this unit test).
process.env.SHARD_COUNT = '4';
process.env.SHARD_0_URL = 'postgres://user:pass@localhost:5432/shard0';
process.env.SHARD_1_URL = 'postgres://user:pass@localhost:5432/shard1';
process.env.SHARD_2_URL = 'postgres://user:pass@localhost:5432/shard2';
process.env.SHARD_3_URL = 'postgres://user:pass@localhost:5432/shard3';

const { getShardIdForCustomer } = require('../services/shardRouter');

test('returns a shard id within [0, SHARD_COUNT)', () => {
  for (const customerId of ['CUST-1', 'CUST-2', 'abc', '12345', '']) {
    const shardId = getShardIdForCustomer(customerId);
    assert.ok(shardId >= 0 && shardId < 4);
  }
});

test('same customer_id always maps to the same shard (deterministic)', () => {
  const first = getShardIdForCustomer('CUST-999');
  const second = getShardIdForCustomer('CUST-999');
  assert.equal(first, second);
});

test('different customer_ids can map to different shards (spreads load)', () => {
  const shards = new Set();
  for (let i = 0; i < 100; i++) {
    shards.add(getShardIdForCustomer(`CUST-${i}`));
  }
  // With 100 customers across 4 shards, we should see more than one
  // shard used - this is a sanity check on distribution, not a strict
  // uniformity test.
  assert.ok(shards.size > 1);
});
