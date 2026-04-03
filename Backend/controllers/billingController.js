const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Appointment = require('../models/appointmentModels');
const Patient = require('../models/patientModels');
const Doctor = require('../models/doctorModels');
const User = require('../models/userModels');
const Billing = require('../models/billingModels');
const DoctorEarning = require('../models/doctorEarningModels');
const moment = require('moment');
const PDFDocument = require('pdfkit');

// ============================
// GET ALL INVOICES
// ============================
const getAllInvoices = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    paymentStatus,
    startDate,
    endDate,
    search,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    patientId,
    doctorId
  } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const matchStage = {};

  if (status && status !== 'all') matchStage.status = status;
  if (paymentStatus && paymentStatus !== 'all') matchStage.paymentStatus = paymentStatus;
  if (patientId) matchStage.patient = new mongoose.Types.ObjectId(patientId);
  if (doctorId) matchStage.doctor = new mongoose.Types.ObjectId(doctorId);

  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const pipeline = [
    { $match: matchStage },

    // ================= PATIENT =================
    {
      $lookup: {
        from: 'patients',
        localField: 'patient',
        foreignField: '_id',
        as: 'patient'
      }
    },
    { $unwind: '$patient' },
    {
      $lookup: {
        from: 'users',
        localField: 'patient.user',
        foreignField: '_id',
        as: 'patientUser'
      }
    },
    { $unwind: '$patientUser' },

    // ================= DOCTOR =================
    {
      $lookup: {
        from: 'doctors',
        localField: 'doctor',
        foreignField: '_id',
        as: 'doctor'
      }
    },
    { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'users',
        localField: 'doctor.user',
        foreignField: '_id',
        as: 'doctorUser'
      }
    },
    { $unwind: { path: '$doctorUser', preserveNullAndEmptyArrays: true } },

    // ================= APPOINTMENT =================
    {
      $lookup: {
        from: 'appointments',
        localField: 'appointment',
        foreignField: '_id',
        as: 'appointment'
      }
    },
    { $unwind: { path: '$appointment', preserveNullAndEmptyArrays: true } }
  ];

  // 🔍 SEARCH (NOW WORKS)
  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { invoiceId: { $regex: search, $options: 'i' } },
          { transactionId: { $regex: search, $options: 'i' } },
          { 'patientUser.name': { $regex: search, $options: 'i' } },
          { 'patientUser.email': { $regex: search, $options: 'i' } },
          { 'patient.patientCode': { $regex: search, $options: 'i' } },
          { 'doctorUser.name': { $regex: search, $options: 'i' } }
        ]
      }
    });
  }

  // ================= SORT =================
  pipeline.push({
    $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 }
  });

  // ================= PAGINATION =================
  pipeline.push(
    { $skip: skip },
    { $limit: limitNum }
  );

  const invoices = await Billing.aggregate(pipeline);

  // ================= COUNT & STATS =================
  const statsPipeline = [
    ...pipeline.filter(s => !('$skip' in s) && !('$limit' in s)),
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        collectedRevenue: { $sum: '$paidAmount' },
        pendingRevenue: { $sum: '$balanceAmount' },
        totalTax: { $sum: '$tax' },
        totalDiscount: { $sum: '$discount' },
        paidInvoices: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] }
        },
        pendingInvoices: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] }
        },
        partialInvoices: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'partial'] }, 1, 0] }
        },
        overdueInvoices: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, 1, 0] }
        }
      }
    }
  ];

  const stats = await Billing.aggregate(statsPipeline);
  const summary = stats[0] || {};

  res.json({
    success: true,
    currentPage: pageNum,
    totalPages: Math.ceil((summary.totalInvoices || 0) / limitNum),
    invoices,
    summary
  });
});


// ============================
// GET FINANCIAL STATISTICS
// ============================
const getFinancialStats = asyncHandler(async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const now = new Date();
    let startDate;

    switch (period) {
      case 'day':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;

      case 'week':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;

      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;

      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;

      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // =========================
    // OVERALL STATS
    // =========================
    const [overallStats] = await Billing.aggregate([
      {
        $match: {
          status: { $ne: 'void' }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          collectedRevenue: { $sum: '$paidAmount' },
          pendingRevenue: { $sum: '$balanceAmount' },
          totalInvoices: { $sum: 1 }
        }
      }
    ]);

    // =========================
    // PERIOD STATS
    // =========================
    const [periodStats] = await Billing.aggregate([
      {
        $match: {
          status: { $ne: 'void' },
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$totalAmount' },
          collected: { $sum: '$paidAmount' },
          pending: { $sum: '$balanceAmount' },
          invoices: { $sum: 1 }
        }
      }
    ]);

    // =========================
    // PAYMENT STATUS DISTRIBUTION
    // =========================
    const statusDistributionRaw = await Billing.aggregate([
      {
        $match: {
          status: { $ne: 'void' }
        }
      },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          amount: { $sum: '$totalAmount' }
        }
      }
    ]);

    const statusDistribution = statusDistributionRaw.reduce((acc, item) => {
      acc[item._id] = {
        count: item.count,
        amount: item.amount
      };
      return acc;
    }, {});

    // =========================
    // LAST 12 MONTHS REVENUE
    // =========================
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);

    const monthlyRevenueRaw = await Billing.aggregate([
      {
        $match: {
          status: { $ne: 'void' },
          createdAt: { $gte: twelveMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$totalAmount' },
          invoices: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);

    const monthlyRevenue = monthlyRevenueRaw.map(item => ({
      month: new Date(item._id.year, item._id.month - 1).toLocaleString(
        'en-US',
        { month: 'short', year: 'numeric' }
      ),
      revenue: item.revenue,
      invoices: item.invoices
    }));

    // =========================
    // RESPONSE
    // =========================
    res.status(200).json({
      success: true,
      stats: {
        overall: overallStats || {
          totalRevenue: 0,
          collectedRevenue: 0,
          pendingRevenue: 0,
          totalInvoices: 0
        },
        period: periodStats || {
          revenue: 0,
          collected: 0,
          pending: 0,
          invoices: 0
        },
        statusDistribution,
        monthlyRevenue
      }
    });

  } catch (error) {
    console.error('Get financial stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch financial statistics',
      error: error.message
    });
  }
});


