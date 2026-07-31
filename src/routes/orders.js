const express = require('express');
const upload = require('../middleware/upload');
const ordersController = require('../controllers/ordersController');

const router = express.Router();

router.post('/upload-orders', upload.single('file'), ordersController.uploadOrders);
router.get('/orders/:orderId', ordersController.getOrderById);
router.get('/orders', ordersController.getOrdersByCustomer);

module.exports = router;
