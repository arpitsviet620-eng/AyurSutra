const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/userModels');
const Patient = require('../models/patientModels');
const Treatment = require('../models/treatmentModels');
const cloudinary = require('cloudinary').v2;
const { generatePatientCode } = require('../utils/generatePatientId');


/*11 ===================== IMPORTS ===================== /**
 * @desc    Get logged-in patient's prescriptions
 * @route   GET /patients/me/prescriptions
 * @access  Patient
 */
const getMyPrescriptions = asyncHandler(async (req, res) => {
  let patient = req.patient;

  // fallback if patientProfile missing but Patient.user exists
  if (!patient) {
    patient = await Patient.findOne({ user: req.user._id });
  }

  // ❌ NO ERROR THROW
  if (!patient) {
    return res.status(200).json({
      success: true,
      count: 0,
      prescriptions: [],
      message: "No patient profile linked yet"
    });
  }

  const prescriptions = await Treatment.find({
    patient: patient._id,
  })
    .populate("doctor", "name email specialization")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: prescriptions.length,
    prescriptions,
  });
});


/* ===================== CREATE PATIENT ===================== */
const createPatient = asyncHandler(async (req, res) => {
  const {
    userId, phone, email, gender, dateOfBirth, bloodGroup,
    address, allergies, emergencyContact, occupation, maritalStatus, referredBy
  } = req.body;

  // Validate required fields
  if (!userId || !phone || !gender || !dateOfBirth) {
    return res.status(400).json({ 
      success: false, 
      message: 'User ID, phone, gender and date of birth are required' 
    });
  }

  // Validate phone
  const cleanPhone = phone.replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid Indian mobile number' 
    });
  }

  // Fetch user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      message: 'User not found' 
    });
  }

  // Prevent duplicate Patient
  const existingPatient = await Patient.findOne({ user: userId });
  if (existingPatient) {
    return res.status(409).json({ 
      success: false, 
      message: 'Patient profile already exists' 
    });
  }

  // Generate patient code
  const patientCode = generatePatientCode();

  const patient = await Patient.create({
    user: userId,
    patientCode,
    phone: cleanPhone,
    email: email || user.email,
    dateOfBirth: new Date(dateOfBirth),
    gender: gender.toLowerCase(),
    bloodGroup: bloodGroup || 'Not Specified',
    address: address || {},
    allergies: allergies || [],
    emergencyContact: emergencyContact || {},
    occupation: occupation || '',
    maritalStatus: maritalStatus || '',
    notes: referredBy || '',
    createdBy: req.user._id
  });

  user.patientProfile = patient._id;
  await user.save();

  res.status(201).json({ 
    success: true, 
    message: 'Patient created successfully', 
    data: patient 
  });
});

/* ===================== GET PATIENT BY ID ===================== */
const getPatientById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid patient ID'
      });
    }

    const patient = await Patient.findById(id)
      .populate('user', 'name email phone photo');

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    res.status(200).json({
      success: true,
      patient
    });

  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};


/* ===================== GET PATIENTS WITH PAGINATION ===================== */
const getPatients = asyncHandler(async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    // Build search query
    let searchQuery = {};
    
    if (search) {
      const regex = new RegExp(search, 'i');
      
      // First get user IDs that match the search
      const matchingUsers = await User.find({
        role: 'patient',
        $or: [
          { name: regex },
          { email: regex },
          { phone: regex }
        ]
      }).select('_id');

      const userIds = matchingUsers.map(user => user._id);
      
      searchQuery = {
        $or: [
          { user: { $in: userIds } },
          { patientCode: regex }
        ]
      };
    }

    // Get total count
    const total = await Patient.countDocuments(searchQuery);

    // Get patients with pagination
    const patients = await Patient.find(searchQuery)
      .populate('user', 'name email phone photo status')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedPatients = patients.map(patient => ({
      _id: patient._id,
      patientCode: patient.patientCode,
      name: patient.user?.name || '',
      phone: patient.phone || patient.user?.phone || '',
      email: patient.email || patient.user?.email || '',
      gender: patient.gender,
      age: patient.age,
      bloodGroup: patient.bloodGroup || 'Not Specified',
      status: patient.status || 'active',
      photo: patient.photo || patient.user?.photo || 
        `https://ui-avatars.com/api/?name=${encodeURIComponent(patient.user?.name || '')}&background=667eea&color=fff`,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
      userId: patient.user?._id
    }));

    res.json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      patients: formattedPatients
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching patients'
    });
  }
});

/* ===================== UPDATE PATIENT ===================== */
const updatePatient = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find patient
    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Check if user is authorized to update this patient
    if (req.user.role === 'patient' && patient.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this patient'
      });
    }

    // Handle phone update
    if (updateData.phone) {
      const cleanPhone = updateData.phone.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Indian mobile number'
        });
      }

      // Check if phone is already in use
      const existingUser = await User.findOne({
        phone: cleanPhone,
        _id: { $ne: patient.user }
      });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already in use'
        });
      }

      updateData.phone = cleanPhone;
      
      // Also update user's phone
      await User.findByIdAndUpdate(patient.user, {
        phone: cleanPhone
      });
    }

    // Handle date of birth and age calculation
    if (updateData.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateData.dateOfBirth);
      
      // Calculate age
      const birthDate = new Date(updateData.dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      updateData.age = age;
    }

    // Handle gender
    if (updateData.gender) {
      updateData.gender = updateData.gender.toLowerCase();
    }

    // Update patient
    const updatedPatient = await Patient.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('user', 'name email phone photo status');

    // Update user information if needed
    if (updateData.name || updateData.email) {
      const userUpdate = {};
      if (updateData.name) userUpdate.name = updateData.name;
      if (updateData.email) userUpdate.email = updateData.email;
      
      await User.findByIdAndUpdate(patient.user, userUpdate);
    }

    res.json({
      success: true,
      message: 'Patient updated successfully',
      data: updatedPatient
    });

  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ===================== DELETE PATIENT ===================== */
