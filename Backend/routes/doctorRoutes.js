const express = require('express');
const router = express.Router();
const {
  getDoctors,
  getDoctorStats,
  createDoctor,
  updateMyDoctorProfile,
  deleteDoctor,
  updateAvailability,
  getDoctorByUserId,
  getDoctorSchedule,
  exportDoctorSchedule,
  getMyDoctorProfile
} = require('../controllers/doctorController');

const { protect, authorize } = require('../middleware/authMiddleware');

/* ---------- SPECIFIC ROUTES FIRST ---------- */
router.get('/user/:userId', protect, getDoctorByUserId);
//currently both admin and doctor can access this route
router.get('/me', protect, authorize('doctor'), getMyDoctorProfile);
router.put('/me', protect, authorize('doctor'), updateMyDoctorProfile);


router.route('/:id').delete(protect, authorize('admin'), deleteDoctor);

router.get('/stats', protect, authorize('admin', 'doctor'), getDoctorStats);

router.get('/:id/schedule', protect, authorize('admin', 'doctor'), getDoctorSchedule);
router.get('/:id/schedule/export', protect, authorize('admin', 'doctor'), exportDoctorSchedule);

router.put('/:id/availability', protect, authorize('admin', 'doctor'), updateAvailability);

/* ---------- GENERIC ROUTES LAST ---------- */


router.route('/')
  .get(protect, getDoctors)
  .post(protect, authorize('admin'), createDoctor);

module.exports = router;
