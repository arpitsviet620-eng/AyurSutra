// controllers/doctorController.js
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const User = require('../models/userModels');
const Doctor = require('../models/doctorModels');
const Appointment = require('../models/appointmentModels');
const Service = require("../models/serviceModels");
const bcrypt = require('bcryptjs');
const { generateDoctorId } = require('../utils/generatePatientId');

// Helper function to check if object ID is valid
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/* ================= DOCTOR SERVICES ================= */
const getDoctorServices = asyncHandler(async (req, res) => {
  const doctor = await Doctor.findOne({ doctorId: req.params.doctorId });

  if (!doctor) {
    return res.status(404).json({ success: false, message: "Doctor not found" });
  }

  const services = await Service.find({
    category: doctor.department,
    isActive: true,
  });

  res.json({
    success: true,
    doctor: doctor.doctorId,
    services,
  });
});

// @desc    Get all doctors with filters
// @route   GET /api/doctors
// @access  Private
const getDoctors = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search,
      department,
      available,
      minExperience,
      maxFee
    } = req.query;

    // Build match conditions
    const matchConditions = { role: 'doctor' };

    if (search) {
      matchConditions.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    
    const pipeline = [
  // 1️⃣ Start with User
  { $match: { role: 'doctor' } }, // सब users जिनका role doctor है

  // 2️⃣ Lookup doctor info
  {
    $lookup: {
      from: 'doctors',
      localField: '_id',  // User._id
      foreignField: 'user', // Doctor.user
      as: 'doctor'
    }
  },

  // 3️⃣ Unwind doctor (अगर doctor profile missing है तो null छोड़ दो)
  {
    $unwind: {
      path: '$doctor',
      preserveNullAndEmptyArrays: true // 🔑 register-only doctor भी आएगा
    }
  },

  // 4️⃣ Final shape
  {
    $project: {
      _id: { $ifNull: ['$doctor._id', '$_id'] }, // Doctor._id या User._id fallback
      doctorCode: '$doctor.doctorId',
      department: '$doctor.department',
      specialization: '$doctor.specialization',
      consultationFee: '$doctor.consultationFee',
      experience: '$doctor.experience',
      isAvailable: { $ifNull: ['$doctor.isAvailable', true] }, // default true
      maxPatientsPerDay: { $ifNull: ['$doctor.maxPatientsPerDay', 20] },
      location: '$doctor.location',
      licenseNumber: '$doctor.licenseNumber',
      education: '$doctor.education',
      createdAt: '$doctor.createdAt',

      user: {
        _id: '$_id',
        name: '$name',
        email: '$email',
        phone: '$phone',
        photo: '$photo',
        bio: '$bio',
        role: '$role'
      }
    }
  }
];

    // Add filters
    if (department) {
      pipeline.push({ $match: { department: { $regex: department, $options: 'i' } } });
    }

    if (available !== undefined) {
      const isAvailable = available === 'true';
      pipeline.push({ $match: { isAvailable: isAvailable } });
    }

    if (minExperience) {
      pipeline.push({
        $match: { experience: { $gte: Number(minExperience) } }
      });
    }

    if (maxFee) {
      pipeline.push({
        $match: { consultationFee: { $lte: Number(maxFee) } }
      });
    }

    // Get total count
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: 'total' });
    const countResult = await User.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add pagination
    const skip = (page - 1) * limit;
    pipeline.push(
      { $sort: { 'user.name': 1 } },
      { $skip: skip },
      { $limit: Number(limit) }
    );

    const doctors = await User.aggregate(pipeline);

    res.json({
      success: true,
      doctors,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      hasMore: (page * limit) < total
    });

  } catch (error) {
    console.error('Error in getDoctors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctors',
      error: error.message
    });
  }
});

// @desc    Get single doctor by ID
// @route   GET /api/doctors/:id
// @access  Private
const getDoctorById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID'
      });
    }

    // Find doctor and populate user
    const doctor = await Doctor.findById(id).populate('user', 'name email phone photo bio');

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Find appointments for this doctor
    const appointments = await Appointment.find({ doctor: id })
      .populate('patient', 'name')
      .sort({ date: -1 })
      .limit(10);

    res.json({
      success: true,
      doctor: {
        ...doctor.toObject(),
        appointments
      }
    });

  } catch (error) {
    console.error('Error in getDoctorById:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor details',
      error: error.message
    });
  }
});

