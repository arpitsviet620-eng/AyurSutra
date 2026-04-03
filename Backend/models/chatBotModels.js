// models/ChatHistory.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { 
    type: String, 
    enum: ['user', 'assistant'], 
    required: true 
  },
  content: { 
    type: String, 
    required: true 
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  }
});

const chatHistorySchema = new mongoose.Schema({
  sessionId: { 
    type: String, 
    required: true,
    unique: true 
  },
  userId: { 
    type: String, 
    required: true,
    default: 'anonymous'
  },
  messages: [messageSchema],
  language: { 
    type: String, 
    default: 'English',
    enum: ['English', 'Hindi', 'Punjabi']
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Update timestamp on save
chatHistorySchema.pre('save', function() {
  this.updatedAt = new Date();
});

// Index for efficient queries
chatHistorySchema.index({ userId: 1, createdAt: -1 });
chatHistorySchema.index({ sessionId: 1 });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);