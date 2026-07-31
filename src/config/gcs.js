const { Storage } = require('@google-cloud/storage');

// No keyFilename / credentials passed here on purpose.
// The client library automatically picks up Application Default
// Credentials from:
//   1. GOOGLE_APPLICATION_CREDENTIALS env var (if set), or
//   2. `gcloud auth application-default login` local credentials, or
//   3. The metadata server when running on GCP (Cloud Run, GCE, GKE)
//      with a workload identity / attached service account.
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
});

const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
  throw new Error('GCS_BUCKET_NAME is not set in environment variables');
}

const bucket = storage.bucket(bucketName);

module.exports = { storage, bucket, bucketName };
