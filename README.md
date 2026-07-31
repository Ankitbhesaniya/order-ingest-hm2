# Order Ingest Service

A Node.js service that takes an orders file (CSV or Excel), uploads it to
Google Cloud Storage, and loads it into a sharded PostgreSQL setup —
streaming the whole way through so a 10,000+ row file never sits fully in
memory.

## How it works, in one paragraph

A file comes in on `POST /upload-orders`. It's first uploaded straight to
GCS (so the raw file is always safely archived), then streamed row by row
from disk, validated, and routed to one of N PostgreSQL "shards" based on a
hash of `customer_id`. Rows are buffered in small batches per shard and
inserted with multi-row `INSERT` statements inside a transaction — never
one row at a time. Rows that fail validation are recorded, not silently
dropped.

## Tech stack

- Node.js + Express
- PostgreSQL (application-level sharding — multiple independent databases)
- Google Cloud Storage, authenticated via Application Default Credentials (ADC)
- `csv-parse` for streaming CSV parsing, `xlsx` for Excel files

## Project structure

```
src/
  server.js              # Express app entrypoint
  config/
    db.js                # Creates one pg Pool per shard
    gcs.js                # GCS client (uses ADC, no keys)
  routes/
    orders.js             # Path -> controller mapping only
    health.js              # Path -> controller mapping only
  controllers/
    ordersController.js    # Request/response handling for orders endpoints
    healthController.js     # Request/response handling for health endpoint
  services/
    shardRouter.js         # hash(customer_id) -> shard id
    gcsUploadService.js     # streams file to GCS
    orderProcessor.js        # streaming parse + validate + batch insert
    shardWriter.js            # batched, transactional insert into one shard
    validateOrder.js           # row validation rules
  middleware/
    upload.js                   # multer disk storage config
  db/
    migrations/001_create_orders.sql
    runMigrations.js
sample-data/sample_orders.csv    # 10,000 valid rows + 100 intentionally invalid rows
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your GCS bucket name, GCP project id, and shard connection strings.

### 3. Set up Google Cloud auth (ADC)

No key files, ever. Locally:

```bash
gcloud auth application-default login
```

This writes credentials to `~/.config/gcloud/application_default_credentials.json`,
which the Google Cloud client library picks up automatically — nothing to
configure in code. When deployed on GCP (Cloud Run, GCE, GKE), the same code
picks up credentials from the attached service account / workload identity
instead. `.env.example` intentionally has no credential fields.

### 4. Start PostgreSQL shards

Easiest path — Docker Compose spins up 4 shard databases plus the app:

```bash
docker compose up
```

Or run Postgres yourself and just make sure `SHARD_0_URL` .. `SHARD_3_URL`
in `.env` point at 4 real databases (they can even be 4 databases on one
Postgres instance for local testing — the sharding logic doesn't care).

### 5. Run migrations (creates the `orders` table on every shard)

```bash
npm run migrate
```

### 6. Run the tests (optional but recommended)

```bash
npm test
```

Runs unit tests for validation logic and shard routing using Node's
built-in test runner — no extra test framework dependency.

### 7. Start the app

```bash
npm start
```

### 8. Try it

```bash
curl -X POST http://localhost:3000/upload-orders \
  -F "file=@sample-data/sample_orders.csv"

curl "http://localhost:3000/orders?customerId=CUST0001"

curl http://localhost:3000/health
```


- [ ] Background processing (workers/queues): intentionally not implemented — see note below

