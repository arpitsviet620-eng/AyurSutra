// controllers/doctorMedicalRecordsController.js
const MedicalRecord = require('../models/medicalRecord');
const Patient = require('../models/patientModels');
const Doctor = require('../models/doctorModels');
const Appointment = require('../models/appointmentModels');
const asyncHandler = require('express-async-handler');
const multer = require('multer');
const path = require('path');
const cloudinary = require('../config/cloudinary');

// Configure multer for memory storage (upload to buffer for Cloudinary)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, PNG, and TXT files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
}).array('attachments', 5); // Allow up to 5 files

// Helper function to upload files to Cloudinary
const uploadToCloudinary = async (fileBuffer, originalname, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'auto',
        public_id: path.parse(originalname).name.replace(/\s+/g, '_') + '_' + Date.now(),
        timeout: 60000
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    
    uploadStream.end(fileBuffer);
  });
};

/* =========================
   DOCTOR/ADMIN CONTROLLER FUNCTIONS
========================= */

// @desc    Get all patients for doctor/admin
// @route   GET /api/doctor/medical-records/patients
// @access  Private (Doctor, Admin)
const getPatientsList = asyncHandler(async (req, res) => {
  try {
    let {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'name',
      sortOrder = 'asc',
      status
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    let query = {};

    // ===============================
    // ✅ DOCTOR: ONLY HIS APPOINTED PATIENTS
    // ===============================
    if (req.user.role === 'doctor') {

      if (!req.user.doctorProfile) {
        return res.status(400).json({
          success: false,
          message: 'Doctor profile not found'
        });
      }

      // 1️⃣ Get unique patient IDs from appointments
      const patientIds = await Appointment.distinct('patient', {
        doctor: req.user.doctorProfile,
        status: { $ne: 'cancelled' } // optional
      });

      if (!patientIds.length) {
        return res.status(200).json({
          success: true,
          count: 0,
          total: 0,
          patients: []
        });
      }

      query._id = { $in: patientIds };
    }

    // ===============================
    // 🔍 SEARCH
    // ===============================
    if (search) {
      query.$or = [
        { patientCode: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // ===============================
    // 📌 STATUS FILTER
    // ===============================
    if (status) {
      query.status = status;
    }

    const sortOptions = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1
    };

    const skip = (page - 1) * limit;

    // ===============================
    // 🚀 FETCH PATIENTS
    // ===============================
    const [patients, total] = await Promise.all([
      Patient.find(query)
        .populate('user', 'name email phone')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      Patient.countDocuments(query)
    ]);

    // ===============================
    // 📅 LAST APPOINTMENT (OPTIMIZED)
    // ===============================
    const patientIds = patients.map(p => p._id);

    const lastAppointments = await Appointment.aggregate([
      {
        $match: {
          patient: { $in: patientIds }
        }
      },
      {
        $sort: { date: -1 }
      },
      {
        $group: {
          _id: '$patient',
          lastAppointmentDate: { $first: '$date' },
          lastAppointmentStatus: { $first: '$status' }
        }
      }
    ]);

    const appointmentMap = {};
    lastAppointments.forEach(a => {
      appointmentMap[a._id.toString()] = a;
    });

    const finalPatients = patients.map(p => ({
      ...p,
      lastAppointment: appointmentMap[p._id]?.lastAppointmentDate || null,
      lastAppointmentStatus: appointmentMap[p._id]?.lastAppointmentStatus || null
    }));

    res.status(200).json({
      success: true,
      count: finalPatients.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      patients: finalPatients
    });

  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

const getMyRecords = asyncHandler(async (req, res) => {
  const records = await MedicalRecord.find({
    patient: req.user.patientProfile,
    isArchived: false
  })
  .populate('doctor', 'user specialization')
  .populate('doctor.user', 'name')
  .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: records.length,
    records
  });
});


// @desc    Get doctor's appointments (completed)
// @route   GET /api/doctor/medical-records/appointments
// @access  Private (Doctor, Admin)
const getDoctorAppointments = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = 'completed',
      startDate,
      endDate,
      patientId
    } = req.query;

    // Build query
    let query = {};

    // For doctors, only their appointments
    if (req.user.role === 'doctor') {
      query.doctor = req.user.doctorProfile;
    } else if (req.user.role === 'admin') {
      // Admin can see all appointments
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by patient
    if (patientId) {
      query.patient = patientId;
    }

    // Date range filter
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [appointments, total] = await Promise.all([
      Appointment.find(query)
        .populate('patient', 'name patientCode age gender')
        .populate('doctor', 'user department specialization')
        .populate('doctor.user', 'name')
        .sort({ date: -1, time: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Appointment.countDocuments(query)
    ]);

    // Check which appointments already have medical records
    const appointmentsWithRecordStatus = await Promise.all(
      appointments.map(async (appointment) => {
        const hasRecord = await MedicalRecord.findOne({
          appointment: appointment._id,
          isArchived: false
        }).select('_id');

        return {
          ...appointment,
          hasMedicalRecord: !!hasRecord,
          medicalRecordId: hasRecord?._id || null
        };
      })
    );

    res.status(200).json({
      success: true,
      count: appointments.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      appointments: appointmentsWithRecordStatus
    });

  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Create medical record from appointment
// @route   POST /api/doctor/medical-records/from-appointment/:appointmentId
// @access  Private (Doctor, Admin)
const createRecordFromAppointment = asyncHandler(async (req, res) => {
  try {
    const { appointmentId } = req.params;

    // Get appointment details
    const appointment = await Appointment.findById(appointmentId)
      .populate('patient', 'name patientCode age gender')
      .populate('doctor', 'user department specialization')
      .populate('doctor.user', 'name');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment already has a medical record
    const existingRecord = await MedicalRecord.findOne({
      appointment: appointmentId,
      isArchived: false
    });

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: 'Medical record already exists for this appointment'
      });
    }

    // Handle file uploads
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      const {
        title = `Follow-up: ${appointment.date ? new Date(appointment.date).toLocaleDateString() : 'Appointment'}`,
        description,
        recordType = 'consultation',
        diagnosis,
        notes = appointment.notes || '',
        visitType = 'follow-up',
        status = 'confirmed',
        confidence = 'High',
        icdCode,
        vitalSigns,
        labResults,
        treatment,
        followUp,
        tags
      } = req.body;

      // Validate required fields
      if (!diagnosis) {
        return res.status(400).json({
          success: false,
          message: 'Diagnosis is required'
        });
      }

      // Parse JSON fields if they're strings
      let parsedVitalSigns = {};
      let parsedLabResults = {};
      let parsedTreatment = {};
      let parsedFollowUp = {};

      try {
        if (vitalSigns) parsedVitalSigns = typeof vitalSigns === 'string' ? JSON.parse(vitalSigns) : vitalSigns;
        if (labResults) parsedLabResults = typeof labResults === 'string' ? JSON.parse(labResults) : labResults;
        if (treatment) parsedTreatment = typeof treatment === 'string' ? JSON.parse(treatment) : treatment;
        if (followUp) parsedFollowUp = typeof followUp === 'string' ? JSON.parse(followUp) : followUp;
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON in one of the fields'
        });
      }

      // Process uploaded files to Cloudinary
      const attachments = [];
      if (req.files && req.files.length > 0) {
        try {
          for (const file of req.files) {
            const result = await uploadToCloudinary(
              file.buffer,
              file.originalname,
              `medical-records/patient-${appointment.patient._id}`
            );

            attachments.push({
              fileName: file.originalname,
              fileSize: file.size,
              fileType: file.mimetype,
              fileUrl: result.secure_url,
              cloudinaryPublicId: result.public_id,
              cloudinaryFormat: result.format
            });
          }
        } catch (uploadError) {
          console.error('Cloudinary upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Error uploading files to cloud storage'
          });
        }
      }

      // Create medical record
      const medicalRecord = new MedicalRecord({
        patient: appointment.patient._id,
        doctor: appointment.doctor._id,
        appointment: appointmentId,
        title,
        description,
        recordType,
        date: appointment.date || new Date(),
        diagnosis,
        notes: notes || appointment.notes || '',
        visitType,
        status,
        confidence,
        icdCode,
        vitalSigns: parsedVitalSigns,
        labResults: parsedLabResults,
        treatment: parsedTreatment,
        followUp: parsedFollowUp,
        attachments,
        tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
        createdBy: req.user._id
      });

      const savedRecord = await medicalRecord.save();

      // Update appointment status to completed (if not already)
      if (appointment.status !== 'completed') {
        appointment.status = 'completed';
        appointment.completedAt = new Date();
        await appointment.save();
      }

      // Populate references
      await savedRecord.populate([
        { path: 'patient', select: 'name patientCode age gender' },
        { path: 'doctor', select: 'user department specialization' },
        { path: 'doctor.user', select: 'name' },
        { path: 'appointment', select: 'date time status' }
      ]);

      res.status(201).json({
        success: true,
        message: 'Medical record created successfully from appointment',
        record: savedRecord
      });
    });

  } catch (error) {
    console.error('Error creating record from appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Create medical record for patient (without appointment)
// @route   POST /api/doctor/medical-records/patient/:patientId
// @access  Private (Doctor, Admin)
const createRecordForPatient = asyncHandler(async (req, res) => {
  try {
    const { patientId } = req.params;

    // Get patient details
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Handle file uploads
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      const {
        title,
        description,
        recordType = 'consultation',
        date = new Date(),
        diagnosis,
        notes,
        visitType = 'routine',
        status = 'confirmed',
        confidence = 'High',
        icdCode,
        vitalSigns,
        labResults,
        treatment,
        followUp,
        tags
      } = req.body;

      // Validate required fields
      if (!title || !diagnosis) {
        return res.status(400).json({
          success: false,
          message: 'Title and diagnosis are required'
        });
      }

      // Parse JSON fields
      let parsedVitalSigns = {};
      let parsedLabResults = {};
      let parsedTreatment = {};
      let parsedFollowUp = {};

      try {
        if (vitalSigns) parsedVitalSigns = typeof vitalSigns === 'string' ? JSON.parse(vitalSigns) : vitalSigns;
        if (labResults) parsedLabResults = typeof labResults === 'string' ? JSON.parse(labResults) : labResults;
        if (treatment) parsedTreatment = typeof treatment === 'string' ? JSON.parse(treatment) : treatment;
        if (followUp) parsedFollowUp = typeof followUp === 'string' ? JSON.parse(followUp) : followUp;
      } catch (parseError) {
        return res.status(400).json({
          success: false,
          message: 'Invalid JSON in one of the fields'
        });
      }

      // Process uploaded files to Cloudinary
      const attachments = [];
      if (req.files && req.files.length > 0) {
        try {
          for (const file of req.files) {
            const result = await uploadToCloudinary(
              file.buffer,
              file.originalname,
              `medical-records/patient-${patientId}`
            );

            attachments.push({
              fileName: file.originalname,
              fileSize: file.size,
              fileType: file.mimetype,
              fileUrl: result.secure_url,
              cloudinaryPublicId: result.public_id,
              cloudinaryFormat: result.format
            });
          }
        } catch (uploadError) {
          console.error('Cloudinary upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Error uploading files to cloud storage'
          });
        }
      }

      // Create medical record
      const medicalRecord = new MedicalRecord({
        patient: patientId,
        doctor: req.user.doctorProfile || req.user._id,
        title,
        description,
        recordType,
        date,
        diagnosis,
        notes,
        visitType,
        status,
        confidence,
        icdCode,
        vitalSigns: parsedVitalSigns,
        labResults: parsedLabResults,
        treatment: parsedTreatment,
        followUp: parsedFollowUp,
        attachments,
        tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [],
        createdBy: req.user._id
      });

      const savedRecord = await medicalRecord.save();

      // Populate references
      await savedRecord.populate([
        { path: 'patient', select: 'name patientCode age gender' },
        { path: 'doctor', select: 'user department specialization' },
        { path: 'doctor.user', select: 'name' },
        { path: 'createdBy', select: 'name email' }
      ]);

      res.status(201).json({
        success: true,
        message: 'Medical record created successfully',
        record: savedRecord
      });
    });

  } catch (error) {
    console.error('Error creating medical record:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update medical record
// @route   PUT /api/doctor/medical-records/:recordId
// @access  Private (Doctor, Admin)
const updateRecord = asyncHandler(async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this record'
      });
    }

    // Handle file uploads
    upload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }

      // Process new uploaded files to Cloudinary
      const newAttachments = [];
      if (req.files && req.files.length > 0) {
        try {
          for (const file of req.files) {
            const result = await uploadToCloudinary(
              file.buffer,
              file.originalname,
              `medical-records/patient-${record.patient}`
            );

            newAttachments.push({
              fileName: file.originalname,
              fileSize: file.size,
              fileType: file.mimetype,
              fileUrl: result.secure_url,
              cloudinaryPublicId: result.public_id,
              cloudinaryFormat: result.format
            });
          }
        } catch (uploadError) {
          console.error('Cloudinary upload error:', uploadError);
          return res.status(500).json({
            success: false,
            message: 'Error uploading files to cloud storage'
          });
        }
      }

      // Update record fields
      const updateData = { ...req.body };

      // Handle JSON fields
      ['vitalSigns', 'labResults', 'treatment', 'followUp', 'tags', 'symptoms'].forEach(field => {
        if (updateData[field] && typeof updateData[field] === 'string') {
          try {
            updateData[field] = JSON.parse(updateData[field]);
          } catch (e) {
            // Keep as is if not valid JSON
          }
        }
      });

      // Add new attachments to existing ones
      if (newAttachments.length > 0) {
        updateData.attachments = [...record.attachments, ...newAttachments];
      }

      updateData.updatedBy = req.user._id;

      // Update the record
      const updatedRecord = await MedicalRecord.findByIdAndUpdate(
        recordId,
        updateData,
        { new: true, runValidators: true }
      ).populate([
        { path: 'patient', select: 'name patientCode age gender' },
        { path: 'doctor', select: 'user department specialization' },
        { path: 'doctor.user', select: 'name' },
        { path: 'appointment', select: 'date time status' },
        { path: 'updatedBy', select: 'name email' }
      ]);

      res.status(200).json({
        success: true,
        message: 'Medical record updated successfully',
        record: updatedRecord
      });
    });

  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete medical record (soft delete)
