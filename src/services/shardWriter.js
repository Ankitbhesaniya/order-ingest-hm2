const { getShardPool } = require('../config/db');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err) {
  // Connection-level / deadlock / lock-timeout errors are worth retrying -
  // they're likely to succeed on a second attempt. Constraint violations,
  // bad data types, etc. are NOT retried since they'd fail identically
  // every time.
  const transientCodes = ['ECONNRESET', 'ETIMEDOUT', '40P01', '57P03', '08006', '08003'];
  return transientCodes.includes(err.code);
}

/**
 * Inserts a batch of orders into a single shard inside one transaction.
 * Uses a multi-row INSERT (not one-by-one inserts) for speed.
 * ON CONFLICT on order_id makes re-running the same file idempotent -
 * re-uploading a file won't create duplicate rows.
 */
async function insertBatch(shardId, orders) {
  if (orders.length === 0) return;

  const pool = getShardPool(shardId);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const values = [];
    const placeholders = orders
      .map((o, i) => {
        const base = i * 5;
        values.push(o.order_id, o.customer_id, o.order_date, o.order_amount, o.status);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(', ');

    const query = `
      INSERT INTO orders (order_id, customer_id, order_date, order_amount, status)
      VALUES ${placeholders}
      ON CONFLICT (order_id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        order_date = EXCLUDED.order_date,
        order_amount = EXCLUDED.order_amount,
        status = EXCLUDED.status
    `;

    await client.query(query, values);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Batch insert failed on shard ${shardId}, transaction rolled back`, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Wraps insertBatch with retry + exponential backoff, but only for
 * transient/connection-level errors. This is what the rest of the app
 * should call.
 */
async function insertBatchWithRetry(shardId, orders) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await insertBatch(shardId, orders);
    } catch (err) {
      attempt++;
      if (!isTransientError(err) || attempt >= MAX_RETRIES) {
        throw err;
      }
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        `Retrying batch insert on shard ${shardId} (attempt ${attempt}/${MAX_RETRIES}) after ${delay}ms`,
        { error: err.message }
      );
      await sleep(delay);
    }
  }
}

module.exports = { insertBatch, insertBatchWithRetry };