// ============================
// GET INVOICE BY ID
// ============================
const getInvoiceById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose notes status',
        populate: [
          {
            path: 'doctor',
            select: 'doctorId consultationFee specialization user',
            populate: {
              path: 'user',
              select: 'name email phone'
            }
          },
          {
            path: 'patient',
            select: 'patientCode gender dateOfBirth user',
            populate: {
              path: 'user',
              select: 'name email phone'
            }
          }
        ]
      })
      .populate({
        path: 'patient',
        select: 'patientCode gender dateOfBirth bloodGroup user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId consultationFee specialization user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate('createdBy', 'name email')
      .populate('paymentTransactions.paymentBy', 'name email')
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // ======================
    // FORMAT RESPONSE
    // ======================
    const appointment = invoice.appointment || {};
    const patient = invoice.patient || appointment.patient || {};
    const doctor = invoice.doctor || appointment.doctor || {};

    res.status(200).json({
      success: true,
      invoice: {
        _id: invoice._id,
        invoiceId: invoice.invoiceId,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        paymentStatus: invoice.paymentStatus,

        patient: patient.user ? {
          _id: patient._id,
          patientCode: patient.patientCode,
          name: patient.user.name,
          email: patient.user.email,
          phone: patient.user.phone,
          gender: patient.gender,
          dateOfBirth: patient.dateOfBirth,
          bloodGroup: patient.bloodGroup
        } : null,

        doctor: doctor.user ? {
          _id: doctor._id,
          doctorId: doctor.doctorId,
          name: `Dr. ${doctor.user.name}`,
          email: doctor.user.email,
          phone: doctor.user.phone,
          specialization: doctor.specialization,
          consultationFee: doctor.consultationFee
        } : null,

        appointment: appointment._id ? {
          _id: appointment._id,
          appointmentId: appointment.appointmentId,
          date: appointment.date,
          time: appointment.time,
          type: appointment.type,
          purpose: appointment.purpose,
          status: appointment.status
        } : null,

        items: invoice.items,
        amounts: {
          subTotal: invoice.subTotal,
          tax: invoice.tax,
          discount: invoice.discount,
          totalAmount: invoice.totalAmount,
          paidAmount: invoice.paidAmount,
          balanceAmount: invoice.balanceAmount
        },

        paymentDetails: {
          paymentMethod: invoice.paymentMethod,
          paymentDate: invoice.paymentDate,
          transactionId: invoice.transactionId,
          transactions: invoice.paymentTransactions || []
        },

        notes: invoice.notes,
        createdBy: invoice.createdBy,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt
      }
    });

  } catch (error) {
    console.error('Get invoice by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: error.message
    });
  }
});

// ============================
// CREATE INVOICE FROM APPOINTMENT
// ============================
const createInvoiceFromAppointment = asyncHandler(async (req, res) => {
  try {
    const { appointmentId, items = [], discount = 0, taxRate = 0, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID'
      });
    }

    // =========================
    // FETCH APPOINTMENT
    // =========================
    const appointment = await Appointment.findById(appointmentId)
      .populate({
        path: 'patient',
        select: 'patientCode gender dateOfBirth bloodGroup user',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId consultationFee specialization user',
        populate: { path: 'user', select: 'name email phone' }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // ❌ Prevent duplicate invoice
    const existingInvoice = await Billing.findOne({ appointment: appointmentId });
    if (existingInvoice) {
      return res.status(400).json({
        success: false,
        message: 'Invoice already exists for this appointment'
      });
    }

    // =========================
    // DEFAULT ITEMS (Doctor Fee)
    // =========================
    let invoiceItems = items;

    if (!invoiceItems.length) {
      invoiceItems = [{
        description: 'Consultation Fee',
        quantity: 1,
        price: appointment.doctor?.consultationFee || 0
      }];
    }

    // =========================
    // SAFE INVOICE ID
    // =========================
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const countToday = await Billing.countDocuments({
      createdAt: {
        $gte: new Date(today.setHours(0, 0, 0, 0)),
        $lt: new Date(today.setHours(23, 59, 59, 999))
      }
    });

    const invoiceId = `INV${dateStr}${String(countToday + 1).padStart(4, '0')}`;

    // =========================
    // CREATE INVOICE
    // =========================
    const invoice = await Billing.create({
      invoiceId,
      appointment: appointment._id,
      patient: appointment.patient._id,
      doctor: appointment.doctor._id,
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      items: invoiceItems,
      discount,
      tax: (invoiceItems.reduce((s, i) => s + i.price * i.quantity, 0) * taxRate) / 100,
      notes: notes || '',
      createdBy: req.user._id
    });

    // =========================
    // RESPONSE (POPULATED)
    // =========================
    const populatedInvoice = await Billing.findById(invoice._id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose status'
      })
      .populate({
        path: 'patient',
        select: 'patientCode gender dateOfBirth bloodGroup',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId consultationFee specialization',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate('createdBy', 'name email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      invoice: populatedInvoice
    });

  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: error.message
    });
  }
});


// ============================
// ADD PAYMENT TO INVOICE
// ============================

const addPaymentToInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      paymentMethod,
      transactionId,
      notes,
      paymentDate,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    const invoice = await Billing.findById(id)
      .populate('appointment')
      .populate('patient')
      .populate('doctor');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Invoice is already fully paid'
      });
    }

    if (amount > invoice.balanceAmount) {
      return res.status(400).json({
        success: false,
        message: `Payment exceeds remaining balance of ${invoice.balanceAmount}`
      });
    }

    // ❌ Prevent duplicate Razorpay payments
    if (razorpayPaymentId) {
      const exists = invoice.paymentTransactions.some(
        p => p.razorpayPaymentId === razorpayPaymentId
      );
      if (exists) {
        return res.status(409).json({
          success: false,
          message: 'This Razorpay payment has already been recorded'
        });
      }
    }

    const finalTransactionId =
      transactionId ||
      `${paymentMethod.toUpperCase()}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    // =========================
    // CREATE PAYMENT ENTRY
    // =========================
    const paymentTransaction = {
      amount,
      paymentMethod,
      transactionId: finalTransactionId,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      notes: notes || '',
      paymentBy: req.user._id,
      status: 'completed',
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    };

    invoice.paymentTransactions.push(paymentTransaction);

    // =========================
    // UPDATE TOTALS
    // =========================
    invoice.paidAmount += amount;
    invoice.balanceAmount = invoice.totalAmount - invoice.paidAmount;

    if (invoice.balanceAmount <= 0) {
      invoice.paymentStatus = 'paid';
      invoice.balanceAmount = 0;
    } else {
      invoice.paymentStatus = 'partial';
    }

    await invoice.save();

    // =========================
    // APPOINTMENT UPDATE
    // =========================
    if (invoice.appointment) {
      await Appointment.findByIdAndUpdate(invoice.appointment._id, {
        paymentStatus: invoice.paymentStatus,
        amountPaid: invoice.paidAmount,
        status: invoice.paymentStatus === 'paid' ? 'confirmed' : 'pending',
        confirmedAt: invoice.paymentStatus === 'paid' ? new Date() : undefined
      });
    }

    // =========================
    // DOCTOR EARNING (ONCE)
    // =========================
    if (invoice.paymentStatus === 'paid' && invoice.doctor) {
      const existingEarning = await DoctorEarning.findOne({
        invoice: invoice._id
      });

      if (!existingEarning) {
        const consultationItem = invoice.items.find(item =>
          item.description.toLowerCase().includes('consultation')
        );

        const consultationAmount = consultationItem
          ? consultationItem.price * consultationItem.quantity
          : 0;

        const doctorShare = consultationAmount * 0.8;

        await DoctorEarning.create({
          doctor: invoice.doctor._id,
          appointment: invoice.appointment?._id,
          patient: invoice.patient,
          invoice: invoice._id,
          amount: doctorShare,
          status: 'completed',
          earningDate: new Date()
        });
      }
    }

    // =========================
    // FINAL RESPONSE
    // =========================
    const updatedInvoice = await Billing.findById(id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time status'
      })
      .populate({
        path: 'patient',
        select: 'patientCode',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId',
        populate: { path: 'user', select: 'name email' }
      })
      .populate('paymentTransactions.paymentBy', 'name email')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Payment added successfully',
      invoice: updatedInvoice,
      payment: paymentTransaction
    });

  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment',
      error: error.message
    });
  }
});


// ============================
// UPDATE INVOICE
// ============================
const updateInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const {
      items,
      discount = 0,
      taxRate = 0,
      notes,
      dueDate,
      status
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // 🚫 LOCK invoice if payments already exist
    if (invoice.paymentTransactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoice cannot be edited after payments are recorded'
      });
    }

    // 🚫 Paid invoices are immutable
    if (invoice.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Paid invoices cannot be updated'
      });
    }

    // =========================
    // RE-CALCULATE TOTALS
    // =========================
    let subTotal = invoice.subTotal;

    if (Array.isArray(items) && items.length > 0) {
      subTotal = items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
      invoice.items = items;
    }

    const taxAmount = (subTotal * taxRate) / 100;
    const totalAmount = subTotal + taxAmount - discount;

    if (totalAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Total invoice amount cannot be negative'
      });
    }

    // =========================
    // APPLY UPDATES
    // =========================
    invoice.subTotal = subTotal;
    invoice.tax = taxAmount;
    invoice.discount = discount;
    invoice.totalAmount = totalAmount;
    invoice.balanceAmount = totalAmount; // no payments yet
    invoice.notes = notes ?? invoice.notes;
    invoice.dueDate = dueDate ?? invoice.dueDate;
    invoice.status = status ?? invoice.status;
    invoice.updatedAt = new Date();

    await invoice.save();

    // =========================
    // POPULATED RESPONSE
    // =========================
    const populatedInvoice = await Billing.findById(invoice._id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time',
        populate: [
          {
            path: 'doctor',
            select: 'doctorId',
            populate: { path: 'user', select: 'name' }
          },
          {
            path: 'patient',
            select: 'patientCode',
            populate: {
              path: 'user',
              select: 'name email phone'
            }
          }
        ]
      })
      .populate('createdBy', 'name email')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully',
      invoice: populatedInvoice
    });

  } catch (error) {
    console.error('Update invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update invoice',
      error: error.message
    });
  }
});


// ============================
// DELETE INVOICE
// ============================
const deleteInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // 🚫 Block deletion if any payment exists
    if (invoice.paymentTransactions.length > 0 || invoice.paidAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invoices with payments cannot be deleted. Use void instead.'
      });
    }

    // =========================
    // HARD DELETE ONLY FOR DRAFT
    // =========================
    if (invoice.status === 'draft') {
      if (invoice.appointment) {
        await Appointment.findByIdAndUpdate(invoice.appointment, {
          $unset: { invoice: '' },
          paymentStatus: 'pending'
        });
      }

      await Billing.findByIdAndDelete(id);

      return res.status(200).json({
        success: true,
        message: 'Draft invoice deleted permanently'
      });
    }

    // =========================
    // SOFT DELETE → VOID
    // =========================
    invoice.status = 'void';
    invoice.paymentStatus = 'void';
    invoice.voidedAt = new Date();
    invoice.voidedBy = req.user._id;
    invoice.updatedAt = new Date();

    await invoice.save();

    if (invoice.appointment) {
      await Appointment.findByIdAndUpdate(invoice.appointment, {
        $unset: { invoice: '' },
        paymentStatus: 'pending',
        status: 'cancelled'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Invoice voided successfully'
    });

  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete invoice',
      error: error.message
    });
  }
});


// ============================
// GENERATE INVOICE PDF
// ============================

const generateInvoicePDF = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time',
        populate: [
          {
            path: 'doctor',
            select: 'doctorId consultationFee',
            populate: {
              path: 'user',
              select: 'name specialization registrationNumber'
            }
          },
          {
            path: 'patient',
            select: 'patientCode user',
            populate: {
              path: 'user',
              select: 'name email phone gender dateOfBirth address'
            }
          }
        ]
      })
      .populate('createdBy', 'name')
      .populate('paymentTransactions.paymentBy', 'name');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // =========================
    // RESPONSE HEADERS
    // =========================
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename=invoice-${invoice.invoiceId}.pdf`
    );

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // =========================
    // VOID WATERMARK
    // =========================
    if (invoice.status === 'void') {
      doc
        .fontSize(80)
        .fillColor('red')
        .opacity(0.15)
        .rotate(-30, { origin: [300, 300] })
        .text('VOID', 100, 300, { align: 'center' })
        .rotate(30, { origin: [300, 300] })
        .opacity(1);
    }

    // =========================
    // HEADER
    // =========================
    doc
      .fontSize(20)
      .fillColor('#000')
      .text('MEDICAL INVOICE', { align: 'center' })
      .moveDown(1);

    doc
      .fontSize(10)
      .text(`Invoice No: ${invoice.invoiceId}`)
      .text(`Invoice Date: ${moment(invoice.invoiceDate).format('DD MMM YYYY')}`)
      .text(`Due Date: ${moment(invoice.dueDate).format('DD MMM YYYY')}`)
      .moveDown(1);

    // =========================
    // PATIENT & DOCTOR DETAILS
    // =========================
    doc.fontSize(11).text('BILL TO:', { underline: true });
    doc
      .text(invoice.patient?.user?.name || 'N/A')
      .text(`Patient ID: ${invoice.patient?.patientCode || 'N/A'}`)
      .text(`Phone: ${invoice.patient?.user?.phone || '-'}`)
      .text(`Email: ${invoice.patient?.user?.email || '-'}`)
      .moveDown(1);

    doc.fontSize(11).text('DOCTOR:', { underline: true });
    doc
      .text(`Dr. ${invoice.appointment?.doctor?.user?.name || 'N/A'}`)
      .text(invoice.appointment?.doctor?.user?.specialization || '')
      .text(
        `Reg. No: ${
          invoice.appointment?.doctor?.user?.registrationNumber || 'N/A'
        }`
      )
      .moveDown(2);

    // =========================
    // ITEMS TABLE
    // =========================
    const tableTop = doc.y;
    const colX = [40, 260, 340, 420, 500];

    doc.fontSize(11).text('Description', colX[0], tableTop);
    doc.text('Qty', colX[1], tableTop);
    doc.text('Price', colX[2], tableTop);
    doc.text('Total', colX[3], tableTop);

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    let y = doc.y + 5;

    invoice.items.forEach(item => {
      doc
        .fontSize(10)
        .text(item.description, colX[0], y, { width: 200 })
        .text(item.quantity, colX[1], y)
        .text(`₹${item.price}`, colX[2], y)
        .text(`₹${item.price * item.quantity}`, colX[3], y);
      y += 20;
    });

    doc.moveDown(2);

    // =========================
    // TOTALS
    // =========================
    doc
      .fontSize(11)
      .text(`Subtotal: ₹${invoice.subTotal}`, { align: 'right' })
      .text(`Tax: ₹${invoice.tax}`, { align: 'right' })
      .text(`Discount: ₹${invoice.discount}`, { align: 'right' })
      .moveDown(0.5)
      .fontSize(13)
      .text(`TOTAL: ₹${invoice.totalAmount}`, { align: 'right' })
      .moveDown(0.5)
      .fontSize(11)
      .text(`Paid: ₹${invoice.paidAmount}`, { align: 'right' })
      .text(`Balance: ₹${invoice.balanceAmount}`, { align: 'right' });

    // =========================
    // FOOTER
    // =========================
    doc
      .moveDown(3)
      .fontSize(9)
      .fillColor('gray')
      .text(
        'This is a system generated invoice and does not require signature.',
        { align: 'center' }
      );

    doc.end();

  } catch (error) {
    console.error('Generate invoice PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate invoice PDF',
      error: error.message
    });
  }
});