// @route   DELETE /api/doctor/medical-records/:recordId
// @access  Private (Doctor, Admin)
const deleteRecord = asyncHandler(async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this record'
      });
    }

    // Optional: Delete files from Cloudinary
    if (record.attachments && record.attachments.length > 0) {
      try {
        const publicIds = record.attachments
          .filter(attachment => attachment.cloudinaryPublicId)
          .map(attachment => attachment.cloudinaryPublicId);
        
        if (publicIds.length > 0) {
          await cloudinary.api.delete_resources(publicIds);
        }
      } catch (cloudinaryError) {
        console.error('Error deleting files from Cloudinary:', cloudinaryError);
        // Continue with soft delete even if file deletion fails
      }
    }

    // Soft delete by archiving
    record.isArchived = true;
    record.updatedBy = req.user._id;
    await record.save();

    res.status(200).json({
      success: true,
      message: 'Medical record deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting medical record:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete attachment from record
// @route   DELETE /api/doctor/medical-records/:recordId/attachments/:attachmentId
// @access  Private (Doctor, Admin)
const deleteAttachment = asyncHandler(async (req, res) => {
  try {
    const { recordId, attachmentId } = req.params;

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this record'
      });
    }

    // Find the attachment
    const attachmentIndex = record.attachments.findIndex(
      attachment => attachment._id.toString() === attachmentId
    );

    if (attachmentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const attachment = record.attachments[attachmentIndex];

    // Delete from Cloudinary if cloudinaryPublicId exists
    if (attachment.cloudinaryPublicId) {
      try {
        await cloudinary.uploader.destroy(attachment.cloudinaryPublicId);
      } catch (cloudinaryError) {
        console.error('Error deleting file from Cloudinary:', cloudinaryError);
        // Continue with removal from record even if Cloudinary deletion fails
      }
    }

    // Remove attachment from array
    record.attachments.splice(attachmentIndex, 1);
    record.updatedBy = req.user._id;
    await record.save();

    res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully',
      record
    });

  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get medical record details
// @route   GET /api/doctor/medical-records/:recordId
// @access  Private (Doctor, Admin)
const getRecordDetails = asyncHandler(async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await MedicalRecord.findById(recordId)
      .populate('patient', 'name patientCode age gender bloodGroup allergies medicalHistory')
      .populate('doctor', 'user department specialization experience')
      .populate('doctor.user', 'name email')
      .populate('appointment', 'date time status notes symptoms')
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role');

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this record'
      });
    }

    res.status(200).json({
      success: true,
      record
    });

  } catch (error) {
    console.error('Error fetching medical record:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Get patient's medical records (for doctor/admin)
// @route   GET /api/doctor/medical-records/patient/:patientId/records
// @access  Private (Doctor, Admin)
const getPatientRecords = asyncHandler(async (req, res) => {
  try {
    const { patientId } = req.params;

    const {
      page = 1,
      limit = 20,
      recordType,
      startDate,
      endDate,
      search,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    // Verify patient exists
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Check authorization for doctors
    if (req.user.role === 'doctor') {
      // Check if doctor has appointments with this patient
      const hasAccess = await Appointment.findOne({
        doctor: req.user.doctorProfile,
        patient: patientId
      });

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this patient\'s records'
        });
      }
    }

    // Build query
    const query = {
      patient: patientId,
      isArchived: false
    };

    if (recordType) {
      query.recordType = recordType;
    }

    // Date range filter
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    // Search
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { diagnosis: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [records, total] = await Promise.all([
      MedicalRecord.find(query)
        .populate('doctor', 'user department specialization')
        .populate('doctor.user', 'name')
        .populate('appointment', 'date time')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      MedicalRecord.countDocuments(query)
    ]);

    // Get statistics
    const stats = await MedicalRecord.getRecordStats(patientId);

    res.status(200).json({
      success: true,
      count: records.length,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      stats,
      patient: {
        _id: patient._id,
        name: patient.name,
        patientCode: patient.patientCode,
        age: patient.age,
        gender: patient.gender,
        bloodGroup: patient.bloodGroup
      },
      records
    });

  } catch (error) {
    console.error('Error fetching patient records:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Download record file
// @route   GET /api/doctor/medical-records/download/:recordId/:fileIndex
// @access  Private (Doctor, Admin)
const downloadRecordFile = asyncHandler(async (req, res) => {
  try {
    const { recordId, fileIndex } = req.params;

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this file'
      });
    }

    const attachments = record.attachments;
    const index = parseInt(fileIndex);

    if (!attachments || attachments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No files attached to this record'
      });
    }

    if (index < 0 || index >= attachments.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file index'
      });
    }

    const file = attachments[index];
    
    // Redirect to Cloudinary URL
    if (file.fileUrl) {
      // Cloudinary files have secure URLs, just redirect
      return res.redirect(file.fileUrl);
    }

    return res.status(404).json({
      success: false,
      message: 'File not found'
    });

  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Send record to patient (email notification)
// @route   POST /api/doctor/medical-records/:recordId/send
// @access  Private (Doctor, Admin)
const sendRecordToPatient = asyncHandler(async (req, res) => {
  try {
    const { recordId } = req.params;

    const record = await MedicalRecord.findById(recordId)
      .populate('patient', 'name email')
      .populate('doctor', 'user')
      .populate('doctor.user', 'name');

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Medical record not found'
      });
    }

    // Check authorization
    if (req.user.role === 'doctor' && record.doctor.toString() !== req.user.doctorProfile?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to send this record'
      });
    }

    // TODO: Implement email sending logic here
    // This is a placeholder for email sending functionality
    console.log(`Would send record ${recordId} to patient ${record.patient.email}`);

    res.status(200).json({
      success: true,
      message: 'Medical record sent to patient successfully',
      data: {
        patientName: record.patient.name,
        patientEmail: record.patient.email,
        recordTitle: record.title,
        sentAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error sending record to patient:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending record to patient',
      error: error.message
    });
  }
});

