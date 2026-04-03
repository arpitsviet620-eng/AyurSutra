const mongoose = require('mongoose');

const treatmentSchema = new mongoose.Schema({
  treatmentId: {
    type: String,
    unique: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  diagnosis: {
    type: String,
    required: true
  },
  chiefComplaints: [String],
  symptoms: [String],
  pulse: {
    vata: String,
    pitta: String,
    kapha: String
  },
  tongueExamination: String,
  prakriti: {
    type: String,
    enum: ['vata', 'pitta', 'kapha', 'vata-pitta', 'vata-kapha', 'pitta-kapha', 'sama']
  },
  doshaImbalance: [String],
  prescribedTherapies: [{
    therapy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Therapy'
    },
    sessions: Number,
    duration: Number,
    instructions: String
  }],
  
  medicines: [
  {
    name: {
      type: String,
      required: true
    },

    dosage: {
      type: String,
      enum: ['250mg', '500mg', '1g', '5ml', '10ml'],
      required: true
    },

    frequency: {
      type: String,
      enum: ['once daily', 'twice daily', 'thrice daily', 'as needed'],
      required: true
    },

    duration: {
      type: String,
      required: true
    },

    beforeMeal: {
      type: Boolean,
      default: false
    },

    instructions: {
      type: String,
      enum: [
        'before meals',
        'after meals',
        'with warm water',
        'with milk',
        'at bedtime'
      ]
    }
  }
],
  dietRecommendations: [String],
  lifestyleChanges: [String],
  yogaRecommendations: [String],
  followUpDate: Date,
  status: {
    type: String,
    enum: ['ongoing', 'completed', 'cancelled', 'follow-up'],
    default: 'ongoing'
  },
  notes: String,
  attachments: [String],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

//
treatmentSchema.pre("save", async function () {
  if (!this.treatmentId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("Treatment").countDocuments();

    this.treatmentId = `TRT${year}${String(count + 1).padStart(4, "0")}`;
  }
});


module.exports = mongoose.model('Treatment', treatmentSchema);