// ============================
// GET UNBILLED APPOINTMENTS
// ============================
const getUnbilledAppointments = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    // =========================
    // BASE QUERY
    // =========================
    const query = {
      $or: [
        { invoice: { $exists: false } },
        { invoice: null }
      ],
      status: { $in: ['confirmed', 'completed'] }
    };

    // =========================
    // SEARCH
    // =========================
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { appointmentId: regex }
      ];
    }

    // =========================
    // FETCH DATA
    // =========================
    const [appointments, total] = await Promise.all([
      Appointment.find(query)
        .populate({
          path: 'patient',
          select: 'patientCode user',
          populate: {
            path: 'user',
            select: 'name email phone'
          }
        })
        .populate({
          path: 'doctor',
          select: 'doctorId consultationFee',
          populate: {
            path: 'user',
            select: 'name specialization'
          }
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Appointment.countDocuments(query)
    ]);

    // =========================
    // FORMAT FOR BILLING UI
    // =========================
    const formattedAppointments = appointments.map(appt => {
      const patientUser = appt.patient?.user || {};
      const doctorUser = appt.doctor?.user || {};

      return {
        _id: appt._id,
        appointmentId: appt.appointmentId,
        date: appt.date,
        time: appt.time,
        type: appt.type,
        purpose: appt.purpose,

        patient: {
          _id: appt.patient?._id,
          patientCode: appt.patient?.patientCode,
          name: patientUser.name || 'N/A',
          email: patientUser.email || 'N/A',
          phone: patientUser.phone || 'N/A'
        },

        doctor: {
          _id: appt.doctor?._id,
          name: doctorUser.name ? `Dr. ${doctorUser.name}` : 'N/A',
          specialization: doctorUser.specialization || 'N/A',
          consultationFee: appt.doctor?.consultationFee || 0
        }
      };
    });

    res.status(200).json({
      success: true,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      appointments: formattedAppointments
    });

  } catch (error) {
    console.error('Get unbilled appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unbilled appointments',
      error: error.message
    });
  }
});