// @desc    Get dashboard statistics for doctor
// @route   GET /api/doctor/medical-records/dashboard/stats
// @access  Private (Doctor, Admin)
const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const doctorId = req.user.doctorProfile || req.user._id;

    // Get total patients
    const totalPatients = await Appointment.distinct('patient', {
      doctor: doctorId
    }).then(patients => patients.length);

    // Get total medical records created
    const totalRecords = await MedicalRecord.countDocuments({
      doctor: doctorId,
      isArchived: false
    });

    // Get records by type
    const recordsByType = await MedicalRecord.aggregate([
      {
        $match: {
          doctor: doctorId,
          isArchived: false
        }
      },
      {
        $group: {
          _id: '$recordType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    // Get recent records
    const recentRecords = await MedicalRecord.find({
      doctor: doctorId,
      isArchived: false
    })
      .populate('patient', 'name patientCode')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.status(200).json({
      success: true,
      stats: {
        totalPatients,
        totalRecords,
        recordsByType,
        recentRecords
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = {
  getPatientsList,
  getDoctorAppointments,
  createRecordFromAppointment,
  createRecordForPatient,
  updateRecord,
  deleteRecord,
  deleteAttachment,
  getRecordDetails,
  getPatientRecords,
  downloadRecordFile,
  sendRecordToPatient,
  getDashboardStats,
  getMyRecords
};