
// models/doctorModels.js
const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  doctorId: {
    type: String,
    unique: true,
    uppercase: true,
    trim: true
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    enum: {
      values: ['general', 'panchakarma', 'kayachikitsa', 'shalya', 'shalakya', 'prasuti', 'kaumarabhritya', 'swasthavritta'],
      message: '{VALUE} is not a valid department'
    }
  },
  specialization: {
    type: [String],
    required: [true, 'At least one specialization is required'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'At least one specialization is required'
    }
  },
  experience: {
    type: Number,
    required: [true, 'Experience is required'],
    min: [0, 'Experience cannot be negative'],
    max: [60, 'Experience cannot exceed 60 years']
  },
  consultationFee: {
    type: Number,
    required: [true, 'Consultation fee is required'],
    min: [0, 'Consultation fee cannot be negative']
  },
  availableDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  workingHours: {
    start: {
      type: String,
      required: [true, 'Start time is required'],
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter a valid time in HH:mm format']
    },
    end: {
      type: String,
      required: [true, 'End time is required'],
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter a valid time in HH:mm format']
    }
  },
  maxPatientsPerDay: {
    type: Number,
    default: 20,
    min: [1, 'Minimum 1 patient per day'],
    max: [100, 'Maximum 100 patients per day']
  },
  leaveDates: [{
    type: Date,
    validate: {
      validator: function(date) {
        return date > new Date();
      },
      message: 'Leave date must be in the future'
    }
  }],
  rating: {
    type: Number,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot exceed 5'],
    default: 0
  },
  totalRatings: {
    type: Number,
    default: 0,
    min: 0
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  signature: String,
  licenseNumber: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    trim: true
  },
  education: {
    type: String,
    required: [true, 'Education details are required']
  },
  location: {
    type: String,
    required: [true, 'Location is required']
  },
  qualifications: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


//Search index
doctorSchema.index({
  department: 1,
  specialization: 1,
  isAvailable: 1
});

doctorSchema.index({
  'user.name': 'text',
  department: 'text',
  specialization: 'text'
});


// Generate doctor ID
doctorSchema.pre('save', async function() {
  if (!this.doctorId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('Doctor').countDocuments();
    this.doctorId = `DOC${year}${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Doctor', doctorSchema);