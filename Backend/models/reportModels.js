const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      required: true,
      unique: true
    },
    title: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: [
        'financial',
        'patient',
        'doctor',
        'therapy',
        'inventory',
        'appointment',
        'custom'
      ],
      required: true
    },
    period: {
      startDate: Date,
      endDate: Date
    },
    filters: {
      type: Map,
      of: mongoose.Schema.Types.Mixed
    },
    data: mongoose.Schema.Types.Mixed,
    metrics: {
      totalPatients: Number,
      totalAppointments: Number,
      totalRevenue: Number,
      newPatients: Number,
      cancellationRate: Number,
      averageRating: Number
    },
    charts: [
      {
        type: {
          type: String,
          enum: ['bar', 'pie', 'line', 'area'],
          required: true
        },
        title: {
          type: String,
          required: true
        },
        data: {
          type: mongoose.Schema.Types.Mixed,
          default: []
        }
      }
    ],
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    generatedAt: {
      type: Date,
      default: Date.now
    },
    filePath: String,
    isScheduled: {
      type: Boolean,
      default: false
    },
    scheduleFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    },
    recipients: [String],
    status: {
      type: String,
      enum: ['generated', 'processing', 'failed', 'sent'],
      default: 'generated'
    }
  },
  {
    timestamps: true
  }
);

// ✅ Generate report ID (NO next() needed)
reportSchema.pre('save', async function () {
  if (!this.reportId) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const count = await mongoose.model('Report').countDocuments({
      generatedAt: {
        $gte: new Date(year, date.getMonth(), date.getDate()),
        $lt: new Date(year, date.getMonth(), date.getDate() + 1)
      }
    });

    this.reportId = `RPT${year}${month}${day}${String(count + 1).padStart(3, '0')}`;
  }
});

module.exports = mongoose.model('Report', reportSchema);
