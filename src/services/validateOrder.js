const { v4: uuidv4 } = require('uuid');

const VALID_STATUSES = ['pending', 'processing', 'completed', 'cancelled', 'refunded'];

/**
 * Validates + normalizes one raw CSV row into a clean order object.
 * Returns { valid: true, order } or { valid: false, reason }.
 *
 * Accepts "order_amout" as a fallback header since that's the exact
 * spelling used in the source spec - real-world files are messy too.
 */
function validateOrder(row) {
  const order_id = (row.order_id || '').toString().trim() || uuidv4();
  const customer_id = (row.customer_id || '').toString().trim();
  const rawDate = row.order_date;
  const rawAmount = row.order_amount ?? row.order_amout;
  const status = (row.status || '').toString().trim().toLowerCase();

  if (!customer_id) {
    return { valid: false, reason: 'Missing customer_id' };
  }

  const order_date = new Date(rawDate);
  if (isNaN(order_date.getTime())) {
    return { valid: false, reason: `Invalid order_date: "${rawDate}"` };
  }

  const order_amount = Number(rawAmount);
  if (Number.isNaN(order_amount) || order_amount < 0) {
    return { valid: false, reason: `Invalid order_amount: "${rawAmount}"` };
  }

  if (!status) {
    return { valid: false, reason: 'Missing status' };
  }
  if (!VALID_STATUSES.includes(status)) {
    return { valid: false, reason: `Unrecognized status: "${status}"` };
  }

  return {
    valid: true,
    order: { order_id, customer_id, order_date, order_amount, status },
  };
}

module.exports = { validateOrder, VALID_STATUSES };