// @desc    Get doctor by user ID
// @route   GET /api/doctors/user/:userId
// @access  Private
const getDoctorByUserId = asyncHandler(async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Find user first
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role !== 'doctor') {
      return res.status(400).json({
        success: false,
        message: 'User is not a doctor'
      });
    }

    // Find doctor profile
    const doctorProfile = await Doctor.findOne({ user: userId });

    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...doctorProfile.toObject(),
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          photo: user.photo,
          role: user.role,
          bio: user.bio
        }
      }
    });

  } catch (error) {
    console.error('Error in getDoctorByUserId:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor information',
      error: error.message
    });
  }
});

// @desc    Create doctor
// @route   POST /api/doctors
// @access  Private/Admin
const createDoctor = asyncHandler(async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      specialization,
      department,
      consultationFee,
      experience,
      qualifications,
      education,
      licenseNumber,
      maxPatientsPerDay,
      bio,
      location
    } = req.body;

    // Validate required fields
    if (!name || !email || !password || !department || !consultationFee) {
      return res.status(400).json({
        success: false,
        message: 'Required fields missing: name, email, password, department, consultationFee'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Create user
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      photo: req.body.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=667eea&color=fff&size=256`,
      role: 'doctor',
      bio: bio || ''
    });

    // Create doctor profile
    const doctorId = await generateDoctorId();
    
    const doctor = await Doctor.create({
      doctorId,
      user: user._id,
      specialization: specialization || '',
      department,
      consultationFee: parseFloat(consultationFee),
      experience: experience ? parseInt(experience) : 0,
      qualifications: qualifications || [],
      education: education || '',
      licenseNumber: licenseNumber || '',
      maxPatientsPerDay: maxPatientsPerDay ? parseInt(maxPatientsPerDay) : 20,
      location: location || '',
      isAvailable: true,
      rating: 0,
      totalRatings: 0
    });

    // Populate and return
    const populatedDoctor = await Doctor.findById(doctor._id)
      .populate('user', 'name email phone photo bio');

    res.status(201).json({
      success: true,
      message: 'Doctor created successfully',
      doctor: populatedDoctor
    });

  } catch (error) {
    console.error('Error in createDoctor:', error);
    
    // Clean up user if doctor creation failed
    if (req.body.email) {
      await User.findOneAndDelete({ email: req.body.email });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating doctor',
      error: error.message
    });
  }
});

// controllers/doctorController.js
const updateMyDoctorProfile = asyncHandler(async (req, res) => {
  try {
    // console.log("Updating doctor profile for user:", req.user._id);
    // console.log("Request body:", req.body);
    
    const doctor = await Doctor.findOne({ user: req.user._id });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    /* ===============================
       🧠 SAFE FIELD MAPPING
    =============================== */
    
    const updateFields = {};
    
    if (req.body.department && req.body.department.trim() !== '') {
      updateFields.department = req.body.department.toLowerCase();
    }

    if (Array.isArray(req.body.specialization) && req.body.specialization.length > 0) {
      updateFields.specialization = req.body.specialization;
    } else if (req.body.specialization && typeof req.body.specialization === 'string') {
      updateFields.specialization = [req.body.specialization];
    }

    if (req.body.experience !== undefined) {
      updateFields.experience = Number(req.body.experience);
    }

    if (req.body.consultationFee !== undefined) {
      updateFields.consultationFee = Number(req.body.consultationFee);
    }

    if (req.body.maxPatientsPerDay !== undefined) {
      updateFields.maxPatientsPerDay = Number(req.body.maxPatientsPerDay);
    }

    if (req.body.licenseNumber && req.body.licenseNumber.trim() !== '') {
      // ライセンス番号の重複チェック（自分自身は除外）
      const existingLicense = await Doctor.findOne({
        licenseNumber: req.body.licenseNumber,
        _id: { $ne: doctor._id }
      });
      
      if (existingLicense) {
        return res.status(400).json({
          success: false,
          message: 'License number already exists'
        });
      }
      updateFields.licenseNumber = req.body.licenseNumber;
    }

    if (req.body.education && req.body.education.trim() !== '') {
      updateFields.education = req.body.education;
    }

    if (req.body.location && req.body.location.trim() !== '') {
      updateFields.location = req.body.location;
    }

    if (Array.isArray(req.body.qualifications)) {
      updateFields.qualifications = req.body.qualifications;
    }

    if (req.body.workingHours && 
        req.body.workingHours.start && 
        req.body.workingHours.end) {
      updateFields.workingHours = {
        start: req.body.workingHours.start,
        end: req.body.workingHours.end
      };
    }

    if (Array.isArray(req.body.availableDays)) {
      updateFields.availableDays = req.body.availableDays.map(d => d.toLowerCase());
    }

    if (req.body.isAvailable !== undefined) {
      updateFields.isAvailable = Boolean(req.body.isAvailable);
    }

    /* ===============================
       🚀 UPDATE DOCTOR PROFILE
    =============================== */
    await Doctor.findByIdAndUpdate(
      doctor._id,
      updateFields,
      { 
        new: true,
        runValidators: true,
        context: 'query'
      }
    );

    /* ===============================
       👤 UPDATE USER PROFILE
    =============================== */
    const userUpdateData = {};

    if (req.body.name && req.body.name.trim() !== '') {
      userUpdateData.name = req.body.name;
    }

    if (req.body.bio !== undefined) {
      userUpdateData.bio = req.body.bio || '';
    }


    if (req.body.phone && req.body.phone.trim() !== '') {
      const existingPhone = await User.findOne({
        phone: req.body.phone,
        _id: { $ne: req.user._id }
      });
      
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
      userUpdateData.phone = req.body.phone;
    }

    // メールアドレスは更新不可
    if (req.body.email) {
      return res.status(400).json({
        success: false,
        message: 'Email cannot be changed'
      });
    }

    await User.findByIdAndUpdate(
      req.user._id,
      userUpdateData,
      { 
        new: true,
        runValidators: true,
        context: 'query'
      }
    );

    // 更新されたプロファイルを取得
    const updatedDoctor = await Doctor.findOne({ user: req.user._id })
      .populate('user', 'name email phone bio photo medicalRegistrationNumber doctorLicenseId role');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedDoctor
    });

  } catch (error) {
    console.error('Error updating doctor profile:', error);
    

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }
    

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} already exists`
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});




// @desc    Delete doctor
// @route   DELETE /api/doctors/:id
// @access  Private/Admin
const deleteDoctor = asyncHandler(async (req, res) => {
  const doctorId = req.params.id;

  // Try find Doctor first
  let doctor = await Doctor.findById(doctorId);

  if (doctor) {
    // If Doctor exists, delete it
    await Doctor.findByIdAndDelete(doctorId);
  } else {
    // Could be a register-only doctor
    const user = await User.findById(doctorId);
    if (!user || user.role !== 'doctor') {
      res.status(404);
      throw new Error('Doctor not found');
    }
  }

  // Delete the linked user as well
  await User.findByIdAndDelete(doctor ? doctor.user : doctorId);

  res.json({
    success: true,
    message: 'Doctor deleted successfully'
  });
});


// @desc    Update doctor availability
// @route   PUT /api/doctors/:id/availability
// @access  Private/Admin, Doctor
const updateAvailability = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID'
      });
    }

    if (isAvailable === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isAvailable field is required'
      });
    }

    const doctor = await Doctor.findByIdAndUpdate(
      id,
      { isAvailable: Boolean(isAvailable) },
      { new: true, runValidators: true }
    ).populate('user', 'name email phone photo');

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    res.json({
      success: true,
      message: `Doctor ${isAvailable ? 'marked as available' : 'marked as unavailable'}`,
      doctor
    });

  } catch (error) {
    console.error('Error in updateAvailability:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating availability',
      error: error.message
    });
  }
});

