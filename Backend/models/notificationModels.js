// models/notificationModels.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Basic Information
  type: {
    type: String,
    required: true,
    enum: [
      'appointment_created',
      'appointment_confirmed',
      'appointment_cancelled',
      'appointment_rescheduled',
      'appointment_reminder',
      'appointment_checkin',
      'appointment_completed',
      'doctor_assigned',
      'patient_registered',
      'payment_success',
      'payment_failed',
      'prescription_ready',
      'lab_report_ready',
      'system_alert'
    ]
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  detailedMessage: {
    type: String,
    default: ''
  },
  
  // User Information
  triggeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Recipients Management
  recipients: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'doctor', 'therapist', 'patient']
    },
    deliveryMethod: [{
      type: String,
      enum: ['in_app', 'email', 'sms', 'push'],
      default: ['in_app']
    }],
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending'
    },
    read: {
      type: Boolean,
      default: false
    },
    readAt: Date,
    emailSent: {
      type: Boolean,
      default: false
    },
    emailSentAt: Date,
    smsSent: {
      type: Boolean,
      default: false
    },
    smsSentAt: Date
  }],
  
  // Appointment Specific Fields
  appointmentData: {
    appointmentId: String,
    date: Date,
    time: String,
    status: String,
    doctorName: String,
    patientName: String,
    consultationFee: Number,
    location: String,
    department: String,
    cancellationReason: String,
    rescheduledFrom: Date
  },
  
  // Email/SMS Data
  emailData: {
    subject: String,
    template: String,
    variables: mongoose.Schema.Types.Mixed
  },
  smsData: {
    template: String,
    variables: mongoose.Schema.Types.Mixed
  },
  
  // Reference to related entities
  relatedTo: {
    model: {
      type: String,
      enum: ['Appointment', 'Patient', 'Doctor', 'User', 'Payment']
    },
    id: mongoose.Schema.Types.ObjectId
  },
  
  // Metadata
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['appointment', 'medical', 'payment', 'system', 'reminder'],
    default: 'appointment'
  },
  icon: String,
  actionLink: String,
  actionText: String,
  imageUrl: String,
  
  // Expiry and Status
  expiresAt: Date,
  scheduledFor: Date, // For scheduled notifications like reminders
  isArchived: {
    type: Boolean,
    default: false
  },
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

// Indexes for better performance
notificationSchema.index({ 'recipients.user': 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ 'appointmentData.appointmentId': 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ scheduledFor: 1 });
notificationSchema.index({ 'recipients.status': 1 });

// Virtual for unread count
notificationSchema.virtual('unreadCount').get(function() {
  return this.recipients.filter(r => !r.read).length;
});

// Virtual for sent count
notificationSchema.virtual('sentCount').get(function() {
  return this.recipients.filter(r => r.status === 'sent' || r.status === 'delivered').length;
});

module.exports = mongoose.model('Notification', notificationSchema);