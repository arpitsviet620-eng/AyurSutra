
// const mongoose = require('mongoose');

// /* =========================
//    Symptom Sub Schema
//    ========================= */
// const symptomSchema = new mongoose.Schema({
//   name: { type: String, required: true, trim: true },
//   severity: { type: String, enum: ['low', 'moderate', 'high'], default: 'moderate' },
//   duration: String,
//   description: String,
//   onset: String,
//   pattern: String,
//   triggers: String,
//   notes: String,
//   status: { type: String, enum: ['active', 'resolved', 'monitoring'], default: 'active' },
//   recordedAt: { type: Date, default: Date.now }
// });

// /* =========================
//    File Attachment Sub Schema
//    ========================= */
// const attachmentSchema = new mongoose.Schema({
//   fileName: { type: String, required: true },
//   fileSize: String,
//   fileType: String,
//   fileUrl: { type: String, required: true },
//   uploadedAt: { type: Date, default: Date.now }
// });

// /* =========================
//    Medical Record Schema
//    ========================= */
// const medicalRecordSchema = new mongoose.Schema(
//   {
//     patient: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Patient',
//       required: true
//     },

//     doctor: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Doctor', // Linked to your Doctor model
//       required: true
//     },

//     date: { type: Date, default: Date.now },
//     diagnosis: { type: String, required: true, trim: true },
//     symptoms: [symptomSchema],
//     notes: String,

//     visitType: {
//       type: String,
//       enum: ['routine', 'emergency', 'symptom_record', 'follow-up', 'other'],
//       set: v => v?.toLowerCase()
//     },

//     status: {
//       type: String,
//       enum: ['confirmed', 'suspected', 'ruled-out'],
//       default: 'confirmed'
//     },

//     confidence: {
//       type: String,
//       enum: ['Low', 'Medium', 'High'],
//       default: 'High'
//     },

//     code: String, // optional ICD code or internal code
//     evidence: { type: [String], default: [] },

//     vitalSigns: {
//       bloodPressure: String,
//       heartRate: Number,
//       temperature: Number,
//       respiratoryRate: Number,
//       oxygenSaturation: Number
//     },

//     attachments: [attachmentSchema] // PDF reports, lab results, etc.
//   },
//   {
//     timestamps: true
//   }
// );

// module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);


// models/medicalRecord.js
const mongoose = require('mongoose');

/* =========================
   Symptom Sub Schema
========================= */
const symptomSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  severity: { type: String, enum: ['low', 'moderate', 'high'], default: 'moderate' },
  duration: String,
  description: String,
  onset: String,
  pattern: String,
  triggers: String,
  notes: String,
  status: { type: String, enum: ['active', 'resolved', 'monitoring'], default: 'active' },
  recordedAt: { type: Date, default: Date.now }
});

/* =========================
   File Attachment Sub Schema
========================= */
const attachmentSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileSize: String,
  fileType: String,
  fileUrl: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
});

/* =========================
   Medical Record Schema
========================= */
const medicalRecordSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true
    },

    // Link to appointment if created from one
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment'
    },

    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true
    },

    description: {
      type: String,
      trim: true
    },

    recordType: {
      type: String,
      enum: ['consultation', 'diagnosis', 'prescription', 'lab_report', 'imaging', 'vaccination', 'surgery', 'other'],
      default: 'consultation',
      required: true
    },

    date: { 
      type: Date, 
      default: Date.now,
      required: true
    },

    diagnosis: { 
      type: String, 
      required: [true, 'Diagnosis is required'], 
      trim: true 
    },

    symptoms: [symptomSchema],

    notes: {
      type: String,
      trim: true
    },

    visitType: {
      type: String,
      enum: ['routine', 'emergency', 'follow-up', 'consultation', 'other'],
      default: 'routine'
    },

    status: {
      type: String,
      enum: ['confirmed', 'suspected', 'ruled-out'],
      default: 'confirmed'
    },

    confidence: {
      type: String,
      enum: ['Low', 'Medium', 'High'],
      default: 'High'
    },

    icdCode: {
      type: String,
      trim: true
    },

    vitalSigns: {
      bloodPressure: String,
      heartRate: Number,
      temperature: Number,
      respiratoryRate: Number,
      oxygenSaturation: Number
    },

    labResults: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    treatment: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    followUp: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    attachments: [attachmentSchema],

    tags: [{
      type: String,
      trim: true
    }],

    // Soft delete
    isArchived: {
      type: Boolean,
      default: false
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
medicalRecordSchema.index({ patient: 1, date: -1 });
medicalRecordSchema.index({ doctor: 1, date: -1 });
medicalRecordSchema.index({ appointment: 1 });
medicalRecordSchema.index({ recordType: 1 });
medicalRecordSchema.index({ isArchived: 1 });
medicalRecordSchema.index({ 'attachments.fileType': 1 });
medicalRecordSchema.index({ createdAt: -1 });

// Virtual for formatted date
medicalRecordSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Static method to get record statistics
medicalRecordSchema.statics.getRecordStats = async function(patientId) {
  const stats = await this.aggregate([
    {
      $match: {
        patient: mongoose.Types.ObjectId.createFromHexString(patientId),
        isArchived: false
      }
    },
    {
      $facet: {
        byType: [
          {
            $group: {
              _id: '$recordType',
              count: { $sum: 1 }
            }
          }
        ],
        totalStats: [
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              withAttachments: {
                $sum: {
                  $cond: [{ $gt: [{ $size: '$attachments' }, 0] }, 1, 0]
                }
              },
              latestRecord: { $max: '$date' }
            }
          }
        ]
      }
    }
  ]);

  return {
    byType: stats[0]?.byType || [],
    totalRecords: stats[0]?.totalStats[0]?.totalRecords || 0,
    withAttachments: stats[0]?.totalStats[0]?.withAttachments || 0,
    latestRecord: stats[0]?.totalStats[0]?.latestRecord || null
  };
};

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);