// @desc    Get doctor statistics
// @route   GET /api/doctors/stats
// @access  Private/Admin
const getDoctorStats = asyncHandler(async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get total doctors
    const totalDoctors = await Doctor.countDocuments();

    // Get available doctors
    const availableDoctors = await Doctor.countDocuments({
      isAvailable: true
    });

    // Get average rating and fee
    const stats = await Doctor.aggregate([
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          avgFee: { $avg: '$consultationFee' },
          totalExperience: { $sum: '$experience' }
        }
      }
    ]);

    // Get today's appointments count
    const appointmentsToday = await Appointment.countDocuments({
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ['confirmed', 'pending', 'completed'] }
    });

    // Get department stats
    const departmentStats = await Doctor.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          avgFee: { $avg: '$consultationFee' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    // Calculate percentage available
    const availablePercentage = totalDoctors > 0
      ? Math.round((availableDoctors / totalDoctors) * 100)
      : 0;

    res.json({
      success: true,
      stats: {
        total: totalDoctors,
        available: availableDoctors,
        unavailable: totalDoctors - availableDoctors,
        availablePercentage,
        avgRating: stats[0]?.avgRating || 0,
        avgFee: stats[0]?.avgFee || 0,
        avgExperience: totalDoctors > 0 ? Math.round(stats[0]?.totalExperience / totalDoctors) : 0,
        appointmentsToday
      },
      departments: departmentStats.map(dept => ({
        name: dept._id || 'Unspecified',
        count: dept.count,
        avgRating: dept.avgRating || 0,
        avgFee: dept.avgFee || 0
      }))
    });

  } catch (error) {
    console.error('Error in getDoctorStats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor statistics',
      error: error.message
    });
  }
});

