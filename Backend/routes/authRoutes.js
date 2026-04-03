const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, isAdmin } = require('../middleware/authMiddleware'); // make sure folder name is correct

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);
router.post('/reset-password', authController.resetPassword);

// Email verify for doctor
router.get('/verify-email', authController.verifyDoctorEmail);

// Admin routes (protected)
router.get('/admin/all', protect, isAdmin, authController.getAllDoctorsForAdmin);
router.get('/admin/doctors/pending', protect, isAdmin, authController.getPendingDoctors);
router.put('/admin/doctors/approve/:id', protect, isAdmin, authController.approveDoctor);
router.put('/admin/doctors/reject/:id', protect, isAdmin, authController.rejectDoctor);
router.delete('/admin/doctors/:id', protect, isAdmin, authController.deleteDoctor);


// Check admin (for testing)
router.get('/check-admin', protect, isAdmin, authController.checkAdmin);

// Protected user routes
router.get('/me', protect, authController.getMe);
router.post('/logout', protect, authController.logout);

module.exports = router;