// ============================
// GET PAYMENT METHODS
// ============================
const getPaymentMethods = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,

    paymentMethods: [
      {
        value: 'cash',
        label: 'Cash',
        isOnline: false
      },
      {
        value: 'card',
        label: 'Credit / Debit Card',
        isOnline: true
      },
      {
        value: 'upi',
        label: 'UPI',
        isOnline: true
      },
      {
        value: 'netbanking',
        label: 'Net Banking',
        isOnline: true
      },
      {
        value: 'cheque',
        label: 'Cheque',
        isOnline: false
      },
      {
        value: 'insurance',
        label: 'Insurance',
        isOnline: false,
        requiresApproval: true
      }
    ],

    paymentGateways: [
      {
        value: 'razorpay',
        label: 'Razorpay'
      }
    ],

    paymentStatus: [
      {
        value: 'pending',
        label: 'Pending'
      },
      {
        value: 'partial',
        label: 'Partially Paid'
      },
      {
        value: 'paid',
        label: 'Paid'
      },
      {
        value: 'overdue',
        label: 'Overdue'
      },
      {
        value: 'refunded',
        label: 'Refunded'
      }
    ],

    invoiceStatus: [
      {
        value: 'draft',
        label: 'Draft'
      },
      {
        value: 'active',
        label: 'Active'
      },
      {
        value: 'void',
        label: 'Void'
      }
    ]
  });
});



// ============================
// GET SUMMARY STATS
// ============================
const getSummaryStats = asyncHandler(async (req, res) => {
  try {
    const today = new Date();

    const [stats] = await Billing.aggregate([
      {
        $match: {
          status: { $ne: 'void' }
        }
      },
      {
        $group: {
          _id: null,

          totalInvoices: { $sum: 1 },

          paidCount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0]
            }
          },

          partialCount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'partial'] }, 1, 0]
            }
          },

          pendingCount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0]
            }
          },

          overdueCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$dueDate', today] },
                    { $ne: ['$paymentStatus', 'paid'] }
                  ]
                },
                1,
                0
              ]
            }
          },

          totalRevenue: { $sum: '$totalAmount' },
          collectedRevenue: { $sum: '$paidAmount' },
          outstandingRevenue: { $sum: '$balanceAmount' }
        }
      }
    ]);

    const result = stats || {
      totalInvoices: 0,
      paidCount: 0,
      partialCount: 0,
      pendingCount: 0,
      overdueCount: 0,
      totalRevenue: 0,
      collectedRevenue: 0,
      outstandingRevenue: 0
    };

    res.status(200).json({
      success: true,
      summary: result
    });

  } catch (error) {
    console.error('Get summary stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch summary statistics',
      error: error.message
    });
  }
});

