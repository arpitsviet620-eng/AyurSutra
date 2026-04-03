const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  appointmentId: { type: String, unique: true, sparse: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  date: { type: Date, required: true, index: true },
  time: { type: String, required: true },
  duration: { type: Number, default: 30 },
  type: { type: String, enum: ['consultation', 'follow-up', 'therapy', 'emergency', 'check-up'], default: 'consultation', index: true },
  purpose: String,
  status: {
    type: String,
    enum: ['pending_payment','scheduled','confirmed','checked-in','in-progress','completed','cancelled','no-show','rescheduled','payment_failed'],
    default: 'pending_payment',
    index: true
  },
  amount: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['pending','completed','failed','refunded','cancelled'], default: 'pending' },
  paymentId: { type: String, sparse: true },
  razorpayOrderId: { type: String, sparse: true },
  refundId: { type: String, sparse: true },
  refundStatus: { type: String, enum: ['initiated','processed','failed', null], default: null },
  refundAmount: { type: Number, default: 0 },
  refundDate: Date,
  refundReason: String,
  therapy: { type: mongoose.Schema.Types.ObjectId, ref: 'Therapy' },
  followUpOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  priority: { type: String, enum: ['low','medium','high','emergency'], default: 'medium' },
  location: { type: String, default: 'Clinic' },
  notes: String,
  symptoms: [String],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  cancelledAt: Date,
  cancelledBy: { user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, role: { type: String, enum: ['patient','doctor','admin'] } },
  cancellationReason: String,
  completedAt: Date,
  doctorNotes: String
}, { timestamps: true });

// Indexes
appointmentSchema.index({ patient: 1, doctor: 1, date: -1, status: 1 });
appointmentSchema.index({ appointmentId: 1, status: 1, paymentStatus: 1 }, { unique: true });
appointmentSchema.index({ patient: 1, date: -1 });
appointmentSchema.index({ doctor: 1, date: -1 });

// Auto-generate appointmentId
appointmentSchema.pre('save', async function() {
  if (!this.appointmentId) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const startOfDay = new Date(year, date.getMonth(), date.getDate());
    const endOfDay = new Date(year, date.getMonth(), date.getDate() + 1);

    const count = await mongoose.model('Appointment').countDocuments({ createdAt: { $gte: startOfDay, $lt: endOfDay } });
    this.appointmentId = `APT${year}${month}${day}${String(count + 1).padStart(3, '0')}`;
  }
});

module.exports = mongoose.model('Appointment', appointmentSchema);
