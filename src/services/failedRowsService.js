const { getShardPool, SHARD_COUNT } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Failed rows don't have a reliable customer_id to shard on (that's often
 * *why* they failed), so we can't route them the normal way. Instead we
 * spread them round-robin across shards - any shard works equally well
 * since failed_order_rows is just an audit/debug table, not something
 * queried by customer_id.
 */
async function insertFailedRows(uploadId, failedRows) {
  if (failedRows.length === 0) return;

  const byShardId = Array.from({ length: SHARD_COUNT }, () => []);
  failedRows.forEach((f, i) => {
    byShardId[i % SHARD_COUNT].push(f);
  });

  for (let shardId = 0; shardId < SHARD_COUNT; shardId++) {
    const batch = byShardId[shardId];
    if (batch.length === 0) continue;

    const pool = getShardPool(shardId);
    const values = [];
    const placeholders = batch
      .map((f, i) => {
        const base = i * 3;
        values.push(uploadId, JSON.stringify(f.row), f.reason);
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      })
      .join(', ');

    try {
      await pool.query(
        `INSERT INTO failed_order_rows (upload_id, raw_row, error_reason) VALUES ${placeholders}`,
        values
      );
    } catch (err) {
      // Failed-row logging should never take down the main upload - log and move on.
      logger.error(`Could not persist failed rows to shard ${shardId}`, err);
    }
  }
}

module.exports = { insertFailedRows };