// ============================
// EXPORT INVOICES TO EXCEL
// ============================
const exportInvoices = asyncHandler(async (req, res) => {
  try {
    const { startDate, endDate, paymentStatus } = req.query;

    const query = {
      status: { $ne: 'void' }
    };

    // Date range (safe day bounds)
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`)
      };
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

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
        select: 'appointmentId'
      })
      .sort({ createdAt: -1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Invoices');

    worksheet.columns = [
      { header: 'Invoice ID', key: 'invoiceId', width: 20 },
      { header: 'Invoice Date', key: 'date', width: 15 },
      { header: 'Patient Name', key: 'patientName', width: 25 },
      { header: 'Patient Code', key: 'patientCode', width: 15 },
      { header: 'Appointment ID', key: 'appointmentId', width: 20 },
      { header: 'Subtotal', key: 'subTotal', width: 15 },
      { header: 'Tax', key: 'tax', width: 15 },
      { header: 'Discount', key: 'discount', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Paid Amount', key: 'paidAmount', width: 15 },
      { header: 'Balance Amount', key: 'balanceAmount', width: 15 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 18 },
      { header: 'Due Date', key: 'dueDate', width: 15 }
    ];

    // Style header row
    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    let totals = {
      subTotal: 0,
      tax: 0,
      discount: 0,
      totalAmount: 0,
      paidAmount: 0,
      balanceAmount: 0
    };

    invoices.forEach(invoice => {
      totals.subTotal += invoice.subTotal || 0;
      totals.tax += invoice.tax || 0;
      totals.discount += invoice.discount || 0;
      totals.totalAmount += invoice.totalAmount || 0;
      totals.paidAmount += invoice.paidAmount || 0;
      totals.balanceAmount += invoice.balanceAmount || 0;

      worksheet.addRow({
        invoiceId: invoice.invoiceId,
        date: moment(invoice.invoiceDate).format('DD/MM/YYYY'),
        patientName: invoice.patient?.user?.name || 'N/A',
        patientCode: invoice.patient?.patientCode || 'N/A',
        appointmentId: invoice.appointment?.appointmentId || 'N/A',
        subTotal: invoice.subTotal,
        tax: invoice.tax,
        discount: invoice.discount,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        balanceAmount: invoice.balanceAmount,
        paymentStatus: invoice.paymentStatus,
        paymentMethod: invoice.paymentMethod || 'N/A',
        dueDate: invoice.dueDate ? moment(invoice.dueDate).format('DD/MM/YYYY') : 'N/A'
      });
    });

    // Currency formatting
    [6, 7, 8, 9, 10, 11].forEach(colIndex => {
      worksheet.getColumn(colIndex).numFmt = '"₹"#,##0.00';
    });

    // Totals row
    const totalRow = worksheet.addRow({
      invoiceId: 'TOTAL',
      subTotal: totals.subTotal,
      tax: totals.tax,
      discount: totals.discount,
      totalAmount: totals.totalAmount,
      paidAmount: totals.paidAmount,
      balanceAmount: totals.balanceAmount
    });

    totalRow.font = { bold: true };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=billing-report-${moment().format('YYYY-MM-DD')}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Export invoices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export invoices',
      error: error.message
    });
  }
});


// ============================
// REFUND PAYMENT
// ============================
const refundPayment = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, reason, refundDate, razorpayRefundId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Refund amount must be greater than 0'
      });
    }

    const invoice = await Billing.findById(id)
      .populate({ path: 'appointment', select: 'appointmentId' })
      .session(session);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    /* ================== VALIDATION ================== */

    if (['void', 'cancelled'].includes(invoice.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot refund a void or cancelled invoice'
      });
    }

    if (invoice.paidAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'No payment available to refund'
      });
    }

    if (amount > invoice.paidAmount) {
      return res.status(400).json({
        success: false,
        message: `Refund exceeds paid amount (${invoice.paidAmount})`
      });
    }

    /* ================== REFUND TRANSACTION ================== */

    const refundTransaction = {
      amount: Number(-Math.abs(amount)),
      paymentMethod: invoice.paymentMethod,
      transactionId: razorpayRefundId || `REFUND-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      paymentDate: refundDate ? new Date(refundDate) : new Date(),
      notes: `Refund: ${reason || 'No reason provided'}`,
      paymentBy: req.user._id,
      status: 'refunded',
      razorpayRefundId
    };

    invoice.paymentTransactions.push(refundTransaction);

    /* ================== UPDATE INVOICE ================== */

    invoice.paidAmount = Number((invoice.paidAmount - amount).toFixed(2));
    invoice.balanceAmount = Number((invoice.totalAmount - invoice.paidAmount).toFixed(2));

    if (invoice.paidAmount === 0) {
      invoice.paymentStatus = 'pending';
    } else if (invoice.balanceAmount > 0) {
      invoice.paymentStatus = 'partial';
    } else {
      invoice.paymentStatus = 'refunded';
    }

    invoice.updatedAt = new Date();

    await invoice.save({ session });

    /* ================== SYNC APPOINTMENT ================== */

    if (invoice.appointment) {
      await Appointment.findByIdAndUpdate(
        invoice.appointment._id,
        {
          paymentStatus: invoice.paymentStatus,
          refundStatus: 'processed',
          refundAmount: amount,
          refundReason: reason,
          refundDate: new Date(),
          refundId: refundTransaction.transactionId
        },
        { session }
      );
    }

    /* ================== DOCTOR EARNING LOGIC ================== */

    if (invoice.paymentStatus === 'refunded') {
      await DoctorEarning.findOneAndUpdate(
        { appointment: invoice.appointment?._id },
        {
          status: 'refunded',
          refundedAt: new Date()
        },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    /* ================== RESPONSE ================== */

    const updatedInvoice = await Billing.findById(id)
      .populate('paymentTransactions.paymentBy', 'name email');

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      invoice: updatedInvoice,
      refund: refundTransaction
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error('Refund payment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process refund'
    });
  }
});


// ============================
// GET INVOICE BY PATIENT ID
// ============================
const getInvoicesByPatientId = asyncHandler(async (req, res) => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 10, status, paymentStatus } = req.query;

    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid patient ID'
      });
    }

    /* ================== VERIFY PATIENT ================== */

    const patient = await Patient.findById(patientId)
      .populate('user', 'name email phone')
      .lean();

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    /* ================== BUILD QUERY ================== */

    const query = { patient: patientId };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (paymentStatus && paymentStatus !== 'all') {
      query.paymentStatus = paymentStatus;
    }

    /* ================== PAGINATION ================== */

    const pageNum = Math.max(parseInt(page), 1);
    const limitNum = Math.max(parseInt(limit), 1);
    const skip = (pageNum - 1) * limitNum;

    /* ================== FETCH INVOICES ================== */

    const [invoices, total] = await Promise.all([
      Billing.find(query)
        .populate({
          path: 'appointment',
          select: 'appointmentId date time type purpose',
          populate: {
            path: 'doctor',
            select: 'doctorId',
            populate: {
              path: 'user',
              select: 'name specialization'
            }
          }
        })
        .populate({
          path: 'doctor',
          select: 'doctorId',
          populate: {
            path: 'user',
            select: 'name specialization'
          }
        })
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Billing.countDocuments(query)
    ]);

    /* ================== STATS (FILTER-AWARE) ================== */

    const stats = await Billing.aggregate([
      { $match: query },
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
          partialInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'partial'] }, 1, 0] }
          },
          paidInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] }
          },
          overdueInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'overdue'] }, 1, 0] }
          },
          refundedInvoices: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, 1, 0] }
          }
        }
      }
    ]);

    const patientStats = stats[0] || {
      totalInvoices: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalBalance: 0,
      pendingInvoices: 0,
      partialInvoices: 0,
      paidInvoices: 0,
      overdueInvoices: 0,
      refundedInvoices: 0
    };

    /* ================== RESPONSE ================== */

    res.status(200).json({
      success: true,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      invoices,
      patient: {
        _id: patient._id,
        patientCode: patient.patientCode,
        user: patient.user
      },
      statistics: patientStats
    });

  } catch (error) {
    console.error('Get invoices by patient error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patient invoices',
      error: error.message
    });
  }
});