const deletePatient = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Find patient
    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Get user ID
    const userId = patient.user;

    // Delete patient record
    await Patient.findByIdAndDelete(id);

    // Remove patientProfile reference from user
    await User.findByIdAndUpdate(userId, {
      $unset: { patientProfile: 1 }
    });

    res.json({
      success: true,
      message: 'Patient deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ===================== MEDICAL RECORDS ===================== */
const getMedicalRecords = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const patient = await Patient.findById(id)
      .populate('medicalRecords.doctor', 'name specialization')
      .select('medicalRecords');

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    res.json({
      success: true,
      records: patient.medicalRecords || []
    });
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const createMedicalRecord = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const recordData = req.body;

    // Validate required fields
    if (!recordData.title || !recordData.description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Create new record
    const newRecord = {
      ...recordData,
      doctor: req.user._id,
      date: new Date(),
      createdAt: new Date()
    };

    patient.medicalRecords.unshift(newRecord);
    await patient.save();

    // Populate doctor info
    await patient.populate('medicalRecords.doctor', 'name specialization');

    res.status(201).json({
      success: true,
      message: 'Medical record added successfully',
      record: patient.medicalRecords[0]
    });
  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

const deleteMedicalRecord = asyncHandler(async (req, res) => {
  try {
    const { id, recordId } = req.params;

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Find record index
    const recordIndex = patient.medicalRecords.findIndex(
      record => record._id.toString() === recordId
    );

    if (recordIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Remove record
    patient.medicalRecords.splice(recordIndex, 1);
    await patient.save();

    res.json({
      success: true,
      message: 'Medical record deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting medical record:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/* ===================== UPLOAD PATIENT PHOTO ===================== */
const uploadPatientPhoto = asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a photo'
      });
    }

    const { id } = req.params;

    // Find patient
    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(
      `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
      {
        folder: 'patient-photos',
        width: 500,
        height: 500,
        crop: 'fill',
        gravity: 'face'
      }
    );

    // Update patient photo
    patient.photo = result.secure_url;
    await patient.save();

    // Also update user photo if exists
    if (patient.user) {
      await User.findByIdAndUpdate(patient.user, {
        photo: result.secure_url
      });
    }

    res.json({
      success: true,
      message: 'Photo uploaded successfully',
      photo: result.secure_url
    });
  } catch (error) {
    console.error('Error uploading photo:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


/* ===================== GET MY PROFILE ===================== */
const getMyPatientProfile = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ user: req.user._id })
    .populate("user", "-password -resetPasswordToken -resetPasswordOTP");

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Patient profile not found",
    });
  }

  res.status(200).json({
    success: true,
    data: patient,
  });
});


/* ===================== UPDATE MY PROFILE ===================== */
const updateMyPatientProfile = asyncHandler(async (req, res) => {
  const patient = await Patient.findOne({ user: req.user._id });

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Patient profile not found",
    });
  }

  Object.assign(patient, req.body);
  await patient.save();

  const updated = await Patient.findById(patient._id).populate(
    "user",
    "-password"
  );

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: updated,
  });
});


// In controllers/patientController.js - Add this function:

const getPatientBillingSummary = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Get billing summary
    const billingSummary = await Billing.aggregate([
      { $match: { patient: patient._id } },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          paidAmount: { $sum: '$paidAmount' },
          balanceAmount: { $sum: '$balanceAmount' }
        }
      }
    ]);

    // Get recent invoices
    const recentInvoices = await Billing.find({ patient: patient._id })
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type',
        populate: {
          path: 'doctor',
          select: 'doctorId',
          populate: {
            path: 'user',
            select: 'name specialization'
          }
        }
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Calculate totals
    const totals = await Billing.aggregate([
      { $match: { patient: patient._id } },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalPaid: { $sum: '$paidAmount' },
          totalBalance: { $sum: '$balanceAmount' },
          averageInvoice: { $avg: '$totalAmount' }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      patient: {
        _id: patient._id,
        patientCode: patient.patientCode,
        name: patient.user?.name
      },
      summary: {
        byStatus: billingSummary,
        totals: totals[0] || {
          totalInvoices: 0,
          totalAmount: 0,
          totalPaid: 0,
          totalBalance: 0,
          averageInvoice: 0
        }
      },
      recentInvoices
    });
  } catch (error) {
    console.error('Get patient billing summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patient billing summary',
      error: error.message
    });
  }
});
/* ===================== EXPORT ===================== */
module.exports = {
  createPatient,
  getPatients,
  getPatientById,
  updatePatient,
  deletePatient,
  getMedicalRecords,
  createMedicalRecord,
  deleteMedicalRecord,
  uploadPatientPhoto,
  getMyPatientProfile,
  updateMyPatientProfile,
  getMyPrescriptions,
  getPatientBillingSummary

};