// routes/therapyRoutes.js
const express = require('express');
const router = express.Router();
const {
  getTherapies,
  getTherapy,
  createTherapy,
  updateTherapy,
  deleteTherapy,
  getTherapyStats,
  getTherapyUtilization,
  getTherapyComparison,
  exportTherapyData,
  getTherapyDashboardStats
} = require('../controllers/therapyController');

const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getTherapies)
  .post(protect, createTherapy);

router.route('/stats/popular')
  .get(protect, getTherapyStats);

// 🆕 NEW DASHBOARD ROUTE
router.route('/dashboard/stats')
  .get(protect, getTherapyDashboardStats);
router.get('/utilization', protect, getTherapyUtilization);
router.get('/comparison', protect, getTherapyComparison);
router.get('/export', protect, exportTherapyData);
// 🔥 POPULAR STATS
router.get('/stats/popular', protect, getTherapyStats);

// 🔥 POPULAR STATS
router.get('/stats/popular', protect, getTherapyStats);

router.route('/:id')
  .get(protect, getTherapy)
  .put(protect, updateTherapy)
  .delete(protect, authorize('admin'), deleteTherapy);

module.exports = router;
