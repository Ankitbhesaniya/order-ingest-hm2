const crypto = require('crypto');
const { SHARD_COUNT } = require('../config/db');

/**
 * Sharding strategy: hash(customer_id) % SHARD_COUNT
 *
 * Why customer_id and not order_id?
 * - Most real-world queries for this system are "get orders for a customer".
 *   Hashing on customer_id guarantees ALL of a customer's orders live on the
 *   SAME shard, so those queries never need to fan out across shards.
 * - order_id hashing would spread a customer's orders randomly across every
 *   shard, making "get orders for customer X" an expensive scatter-gather.
 *
 * Why a hash and not a range (e.g. time-based)?
 * - A hash distributes customers roughly evenly across shards, avoiding the
 *   "hot shard" problem you get with time-based sharding (all of today's
 *   writes hit one shard).
 *
 * We use MD5 purely as a fast, well-distributed hash function here -
 * not for anything security-related.
 */
function getShardIdForCustomer(customerId) {
  const hash = crypto.createHash('md5').update(String(customerId)).digest('hex');
  // Take the first 8 hex chars as a 32-bit int, then mod by shard count.
  const intHash = parseInt(hash.substring(0, 8), 16);
  return intHash % SHARD_COUNT;
}

module.exports = { getShardIdForCustomer };
