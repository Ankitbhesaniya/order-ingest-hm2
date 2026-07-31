const { healthCheck } = require('../config/db');
const metrics = require('../utils/metrics');

async function checkHealth(req, res) {
  const shards = await healthCheck();
  const allOk = shards.every((s) => s.status === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    shards,
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

function getMetrics(req, res) {
  res.json(metrics.getSnapshot());
}

module.exports = { checkHealth, getMetrics };
