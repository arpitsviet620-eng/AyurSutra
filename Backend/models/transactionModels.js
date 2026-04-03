const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true
  },
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
  type: {
    type: String,
    enum: ['payment', 'refund'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  paymentId: { type: String },
  refundId: { type: String },
  status: {
    type: String,
    enum: ['initiated', 'processed', 'completed', 'failed'], // ✅ Added 'completed'
    default: 'initiated'
  },
  notes: { type: String },
  metadata: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
