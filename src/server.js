require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const ordersRouter = require('./routes/orders');
const healthRouter = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use('/', healthRouter);
app.use('/', ordersRouter);

// Basic 404 + error handlers
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`Order ingest service listening on port ${PORT}`);
});
