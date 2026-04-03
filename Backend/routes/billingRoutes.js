const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const Billing = require('../models/billingModels');
const Doctor = require('../models/doctorModels');
const Patient = require('../models/patientModels');
const {
  getAllInvoices,
  getFinancialStats,
  getInvoiceById,
  createInvoice,
  addPaymentToInvoice,
  refundPayment,
  updateInvoice,
  deleteInvoice,
  generateInvoicePDF,
  getUnbilledAppointments,
  getPaymentMethods,
  exportInvoices,
  getSummaryStats,
  getInvoicesByPatientId,
  getInvoiceByAppointmentId,
  voidInvoice,
  updateInvoiceItems,
  getDashboardStatistics
} = require('../controllers/billingController');

// All routes are protected
router.use(protect);

// ============================
// PUBLIC ROUTES (Meta Data)
// ============================
router.get('/meta', getPaymentMethods);

// ============================
// ADMIN ROUTES
// ============================
router.get('/', authorize('admin'), getAllInvoices);
router.get('/stats/financial', authorize('admin'), getFinancialStats);
router.get('/stats/summary', authorize('admin'), getSummaryStats);
router.get('/stats/dashboard', authorize('admin'), getDashboardStatistics);
router.get('/export', authorize('admin'), exportInvoices);
router.get('/unbilled-appointments', authorize('admin'), getUnbilledAppointments);
router.post('/', authorize('admin'), createInvoice);
router.get('/:id', authorize('admin'), getInvoiceById);
router.put('/:id', authorize('admin'), updateInvoice);
router.patch('/:id/items', authorize('admin'), updateInvoiceItems);
router.put('/:id/payment', authorize('admin'), addPaymentToInvoice);
router.post('/:id/refund', authorize('admin'), refundPayment);
router.post('/:id/void', authorize('admin'), voidInvoice);
router.delete('/:id', authorize('admin'), deleteInvoice);
router.get('/:id/pdf', authorize('admin'), generateInvoicePDF);

// ============================
// PATIENT SPECIFIC ROUTES
// ============================
router.get('/patient/:patientId', authorize(['admin', 'doctor']), getInvoicesByPatientId);
router.get('/appointment/:appointmentId', authorize(['admin', 'doctor', 'patient']), getInvoiceByAppointmentId);

// ============================
// DOCTOR ROUTES
// ============================
router.get('/doctor/invoices', authorize('doctor'), async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const { page = 1, limit = 10, status, paymentStatus } = req.query;
    const query = { doctor: doctor._id };

    if (status && status !== 'all') query.status = status;
    if (paymentStatus && paymentStatus !== 'all') query.paymentStatus = paymentStatus;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const invoices = await Billing.find(query)
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Billing.countDocuments(query);

    // Get doctor earnings
    const earnings = await DoctorEarning.aggregate([
      { $match: { doctor: doctor._id } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          totalAppointments: { $sum: 1 },
          pendingEarnings: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0]
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      invoices,
      earnings: earnings[0] || {
        totalEarnings: 0,
        totalAppointments: 0,
        pendingEarnings: 0
      }
    });
  } catch (error) {
    console.error('Doctor invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor invoices'
    });
  }
});

// Doctor dashboard statistics
router.get('/doctor/stats', authorize('doctor'), async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Monthly earnings
    const monthlyEarnings = await DoctorEarning.aggregate([
      {
        $match: {
          doctor: doctor._id,
          earningDate: { $gte: startOfMonth },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$amount' },
          appointments: { $sum: 1 }
        }
      }
    ]);

    // Total earnings
    const totalEarnings = await DoctorEarning.aggregate([
      {
        $match: {
          doctor: doctor._id,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$amount' },
          appointments: { $sum: 1 }
        }
      }
    ]);

    // Pending payments (invoices with balance)
    const pendingPayments = await Billing.aggregate([
      {
        $match: {
          doctor: doctor._id,
          balanceAmount: { $gt: 0 },
          paymentStatus: { $in: ['pending', 'partial'] }
        }
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$balanceAmount' },
          invoices: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        monthly: monthlyEarnings[0] || { amount: 0, appointments: 0 },
        total: totalEarnings[0] || { amount: 0, appointments: 0 },
        pending: pendingPayments[0] || { amount: 0, invoices: 0 }
      }
    });
  } catch (error) {
    console.error('Doctor stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor statistics'
    });
  }
});

// ============================
// PATIENT ROUTES
// ============================
router.get('/patient/my-invoices', authorize('patient'), async (req, res) => {
  try {
    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    const { page = 1, limit = 10, status, paymentStatus } = req.query;
    const query = { patient: patient._id };

    if (status && status !== 'all') query.status = status;
    if (paymentStatus && paymentStatus !== 'all') query.paymentStatus = paymentStatus;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const invoices = await Billing.find(query)
      .populate({
        path: 'doctor',
        select: 'doctorId',
        populate: {
          path: 'user',
          select: 'name email phone specialization'
        }
      })
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Billing.countDocuments(query);

    // Get patient financial summary
    const summary = await Billing.aggregate([
      { $match: { patient: patient._id } },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalPaid: { $sum: '$paidAmount' },
          totalBalance: { $sum: '$balanceAmount' },
          pendingInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] }
          },
          overdueInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      invoices,
      summary: summary[0] || {
        totalInvoices: 0,
        totalAmount: 0,
        totalPaid: 0,
        totalBalance: 0,
        pendingInvoices: 0,
        overdueInvoices: 0
      }
    });
  } catch (error) {
    console.error('Patient invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching patient invoices'
    });
  }
});

// Patient make payment (for online payments)
router.post('/patient/:id/pay', authorize('patient'), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, transactionId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    const invoice = await Billing.findOne({
      _id: id,
      patient: patient._id
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found or unauthorized'
      });
    }

    // Process payment (similar to admin payment)
    const paymentTransaction = {
      amount,
      paymentMethod,
      transactionId: transactionId || `PAT-PAY-${Date.now()}`,
      paymentDate: new Date(),
      notes: 'Patient self-payment',
      paymentBy: req.user._id,
      status: 'completed',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    };

    invoice.paidAmount += amount;
    invoice.balanceAmount = invoice.totalAmount - invoice.paidAmount;
    
    if (invoice.balanceAmount <= 0) {
      invoice.paymentStatus = 'paid';
    } else if (invoice.paidAmount > 0) {
      invoice.paymentStatus = 'partial';
    }

    invoice.paymentMethod = paymentMethod;
    invoice.paymentDate = new Date();
    invoice.transactionId = transactionId;
    invoice.paymentTransactions.push(paymentTransaction);
    invoice.updatedAt = new Date();

    await invoice.save();

    // Update appointment status
    if (invoice.appointment) {
      await Appointment.findByIdAndUpdate(
        invoice.appointment,
        {
          paymentStatus: invoice.paymentStatus === 'paid' ? 'completed' : 'partial',
          paymentId: transactionId,
          paymentDate: new Date()
        }
      );
    }

    const updatedInvoice = await Billing.findById(id)
      .populate({
        path: 'doctor',
        select: 'doctorId',
        populate: {
          path: 'user',
          select: 'name specialization'
        }
      });

    res.json({
      success: true,
      message: 'Payment successful',
      invoice: updatedInvoice
    });
  } catch (error) {
    console.error('Patient payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment failed',
      error: error.message
    });
  }
});

module.exports = router;