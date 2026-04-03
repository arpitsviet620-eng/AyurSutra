const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['cash', 'card', 'upi', 'netbanking', 'cheque', 'razorpay', 'insurance']
  },
  transactionId: {
    type: String,
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  },
  paymentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const invoiceItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  }
});

const billingSchema = new mongoose.Schema({
  invoiceId: {
    type: String,
    required: true,
    unique: true
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor'
  },
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  items: [invoiceItemSchema],
  subTotal: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  balanceAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'refunded'],
    default: 'pending'
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'void', 'cancelled'],
    default: 'active'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'netbanking', 'cheque', 'razorpay', 'insurance']
  },
  paymentDate: {
    type: Date
  },
  transactionId: {
    type: String
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paymentTransactions: [paymentTransactionSchema]
}, {
  timestamps: true
});

// Auto-calculate totals before saving
// Auto-calculate totals before saving
billingSchema.pre('save', async function() {
  // Calculate item totals
  this.items.forEach(item => {
    item.total = item.price * item.quantity;
  });

  // Calculate subTotal from items
  this.subTotal = this.items.reduce((sum, item) => sum + item.total, 0);
  
  // Calculate total amount
  this.totalAmount = this.subTotal + this.tax - this.discount;
  
  // Calculate balance
  this.balanceAmount = this.totalAmount - this.paidAmount;
  
  // Update payment status
  if (this.balanceAmount <= 0) {
    this.paymentStatus = 'paid';
  } else if (this.paidAmount > 0) {
    this.paymentStatus = 'partial';
  } else {
    // Check if overdue
    if (new Date() > this.dueDate) {
      this.paymentStatus = 'overdue';
    } else {
      this.paymentStatus = 'pending';
    }
  }
});

// Indexes for better query performance
// Indexes for better query performance
billingSchema.index({ patient: 1 });
billingSchema.index({ appointment: 1 });
billingSchema.index({ paymentStatus: 1 });
billingSchema.index({ createdAt: -1 });
billingSchema.index({ dueDate: 1 });
const Billing = mongoose.model('Billing', billingSchema);

module.exports = Billing;