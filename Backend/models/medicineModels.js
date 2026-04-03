const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  genericName: String,
  brandName: String,
  description: {
    english: String,
    hindi: String,
    punjabi: String
  },
  dosage: {
    english: String,
    hindi: String,
    punjabi: String
  },
  activeIngredient: String,
  category: {
    type: String,
    enum: ['fever', 'headache', 'cough', 'vomiting', 'allergy', 'pain', 'antibiotic', 'antiviral', 'other']
  },
  sideEffects: [String],
  precautions: [String],
  storageInstructions: String,
  contraindications: [String],
  interactions: [String],
  priceRange: {
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
  },
  availableForms: [{
    type: String,
    enum: ['tablet', 'capsule', 'syrup', 'injection', 'ointment', 'cream']
  }],
  requiresPrescription: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'discontinued', 'out_of_stock'],
    default: 'active'
  },
  photo: String,
  ratingsAverage: {
    type: Number,
    min: 1,
    max: 5,
    default: 4.5
  },
  ratingsQuantity: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Medicine', medicineSchema);