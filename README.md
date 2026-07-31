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

## Sharding strategy — why and how

**Shard key: `hash(customer_id) % SHARD_COUNT`**, implemented in
`src/services/shardRouter.js`.

- **Why customer_id, not order_id?** The most common real query is "get all
  orders for this customer." Hashing on `customer_id` guarantees every order
  belonging to one customer lands on the same shard, so that query only ever
  hits one database. Hashing on `order_id` would scatter a customer's orders
  across every shard and turn a simple lookup into a fan-out query.
- **Why a hash, not a date range?** Time-based sharding puts all of *today's*
  writes on one shard — a hot shard. A hash spreads customers (and therefore
  load) evenly across all shards regardless of when orders come in.
- **Why separate databases instead of native Postgres partitioning?** It's
  the simplest option to reason about and to horizontally scale later — each
  shard is just an independent Postgres instance you can put on its own
  server. The routing logic is a few lines (`shardRouter.js`) and applies at
  the application layer, which is also the approach the assessment lists as
  "recommended."

Adding a 5th shard later just means bumping `SHARD_COUNT`, adding a
`SHARD_4_URL`, and running the migration against it — existing rows on
shards 0-3 aren't touched (only new writes for customers that happen to hash
to the new shard would land there — a full resharding/rebalance is a
separate, deliberately out-of-scope concern for this size of project).

## Performance choices

- **Streaming, not full-file load**: CSV files are parsed row-by-row via a
  Node stream (`fs.createReadStream` → `csv-parse`), with backpressure
  (the parser is paused while each row's async work resolves). Memory usage
  stays flat no matter how large the file is.
- **Batched inserts, not row-by-row**: rows are buffered per shard (default
  500 rows, configurable via `BATCH_SIZE`) and written with one multi-row
  `INSERT ... VALUES (...), (...), (...)` per batch.
- **Transactions**: each batch insert is wrapped in `BEGIN`/`COMMIT`, so a
  failure partway through a batch rolls back cleanly instead of leaving
  partial data.
- **Idempotency**: inserts use `ON CONFLICT (order_id) DO UPDATE`, so
  re-uploading the same file twice updates existing rows instead of creating
  duplicates.

## Error handling

- Invalid rows (bad date, non-numeric amount, missing customer_id, unknown
  status, etc.) are never inserted. They're collected during processing and
  written to a JSON file (path returned in the upload response as
  `failedRecordsFile`) along with the reason each row failed.
- File upload / GCS failures and database failures return a `500` with a
  descriptive message, and are logged with `src/utils/logger.js`.
- `GET /health` checks connectivity to every shard and returns `503` if any
  shard is unreachable — useful for load balancer health checks.

## Excel note

`.xlsx`/`.xls` files are supported via the `xlsx` library. That library
doesn't support true row streaming the way CSV does, so Excel files are read
fully into memory by the parser itself, but the *database writes* are still
fully batched either way. If very large Excel files are expected in
production, converting to CSV upstream is the simpler path to keep memory
flat end-to-end.

## Requirement checklist (mapped to the assessment PDF)

**Section 3 — File Upload & Order Data**
- [x] CSV/Excel accepted (`src/middleware/upload.js`)
- [x] File uploaded to GCS (`src/services/gcsUploadService.js`)
- [x] ADC authentication, no key files (`src/config/gcs.js`)
- [x] order_id, customer_id, order_date, order_amount, status fields (`src/services/validateOrder.js`)
- [x] Invalid rows handled gracefully — validated, logged, **and stored separately** in the `failed_order_rows` table (`src/services/failedRowsService.js`), plus a local JSON summary returned in the API response

**Section 4 — Database**
- [x] Schema with correct types + indexes on `order_id`, `customer_id`, `order_date` (`src/db/migrations/001_create_orders.sql`)
- [x] Sharding: application-level, hash(customer_id) % SHARD_COUNT, strategy explained below
- [x] Shard routing implemented in the app (`src/services/shardRouter.js`), data always lands on the correct shard

**Section 5 — Performance**
- [x] No one-by-one inserts — multi-row batched INSERTs (`src/services/shardWriter.js`)
- [x] Transactions per batch (`BEGIN`/`COMMIT`/`ROLLBACK`)
- [x] Streaming file processing — CSV never fully loaded into memory (`src/services/orderProcessor.js`)

**Section 6 — API**
- [x] `POST /upload-orders`
- [x] `GET /orders/:orderId` (bonus endpoint)
- [x] `GET /orders?customerId=` (bonus endpoint)

**Section 7 — Google Cloud**
- [x] GCS for file uploads, ADC-only auth, nothing hardcoded

**Section 8 — Error Handling & Logging**
- [x] Upload failures, parsing errors, DB insert failures all caught and logged (`src/utils/logger.js`)
- [x] Logging covers upload start/end and processing status (`orderProcessor.js` logs `[upload <id>] Processing started/finished`)
- [x] Failed records logged
- [x] Bonus: `GET /health` (checks every shard's connectivity) and `GET /metrics` (uploads processed, rows inserted/failed, uptime, memory)

**Section 10 — Bonus points**
- [x] Retry and idempotency handling: `insertBatchWithRetry` retries transient DB errors (connection drops, deadlocks) with exponential backoff; `ON CONFLICT (order_id) DO UPDATE` makes re-uploading a file idempotent
- [x] Dockerized setup: `Dockerfile` + `docker-compose.yml` (app + 4 shard databases)
- [x] Unit tests: `src/tests/validateOrder.test.js`, `src/tests/shardRouter.test.js` using Node's built-in test runner (`npm test`) — no extra dependency needed
- [x] Clear separation of concerns: `routes/` (path wiring) → `controllers/` (request/response) → `services/` (business logic) → `config/` (external clients)
- [ ] Background processing (workers/queues): intentionally not implemented — see note below

## What's intentionally left out

Only one bonus item is skipped: a background job queue (e.g. BullMQ/Redis)
for async processing. The assessment's core requirement is synchronous
processing of a ~10,000 row file, which this handles well within seconds
via streaming + batching. Adding a queue means adding infrastructure
(Redis, a worker process, job status polling) that the spec doesn't
require and that would make the project meaningfully harder to read and
run for a 24-hour assessment. Happy to add it if asked to extend the
system for much larger files or true async processing.


