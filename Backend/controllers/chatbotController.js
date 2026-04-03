// controllers/chatbotController.js
const geminiService = require('../utils/geminiService');
const ChatHistory = require('../models/chatBotModels');
const { v4: uuidv4 } = require('uuid');

// Allowed languages
const ALLOWED_LANGUAGES = ['English', 'Hindi', 'Punjabi'];

class GeminiController {
  // Validate language
  validateLanguage(language) {
    if (!ALLOWED_LANGUAGES.includes(language)) {
      throw new Error(`Language not supported. Only ${ALLOWED_LANGUAGES.join(', ')} are allowed.`);
    }
  }

  async generateResponse(req, res) {
    try {
      const { prompt, language = 'English' } = req.body;

      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Prompt is required'
        });
      }

      // Validate language
      this.validateLanguage(language);

      const response = await geminiService.generateContent(prompt, language);

      res.json({
        success: true,
        data: response
      });
    }catch (error) {
      console.error('Controller error:', error);

      res.status(500).json({
        success: false,
        error: error.message || "AI service unavailable",
        solution: "Check API key, quota, or billing settings"
      });
    }
  }

  async generateMedicalAdvice(req, res) {
    try {
      const { symptoms, language = 'English', sessionId } = req.body;

      if (!symptoms) {
        return res.status(400).json({
          success: false,
          error: 'Symptoms are required'
        });
      }

      // Validate language
      this.validateLanguage(language);

      const response = await geminiService.generateMedicalAdvice(symptoms, language);

      // Save to chat history if session exists
      if (sessionId) {
        await this.saveChatHistory(sessionId, 'user', symptoms, language);
        await this.saveChatHistory(sessionId, 'assistant', response.text, language);
      }

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      console.error('Medical advice error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async generateStructuredMedicalResponse(req, res) {
    try {
      const { symptoms, language = 'English' } = req.body;

      if (!symptoms) {
        return res.status(400).json({
          success: false,
          error: 'Symptoms are required'
        });
      }

      // Validate language
      this.validateLanguage(language);

      const response = await geminiService.generateStructuredMedicalResponse(symptoms, language);

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      console.error('Structured response error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async chatWithMemory(req, res) {
    try {
      const { messages, language = 'English' } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          success: false,
          error: 'Messages array is required'
        });
      }

      // Get the last user message
      const lastUserMessage = messages.filter(m => m.role === 'user').pop();
      
      if (!lastUserMessage) {
        return res.status(400).json({
          success: false,
          error: 'No user message found'
        });
      }

      const response = await geminiService.generateMedicalAdvice(lastUserMessage.content, language);

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      console.error('Chat with memory error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async initializeSession(req, res) {
    try {
      const { language = 'English' } = req.body;
      const userId = req.user?.id || 'anonymous';
      const sessionId = uuidv4();

      const chatHistory = new ChatHistory({
        sessionId,
        userId,
        language,
        messages: []
      });

      await chatHistory.save();

      res.json({
        success: true,
        sessionId,
        message: 'Chat session initialized'
      });
    } catch (error) {
      console.error('Session init error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async getChatHistory(req, res) {
    try {
      const { sessionId } = req.params;
      const userId = req.user?.id || 'anonymous';

      const chatHistory = await ChatHistory.findOne({ sessionId, userId });

      if (!chatHistory) {
        return res.status(404).json({
          success: false,
          error: 'Chat history not found'
        });
      }

      res.json({
        success: true,
        data: chatHistory
      });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  async saveChatHistory(sessionId, role, content, language) {
    try {
      await ChatHistory.findOneAndUpdate(
        { sessionId },
        {
          $push: {
            messages: {
              role,
              content,
              timestamp: new Date()
            }
          },
          $set: { updatedAt: new Date() }
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Save history error:', error);
    }
  }

  // Image Analysis for Ayurveda Medicine
  async analyzeAyurvedaMedicineImage(req, res) {
    try {
      const { imageData, language = 'English' } = req.body;

      if (!imageData) {
        return res.status(400).json({
          success: false,
          error: 'Image data is required'
        });
      }

      // Validate language
      this.validateLanguage(language);

      // Analyze image specifically for Ayurveda medicine
      const response = await geminiService.analyzeAyurvedaMedicineImage(imageData, language);

      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      console.error('Image analysis error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }
}

module.exports = new GeminiController();