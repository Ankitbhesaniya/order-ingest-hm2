// Minimal structured logger. Keeps things easy to read in the console
// and easy to swap out for something like pino/winston later.

function timestamp() {
  return new Date().toISOString();
}

function info(message, meta) {
  console.log(`[INFO]  ${timestamp()} - ${message}`, meta || '');
}

function warn(message, meta) {
  console.warn(`[WARN]  ${timestamp()} - ${message}`, meta || '');
}

function error(message, err) {
  console.error(`[ERROR] ${timestamp()} - ${message}`, err ? err.stack || err : '');
}

module.exports = { info, warn, error };
