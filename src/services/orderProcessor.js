const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');

const { validateOrder } = require('./validateOrder');
const { getShardIdForCustomer } = require('./shardRouter');
const { insertBatchWithRetry } = require('./shardWriter');
const { insertFailedRows } = require('./failedRowsService');
const { SHARD_COUNT } = require('../config/db');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);

/**
 * Processes an orders file end-to-end:
 *  - streams rows from disk (never loads the full file into memory)
 *  - validates each row
 *  - routes valid rows to the correct shard buffer
 *  - flushes each shard's buffer in batches (not row-by-row), with retry
 *    on transient DB errors
 *  - persists invalid rows to the failed_order_rows table (per shard,
 *    round-robin) AND a local JSON file, so nothing is silently lost
 *
 * Returns a summary object.
 */
async function processOrderFile(localFilePath, originalName) {
  const uploadId = uuidv4();
  const isExcel = /\.xlsx?$/i.test(originalName);

  logger.info(`[upload ${uploadId}] Processing started`, { originalName });

  const stats = {
    uploadId,
    totalRows: 0,
    inserted: 0,
    failed: 0,
    perShardCounts: Array(SHARD_COUNT).fill(0),
  };

  // One in-memory buffer per shard. Small (max BATCH_SIZE rows each),
  // so this stays cheap even with millions of total rows.
  const shardBuffers = Array.from({ length: SHARD_COUNT }, () => []);
  const failedRows = [];

  async function flushShard(shardId) {
    const batch = shardBuffers[shardId];
    if (batch.length === 0) return;
    shardBuffers[shardId] = [];
    await insertBatchWithRetry(shardId, batch);
    stats.inserted += batch.length;
    stats.perShardCounts[shardId] += batch.length;
    logger.info(`[upload ${uploadId}] Flushed batch to shard ${shardId}`, {
      batchSize: batch.length,
    });
  }

  async function handleRow(row) {
    stats.totalRows++;
    const result = validateOrder(row);

    if (!result.valid) {
      stats.failed++;
      failedRows.push({ row, reason: result.reason });
      return;
    }

    const shardId = getShardIdForCustomer(result.order.customer_id);
    shardBuffers[shardId].push(result.order);

    if (shardBuffers[shardId].length >= BATCH_SIZE) {
      await flushShard(shardId);
    }
  }

  if (isExcel) {
    // Excel files are read in one shot by the xlsx library (it doesn't
    // support true streaming), but we still batch the DB writes below.
    const workbook = xlsx.readFile(localFilePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    for (const row of rows) {
      await handleRow(row);
    }
  } else {
    // CSV: true streaming parse, row by row, backpressure-aware.
    await new Promise((resolve, reject) => {
      const parser = fs.createReadStream(localFilePath).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
        })
      );

      parser.on('data', (row) => {
        parser.pause();
        handleRow(row)
          .then(() => parser.resume())
          .catch((err) => parser.destroy(err));
      });

      parser.on('end', resolve);
      parser.on('error', reject);
    });
  }

  // Flush whatever is left in each shard's buffer.
  for (let shardId = 0; shardId < SHARD_COUNT; shardId++) {
    await flushShard(shardId);
  }

  // Persist failed rows: primary copy goes to the failed_order_rows
  // table (queryable, durable), plus a local JSON file as a quick
  // human-readable summary returned in the API response.
  let failedFilePath = null;
  if (failedRows.length > 0) {
    await insertFailedRows(uploadId, failedRows);

    failedFilePath = path.join(require('os').tmpdir(), `failed-records-${uploadId}.json`);
    fs.writeFileSync(failedFilePath, JSON.stringify(failedRows, null, 2));
    logger.warn(`[upload ${uploadId}] ${failedRows.length} rows failed validation`, {
      failedFilePath,
    });
  }

  metrics.recordUpload(stats);
  logger.info(`[upload ${uploadId}] Processing finished`, stats);

  return { ...stats, failedFilePath };
}

module.exports = { processOrderFile };
