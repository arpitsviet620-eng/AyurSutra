const express = require('express');
const router = express.Router();
const {
  generateReport,
  getReports,
  getReport,
  downloadReport,
  scheduleReport,
  getDashboardStats
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getReports);

router.route('/generate')
  .post(protect, generateReport);

router.route('/schedule')
  .post(protect, authorize('admin'), scheduleReport);

router.route('/dashboard-stats')
  .get(protect, getDashboardStats);

router.route('/:id')
  .get(protect, getReport);

router.route('/:id/download/:format')
  .get(protect, downloadReport);

module.exports = router;