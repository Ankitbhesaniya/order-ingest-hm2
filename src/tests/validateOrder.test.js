const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateOrder } = require('../services/validateOrder');

test('accepts a well-formed row', () => {
  const result = validateOrder({
    order_id: 'ORD-1',
    customer_id: 'CUST-1',
    order_date: '2026-01-01T10:00:00',
    order_amount: '199.99',
    status: 'completed',
  });

  assert.equal(result.valid, true);
  assert.equal(result.order.customer_id, 'CUST-1');
  assert.equal(result.order.order_amount, 199.99);
});

test('generates an order_id when missing', () => {
  const result = validateOrder({
    customer_id: 'CUST-2',
    order_date: '2026-01-01T10:00:00',
    order_amount: '10',
    status: 'pending',
  });

  assert.equal(result.valid, true);
  assert.ok(result.order.order_id.length > 0);
});

test('rejects a row with missing customer_id', () => {
  const result = validateOrder({
    order_id: 'ORD-2',
    order_date: '2026-01-01T10:00:00',
    order_amount: '10',
    status: 'pending',
  });

  assert.equal(result.valid, false);
  assert.match(result.reason, /customer_id/);
});

test('rejects a row with an invalid order_date', () => {
  const result = validateOrder({
    order_id: 'ORD-3',
    customer_id: 'CUST-3',
    order_date: 'not-a-date',
    order_amount: '10',
    status: 'pending',
  });

  assert.equal(result.valid, false);
  assert.match(result.reason, /order_date/);
});

test('rejects a negative or non-numeric order_amount', () => {
  const negative = validateOrder({
    order_id: 'ORD-4',
    customer_id: 'CUST-4',
    order_date: '2026-01-01T10:00:00',
    order_amount: '-5',
    status: 'pending',
  });
  assert.equal(negative.valid, false);

  const nonNumeric = validateOrder({
    order_id: 'ORD-5',
    customer_id: 'CUST-5',
    order_date: '2026-01-01T10:00:00',
    order_amount: 'abc',
    status: 'pending',
  });
  assert.equal(nonNumeric.valid, false);
});

test('rejects an unrecognized status', () => {
  const result = validateOrder({
    order_id: 'ORD-6',
    customer_id: 'CUST-6',
    order_date: '2026-01-01T10:00:00',
    order_amount: '10',
    status: 'not_a_real_status',
  });

  assert.equal(result.valid, false);
  assert.match(result.reason, /status/);
});

test('falls back to the "order_amout" header (matches the spec\'s spelling)', () => {
  const result = validateOrder({
    order_id: 'ORD-7',
    customer_id: 'CUST-7',
    order_date: '2026-01-01T10:00:00',
    order_amout: '42.50',
    status: 'completed',
  });

  assert.equal(result.valid, true);
  assert.equal(result.order.order_amount, 42.5);
});
