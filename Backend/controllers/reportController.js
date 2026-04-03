const Report = require('../models/reportModels');
const Patient = require('../models/patientModels');
const Appointment = require('../models/appointmentModels');
const Billing = require('../models/billingModels');
const Inventory = require('../models/inventoryModels');
const asyncHandler = require('express-async-handler');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const nodemailer = require('nodemailer');
const {generateReportId} =require("../utils/generatePatientId")
// @desc    Generate report
// @route   POST /api/reports/generate
// @access  Private
const generateReport = asyncHandler(async (req, res) => {
  const {
    title,
    type,
    startDate,
    endDate,
    filters,
    format = 'json'
  } = req.body;

  let reportData = {};
  let metrics = {};

  const dateRange = {
    startDate: startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1)),
    endDate: endDate ? new Date(endDate) : new Date()
  };

  switch (type) {
    case 'financial':
      const financialData = await generateFinancialReport(dateRange, filters);
      reportData = financialData.data;
      metrics = financialData.metrics;
      break;

    case 'patient':
      const patientData = await generatePatientReport(dateRange, filters);
      reportData = patientData.data;
      metrics = patientData.metrics;
      break;

    case 'doctor':
      const doctorData = await generateDoctorReport(dateRange, filters);
      reportData = doctorData.data;
      metrics = doctorData.metrics;
      break;

    case 'appointment':
      const appointmentData = await generateAppointmentReport(dateRange, filters);
      reportData = appointmentData.data;
      metrics = appointmentData.metrics;
      break;

    case 'therapy':
      const therapyData = await generateTherapyReport(dateRange, filters);
      reportData = therapyData.data;
      metrics = therapyData.metrics;
      break;

    case 'inventory':
      const inventoryData = await generateInventoryReport(dateRange, filters);
      reportData = inventoryData.data;
      metrics = inventoryData.metrics;
      break;

    default:
      res.status(400);
      throw new Error('Invalid report type');
  }

  // Create charts data
  const charts = generateCharts(reportData, type);

  // Save report to database
  const reportId=await generateReportId();
  const report = await Report.create({
    reportId,
    title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} Report`,
    type,
    period: dateRange,
    filters,
    data: reportData,
    metrics,
    charts,
    generatedBy: req.user.id
  });

  // Generate file based on format
  let fileBuffer = null;
  let fileName = `report_${report.reportId}`;

  if (format === 'excel') {
    fileBuffer = await generateExcelReport(report);
    fileName += '.xlsx';
  } else if (format === 'pdf') {
    fileBuffer = await generatePDFReport(report);
    fileName += '.pdf';
  }

  if (fileBuffer) {
    report.filePath = `/reports/${fileName}`;
    await report.save();
  }

  res.json({
    success: true,
    message: 'Report generated successfully',
    report,
    downloadUrl: fileBuffer ? `/api/reports/${report._id}/download/${format}` : null
  });
});

// Financial Report Generator
const generateFinancialReport = async (dateRange, filters) => {
  const query = {
    billDate: {
      $gte: dateRange.startDate,
      $lte: dateRange.endDate
    }
  };

  if (filters?.paymentStatus) {
    query.paymentStatus = filters.paymentStatus;
  }

  // Get invoices
  const invoices = await Billing.find(query)
    .populate('patient', 'fullName')
    .sort('billDate');

  // Calculate metrics
  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const collectedRevenue = invoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
  const pendingPayments = invoices.reduce((sum, inv) => sum + inv.balanceAmount, 0);

  // Daily revenue trend
  const dailyRevenue = {};
  invoices.forEach(inv => {
    const date = moment(inv.billDate).format('YYYY-MM-DD');
    dailyRevenue[date] = (dailyRevenue[date] || 0) + inv.totalAmount;
  });

  // Payment method distribution
  const paymentMethodDist = {};
  invoices.forEach(inv => {
    paymentMethodDist[inv.paymentMethod] = (paymentMethodDist[inv.paymentMethod] || 0) + 1;
  });

  return {
    data: {
      invoices,
      dailyRevenue: Object.entries(dailyRevenue).map(([date, amount]) => ({ date, amount })),
      paymentMethodDist: Object.entries(paymentMethodDist).map(([method, count]) => ({ method, count }))
    },
    metrics: {
      totalRevenue,
      collectedRevenue,
      pendingPayments,
      invoiceCount: invoices.length,
      averageInvoiceValue: invoices.length > 0 ? totalRevenue / invoices.length : 0,
      collectionRate: totalRevenue > 0 ? (collectedRevenue / totalRevenue) * 100 : 0
    }
  };
};

// Doctor Report Generator
const generateDoctorReport = async (dateRange, filters) => {
  const query = {};

  // Date filter: appointments count & earnings per doctor in range
  if (dateRange) {
    query.date = {
      $gte: dateRange.startDate,
      $lte: dateRange.endDate
    };
  }

  // Filter by department / specialization / doctor
  if (filters?.doctor) query.doctor = filters.doctor;
  if (filters?.department) query.department = filters.department;

  // fetch appointments of doctors
  const appointments = await Appointment.find(query)
    .populate('doctor', 'name department specialization')
    .populate('patient', 'fullName age gender')
    .sort('date');

  // doctor wise count
  const doctorStats = {};
  const departmentStats = {};

  appointments.forEach((apt) => {
    if (!apt.doctor || !apt.doctor.name) return;

    const doc = apt.doctor.name;
    const dept = apt.doctor.department || 'Unknown';

    doctorStats[doc] = (doctorStats[doc] || 0) + 1;
    departmentStats[dept] = (departmentStats[dept] || 0) + 1;
  });

  // response format
  return {
    data: {
      appointments,
      doctorStats: Object.entries(doctorStats).map(([doctor, count]) => ({ doctor, count })),
      departmentStats: Object.entries(departmentStats).map(([department, count]) => ({ department, count }))
    },
    metrics: {
      totalDoctors: Object.keys(doctorStats).length,
      totalAppointments: appointments.length,
      busiestDoctor:
        Object.entries(doctorStats).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      busiestDepartment:
        Object.entries(departmentStats).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    }
  };
};

// Patient Report Generator
const generatePatientReport = async (dateRange, filters) => {
  const query = {
    registrationDate: {
      $gte: dateRange.startDate,
      $lte: dateRange.endDate
    }
  };

  if (filters?.status) query.status = filters.status;
  if (filters?.gender) query.gender = filters.gender;

  const patients = await Patient.find(query).sort('registrationDate');

  // Metrics
  const totalPatients = patients.length;
  const genderStats = patients.reduce((acc, patient) => {
    acc[patient.gender] = (acc[patient.gender] || 0) + 1;
    return acc;
  }, {});

  // Age distribution
  const ageGroups = { '0-18': 0, '19-30': 0, '31-45': 0, '46-60': 0, '60+': 0 };
  patients.forEach(patient => {
    if (patient.age <= 18) ageGroups['0-18']++;
    else if (patient.age <= 30) ageGroups['19-30']++;
    else if (patient.age <= 45) ageGroups['31-45']++;
    else if (patient.age <= 60) ageGroups['46-60']++;
    else ageGroups['60+']++;
  });

  return {
    data: {
      patients,
      genderStats: Object.entries(genderStats).map(([gender, count]) => ({ gender, count })),
      ageGroups: Object.entries(ageGroups).map(([group, count]) => ({ group, count }))
    },
    metrics: {
      totalPatients,
      newPatients: totalPatients,
      averageAge: patients.length > 0 ? patients.reduce((sum, p) => sum + p.age, 0) / patients.length : 0
    }
  };
};

// Appointment Report Generator
const generateAppointmentReport = async (dateRange, filters) => {
  const query = {
    date: {
      $gte: dateRange.startDate,
      $lte: dateRange.endDate
    }
  };

  if (filters?.status) query.status = filters.status;
  if (filters?.doctor) query.doctor = filters.doctor;

  const appointments = await Appointment.find(query)
    .populate('patient', 'fullName')
    .populate('doctor', 'name')
    .sort('date');

  // Metrics
  const totalAppointments = appointments.length;
  const completed = appointments.filter(a => a.status === 'completed').length;
  const cancelled = appointments.filter(a => a.status === 'cancelled').length;
  const noShow = appointments.filter(a => a.status === 'no-show').length;

  // Daily appointments
  const dailyAppointments = {};
  appointments.forEach(apt => {
    const date = moment(apt.date).format('YYYY-MM-DD');
    dailyAppointments[date] = (dailyAppointments[date] || 0) + 1;
  });

  // Doctor-wise distribution
  const doctorDistribution = {};
  appointments.forEach(apt => {
    if (apt.doctor && apt.doctor.name) {
      doctorDistribution[apt.doctor.name] = (doctorDistribution[apt.doctor.name] || 0) + 1;
    }
  });

  return {
    data: {
      appointments,
      dailyAppointments: Object.entries(dailyAppointments).map(([date, count]) => ({ date, count })),
      doctorDistribution: Object.entries(doctorDistribution).map(([doctor, count]) => ({ doctor, count }))
    },
    metrics: {
      totalAppointments,
      completed,
      cancelled,
      noShow,
      completionRate: totalAppointments > 0 ? (completed / totalAppointments) * 100 : 0,
      cancellationRate: totalAppointments > 0 ? (cancelled / totalAppointments) * 100 : 0
    }
  };
};

// Inventory Report Generator
const generateInventoryReport = async (dateRange, filters) => {
  const query = {};
  
  if (filters?.category) query.category = filters.category;
  if (filters?.isCritical) query.isCritical = filters.isCritical === 'true';

  const inventory = await Inventory.find(query).sort('category');

  // Metrics
  const totalItems = inventory.length;
  const totalValue = inventory.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const lowStockItems = inventory.filter(item => item.quantity <= item.minStockLevel).length;
  const expiredItems = inventory.filter(item => item.expiryDate && item.expiryDate < new Date()).length;

  // Category distribution
  const categoryValue = {};
  inventory.forEach(item => {
    const value = item.quantity * item.unitPrice;
    categoryValue[item.category] = (categoryValue[item.category] || 0) + value;
  });

  return {
    data: {
      inventory,
      categoryValue: Object.entries(categoryValue).map(([category, value]) => ({ category, value }))
    },
    metrics: {
      totalItems,
      totalValue,
      lowStockItems,
      expiredItems,
      averageItemValue: totalItems > 0 ? totalValue / totalItems : 0
    }
  };
};

// Therapy and Doctor reports would be similar patterns...

// Chart generator
const generateCharts = (data, type) => {
  const charts = [];

  switch (type) {
    case 'financial':
      charts.push({
        type: 'line',
        title: 'Daily Revenue Trend',
        data: data.dailyRevenue
      });
      charts.push({
        type: 'pie',
        title: 'Payment Method Distribution',
        data: data.paymentMethodDist
      });
      break;

    case 'patient':
      charts.push({
        type: 'bar',
        title: 'Patient Age Distribution',
        data: data.ageGroups
      });
      charts.push({
        type: 'pie',
        title: 'Gender Distribution',
        data: data.genderStats
      });
      break;

    case 'appointment':
      charts.push({
        type: 'line',
        title: 'Daily Appointments',
        data: data.dailyAppointments
      });
      charts.push({
        type: 'bar',
        title: 'Doctor-wise Appointments',
        data: data.doctorDistribution
      });
      break;

    case 'inventory':
      charts.push({
        type: 'pie',
        title: 'Inventory Value by Category',
        data: data.categoryValue
      });
      break;
  }

  return charts;
};

// Excel Report Generator
const generateExcelReport = async (report) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

  // Add header
  worksheet.mergeCells('A1:F1');
  worksheet.getCell('A1').value = `AyurSutra - ${report.title}`;
  worksheet.getCell('A1').font = { size: 16, bold: true };
  worksheet.getCell('A1').alignment = { horizontal: 'center' };

  // Add period info
  worksheet.getCell('A3').value = 'Period:';
  worksheet.getCell('B3').value = `${moment(report.period.startDate).format('DD/MM/YYYY')} to ${moment(report.period.endDate).format('DD/MM/YYYY')}`;

  // Add generated info
  worksheet.getCell('A4').value = 'Generated:';
  worksheet.getCell('B4').value = moment(report.generatedAt).format('DD/MM/YYYY HH:mm:ss');

  // Add metrics
  worksheet.getCell('A6').value = 'Metrics';
  worksheet.getCell('A6').font = { bold: true };

  let row = 7;
  Object.entries(report.metrics).forEach(([key, value]) => {
    worksheet.getCell(`A${row}`).value = key;
    worksheet.getCell(`B${row}`).value = typeof value === 'number' ? value.toFixed(2) : value;
    row++;
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

// PDF Report Generator
const generatePDFReport = async (report) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).text('AyurSutra Clinic', { align: 'center' });
    doc.fontSize(16).text(report.title, { align: 'center' });
    doc.moveDown();

    // Period
    doc.fontSize(12)
      .text(`Period: ${moment(report.period.startDate).format('DD/MM/YYYY')} - ${moment(report.period.endDate).format('DD/MM/YYYY')}`)
      .text(`Generated: ${moment(report.generatedAt).format('DD/MM/YYYY HH:mm:ss')}`)
      .moveDown();

    // Metrics
    doc.fontSize(14).text('Metrics', { underline: true });
    Object.entries(report.metrics).forEach(([key, value]) => {
      doc.fontSize(10).text(`${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`);
    });

    doc.end();
  });
};

// @desc    Get all reports
// @route   GET /api/reports
// @access  Private
const getReports = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, type } = req.query;

  const query = {};
  if (type) query.type = type;

  const reports = await Report.find(query)
    .populate('generatedBy', 'name')
    .sort('-generatedAt')
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Report.countDocuments(query);

  res.json({
    success: true,
    count: reports.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    reports
  });
});

// @desc    Get single report
// @route   GET /api/reports/:id
// @access  Private
const getReport = asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id)
    .populate('generatedBy', 'name email');

  if (!report) {
    res.status(404);
    throw new Error('Report not found');
  }

  res.json({
    success: true,
    report
  });
});

// @desc    Download report file
// @route   GET /api/reports/:id/download/:format
// @access  Private
const downloadReport = asyncHandler(async (req, res) => {
  const { id, format } = req.params;

  const report = await Report.findById(id);
  if (!report) {
    res.status(404);
    throw new Error('Report not found');
  }

  let fileBuffer;
  let contentType;
  let fileName = `report_${report.reportId}`;

  if (format === 'excel') {
    fileBuffer = await generateExcelReport(report);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileName += '.xlsx';
  } else if (format === 'pdf') {
    fileBuffer = await generatePDFReport(report);
    contentType = 'application/pdf';
    fileName += '.pdf';
  } else {
    res.status(400);
    throw new Error('Invalid format');
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(fileBuffer);
});

// @desc    Schedule report
// @route   POST /api/reports/schedule
// @access  Private/Admin
const scheduleReport = asyncHandler(async (req, res) => {
  const {
    title,
    type,
    scheduleFrequency,
    recipients,
    filters
  } = req.body;

  const report = await Report.create({
    title,
    type,
    filters,
    isScheduled: true,
    scheduleFrequency,
    recipients,
    generatedBy: req.user.id,
    status: 'processing'
  });

  // Here you would typically set up a cron job
  // For now, we'll just save the schedule

  res.status(201).json({
    success: true,
    message: 'Report scheduled successfully',
    report
  });
});

// @desc    Get dashboard statistics
// @route   GET /api/reports/dashboard-stats
// @access  Private
const getDashboardStats = asyncHandler(async (req, res) => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  // Patient Stats
  const totalPatients = await Patient.countDocuments();
  const newPatientsThisMonth = await Patient.countDocuments({
    registrationDate: { $gte: startOfMonth }
  });

  // Appointment Stats
  const todayAppointments = await Appointment.countDocuments({
    date: {
      $gte: new Date(today.setHours(0, 0, 0, 0)),
      $lt: new Date(today.setHours(23, 59, 59, 999))
    }
  });

  const weeklyAppointments = await Appointment.countDocuments({
    date: { $gte: startOfWeek }
  });

  // Financial Stats
  const monthlyRevenue = await Billing.aggregate([
    {
      $match: {
        billDate: { $gte: startOfMonth }
      }
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$totalAmount' },
        collected: { $sum: '$paidAmount' }
      }
    }
  ]);

  // Inventory Alerts
  const lowStockItems = await Inventory.countDocuments({
    $expr: { $lte: ['$quantity', '$minStockLevel'] }
  });

  // Recent Activities
  const recentPatients = await Patient.find()
    .sort('-createdAt')
    .limit(5)
    .select('fullName registrationDate status');

  const upcomingAppointments = await Appointment.find({
    date: { $gte: new Date() },
    status: { $in: ['scheduled', 'confirmed'] }
  })
    .populate('patient', 'fullName')
    .populate('doctor', 'name')
    .sort('date')
    .limit(5);

  res.json({
    success: true,
    stats: {
      patients: {
        total: totalPatients,
        newThisMonth: newPatientsThisMonth
      },
      appointments: {
        today: todayAppointments,
        thisWeek: weeklyAppointments
      },
      financial: {
        monthlyRevenue: monthlyRevenue[0]?.revenue || 0,
        collected: monthlyRevenue[0]?.collected || 0
      },
      inventory: {
        lowStockItems
      }
    },
    recentActivities: {
      recentPatients,
      upcomingAppointments
    }
  });
});

module.exports = {
  generateReport,
  generateDoctorReport,
  generateFinancialReport,
  generatePatientReport,
  generateAppointmentReport,
  generateInventoryReport,
  getReports,
  getReport,
  downloadReport,
  scheduleReport,
  getDashboardStats
};