// @desc    Bulk update doctors
// @route   PATCH /api/doctors/bulk
// @access  Private/Admin
const bulkUpdateDoctors = asyncHandler(async (req, res) => {
  try {
    const { doctorIds, action } = req.body;

    if (!doctorIds || !Array.isArray(doctorIds) || doctorIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide doctor IDs'
      });
    }

    if (!action || !['activate', 'deactivate'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "activate" or "deactivate"'
      });
    }

    const isAvailable = action === 'activate';
    
    const result = await Doctor.updateMany(
      { _id: { $in: doctorIds } },
      { $set: { isAvailable } }
    );

    res.json({
      success: true,
      message: `${doctorIds.length} doctor(s) ${action}d successfully`,
      updatedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Error in bulkUpdateDoctors:', error);
    res.status(500).json({
      success: false,
      message: 'Error performing bulk action',
      error: error.message
    });
  }
});


// @desc    Get doctor schedule with appointments
// @route   GET /api/doctors/:id/schedule
// @access  Private/Admin/Doctor
const getDoctorSchedule = asyncHandler(async (req, res) => {
  try {
    const doctorId = req.params.id;
    const date = req.query.date;
    
    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID is required'
      });
    }

    // Format date
    let queryDate;
    if (date) {
      queryDate = new Date(date);
    } else {
      queryDate = new Date();
    }
    
    // Set to start of day
    queryDate.setHours(0, 0, 0, 0);
    const endDate = new Date(queryDate);
    endDate.setDate(endDate.getDate() + 1);

    console.log('Fetching schedule for doctor:', doctorId, 'on date:', queryDate);

    // Find doctor with user details
    const doctor = await Doctor.findById(doctorId)
      .populate('user', 'name email phone photo role bio')
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Get appointments for this doctor on selected date
    const appointments = await Appointment.find({
      doctor: doctorId,
      date: {
        $gte: queryDate,
        $lt: endDate
      }
    })
    .populate('patient', 'fullName phone patientId')
    .sort({ time: 1 })
    .lean();

    console.log('Found appointments:', appointments.length);

    // Generate time slots based on doctor's working hours
    const workingHours = doctor.workingHours || { start: '09:00', end: '17:00' };
    const timeSlots = generateTimeSlots(workingHours.start, workingHours.end, appointments);

    // Calculate stats
    const stats = calculateAppointmentStats(appointments);

    // Format doctor data
    const formattedDoctor = {
      _id: doctor._id,
      doctorId: doctor.doctorId,
      name: doctor.user?.name || 'Unknown',
      email: doctor.user?.email || 'No email',
      phone: doctor.user?.phone || 'N/A',
      photo: doctor.user?.photo,
      department: doctor.department || 'General',
      specialization: doctor.specialization || [],
      experience: doctor.experience || 0,
      consultationFee: doctor.consultationFee || 0,
      workingHours: doctor.workingHours || { start: '09:00', end: '17:00' },
      maxPatientsPerDay: doctor.maxPatientsPerDay || 20,
      availableDays: doctor.availableDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      isAvailable: doctor.isAvailable !== false,
      rating: doctor.rating || 0,
      totalRatings: doctor.totalRatings || 0,
      location: doctor.location || 'Not specified',
      education: doctor.education || 'Not specified',
      licenseNumber: doctor.licenseNumber || 'Not specified',
      bio: doctor.user?.bio || 'No bio available'
    };

    res.json({
      success: true,
      doctor: formattedDoctor,
      timeSlots,
      appointments,
      stats,
      date: queryDate.toISOString().split('T')[0]
    });

  } catch (error) {
    console.error('Error in getDoctorSchedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor schedule',
      error: error.message
    });
  }
});

