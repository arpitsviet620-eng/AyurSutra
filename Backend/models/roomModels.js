const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['therapy', 'consultation', 'operation', 'general', 'private'],
    default: 'therapy'
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  capacity: {
    type: Number,
    default: 1
  },
  equipment: {
    type: [String],
    default: []
  },
  notes: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Room', roomSchema);