// ============================
// GET INVOICE BY APPOINTMENT ID
// ============================
const getInvoiceByAppointmentId = asyncHandler(async (req, res) => {
  try {
    const { appointmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID'
      });
    }

    const invoice = await Billing.findOne({ appointment: appointmentId })
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose status',
        populate: [
          {
            path: 'doctor',
            select: 'doctorId consultationFee',
            populate: {
              path: 'user',
              select: 'name email phone specialization'
            }
          },
          {
            path: 'patient',
            select: 'patientCode user',
            populate: {
              path: 'user',
              select: 'name email phone'
            }
          }
        ]
      })
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate('createdBy', 'name email')
      .populate('paymentTransactions.paymentBy', 'name email')
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'No invoice found for this appointment'
      });
    }

    res.status(200).json({
      success: true,
      invoice
    });

  } catch (error) {
    console.error('Get invoice by appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: error.message
    });
  }
});


// ============================
// VOID INVOICE
// ============================
const voidInvoice = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Cannot void already voided or cancelled invoice
    if (['void', 'cancelled'].includes(invoice.status)) {
      return res.status(400).json({
        success: false,
        message: `Invoice is already ${invoice.status}`
      });
    }

    // Cannot void invoice with payments
    if (invoice.paidAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot void invoice with payments. Process refund first.'
      });
    }

    // Mark invoice as voided
    invoice.status = 'void';
    invoice.paymentStatus = 'cancelled';
    invoice.notes = `${invoice.notes || ''}\n[VOIDED on ${new Date().toISOString()}] Reason: ${reason || 'No reason provided'}`;
    invoice.updatedAt = new Date();
    await invoice.save();

    // Update linked appointment if exists
    if (invoice.appointment) {
      await Appointment.findByIdAndUpdate(invoice.appointment, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: req.user._id,
        cancellationReason: `Invoice voided: ${reason || 'No reason provided'}`
      });
    }

    res.status(200).json({
      success: true,
      message: 'Invoice voided successfully',
      invoice
    });

  } catch (error) {
    console.error('Void invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to void invoice',
      error: error.message
    });
  }
});


// ============================
// UPDATE INVOICE ITEMS
// ============================
const updateInvoiceItems = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { items, tax, discount } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invoice ID'
      });
    }

    const invoice = await Billing.findById(id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Ensure invoice is editable
    if (!['active', 'draft'].includes(invoice.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only active or draft invoices can be updated'
      });
    }

    if (invoice.paidAmount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update invoice with payments'
      });
    }

    // Update items if provided
    if (items && Array.isArray(items) && items.length > 0) {
      const invoiceItems = items.map(item => {
        const quantity = item.quantity || 1;
        const price = item.price || 0;
        const total = quantity * price;

        return {
          description: item.description || 'Service',
          quantity,
          price,
          total
        };
      });

      invoice.items = invoiceItems;
      invoice.subTotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
    }

    // Update tax and discount safely
    if (typeof tax === 'number') invoice.tax = tax;
    if (typeof discount === 'number') invoice.discount = discount;

    // Recalculate totals
    invoice.totalAmount = invoice.subTotal + invoice.tax - invoice.discount;
    invoice.balanceAmount = invoice.totalAmount - invoice.paidAmount;
    invoice.updatedAt = new Date();

    await invoice.save();

    const updatedInvoice = await Billing.findById(id)
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
      });

    res.status(200).json({
      success: true,
      message: 'Invoice items updated successfully',
      invoice: updatedInvoice
    });

  } catch (error) {
    console.error('Update invoice items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update invoice items',
      error: error.message
    });
  }
});

// ============================
// GET DASHBOARD STATISTICS
// ============================
const getDashboardStatistics = asyncHandler(async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    const [aggregatedStats, paymentMethodsStats, overdueInvoices] = await Promise.all([
      // Faceted aggregation for daily, monthly, yearly
      Billing.aggregate([
        {
          $facet: {
            today: [
              { $match: { createdAt: { $gte: startOfToday } } },
              { $group: { _id: null, invoices: { $sum: 1 }, revenue: { $sum: '$totalAmount' }, collected: { $sum: '$paidAmount' }, pending: { $sum: '$balanceAmount' } } }
            ],
            monthly: [
              { $match: { createdAt: { $gte: startOfMonth } } },
              { $group: { _id: null, invoices: { $sum: 1 }, revenue: { $sum: '$totalAmount' }, collected: { $sum: '$paidAmount' }, pending: { $sum: '$balanceAmount' } } }
            ],
            yearly: [
              { $match: { createdAt: { $gte: startOfYear } } },
              { $group: { _id: null, invoices: { $sum: 1 }, revenue: { $sum: '$totalAmount' }, collected: { $sum: '$paidAmount' }, pending: { $sum: '$balanceAmount' } } }
            ]
          }
        }
      ]),
      // Payment methods
      Billing.aggregate([
        { $match: { paymentMethod: { $ne: null } } },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
        { $sort: { amount: -1 } }
      ]),
      // Overdue invoices
      Billing.countDocuments({ paymentStatus: 'overdue', balanceAmount: { $gt: 0 } })
    ]);

    // Recent payments
    const recentPayments = await Billing.aggregate([
      { $unwind: '$paymentTransactions' },
      { $match: { 'paymentTransactions.status': 'completed', 'paymentTransactions.amount': { $gt: 0 } } },
      { $sort: { 'paymentTransactions.paymentDate': -1 } },
      { $limit: 10 },
      { $lookup: {
          from: 'patients',
          localField: 'patient',
          foreignField: '_id',
          as: 'patientDetails'
      }},
      { $unwind: { path: '$patientDetails', preserveNullAndEmptyArrays: true } },
      { $project: {
          invoiceId: 1,
          patient: { _id: '$patientDetails._id', patientCode: '$patientDetails.patientCode', name: '$patientDetails.user.name' },
          amount: '$paymentTransactions.amount',
          paymentMethod: '$paymentTransactions.paymentMethod',
          paymentDate: '$paymentTransactions.paymentDate',
          transactionId: '$paymentTransactions.transactionId'
      }}
    ]);

    const statistics = {
      today: aggregatedStats[0].today[0] || { invoices: 0, revenue: 0, collected: 0, pending: 0 },
      monthly: aggregatedStats[0].monthly[0] || { invoices: 0, revenue: 0, collected: 0, pending: 0 },
      yearly: aggregatedStats[0].yearly[0] || { invoices: 0, revenue: 0, collected: 0, pending: 0 },
      paymentMethods: paymentMethodsStats,
      overdueInvoices,
      recentPayments
    };

    res.status(200).json({
      success: true,
      statistics
    });

  } catch (error) {
    console.error('Get dashboard statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
});