// Helper function to generate time slots
const generateTimeSlots = (startTime, endTime, appointments) => {
  const slots = [];
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  let currentHour = startHour;
  let currentMinute = startMinute;
  
  while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
    const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    // Find appointment for this time slot
    const appointment = appointments.find(app => app.time === timeString);
    
    slots.push({
      time: timeString,
      appointment: appointment || null
    });
    
    // Increment by 30 minutes
    currentMinute += 30;
    if (currentMinute >= 60) {
      currentHour += 1;
      currentMinute = 0;
    }
  }
  
  return slots;
};

// Helper function to calculate appointment stats
const calculateAppointmentStats = (appointments) => {
  const stats = {
    totalAppointments: appointments.length,
    scheduled: 0,
    confirmed: 0,
    checkedIn: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    pending: 0
  };
  
  appointments.forEach(app => {
    const status = app.status?.toLowerCase() || 'scheduled';
    if (stats[status] !== undefined) {
      stats[status]++;
    }
    
    // Also count as pending if not completed/cancelled/no-show
    if (!['completed', 'cancelled', 'no-show'].includes(status)) {
      stats.pending++;
    }
  });
  
  return stats;
};

// @desc    Export doctor schedule
// @route   GET /api/doctors/:id/schedule/export
// @access  Private/Admin/Doctor
const exportDoctorSchedule = asyncHandler(async (req, res) => {
  try {
    const doctorId = req.params.id;
    const { startDate, endDate } = req.query;
    
    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID is required'
      });
    }
    
    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    // Get doctor details
    const doctor = await Doctor.findById(doctorId)
      .populate('user', 'name email phone')
      .lean();
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }
    
    // Get appointments in date range
    const appointments = await Appointment.find({
      doctor: doctorId,
      date: {
        $gte: start,
        $lte: end
      }
    })
    .populate('patient', 'fullName phone patientId')
    .sort({ date: 1, time: 1 })
    .lean();
    
    // Format data for export
    const exportData = {
      doctor: {
        name: doctor.user?.name,
        email: doctor.user?.email,
        phone: doctor.user?.phone,
        department: doctor.department,
        doctorId: doctor.doctorId
      },
      period: {
        start: startDate,
        end: endDate
      },
      appointments: appointments.map(app => ({
        appointmentId: app.appointmentId,
        date: app.date,
        time: app.time,
        patientName: app.patient?.fullName,
        patientId: app.patient?.patientId,
        patientPhone: app.patient?.phone,
        status: app.status,
        purpose: app.purpose,
        type: app.type
      })),
      stats: calculateAppointmentStats(appointments),
      generatedAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: 'Schedule exported successfully',
      data: exportData
    });
    
  } catch (error) {
    console.error('Error in exportDoctorSchedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting schedule',
      error: error.message
    });
  }
});

// @desc    Get logged-in doctor profile (session-based)
// @route   GET /api/doctors/me
// @access  Private (Doctor)
const getMyDoctorProfile = asyncHandler(async (req, res) => {
  let doctor = await Doctor.findOne({ user: req.user._id })
    .populate('user', 'name email phone bio photo medicalRegistrationNumber doctorLicenseId role');

  if (!doctor) {
    const user = await User.findById(req.user._id);

    doctor = await Doctor.create({
      user: user._id,

      // ✅ ENUM MUST MATCH (lowercase)
      department: 'general',

      // ✅ REQUIRED ARRAY (min 1)
      specialization: ['general medicine'],

      experience: 0,
      consultationFee: 0,

      // ✅ REQUIRED
      licenseNumber: user.doctorLicenseId || 'TEMP-LICENSE',
      education: 'Not specified',
      location: 'Not specified',

      workingHours: {
        start: '09:00',
        end: '17:00'
      },

      maxPatientsPerDay: 20,
      availableDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      isAvailable: true,
      qualifications: []
    });

    doctor = await Doctor.findById(doctor._id)
      .populate('user', 'name email phone bio photo medicalRegistrationNumber doctorLicenseId role');
  }

  res.json({
    success: true,
    data: doctor
  });
});



module.exports = {
  getDoctors,
  getDoctorById,
  getDoctorByUserId,
  createDoctor,
  updateMyDoctorProfile,
  deleteDoctor,
  updateAvailability,
  getDoctorStats,
  bulkUpdateDoctors,
  getDoctorSchedule,
  exportDoctorSchedule,
  getDoctorServices,
  getMyDoctorProfile
};