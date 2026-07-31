const { Pool } = require('pg');
const logger = require('../utils/logger');

const SHARD_COUNT = parseInt(process.env.SHARD_COUNT || '4', 10);

// One pg Pool per shard. Index in this array === shard id.
const pools = [];

for (let i = 0; i < SHARD_COUNT; i++) {
  const connectionString = process.env[`SHARD_${i}_URL`];

  if (!connectionString) {
    throw new Error(`Missing env var SHARD_${i}_URL for configured SHARD_COUNT=${SHARD_COUNT}`);
  }

  pools.push(
    new Pool({
      connectionString,
      max: 10, // max connections per shard pool
      idleTimeoutMillis: 30000,
    })
  );

  pools[i].on('error', (err) => {
    logger.error(`Unexpected error on idle client for shard ${i}`, err);
  });
}

function getShardPool(shardId) {
  const pool = pools[shardId];
  if (!pool) {
    throw new Error(`No pool found for shard id ${shardId}`);
  }
  return pool;
}

async function healthCheck() {
  const results = [];
  for (let i = 0; i < pools.length; i++) {
    try {
      await pools[i].query('SELECT 1');
      results.push({ shard: i, status: 'ok' });
    } catch (err) {
      results.push({ shard: i, status: 'error', message: err.message });
    }
  }
  return results;
}

async function closeAll() {
  await Promise.all(pools.map((p) => p.end()));
}

module.exports = {
  SHARD_COUNT,
  getShardPool,
  healthCheck,
  closeAll,
};
