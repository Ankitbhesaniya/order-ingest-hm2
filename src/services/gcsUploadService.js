const fs = require('fs');
const path = require('path');
const { bucket, bucketName } = require('../config/gcs');
const logger = require('../utils/logger');

/**
 * Streams a local file up to GCS (no full-file buffering in memory).
 * Returns the destination path (object name) in the bucket.
 */
async function uploadFileToGCS(localFilePath, originalName) {
  const destination = `orders-uploads/${Date.now()}-${path.basename(originalName)}`;

  logger.info(`Uploading ${originalName} to gs://${bucketName}/${destination}`);

  await new Promise((resolve, reject) => {
    fs.createReadStream(localFilePath)
      .pipe(
        bucket.file(destination).createWriteStream({
          resumable: false, // fine for files well under a few hundred MB
          metadata: { contentType: 'text/csv' },
        })
      )
      .on('error', reject)
      .on('finish', resolve);
  });

  logger.info(`Upload complete: gs://${bucketName}/${destination}`);
  return destination;
}

module.exports = { uploadFileToGCS };
