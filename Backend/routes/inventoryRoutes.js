const express = require('express');
const router = express.Router();
const {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  restockInventory,
  getLowStockAlerts,
  getInventoryStats
} = require('../controllers/inventoryController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getInventoryItems)
  .post(protect, createInventoryItem);

router.route('/stats/overview')
  .get(protect, getInventoryStats);

router.route('/alerts/low-stock')
  .get(protect, getLowStockAlerts);

router.route('/:id')
  .get(protect, getInventoryItem)
  .put(protect, updateInventoryItem)
  .delete(protect, authorize('admin'), deleteInventoryItem);

router.route('/:id/restock')
  .post(protect, restockInventory);

module.exports = router;