//  ============================

// Create Invoice
const createInvoice = asyncHandler(async (req, res) => {
  try {
    const {
      appointmentId,
      patientId,
      items,
      tax = 0,
      discount = 0,
      notes = '',
      paymentMethod,
      dueDate
    } = req.body;

    if ((!appointmentId && !patientId) || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide appointmentId or patientId and at least one item'
      });
    }

    let appointment = null;
    let patient = null;
    let doctor = null;

    if (appointmentId) {
      appointment = await Appointment.findById(appointmentId)
        .populate({
          path: 'patient',
          populate: { path: 'user', select: 'name email phone' }
        })
        .populate({
          path: 'doctor',
          populate: { path: 'user', select: 'name specialization' }
        });

      if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });

      patient = appointment.patient;
      doctor = appointment.doctor;

      // Prevent duplicate invoice
      const existingInvoice = await Billing.findOne({ appointment: appointmentId });
      if (existingInvoice) {
        return res.status(400).json({ success: false, message: 'Invoice already exists for this appointment' });
      }
    } else {
      patient = await Patient.findById(patientId).populate({ path: 'user', select: 'name email phone' });
      if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    // Calculate invoice items
    const invoiceItems = items.map(item => {
      const quantity = item.quantity || 1;
      const price = item.price || 0;
      return {
        description: item.description || 'Service',
        quantity,
        price,
        total: quantity * price
      };
    });

    const subTotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
    const totalAmount = subTotal + tax - discount;
    const balanceAmount = totalAmount;

    // Generate invoice ID (format: INVYYYYMMDDXXX)
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const count = await Billing.countDocuments({
      createdAt: { $gte: new Date(year, date.getMonth(), date.getDate()), $lt: new Date(year, date.getMonth(), date.getDate() + 1) }
    });
    const invoiceId = `INV${year}${month}${day}${String(count + 1).padStart(3, '0')}`;

    // Create invoice
    const invoice = await Billing.create({
      invoiceId,
      appointment: appointmentId || null,
      patient: patient._id,
      doctor: doctor ? doctor._id : null,
      invoiceDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : moment().add(15, 'days').toDate(),
      items: invoiceItems,
      subTotal,
      tax,
      discount,
      totalAmount,
      paidAmount: 0,
      balanceAmount,
      paymentStatus: 'pending',
      status: 'active',
      paymentMethod: paymentMethod || null,
      notes,
      createdBy: req.user._id
    });

    // Update appointment reference
    if (appointment) {
      appointment.invoice = invoice._id;
      appointment.paymentStatus = 'pending';
      appointment.status = 'pending_payment';
      await appointment.save();
    }

    // Populate invoice before returning
    const populatedInvoice = await Billing.findById(invoice._id)
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type purpose',
        populate: [
          { path: 'doctor', populate: { path: 'user', select: 'name specialization' } },
          { path: 'patient', populate: { path: 'user', select: 'name email phone' } }
        ]
      })
      .populate({ path: 'patient', populate: { path: 'user', select: 'name email phone' } })
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      invoice: populatedInvoice
    });

  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create invoice',
      error: error.message
    });
  }
});


const addPayment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, method, reference, notes, date } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice ID' });
    }

    const invoice = await Billing.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Validate payment amount
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Payment amount must be greater than 0' });
    }

    if (amount > invoice.balanceAmount) {
      return res.status(400).json({ success: false, message: `Payment cannot exceed balance of ${invoice.balanceAmount}` });
    }

    // Safe method handling
    let paymentMethod = 'CASH'; // default
    if (typeof method === 'string' && method.trim() !== '') {
      paymentMethod = method.trim().toUpperCase();
    }

  
    // Create payment transaction
    const paymentTransaction = {
      amount,
      paymentMethod,
      transactionId: reference || `TRX-${Date.now()}`,
      paymentDate: date ? new Date(date) : new Date(),
      notes: notes || '',
      paymentBy: req.user._id,
      status: 'completed'
    };

    // Update invoice amounts and status
    invoice.paidAmount += amount;
    invoice.balanceAmount = invoice.totalAmount - invoice.paidAmount;
    invoice.paymentStatus = invoice.balanceAmount > 0 ? 'partial' : 'paid';
    invoice.paymentMethod = paymentMethod;
    invoice.paymentDate = date ? new Date(date) : new Date();
    invoice.transactionId = reference || invoice.transactionId;
    invoice.paymentTransactions.push(paymentTransaction);
    invoice.updatedAt = new Date();


    await invoice.save();

    const updatedInvoice = await Billing.findById(id)
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: { path: 'user', select: 'name email' }
      });

    res.status(200).json({
      success: true,
      message: 'Payment added successfully',
      invoice: updatedInvoice
    });

  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment',
      error: error.message
    });
  }
});


module.exports = {
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
  getSummaryStats,
  exportInvoices,
  getInvoicesByPatientId,
  getInvoiceByAppointmentId,
  voidInvoice,
  updateInvoiceItems,
  getDashboardStatistics,
  addPayment
};
