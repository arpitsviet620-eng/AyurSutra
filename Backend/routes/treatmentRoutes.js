const express = require('express');
const router = express.Router();
const {
  getTreatments,
  getTreatment,
  createTreatment,
  updateTreatment,
  updateTreatmentStatus,
  getTreatmentStats
} = require('../controllers/treatmentController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, getTreatments)
  .post(protect, createTreatment);

router.route('/stats/overview')
  .get(protect, getTreatmentStats);

router.route('/:id')
  .get(protect, getTreatment)
  .put(protect, updateTreatment);

router.route('/:id/status')
  .put(protect, updateTreatmentStatus);

module.exports = router;