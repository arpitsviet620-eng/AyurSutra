// routes/chatbotRoutes.js
const express = require('express');
const router = express.Router();
const geminiController = require('../controllers/chatbotController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');

// Public routes (no login required)
router.post('/generate', optionalAuth, geminiController.generateResponse.bind(geminiController));
router.post('/medical-advice', optionalAuth, geminiController.generateMedicalAdvice.bind(geminiController));
router.post('/structured-medical', optionalAuth, geminiController.generateStructuredMedicalResponse.bind(geminiController));
router.post('/chat', optionalAuth, geminiController.chatWithMemory.bind(geminiController));

// Image Analysis

// Ayurveda Medicine Image Analysis (Specific for Ayurveda only)
router.post('/analyze-ayurveda-medicine', optionalAuth, geminiController.analyzeAyurvedaMedicineImage.bind(geminiController));

// Session management
router.post('/chat/init', optionalAuth, geminiController.initializeSession.bind(geminiController));

// Protected route (login required)
router.get('/chat/history/:sessionId', protect, geminiController.getChatHistory.bind(geminiController));

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Gemini API service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
