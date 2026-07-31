// Applies the schema in migrations/001_create_orders.sql to every
// configured shard. Run with: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { SHARD_COUNT, getShardPool, closeAll } = require('../config/db');
const logger = require('../utils/logger');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_create_orders.sql'), 'utf8');

  for (let shardId = 0; shardId < SHARD_COUNT; shardId++) {
    const pool = getShardPool(shardId);
    logger.info(`Applying migration to shard ${shardId}...`);
    await pool.query(sql);
    logger.info(`Shard ${shardId} migrated successfully.`);
  }

  await closeAll();
  logger.info('All shards migrated.');
}

run().catch((err) => {
  logger.error('Migration failed', err);
  process.exit(1);
});
