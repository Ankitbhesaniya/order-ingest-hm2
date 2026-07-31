// Simple in-process metrics. No external dependency (Prometheus etc.)
// on purpose - this is enough to satisfy "basic metrics endpoint" without
// adding infrastructure. Resets on restart, which is fine for this scope.

const state = {
  uploadsProcessed: 0,
  totalRowsProcessed: 0,
  totalRowsInserted: 0,
  totalRowsFailed: 0,
  startedAt: new Date().toISOString(),
};

function recordUpload(stats) {
  state.uploadsProcessed += 1;
  state.totalRowsProcessed += stats.totalRows;
  state.totalRowsInserted += stats.inserted;
  state.totalRowsFailed += stats.failed;
}

function getSnapshot() {
  return {
    ...state,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

module.exports = { recordUpload, getSnapshot };
