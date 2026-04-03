// models/DoctorEarning.js
const mongoose = require('mongoose');

const doctorEarningSchema = new mongoose.Schema({
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor',
    required: true,
    index: true
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
    unique: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  netAmount: {
    type: Number,
    default: 0
  },
  paymentId: String,
  razorpayOrderId: String,
  refundId: String,
  refundAmount: Number,
  refundDate: Date,
  refundReason: String,
  status: {
    type: String,
    enum: ['pending', 'completed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  earningDate: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

// Indexes
doctorEarningSchema.index({ doctor: 1, earningDate: -1 });
doctorEarningSchema.index({ status: 1, earningDate: -1 });
doctorEarningSchema.index({ paymentId: 1, refundId: 1 });

// Pre-save hook to calculate net amount
doctorEarningSchema.pre('save', async function() {
  if (this.status === 'refunded') {
    this.netAmount = -(this.refundAmount || this.amount || 0);
  } else {
    this.netAmount = this.amount || 0;
  }
});


module.exports = mongoose.model('DoctorEarning', doctorEarningSchema);