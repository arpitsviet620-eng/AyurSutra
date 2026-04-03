// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); // middleware to authenticate user
const profileController = require('../controllers/profileControllers');
const { uploadUserImage } = require("../controllers/uploadControllers");
const upload = require("../middleware/upload");
// ================== PROFILE ROUTES ==================
router.post("/upload-image",protect,upload.single("photo"),uploadUserImage);
// Complete / Create Profile (first-time setup)
router.post('/complete', protect, profileController.completeProfile);

// Get logged-in user profile
router.get('/me', protect, profileController.getMyProfile);

// Full update of profile (PUT)
router.put('/me', protect, profileController.updateMyProfile);

// Partial update of profile (PATCH)
router.patch('/me', protect, profileController.partialUpdate);

// Soft delete profile
router.delete('/me', protect, profileController.deleteMyProfile);
//Change Password
router.put('/change-password',protect,profileController.changePassword);

module.exports = router;
