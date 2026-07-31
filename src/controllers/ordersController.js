const fs = require('fs');
const { uploadFileToGCS } = require('../services/gcsUploadService');
const { processOrderFile } = require('../services/orderProcessor');
const { getShardIdForCustomer } = require('../services/shardRouter');
const { getShardPool } = require('../config/db');
const logger = require('../utils/logger');

async function uploadOrders(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use form field name "file".' });
  }

  console.log('Received file upload request:', req.file.originalname, 'size:', req.file.size);

  const localFilePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    logger.info(`Received upload: ${originalName}`);

    // 1. Upload the raw file to GCS first, so we always keep the source of truth.
    const gcsObjectPath = await uploadFileToGCS(localFilePath, originalName);

    // 2. Stream-parse, validate, and batch-insert into the correct shards.
    const result = await processOrderFile(localFilePath, originalName);

    res.status(200).json({
      status: 'completed',
      uploadId: result.uploadId,
      gcsPath: `gs://${process.env.GCS_BUCKET_NAME}/${gcsObjectPath}`,
      totalRows: result.totalRows,
      inserted: result.inserted,
      failed: result.failed,
      perShardCounts: result.perShardCounts,
      failedRecordsFile: result.failedFilePath,
    });
  } catch (err) {
    logger.error('Upload processing failed', err);
    res.status(500).json({ error: 'Failed to process orders file', details: err.message });
  } finally {
    fs.unlink(localFilePath, () => {});
  }
}

async function getOrderById(req, res) {
  const { orderId } = req.params;
  const { customerId } = req.query;

  if (!customerId) {
    return res.status(400).json({
      error: 'customerId query param is required to locate the correct shard, e.g. /orders/ORD123?customerId=CUST456',
    });
  }

  try {
    const shardId = getShardIdForCustomer(customerId);
    const pool = getShardPool(shardId);
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to fetch order', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
}

async function getOrdersByCustomer(req, res) {
  const { customerId } = req.query;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId query param is required' });
  }

  try {
    const shardId = getShardIdForCustomer(customerId);
    const pool = getShardPool(shardId);
    const { rows } = await pool.query(
      'SELECT * FROM orders WHERE customer_id = $1 ORDER BY order_date DESC LIMIT 200',
      [customerId]
    );
    res.json({ customerId, shardId, count: rows.length, orders: rows });
  } catch (err) {
    logger.error('Failed to fetch orders', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
}

module.exports = { uploadOrders, getOrderById, getOrdersByCustomer };
