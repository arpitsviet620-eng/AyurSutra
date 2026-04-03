const mongoose = require('mongoose');

// Counter schema for sequences
const Counter = require('./counterModels');
const patientSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },

    patientCode: {
      type: String,
      unique: true,
      uppercase: true,
      sparse: true
    },

    age: {
      type: Number,
      min: 0,
      max: 120
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: 'other'
    },

    dateOfBirth: {
      type: Date,
      required: true
      
    },

    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Not Specified'],
      default: 'Not Specified'
    },

    allergies: {
      type: [String],
      default: []
    },

    medicalHistory: {
      type: [String],
      default: []
    },

    medicalRecords: [
      {
        recordType: {
          type: String,
          enum: ['consultation', 'diagnosis', 'prescription', 'lab_report', 'other']
        },
        title: String,
        description: String,
        date: { type: Date, default: Date.now },
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        fileUrl: String,
        notes: String
      }
    ],

    phone: String,
    email: String,

    emergencyContact: {
      name: String,
      relationship: String,
      phone: String
    },

    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: { type: String, default: 'India' }
    },

    occupation: String,
    maritalStatus: { type: String, default: '' },
    status: {
      type: String,
      enum: ['active', 'inactive', 'critical', 'deceased'],
      default: 'active'
    },
    photo: String,
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);


//Search index
patientSchema.index({
  'user.name': 'text',
  phone: 1,
  email: 1,
  status: 1
});


// Pre-save hook to generate patientCode and calculate age
patientSchema.pre('save', async function () {
  // 1️⃣ Generate patientCode if missing using Counter (atomic)
  if (!this.patientCode) {
    const counter = await Counter.findOneAndUpdate(
      { name: 'patientCode' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const year = new Date().getFullYear();
    this.patientCode = `PAT${year}${String(counter.seq).padStart(5, '0')}`;
  }

  // 2️⃣ Calculate age from dateOfBirth
  if (this.dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    this.age = age;
  }
});

module.exports = mongoose.model('Patient', patientSchema);
