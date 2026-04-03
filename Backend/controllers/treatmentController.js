const mongoose = require('mongoose');
const Treatment = require('../models/treatmentModels');
const Patient = require('../models/patientModels');
const User = require('../models/userModels');
const Therapy = require('../models/therapyModels');
const {generateTreatmentId} = require('../utils/generatePatientId');
const asyncHandler = require('express-async-handler');

// @desc    Get all treatments
// @route   GET /api/treatments
// @access  Private
const getTreatments = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    search,
    patientId,
    doctorId,
    status,
    startDate,
    endDate
  } = req.query;

  const query = {};

  if (search) {
    query.$or = [
      { diagnosis: { $regex: search, $options: 'i' } },
      { 'patient.fullName': { $regex: search, $options: 'i' } },
      { treatmentId: { $regex: search, $options: 'i' } }
    ];
  }

  if (patientId) query.patient = patientId;
  if (doctorId) query.doctor = doctorId;
  if (status) query.status = status;

  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const treatments = await Treatment.find(query)
    .populate('patient', 'fullName patientId')
    .populate('doctor', 'name specialization')
    .populate('prescribedTherapies.therapy', 'name duration cost')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Treatment.countDocuments(query);

  res.json({
    success: true,
    count: treatments.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    treatments
  });
});

// @desc    Get single treatment
// @route   GET /api/treatments/:id
// @access  Private
const getTreatment = asyncHandler(async (req, res) => {
  const treatment = await Treatment.findById(req.params.id)
    .populate('patient', 'fullName patientId age gender bloodGroup')
    .populate('doctor', 'name specialization')
    .populate('prescribedTherapies.therapy', 'name description duration cost')
    .populate('createdBy', 'name');

  if (!treatment) {
    res.status(404);
    throw new Error('Treatment not found');
  }

  res.json({
    success: true,
    treatment
  });
});

// @desc    Create treatment
// @route   POST /api/treatments
// @access  Private
const createTreatment = asyncHandler(async (req, res) => {
  const {
    patient,
    diagnosis,
    chiefComplaints = [],
    symptoms = [],
    pulse = {},
    tongueExamination,
    prakriti,
    doshaImbalance = [],
    prescribedTherapies = [],
    medicines = [],
    dietRecommendations = [],
    lifestyleChanges = [],
    yogaRecommendations = [],
    followUpDate,
    notes
  } = req.body;

  /* ---------- PATIENT VALIDATION ---------- */
if (!patient || !mongoose.Types.ObjectId.isValid(patient)) {
  res.status(400);
  throw new Error("Valid patient is required");
}

  const patientExists = await Patient.findById(patient);
  if (!patientExists) {
    res.status(404);
    throw new Error("Patient not found");
  }

  /* ---------- DOCTOR FROM TOKEN ---------- */
  const doctor = req.user._id;
    if (!["doctor", "admin"].includes(req.user.role)) {
      res.status(403);
      throw new Error("Only doctors or admins can create treatment");
    }




  /* ---------- THERAPY VALIDATION ---------- */
  if (prescribedTherapies.length > 0) {
  const therapyIds = prescribedTherapies
    .map(t => t.therapy)
    .filter(id => mongoose.Types.ObjectId.isValid(id));

  const therapies = await Therapy.find({ _id: { $in: therapyIds } });

  if (therapies.length !== therapyIds.length) {
    res.status(404);
    throw new Error("One or more therapies not found");
  }
}


  /* ---------- CREATE ---------- */
  const treatmentId = await generateTreatmentId();
  const treatment = await Treatment.create({
    treatmentId,
    patient,
    doctor,
    diagnosis,
    chiefComplaints,
    symptoms,
    pulse,
    tongueExamination,
    prakriti,
    doshaImbalance,
    prescribedTherapies,
    medicines,
    dietRecommendations,
    lifestyleChanges,
    yogaRecommendations,
    followUpDate: followUpDate ? new Date(followUpDate) : null,
    notes,
    status: "ongoing",
    createdBy: req.user._id
});

  res.status(201).json({
    success: true,
    message: "Treatment created successfully",
    treatment
  });
});

// @desc    Update treatment
// @route   PUT /api/treatments/:id
// @access  Private
const updateTreatment = asyncHandler(async (req, res) => {
  const treatment = await Treatment.findById(req.params.id);

  if (!treatment) {
    res.status(404);
    throw new Error('Treatment not found');
  }

  const updatedTreatment = await Treatment.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Treatment updated successfully',
    treatment: updatedTreatment
  });
});


// @desc    Update treatment status
// @route   PUT /api/treatments/:id/status
// @access  Private
const updateTreatmentStatus = asyncHandler(async (req, res) => {
  const { status, followUpDate } = req.body;

  const treatment = await Treatment.findById(req.params.id);
  if (!treatment) {
    res.status(404);
    throw new Error('Treatment not found');
  }

  treatment.status = status;
  if (followUpDate) {
    treatment.followUpDate = new Date(followUpDate);
  }

  await treatment.save();

  res.json({
    success: true,
    message: 'Treatment status updated successfully',
    treatment
  });
});

// @desc    Get treatment statistics
// @route   GET /api/treatments/stats/overview
// @access  Private
const getTreatmentStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  // Status distribution
  const statusStats = await Treatment.aggregate([
    { $match: dateFilter },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  // Doctor-wise treatments
  const doctorStats = await Treatment.aggregate([
    { $match: dateFilter },
    { $group: { _id: '$doctor', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  // Populate doctor names
  const doctorIds = doctorStats.map(stat => stat._id);
  const doctors = await User.find({ _id: { $in: doctorIds } }, 'name specialization');

  const formattedDoctorStats = doctorStats.map(stat => {
    const doctor = doctors.find(d => d._id.toString() === stat._id.toString());
    return {
      doctor: doctor ? doctor.name : 'Unknown',
      specialization: doctor ? doctor.specialization : 'N/A',
      treatments: stat.count
    };
  });

  // Common diagnoses
  const commonDiagnoses = await Treatment.aggregate([
    { $match: dateFilter },
    { $group: { _id: '$diagnosis', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 }
  ]);

  res.json({
    success: true,
    stats: {
      statusDistribution: statusStats,
      topDoctors: formattedDoctorStats,
      commonDiagnoses
    }
  });
});

module.exports = {
  getTreatments,
  getTreatment,
  createTreatment,
  updateTreatment,
  updateTreatmentStatus,
  getTreatmentStats
};