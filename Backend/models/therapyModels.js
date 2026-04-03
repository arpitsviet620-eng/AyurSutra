const mongoose = require('mongoose');

const therapySchema = new mongoose.Schema({
  therapyId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  category: {
    type: String,
    enum: [
      'panchakarma',
      'swedana',
      'basti',
      'nasya',
      'virechana',
      'rakta-mokshana',
      'other'
    ],
    required: true
  },
  duration: {
    type: Number,
    required: true
  },
  cost: {
    type: Number,
    required: true
  },
  requiredEquipment: [String],
  requiredTherapists: {
    type: Number,
    default: 1
  },
  precautions: [String],
  benefits: [String],
  contraindications: [String],
  preparationInstructions: String,
  aftercareInstructions: String,
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });


// ✅ Generate therapy ID (ASYNC, NO next)
therapySchema.pre('save', async function () {
  if (!this.therapyId) {
    const year = new Date().getFullYear();

    const count = await mongoose
      .model('Therapy')
      .countDocuments({});

    this.therapyId = `THP${year}${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Therapy', therapySchema);
