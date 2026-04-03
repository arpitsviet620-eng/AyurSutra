const mongoose = require('mongoose');
const Appointment = require('../models/appointmentModels');
const Patient = require('../models/patientModels');
const User = require('../models/userModels');
const Doctor = require('../models/doctorModels');
const Service = require("../models/serviceModels");
const DoctorEarning = require('../models/doctorEarningModels');
const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const { razorpay, verifyPaymentSignature } = require('../config/razorpay');
const sendEmail = require('../utils/emailService');
const PDFDocument = require("pdfkit");
const Notification = require('../models/notificationModels');
const Transaction = require('../models/transactionModels'); // adjust path as needed

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Helper function to generate appointment ID
const generateAppointmentId = () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `APT${year}${month}${day}${random}`;
};


const getServices = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Build query
  let query = {};

  // Filter by active status if provided
  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === "true";
  }

  // Search by name if provided
  if (req.query.search) {
    query.name = { $regex: req.query.search, $options: "i" };
  }

  const [services, total] = await Promise.all([
    Service.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Service.countDocuments(query),
  ]);

  res.json({
    success: true,
    count: services.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    services,
  });
});


// ============================
// GET DOCTORS BY SERVICE/CATEGORY (FIXED)
// ============================
const getDoctorsByService = asyncHandler(async (req, res) => {
  const { serviceId } = req.params;

  // 1️⃣ Find service
  const service = await Service.findById(serviceId);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: "Service not found",
    });
  }

  if (!service.isActive) {
    return res.status(400).json({
      success: false,
      message: "Service is inactive",
    });
  }

  // 2️⃣ Match doctor.department = service.category
  const doctors = await Doctor.find({
    department: service.category, // 👈 EXACT MATCH
    isAvailable: true,
  })
    .populate("user", "name email phone photo")
    .lean();

  // 3️⃣ Format response
  const formattedDoctors = doctors.map((doc) => {
    const user = doc.user || {};

    return {
      _id: doc._id,
      doctorId: doc.doctorId,
      name: `Dr. ${user.name || "Unknown"}`,
      email: user.email || "",
      phone: user.phone || "",
      department: doc.department,
      specialization: doc.specialization || [],
      experience: doc.experience || 0,
      consultationFee: doc.consultationFee,
      rating: doc.rating || 4.5,
      availableDays: doc.availableDays || [],
      workingHours: doc.workingHours || {},
      image:
        user.photo ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          user.name || "Doctor"
        )}&background=4f46e5&color=fff`,
    };
  });

  res.json({
    success: true,
    service: service.name,
    category: service.category,
    count: formattedDoctors.length,
    doctors: formattedDoctors,
  });
});


// ============================
// GET AVAILABLE TIME SLOTS (IMPROVED)
// ============================
const getAvailableTimeSlots = asyncHandler(async (req, res) => {
  try {
    const { doctorId, date, serviceId } = req.query;

    if (!doctorId || !date) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID and date are required'
      });
    }

    // Validate doctor ID
    if (!isValidObjectId(doctorId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID format'
      });
    }

    // Get doctor info with user details
    const doctor = await Doctor.findById(doctorId)
      .populate('user', 'name')
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Check if doctor is available
    if (!doctor.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Doctor is currently not available for appointments'
      });
    }

    // Check if date is valid
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use YYYY-MM-DD'
      });
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      return res.status(400).json({
        success: false,
        message: 'Cannot book appointments for past dates'
      });
    }

    // Check if doctor is available on this day
    const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    
    const availableDays = doctor.availableDays || [];
    if (!availableDays.includes(dayOfWeek)) {
      return res.json({
        success: true,
        timeSlots: [],
        message: `Doctor is not available on ${dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)}`,
        doctorName: `Dr. ${doctor.user?.name || 'Unknown'}`,
        selectedDate: selectedDate.toISOString().split('T')[0]
      });
    }

    // Check if doctor is on leave
    const leaveDates = doctor.leaveDates || [];
    const isOnLeave = leaveDates.some(leaveDate => {
      const leave = new Date(leaveDate);
      return leave.toDateString() === selectedDate.toDateString();
    });

    if (isOnLeave) {
      return res.json({
        success: true,
        timeSlots: [],
        message: 'Doctor is on leave on the selected date',
        doctorName: `Dr. ${doctor.user?.name || 'Unknown'}`,
        selectedDate: selectedDate.toISOString().split('T')[0]
      });
    }

    // Get working hours
    const workingHours = doctor.workingHours || { start: '09:00', end: '17:00' };
    
    // Parse start and end times
    const [startHour, startMinute] = workingHours.start.split(':').map(Number);
    const [endHour, endMinute] = workingHours.end.split(':').map(Number);

    // Generate time slots (30-minute intervals)
    const timeSlots = [];
    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
      const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
      timeSlots.push(timeString);

      // Increment by 30 minutes
      currentMinute += 30;
      if (currentMinute >= 60) {
        currentHour += 1;
        currentMinute = 0;
      }
    }

    // Get booked appointments for this doctor on selected date
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const bookedAppointments = await Appointment.find({
      doctor: doctorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['scheduled', 'confirmed', 'checked-in'] }
    }).select('time duration');

    // Get booked time slots
    const bookedTimeSlots = new Set();
    bookedAppointments.forEach(appointment => {
      const [hour, minute] = appointment.time.split(':').map(Number);
      const appointmentEndMinute = minute + (appointment.duration || 30);
      
      let currentSlotHour = hour;
      let currentSlotMinute = minute;
      
      while (currentSlotHour < hour + 1 || 
             (currentSlotHour === hour && currentSlotMinute < appointmentEndMinute)) {
        const slotTime = `${currentSlotHour.toString().padStart(2, '0')}:${currentSlotMinute.toString().padStart(2, '0')}`;
        bookedTimeSlots.add(slotTime);
        
        currentSlotMinute += 30;
        if (currentSlotMinute >= 60) {
          currentSlotHour += 1;
          currentSlotMinute = 0;
        }
      }
    });

    // Filter out booked time slots
    const availableTimeSlots = timeSlots.filter(time => !bookedTimeSlots.has(time));

    // Check daily limit
    const maxPatientsPerDay = doctor.maxPatientsPerDay || 20;
    const dailyAppointmentCount = bookedAppointments.length;
    
    if (dailyAppointmentCount >= maxPatientsPerDay) {
      return res.json({
        success: true,
        timeSlots: [],
        message: `Doctor has reached the daily limit of ${maxPatientsPerDay} appointments`,
        doctorName: `Dr. ${doctor.user?.name || 'Unknown'}`,
        selectedDate: selectedDate.toISOString().split('T')[0],
        dailyLimitReached: true
      });
    }

    res.json({
      success: true,
      timeSlots: availableTimeSlots,
      workingHours,
      doctorName: `Dr. ${doctor.user?.name || 'Unknown'}`,
      doctorId: doctor.doctorId,
      selectedDate: selectedDate.toISOString().split('T')[0],
      dayOfWeek: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
      dailyAppointments: dailyAppointmentCount,
      maxDailyAppointments: maxPatientsPerDay
    });

  } catch (error) {
    console.error('Error fetching time slots:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available time slots',
      error: error.message
    });
  }
});

// ============================
// GET ALL DOCTORS WITH FILTERS
// ============================
const getAllDoctors = asyncHandler(async (req, res) => {
  try {
    const { department, search, isAvailable, minRating, maxFee, page = 1, limit = 10 } = req.query;

    const query = {};

    // Department filter
    if (department && department !== 'all') {
      query.department = department;
    }

    // Availability filter
    if (isAvailable === 'true') {
      query.isAvailable = true;
    } else if (isAvailable === 'false') {
      query.isAvailable = false;
    }

    // Rating filter
    if (minRating) {
      query.rating = { $gte: parseFloat(minRating) };
    }

    // Fee filter
    if (maxFee) {
      query.consultationFee = { $lte: parseFloat(maxFee) };
    }

    // Search filter
    if (search) {
      // Get user IDs that match the search
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = users.map(user => user._id);
      query.user = { $in: userIds };
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count
    const total = await Doctor.countDocuments(query);

    // Get doctors with pagination
    const doctors = await Doctor.find(query)
      .populate('user', 'name email phone photo')
      .sort({ rating: -1, experience: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const formattedDoctors = doctors.map(doctor => {
      const user = doctor.user || {};
      
      return {
        id: doctor._id,
        doctorId: doctor.doctorId,
        name: `${user.name || 'Unknown'}`,
        specialty: doctor.department,
        specialization: doctor.specialization || [],
        experience: doctor.experience || 0,
        rating: doctor.rating || 0,
        totalRatings: doctor.totalRatings || 0,
        consultationFee: doctor.consultationFee || 500,
        image: user.photo || `https://ui-avatars.com/api/?name=Dr.${encodeURIComponent(user.name || 'Doctor')}&background=667eea&color=fff`,
        availableDays: doctor.availableDays || [],
        workingHours: doctor.workingHours || { start: '09:00', end: '17:00' },
        isAvailable: doctor.isAvailable,
        bio: doctor.bio || '',
        education: doctor.education || [],
        languages: doctor.languages || [],
        maxPatientsPerDay: doctor.maxPatientsPerDay || 20
      };
    });

    // Get department statistics
    const departmentStats = await Doctor.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' },
          avgExperience: { $avg: '$experience' },
          avgFee: { $avg: '$consultationFee' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    res.json({
      success: true,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      doctors: formattedDoctors,
      departments: departmentStats,
      filters: {
        department: department || 'all',
        search: search || '',
        isAvailable: isAvailable || 'all',
        minRating: minRating || 0,
        maxFee: maxFee || ''
      }
    });

  } catch (error) {
    console.error('Error fetching all doctors:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctors',
      error: error.message
    });
  }
});

// ============================
// GET DOCTOR DETAILS BY ID
// ============================
const getDoctorDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID format'
      });
    }

    const doctor = await Doctor.findById(id)
      .populate('user', 'name email phone photo')
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    const user = doctor.user || {};

    // Get doctor's upcoming appointments count
    const upcomingAppointments = await Appointment.countDocuments({
      doctor: id,
      date: { $gte: new Date() },
      status: { $in: ['scheduled', 'confirmed'] }
    });

    // Get doctor's statistics
    const appointmentStats = await Appointment.aggregate([
      {
        $match: { doctor: new mongoose.Types.ObjectId(id) }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get available dates for next 7 days
    const availableDates = [];
    const availableDays = doctor.availableDays || [];
    const leaveDates = doctor.leaveDates || [];

    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const isOnLeave = leaveDates.some(leaveDate => {
        const leave = new Date(leaveDate);
        return leave.toDateString() === date.toDateString();
      });

      if (availableDays.includes(dayOfWeek) && !isOnLeave) {
        availableDates.push(date.toISOString().split('T')[0]);
      }
    }

    // Get next available appointment slots
    const nextAvailableSlots = [];
    const workingHours = doctor.workingHours || { start: '09:00', end: '17:00' };

    for (const dateStr of availableDates.slice(0, 3)) {
      const date = new Date(dateStr);
      const availableSlots = await getTimeSlotsForDate(id, date, workingHours);
      
      if (availableSlots.length > 0) {
        nextAvailableSlots.push({
          date: dateStr,
          slots: availableSlots.slice(0, 3), // Show only first 3 slots
          dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'short' })
        });
      }
    }

    const doctorDetails = {
      id: doctor._id,
      doctorId: doctor.doctorId,
      name: `${user.name || 'Unknown'}`,
      specialty: doctor.department,
      specialization: doctor.specialization || [],
      experience: doctor.experience || 0,
      rating: doctor.rating || 0,
      totalRatings: doctor.totalRatings || 0,
      consultationFee: doctor.consultationFee || 500,
      image: user.photo || `https://ui-avatars.com/api/?name=Dr.${encodeURIComponent(user.name || 'Doctor')}&background=667eea&color=fff`,
      availableDays: doctor.availableDays || [],
      workingHours: doctor.workingHours || { start: '09:00', end: '17:00' },
      isAvailable: doctor.isAvailable,
      bio: doctor.bio || '',
      education: doctor.education || [],
      languages: doctor.languages || [],
      awards: doctor.awards || [],
      maxPatientsPerDay: doctor.maxPatientsPerDay || 20,
      contact: {
        email: user.email || '',
        phone: user.phone || ''
      },
      statistics: {
        totalAppointments: appointmentStats.reduce((sum, stat) => sum + stat.count, 0),
        upcomingAppointments: upcomingAppointments,
        byStatus: appointmentStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      },
      availability: {
        availableDates: availableDates,
        nextAvailableSlots: nextAvailableSlots,
        isOnLeave: leaveDates.some(leaveDate => {
          const leave = new Date(leaveDate);
          return leave.toDateString() === new Date().toDateString();
        })
      }
    };

    res.json({
      success: true,
      doctor: doctorDetails
    });

  } catch (error) {
    console.error('Error fetching doctor details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor details',
      error: error.message
    });
  }
});

// Helper function to get time slots for a specific date
const getTimeSlotsForDate = async (doctorId, date, workingHours) => {
  try {
    const [startHour, startMinute] = workingHours.start.split(':').map(Number);
    const [endHour, endMinute] = workingHours.end.split(':').map(Number);

    // Generate all possible time slots
    const timeSlots = [];
    let currentHour = startHour;
    let currentMinute = startMinute;

    while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
      const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
      timeSlots.push(timeString);

      currentMinute += 30;
      if (currentMinute >= 60) {
        currentHour += 1;
        currentMinute = 0;
      }
    }

    // Get booked appointments for this date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const bookedAppointments = await Appointment.find({
      doctor: doctorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['scheduled', 'confirmed', 'checked-in'] }
    }).select('time');

    const bookedTimes = bookedAppointments.map(apt => apt.time);
    return timeSlots.filter(time => !bookedTimes.includes(time));

  } catch (error) {
    console.error('Error getting time slots:', error);
    return [];
  }
};

// ============================
// GET DOCTOR'S SCHEDULE
// ============================
const getDoctorSchedule = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid doctor ID format'
      });
    }

    const doctor = await Doctor.findById(id)
      .populate('user', 'name')
      .lean();

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Set date range (default: next 7 days)
    const defaultStartDate = new Date();
    const defaultEndDate = new Date();
    defaultEndDate.setDate(defaultEndDate.getDate() + 7);

    const queryStartDate = startDate ? new Date(startDate) : defaultStartDate;
    const queryEndDate = endDate ? new Date(endDate) : defaultEndDate;

    queryStartDate.setHours(0, 0, 0, 0);
    queryEndDate.setHours(23, 59, 59, 999);

    // Get appointments in date range
    const appointments = await Appointment.find({
      doctor: id,
      date: { $gte: queryStartDate, $lte: queryEndDate }
    })
    .populate({
      path: 'patient',
      select: 'patientCode user',
      populate: {
        path: 'user',
        select: 'name phone'
      }
    })
    .sort({ date: 1, time: 1 })
    .lean();

    // Get doctor's working hours and available days
    const workingHours = doctor.workingHours || { start: '09:00', end: '17:00' };
    const availableDays = doctor.availableDays || [];
    const leaveDates = doctor.leaveDates || [];

    // Generate schedule for each day
    const schedule = [];
    const currentDate = new Date(queryStartDate);

    while (currentDate <= queryEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = currentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      
      // Check if doctor is available on this day
      const isAvailableDay = availableDays.includes(dayOfWeek);
      
      // Check if doctor is on leave
      const isOnLeave = leaveDates.some(leaveDate => {
        const leave = new Date(leaveDate);
        return leave.toDateString() === currentDate.toDateString();
      });

      // Get appointments for this day
      const dayAppointments = appointments.filter(apt => {
        const aptDate = new Date(apt.date);
        return aptDate.toDateString() === currentDate.toDateString();
      });

      // Generate time slots
      let timeSlots = [];
      if (isAvailableDay && !isOnLeave) {
        const [startHour, startMinute] = workingHours.start.split(':').map(Number);
        const [endHour, endMinute] = workingHours.end.split(':').map(Number);

        let currentHour = startHour;
        let currentMinute = startMinute;

        while (currentHour < endHour || (currentHour === endHour && currentMinute < endMinute)) {
          const timeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
          
          // Check if slot is booked
          const isBooked = dayAppointments.some(apt => apt.time === timeString);
          
          timeSlots.push({
            time: timeString,
            isBooked,
            appointment: isBooked ? dayAppointments.find(apt => apt.time === timeString) : null
          });

          currentMinute += 30;
          if (currentMinute >= 60) {
            currentHour += 1;
            currentMinute = 0;
          }
        }
      }

      schedule.push({
        date: dateStr,
        dayOfWeek: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
        isAvailableDay,
        isOnLeave,
        workingHours: isAvailableDay && !isOnLeave ? workingHours : null,
        appointments: dayAppointments.map(apt => ({
          id: apt._id,
          appointmentId: apt.appointmentId,
          patient: apt.patient?.user?.name || 'Unknown',
          patientCode: apt.patient?.patientCode,
          time: apt.time,
          status: apt.status,
          type: apt.type,
          duration: apt.duration
        })),
        timeSlots: timeSlots
      });

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({
      success: true,
      doctor: {
        id: doctor._id,
        name: `Dr. ${doctor.user?.name || 'Unknown'}`,
        specialty: doctor.department
      },
      schedule: schedule,
      dateRange: {
        start: queryStartDate.toISOString().split('T')[0],
        end: queryEndDate.toISOString().split('T')[0],
        days: schedule.length
      }
    });

  } catch (error) {
    console.error('Error fetching doctor schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching doctor schedule',
      error: error.message
    });
  }
});



// ============================
// GET ALL APPOINTMENTS (With filters)
// ============================
const getAppointments = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      doctorId,
      patientId,
      startDate,
      endDate,
      search
    } = req.query;

    const query = {};

    // Status filtering
    if (status && status !== 'all') {
      const statuses = status.split(',');
      query.status = { $in: statuses };
    }

    // Doctor filtering
    if (doctorId && isValidObjectId(doctorId)) {
      query.doctor = doctorId;
    }

    // Patient filtering
    if (patientId && isValidObjectId(patientId)) {
      query.patient = patientId;
    }

    // Date range filtering
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Search by appointment ID or patient name
    if (search) {
      // Find patients matching the search
      const patients = await Patient.find({
        $or: [
          { patientCode: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');

      const patientIds = patients.map(p => p._id);
      
      const users = await User.find({
        name: { $regex: search, $options: 'i' }
      }).select('_id');

      const userIds = users.map(u => u._id);
      const patientUsers = await Patient.find({ user: { $in: userIds } }).select('_id');
      const allPatientIds = [...patientIds, ...patientUsers.map(p => p._id)];

      query.$or = [
        { appointmentId: { $regex: search, $options: 'i' } },
        { patient: { $in: allPatientIds } }
      ];
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get appointments with pagination
    const [appointments, total] = await Promise.all([
      Appointment.find(query)
        .populate({
          path: 'patient',
          select: 'patientCode user',
          populate: {
            path: 'user',
            select: 'name phone email photo'
          }
        })
        .populate({
          path: 'doctor',
          select: 'doctorId user',
          populate: {
            path: 'user',
            select: 'name email phone specialization photo'
          }
        })
        .sort({ date: -1, time: 1 })
        .limit(limitNum)
        .skip(skip)
        .lean(),
      Appointment.countDocuments(query)
    ]);

    // Format appointments
    const formattedAppointments = appointments.map(appointment => ({
      _id: appointment._id,
      appointmentId: appointment.appointmentId,
      patient: {
        _id: appointment.patient?._id,
        patientCode: appointment.patient?.patientCode,
        name: appointment.patient?.user?.name || 'Unknown',
        phone: appointment.patient?.user?.phone || appointment.patient?.phone,
        email: appointment.patient?.user?.email || appointment.patient?.email,
        photo: appointment.patient?.user?.photo || appointment.patient?.photo
      },
      doctor: {
        _id: appointment.doctor?._id,
        doctorId: appointment.doctor?.doctorId,
        name: appointment.doctor?.user?.name || 'Unknown',
        specialization: appointment.doctor?.user?.specialization || '',
        photo: appointment.doctor?.user?.photo
      },
      date: appointment.date,
      time: appointment.time,
      status: appointment.status,
      type: appointment.type,
      purpose: appointment.purpose,
      notes: appointment.notes,
      createdAt: appointment.createdAt
    }));

    res.json({
      success: true,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      appointments: formattedAppointments
    });

  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
});

// ============================
// GET TODAY'S APPOINTMENTS
// ============================

const getTodayAppointments = asyncHandler(async (req, res) => {
  try {
    // 📅 Today range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 🔎 Base query
    const query = {
      date: { $gte: startOfDay, $lte: endOfDay },
    };

    /**
     * 🔐 Optional Role-Based Filters
     * Uncomment if needed
     */
    // if (req.user.role === "doctor") {
    //   query.doctor = req.user.doctorProfile;
    // }
    // if (req.user.role === "patient") {
    //   query.patient = req.user.patientProfile;
    // }

    const appointments = await Appointment.find(query)
      .populate({
        path: "patient",
        select: "patientCode user",
        populate: {
          path: "user",
          select: "name phone email",
        },
      })
      .populate({
        path: "doctor",
        select: "doctorId user specialization",
        populate: {
          path: "user",
          select: "name",
        },
      })
      .sort({ time: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments.map((apt) => ({
        _id: apt._id,
        appointmentId: apt.appointmentId,
        patient: {
          name: apt.patient?.user?.name || "Unknown",
          patientCode: apt.patient?.patientCode || null,
          phone: apt.patient?.user?.phone || null,
        },
        doctor: {
          name: apt.doctor?.user?.name || "Unknown",
          specialization: apt.doctor?.specialization || "",
        },
        date: apt.date,
        time: apt.time,
        status: apt.status,
        purpose: apt.purpose,
        type: apt.type,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching today appointments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch today's appointments",
    });
  }
});


// ============================
// UPDATE APPOINTMENT STATUS
// ============================
const updateAppointmentStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancellationReason } = req.body;

    // Validate ObjectId
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid appointment ID'
      });
    }

    // Validate status
    const validStatus = ['scheduled', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'];
    if (!validStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value. Must be one of: ' + validStatus.join(', ')
      });
    }

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Update appointment
    appointment.status = status;
    
    if (status === 'cancelled' && cancellationReason) {
      appointment.cancellationReason = cancellationReason;
    }

    await appointment.save();

    // Get updated appointment with populated data
    const updatedAppointment = await Appointment.findById(id)
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: {
          path: 'user',
          select: 'name phone email'
        }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .lean();

    res.json({
      success: true,
      message: 'Appointment status updated successfully',
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating appointment status'
    });
  }
});

// ============================
// GET DASHBOARD STATS
// ============================
const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's appointments by status
    const todayStats = await Appointment.aggregate([
      {
        $match: {
          date: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Total counts
    const totalAppointments = await Appointment.countDocuments();
    
    const upcomingAppointments = await Appointment.countDocuments({
      status: { $in: ['scheduled', 'confirmed'] },
      date: { $gte: today }
    });

    const pendingAppointments = await Appointment.countDocuments({
      status: 'scheduled'
    });

    // Format stats
    const stats = {
      today: todayStats.reduce((sum, stat) => sum + stat.count, 0),
      upcoming: upcomingAppointments,
      completed: todayStats.find(s => s._id === 'completed')?.count || 0,
      cancelled: todayStats.find(s => s._id === 'cancelled')?.count || 0,
      pending: pendingAppointments,
      total: totalAppointments
    };

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching dashboard statistics'
    });
  }
});


// @desc    Get my full patient profile
// @route   GET /api/patients/me
// @access  Private
// controllers/patientController.js
const getMyPatientProfile = asyncHandler(async (req, res) => {
  // 1️⃣ If user already has patientProfile, trust it
  if (req.user.patientProfile) {
    const patient = await Patient.findById(req.user.patientProfile)
      .populate({
        path: "user",
        select: "+phone name email"
      });

    if (patient) {
      return res.status(200).json({
        success: true,
        data: patient,
      });
    }
  }

  // 2️⃣ Fallback: find patient by user ID
  let patient = await Patient.findOne({ user: req.user._id })
    .populate({
      path: "user",
      select: "+phone name email"
    });

  // 3️⃣ Auto-create patient profile if missing
  if (!patient) {
    patient = await Patient.create({
      user: req.user._id,
      createdBy: req.user._id,
      status: "active",
    });

    // 4️⃣ Link user → patient profile
    await User.findByIdAndUpdate(
      req.user._id,
      { patientProfile: patient._id },
      { new: true }
    );

    patient = await Patient.findById(patient._id)
      .populate({
        path: "user",
        select: "+phone name email"
      });
  }

  res.status(200).json({
    success: true,
    data: patient,
  });
});


// @desc    Update my patient profile
// @route   PUT /api/patients/me
// @access  Private
const updateMyPatientProfile = asyncHandler(async (req, res) => {
  try {
    const patient = await Patient.findOne({ user: req.user._id });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found",
      });
    }

    const updateFields = {};

    // Patient info
    if (req.body.dateOfBirth)
      updateFields.dateOfBirth = new Date(req.body.dateOfBirth);
    if (req.body.gender)
      updateFields.gender = req.body.gender.toLowerCase();
        if (req.body.status)
      updateFields.status = req.body.status;

    await Patient.findByIdAndUpdate(patient._id, updateFields, {
      new: true,
      runValidators: true,
    });

    /* ===============================
       👤 UPDATE USER (NO PASSWORD)
    =============================== */
    const userUpdateData = {};

    if (req.body.name) userUpdateData.name = req.body.name;
    if (req.body.phone) {
      const existingPhone = await User.findOne({
        phone: req.body.phone,
        _id: { $ne: req.user._id },
      });

      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already exists",
        });
      }

      userUpdateData.phone = req.body.phone;
    }

    if (req.body.email) {
      return res.status(400).json({
        success: false,
        message: "Email cannot be changed",
      });
    }

    await User.findByIdAndUpdate(req.user._id, userUpdateData, {
      new: true,
      runValidators: false,
    });


    const updatedPatient = await Patient.findOne({ user: req.user._id })
      .populate({
        path: "user",
        select: "+phone name email"
      });

    res.status(200).json({
      success: true,
      message: "Patient profile updated successfully",
      data: updatedPatient,
    });
  } catch (error) {
    console.error("Error updating patient profile:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


// ============================
// DOCTOR: GET DOCTOR'S APPOINTMENTS
// ============================
const getDoctorAppointments = asyncHandler(async (req, res) => {
  try {
    // Find doctor profile for logged-in user
    const doctor = await Doctor.findOne({ user: req.user._id });
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const { 
      status, 
      date, 
      search, 
      limit = 20, 
      page = 1 
    } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = { doctor: doctor._id };
    
    // Status filtering
    if (status && status !== 'all') {
      const statuses = status.split(',');
      query.status = { $in: statuses };
    }
    
    // Date filtering
    if (date) {
      const selectedDate = new Date(date);
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      query.date = { $gte: startOfDay, $lte: endOfDay };
    }
    
    // Search by patient name or appointment ID
    if (search) {
      // Find patients matching search
      const patients = await Patient.find().populate('user');
      const filteredPatients = patients.filter(p => 
        p.user?.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.patientCode?.toLowerCase().includes(search.toLowerCase())
      );
      
      const patientIds = filteredPatients.map(p => p._id);
      
      query.$or = [
        { appointmentId: { $regex: search, $options: 'i' } },
        { patient: { $in: patientIds } }
      ];
    }

    // Get appointments with pagination
    const [appointments, total] = await Promise.all([
      Appointment.find(query)
        .populate({
          path: 'patient',
          select: 'patientCode user',
          populate: {
            path: 'user',
            select: 'name phone email photo'
          }
        })
        .sort({ date: 1, time: 1 })
        .limit(limitNum)
        .skip(skip)
        .lean(),
      Appointment.countDocuments(query)
    ]);

    // Format appointments
    const formattedAppointments = appointments.map(appointment => ({
      _id: appointment._id,
      appointmentId: appointment.appointmentId,
      patient: {
        _id: appointment.patient?._id,
        patientCode: appointment.patient?.patientCode,
        name: appointment.patient?.user?.name || 'Unknown',
        phone: appointment.patient?.user?.phone || '',
        email: appointment.patient?.user?.email || '',
        photo: appointment.patient?.user?.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(appointment.patient?.user?.name || 'Patient')}&background=667eea&color=fff`
      },
      date: appointment.date,
      time: appointment.time,
      status: appointment.status,
      type: appointment.type,
      purpose: appointment.purpose || 'Consultation',
      notes: appointment.notes,
      symptoms: appointment.symptoms,
      createdAt: appointment.createdAt,
      canCancel: appointment.status === 'scheduled' || appointment.status === 'confirmed',
      canConfirm: appointment.status === 'scheduled'
    }));

    // Get statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const stats = await Appointment.aggregate([
      {
        $match: { doctor: doctor._id }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const todayStats = await Appointment.aggregate([
      {
        $match: {
          doctor: doctor._id,
          date: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const formattedStats = {
      total: total,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      today: todayStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {})
    };

    res.json({
      success: true,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      appointments: formattedAppointments,
      stats: formattedStats,
      doctor: {
        _id: doctor._id,
        doctorId: doctor.doctorId,
        name: `Dr. ${req.user.name}`,
        department: doctor.department
      }
    });

  } catch (error) {
    console.error('Error fetching doctor appointments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
});

// ============================
// DOCTOR: CONFIRM APPOINTMENT
// ============================
// const confirmAppointment = asyncHandler(async (req, res) => {
//   try {
//     const { id } = req.params;
//     const doctor = await Doctor.findOne({ user: req.user._id });
    
//     if (!doctor) {
//       return res.status(404).json({
//         success: false,
//         message: 'Doctor profile not found'
//       });
//     }

//     // Find appointment
//     const appointment = await Appointment.findOne({
//       _id: id,
//       doctor: doctor._id
//     });

//     if (!appointment) {
//       return res.status(404).json({
//         success: false,
//         message: 'Appointment not found'
//       });
//     }

//     // Check if appointment can be confirmed
//     if (appointment.status !== 'scheduled') {
//       return res.status(400).json({
//         success: false,
//         message: `Appointment is already ${appointment.status}`
//       });
//     }

//     // Update appointment status
//     appointment.status = 'confirmed';
//     appointment.confirmedAt = new Date();
//     appointment.confirmedBy = req.user._id;
    
//     await appointment.save();

//     // Get updated appointment with populated data
//     const updatedAppointment = await Appointment.findById(id)
//       .populate({
//         path: 'patient',
//         select: 'patientCode user',
//         populate: {
//           path: 'user',
//           select: 'name phone email'
//         }
//       })
//       .lean();

//     // No email sending as per requirement
//     // You can add notification logic here if needed (e.g., in-app notifications)

//     res.json({
//       success: true,
//       message: 'Appointment confirmed successfully',
//       appointment: updatedAppointment
//     });

//   } catch (error) {
//     console.error('Error confirming appointment:', error);
//     res.status(500).json({
//       success: false,
//       message: error.message || 'Error confirming appointment'
//     });
//   }
// });
const confirmAppointment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Find doctor profile
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    // Find appointment belonging to this doctor
    const appointment = await Appointment.findOne({
      _id: id,
      doctor: doctor._id
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Validate status
    if (appointment.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: `Appointment is already ${appointment.status}`
      });
    }

    // Update status
    appointment.status = 'confirmed';
    appointment.confirmedAt = new Date();
    appointment.confirmedBy = req.user._id;

    await appointment.save();

    // Populate data for response + notification
    const updatedAppointment = await Appointment.findById(id)
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: {
          path: 'user',
          select: 'name phone email'
        }
      })
      .populate({
        path: 'doctor',
        select: 'user',
        populate: {
          path: 'user',
          select: 'name'
        }
      })
      .lean();

    /* =========================
       🔔 TRIGGER NOTIFICATION
    ========================= */
    await notificationController.appointmentConfirmed(
      updatedAppointment,
      req.user
    );


    res.json({
      success: true,
      message: 'Appointment confirmed successfully',
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('Error confirming appointment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error confirming appointment'
    });
  }
});



// ============================
// DOCTOR: UPDATE APPOINTMENT STATUS (ENHANCED)
// ============================
const doctorUpdateAppointmentStatus = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const doctor = await Doctor.findOne({ user: req.user._id });
    
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    // Validate status
    const validStatus = ['checked-in', 'in-progress', 'completed', 'no-show'];
    if (!validStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value for doctor update'
      });
    }

    const appointment = await Appointment.findOne({
      _id: id,
      doctor: doctor._id
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Update appointment
    appointment.status = status;
    
    if (notes) {
      appointment.doctorNotes = notes;
    }
    
    if (status === 'completed') {
      appointment.completedAt = new Date();
    }
    
    await appointment.save();

    // Get updated appointment with populated data
    const updatedAppointment = await Appointment.findById(id)
      .populate({
        path: 'patient',
        select: 'patientCode user',
        populate: {
          path: 'user',
          select: 'name phone email'
        }
      })
      .lean();

    res.json({
      success: true,
      message: `Appointment marked as ${status}`,
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating appointment status'
    });
  }
});


//=================================
// CREATE DYNAMIC APPOINTMENT
//===============================

const createDynamicAppointment = async (req, res) => {
  try {
    const {
      serviceId,
      doctorId,
      date,
      time,
      patientName,
      patientEmail,
      patientPhone,
      patientGender,
      patientDateOfBirth,
      notes,
      amount
    } = req.body;

    // =========================
    // 1️⃣ VALIDATION
    // =========================
    if (!serviceId || !doctorId || !date || !time || !patientName || !patientEmail || !patientPhone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // =========================
    // 2️⃣ FETCH SERVICE
    // =========================
    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // =========================
    // 3️⃣ FETCH DOCTOR
    // =========================
    const doctor = await Doctor.findById(doctorId).populate('user', 'name email');
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    // =========================
    // 4️⃣ FIND OR CREATE PATIENT
    // =========================
    const userId = req.user?._id || null;

    let patient = await Patient.findOne({
      $or: [
        userId ? { user: userId } : null,
        { email: patientEmail },
        { phone: patientPhone }
      ].filter(Boolean)
    });

    if (!patient) {
      patient = await Patient.create({
        user: userId,
        name: patientName,
        email: patientEmail,
        phone: patientPhone,
        gender: patientGender || 'other',
        dateOfBirth: patientDateOfBirth || new Date('2000-01-01'),
        createdBy: userId
      });

      if (userId) {
        await User.findByIdAndUpdate(userId, {
          patientProfile: patient._id
        });
      }
    }

    // =========================
    // 5️⃣ SLOT CHECK
    // =========================
    const existingAppointment = await Appointment.findOne({
      doctor: doctor._id,
      date: new Date(date),
      time,
      status: { $in: ['confirmed', 'pending_payment'] }
    });

    if (existingAppointment) {
      return res.status(400).json({
        success: false,
        message: 'Time slot is already booked'
      });
    }

    // =========================
    // 6️⃣ AMOUNT
    // =========================
    const appointmentAmount = amount || doctor.consultationFee || 500;

    // =========================
    // 7️⃣ CREATE APPOINTMENT
    // =========================
    const appointment = await Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      date: new Date(date),
      time,
      notes,
      amount: appointmentAmount,
      status: 'pending_payment',
      paymentStatus: 'pending',
      createdBy: userId
    });

    // 🔔 SEND NOTIFICATION
    await Notification({
      appointment,
      patient,
      doctor,
      triggeredBy: userId
    });

    // =========================
    // 8️⃣ RAZORPAY ORDER
    // =========================
    try {
      const razorpayOrder = await razorpay.orders.create({
        amount: Math.round(appointmentAmount * 100),
        currency: 'INR',
        receipt: appointment._id.toString(),
        notes: {
          appointmentId: appointment._id.toString(),
          patientName: patient.name,
          doctorName: doctor.user.name,
          serviceName: service.name
        }
      });

      appointment.razorpayOrderId = razorpayOrder.id;
      await appointment.save();

      return res.status(201).json({
        success: true,
        message: 'Appointment created. Complete payment.',
        appointment,
        razorpay: {
          key: process.env.RAZORPAY_KEY_ID,
          orderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency
        }
      });

    } catch (razorpayError) {
      appointment.paymentStatus = 'failed';
      appointment.status = 'payment_failed';
      await appointment.save();

      return res.status(201).json({
        success: true,
        message: 'Appointment created but payment failed',
        appointment
      });
    }

  } catch (error) {
    console.error('Error creating appointment:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Server error creating appointment'
    });
  }
};

// ============================
// PATIENT: GET APPOINTMENT DETAILS
// ============================


const getAppointmentDetails = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const patientUserId = req.user._id;
    
    // Find patient profile
    const patient = await Patient.findOne({ user: patientUserId });
    
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    // Find appointment (patient can only view their own appointments)
    const appointment = await Appointment.findOne({
      _id: id,
      patient: patient._id
    })
    .populate({
      path: 'doctor',
      select: 'doctorId user consultationFee department',
      populate: {
        path: 'user',
        select: 'name email phone specialization photo'
      }
    })
    .populate('patient', 'patientCode')
    .lean();

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Format response
    const formattedAppointment = {
      _id: appointment._id,
      appointmentId: appointment.appointmentId,
      patient: {
        _id: patient._id,
        patientCode: patient.patientCode,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone
      },
      doctor: {
        _id: appointment.doctor?._id,
        doctorId: appointment.doctor?.doctorId,
        name: `Dr. ${appointment.doctor?.user?.name || 'Unknown'}`,
        specialization: appointment.doctor?.user?.specialization || '',
        department: appointment.doctor?.department || '',
        consultationFee: appointment.doctor?.consultationFee || 0,
        photo: appointment.doctor?.user?.photo || `https://ui-avatars.com/api/?name=Dr.${encodeURIComponent(appointment.doctor?.user?.name || 'Doctor')}&background=667eea&color=fff`
      },
      date: appointment.date,
      time: appointment.time,
      duration: appointment.duration || 30,
      status: appointment.status,
      type: appointment.type,
      purpose: appointment.purpose,
      notes: appointment.notes,
      symptoms: appointment.symptoms,
      cancellationReason: appointment.cancellationReason,
      doctorNotes: appointment.doctorNotes,
      createdAt: appointment.createdAt,
      confirmedAt: appointment.confirmedAt,
      completedAt: appointment.completedAt,
      canCancel: appointment.status === 'scheduled' || appointment.status === 'confirmed',
      canReschedule: appointment.status === 'scheduled'
    };

    res.json({
      success: true,
      appointment: formattedAppointment
    });

  } catch (error) {
    console.error('Error fetching appointment details:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointment details'
    });
  }
});

// ============================
// CHECK APPOINTMENT STATUS (FOR PATIENT)
// ============================
const checkAppointmentStatus = asyncHandler(async (req, res) => {
  try {
    const patientUserId = req.user._id;

    // ================= FIND PATIENT =================
    const patient = await Patient.findOne({ user: patientUserId });
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient profile not found"
      });
    }

    // ================= TODAY RANGE =================
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ================= UPCOMING APPOINTMENTS =================
    const upcomingAppointments = await Appointment.find({
      patient: patient._id,
      date: { $gte: todayStart },
      status: { $in: ['confirmed', 'pending_payment', 'completed'] }
    })
      .populate({
        path: "doctor",
        select: "doctorId department user",
        populate: {
          path: "user",
          select: "name specialization photo"
        }
      })
      .sort({ date: 1, time: 1 })
      .lean();

    const formattedUpcoming = upcomingAppointments.map(apt => ({
      _id: apt._id,
      appointmentId: apt.appointmentId,
      doctor: {
        name: `Dr. ${apt.doctor?.user?.name || 'Unknown'}`,
        specialization: apt.doctor?.user?.specialization || '',
        department: apt.doctor?.department || ''
      },
      date: apt.date,
      time: apt.time,
      amount: apt.amount || 0,
      status: apt.status,
      paymentStatus: apt.paymentStatus
    }));

    // ================= TODAY APPOINTMENT =================
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todaysAppointment = await Appointment.findOne({
      patient: patient._id,
      date: { $gte: todayStart, $lt: todayEnd },
      status: { $in: ['confirmed', 'completed'] }
    })
      .populate({
        path: "doctor",
        select: "doctorId department user",
        populate: {
          path: "user",
          select: "name specialization photo"
        }
      })
      .lean();

    // ================= COUNTS =================
    const statusCounts = await Appointment.aggregate([
      { $match: { patient: patient._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const counts = {
      pending_payment: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      total: await Appointment.countDocuments({ patient: patient._id })
    };

    statusCounts.forEach(s => {
      counts[s._id] = s.count;
    });

    // ================= RESPONSE =================
    res.status(200).json({
      success: true,
      todaysAppointment: todaysAppointment
        ? {
            _id: todaysAppointment._id,
            appointmentId: todaysAppointment.appointmentId,
            doctor: {
              name: `Dr. ${todaysAppointment.doctor?.user?.name || 'Unknown'}`,
              specialization: todaysAppointment.doctor?.user?.specialization || ''
            },
            date: todaysAppointment.date,
            time: todaysAppointment.time,
            status: todaysAppointment.status,
            amount: todaysAppointment.amount,
            paymentStatus: todaysAppointment.paymentStatus
          }
        : null,
      upcomingAppointments: formattedUpcoming,
      counts,
      hasPendingConfirmation: counts.pending_payment > 0
    });

  } catch (error) {
    console.error("❌ checkAppointmentStatus ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Error checking appointment status"
    });
  }
});


 //====================
// PATIENT: GET PATIENT'S APPOINTMENTS
//====================
 
const getPatientAppointments = asyncHandler(async (req, res) => {
  if (!req.user || !req.user._id) {
    return res.status(401).json({
      success: false,
      message: "User not authenticated",
    });
  }

  /* ================= PATIENT ================= */
  let patient = null;

  if (req.user.patientProfile) {
    patient = await Patient.findById(req.user.patientProfile);
  }

  if (!patient) {
    patient = await Patient.findOne({ user: req.user._id });
  }

  if (!patient) {
    patient = await Patient.create({
      user: req.user._id,
      email: req.user.email,
      phone: req.user.phone,
      createdBy: req.user._id,
    });
  }

  /* ================= FETCH ================= */
  const appointments = await Appointment.find({ patient: patient._id })
    .populate({
      path: "doctor",
      select: "doctorId department consultationFee user",
      populate: {
        path: "user",
        select: "name email phone photo specialization",
      },
    })
    .sort({ date: 1 })
    .lean();

  /* ================= TIME FIX ================= */
  const now = new Date();

  const formattedAppointments = appointments.map((appt) => {
    // 🔥 DATE + TIME COMBINE
    let appointmentDateTime = new Date(appt.date);

    if (appt.time) {
      const [time, modifier] = appt.time.split(" ");
      let [hours, minutes] = time.split(":").map(Number);

      if (modifier === "PM" && hours < 12) hours += 12;
      if (modifier === "AM" && hours === 12) hours = 0;

      appointmentDateTime.setHours(hours, minutes, 0, 0);
    }

    const isUpcoming = appointmentDateTime > now;
    const isPast = appointmentDateTime < now;
    const isToday =
      appointmentDateTime.toDateString() === now.toDateString();

    return {
      _id: appt._id,
      appointmentId: appt.appointmentId || appt._id.toString(),

      doctor: {
        name: appt.doctor?.user?.name
          ? `Dr. ${appt.doctor.user.name}`
          : "Dr. Unknown",
        specialization: appt.doctor?.user?.specialization || "",
        department: appt.doctor?.department || "",
      },

      date: appt.date,
      time: appt.time,

      amount: appt.amount || appt.doctor?.consultationFee || 0,
      paymentStatus: appt.paymentStatus || "pending",
      status: appt.status || "pending_payment",

      isUpcoming,
      isToday,
      isPast,
    };
  });

  /* ================= STATS ================= */
  const stats = {
    total: formattedAppointments.length,
    upcoming: formattedAppointments.filter(a => a.isUpcoming).length,
    today: formattedAppointments.filter(a => a.isToday).length,
    completed: formattedAppointments.filter(a => a.status === "completed").length,
    cancelled: formattedAppointments.filter(a => a.status === "cancelled").length,
  };

  res.status(200).json({
    success: true,
    appointments: formattedAppointments,
    stats,
  });
});


// Add this new function for getting stats

const getPatientAppointmentStats = asyncHandler(async (req, res) => {
  try {
    const patientUserId = req.user._id;
    
    // Find patient profile
    const patient = await Patient.findOne({ user: patientUserId });
    
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get all counts in parallel for better performance
    const [
      total,
      upcoming,
      todayCount,
      completed,
      cancelled,
      pendingPayment,
      allAppointments
    ] = await Promise.all([
      // Total appointments
      Appointment.countDocuments({ patient: patient._id }),
      
      // Upcoming appointments
      Appointment.countDocuments({
        patient: patient._id,
        date: { $gte: new Date() },
        status: { $in: ['scheduled', 'confirmed', 'pending'] }
      }),
      
      // Today's appointments
      Appointment.countDocuments({
        patient: patient._id,
        date: { $gte: today, $lt: tomorrow },
        status: { $in: ['scheduled', 'confirmed', 'pending'] }
      }),
      
      // Completed appointments
      Appointment.countDocuments({
        patient: patient._id,
        status: 'completed'
      }),
      
      // Cancelled appointments
      Appointment.countDocuments({
        patient: patient._id,
        status: 'cancelled'
      }),
      
      // Pending payment
      Appointment.countDocuments({
        patient: patient._id,
        paymentStatus: 'pending'
      }),
      
      // Get all appointments for amount calculations
      Appointment.find({ patient: patient._id })
        .select('amount paymentStatus refundAmount')
        .lean()
    ]);

    // Calculate amounts
    const totalPaid = allAppointments
      .filter(appt => appt.paymentStatus === 'completed')
      .reduce((sum, appt) => sum + (appt.amount || 0), 0);
    
    const pendingAmount = allAppointments
      .filter(appt => appt.paymentStatus === 'pending')
      .reduce((sum, appt) => sum + (appt.amount || 0), 0);
    
    const refundedAmount = allAppointments
      .filter(appt => appt.paymentStatus === 'refunded')
      .reduce((sum, appt) => sum + (appt.refundAmount || appt.amount || 0), 0);

    res.json({
      success: true,
      stats: {
        total,
        upcoming,
        today: todayCount,
        completed,
        cancelled,
        pendingPayment,
        totalPaid,
        pendingAmount,
        refundedAmount,
        netEarnings: totalPaid - refundedAmount
      }
    });

  } catch (error) {
    console.error('Error fetching appointment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching appointment stats'
    });
  }
});

// Add this new function for getting upcoming appointments
const getUpcomingAppointments = asyncHandler(async (req, res) => {
  try {
    const patientUserId = req.user._id;
    
    // Find patient profile
    const patient = await Patient.findOne({ user: patientUserId });
    
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's appointments
    const todayAppointments = await Appointment.find({
      patient: patient._id,
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .populate({
      path: 'doctor',
      select: 'doctorId user',
      populate: {
        path: 'user',
        select: 'name photo'
      }
    })
    .sort({ date: 1, time: 1 })
    .lean();

    // Get future appointments (excluding today)
    const upcomingAppointments = await Appointment.find({
      patient: patient._id,
      date: { $gt: new Date() },
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .populate({
      path: 'doctor',
      select: 'doctorId user',
      populate: {
        path: 'user',
        select: 'name photo'
      }
    })
    .sort({ date: 1, time: 1 })
    .lean();

    // Format appointments with days remaining
    const formattedUpcoming = upcomingAppointments.map(appointment => {
      const appointmentDate = new Date(appointment.date);
      const today = new Date();
      const diffTime = appointmentDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return {
        ...appointment,
        daysRemaining: diffDays > 0 ? diffDays : 0
      };
    });

    // Format today's appointments
    const formattedToday = todayAppointments.map(appointment => ({
      ...appointment,
      isToday: true
    }));

    res.json({
      success: true,
      todayAppointments: formattedToday,
      upcomingAppointments: formattedUpcoming
    });

  } catch (error) {
    console.error('Error fetching upcoming appointments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching upcoming appointments'
    });
  }
});

// Add this new function for cancelling appointment
const cancelPatientAppointment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;
    const patientUserId = req.user._id;

    console.log(`Cancelling appointment ${id} for user ${patientUserId}`);

    // Find patient profile
    const patient = await Patient.findOne({ user: patientUserId });
    
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found'
      });
    }

    // Find the appointment with proper population
    const appointment = await Appointment.findOne({
      _id: id,
      patient: patient._id
    })
    .populate({
      path: 'patient',
      populate: { path: 'user', select: 'name email phone' }
    })
    .populate({
      path: 'doctor',
      populate: { path: 'user', select: 'name email' }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment can be cancelled
    const cancellableStatuses = ['scheduled', 'confirmed', 'pending', 'pending_payment'];
    if (!cancellableStatuses.includes(appointment.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel appointment with status: ${appointment.status}`
      });
    }

    // Check if appointment is in the future
    const appointmentDate = new Date(appointment.date);
    const today = new Date();
    
    // Allow cancellation up to 1 hour before appointment
    const oneHourBefore = new Date(appointmentDate.getTime() - 60 * 60 * 1000);
    
    if (today > oneHourBefore) {
      return res.status(400).json({
        success: false,
        message: 'Appointment can only be cancelled at least 1 hour before the scheduled time'
      });
    }

    // Check cancellation reason
    if (!cancellationReason || cancellationReason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a detailed cancellation reason (minimum 10 characters)'
      });
    }

    // Determine if refund should be processed
    let refundInitiated = false;
    let refundDetails = null;

    if (appointment.paymentStatus === 'completed') {
      // Check if enough time for refund (24 hours before)
      const hoursDifference = (appointmentDate - today) / (1000 * 60 * 60);
      
      if (hoursDifference >= 24) {
        try {
          // In production, call Razorpay API for refund
          // For demo, simulate refund
          const mockRefundId = 'rfnd_' + Math.random().toString(36).substr(2, 9);
          
          // Update appointment with refund info
          appointment.refundId = mockRefundId;
          appointment.refundAmount = appointment.amount;
          appointment.refundStatus = 'initiated';
          appointment.refundDate = new Date();
          appointment.refundReason = cancellationReason;
          appointment.paymentStatus = 'refunded';
          
          refundInitiated = true;
          refundDetails = {
            refundId: mockRefundId,
            amount: appointment.amount,
            status: 'initiated',
            estimatedProcessingTime: '5-7 business days'
          };

          // Update doctor earning record if exists
          await DoctorEarning.findOneAndUpdate(
            { appointment: appointment._id },
            {
              status: 'refunded',
              refundId: mockRefundId,
              updatedAt: new Date()
            }
          );

        } catch (refundError) {
          console.error('Refund processing error:', refundError);
          // Continue with cancellation even if refund fails
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'Refund cannot be processed for appointments within 24 hours. Please contact support.'
        });
      }
    }

    // Update appointment status
    appointment.status = 'cancelled';
    appointment.cancellationReason = cancellationReason;
    appointment.cancelledBy = patient.user._id;
    appointment.cancelledAt = new Date();
    appointment.updatedAt = new Date();

    await appointment.save();

    // Send notification (optional)
    try {
      await sendEmail({
        to: appointment.patient.user.email,
        subject: 'Appointment Cancelled Successfully',
        template: 'appointment-cancelled',
        context: {
          patientName: appointment.patient.user.name,
          doctorName: appointment.doctor.user.name,
          appointmentId: appointment.appointmentId,
          date: appointment.date ? new Date(appointment.date).toLocaleDateString('en-IN') : 'N/A',
          time: appointment.time,
          cancellationReason: cancellationReason,
          refundInitiated: refundInitiated,
          refundAmount: refundInitiated ? appointment.amount : 0,
          refundId: refundInitiated ? appointment.refundId : null
        }
      });
    } catch (emailError) {
      console.error('Email notification failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Appointment cancelled successfully',
      refundInitiated: refundInitiated,
      refund: refundDetails
    });

  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling appointment',
      error: error.message
    });
  }
});


// ✅ CREATE RAZORPAY ORDER
const createRazorpayOrder = asyncHandler(async (req, res) => {
  try {
    const { appointmentId, amount } = req.body;

    if (!appointmentId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Appointment ID and amount are required'
      });
    }

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate('patient')
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if payment already completed
    if (appointment.paymentStatus === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed for this appointment'
      });
    }

    // Create Razorpay order
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      receipt: appointment.appointmentId,
      notes: {
        appointmentId: appointment._id.toString(),
        patientId: appointment.patient._id.toString(),
        doctorId: appointment.doctor._id.toString()
      },
      payment_capture: 1
    });

    // Update appointment with order ID
    appointment.razorpayOrderId = order.id;
    appointment.amount = amount;
    await appointment.save();

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        key: process.env.RAZORPAY_KEY_ID
      },
      appointment: {
        _id: appointment._id,
        appointmentId: appointment.appointmentId,
        amount: appointment.amount,
        doctorName: `Dr. ${appointment.doctor.user?.name || 'Unknown'}`,
        patientName: appointment.patient.name
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order'
    });
  }
});


// appointmentController.js - getDoctorEarnings function

const getDoctorEarnings = asyncHandler(async (req, res) => {
  try {
    // 1️⃣ Find doctor profile
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor profile not found"
      });
    }

    // 2️⃣ Fetch completed appointments WITH payment completed
    const appointments = await Appointment.find({
      doctor: doctor._id,
      paymentStatus: { $in: ['completed', 'refunded'] }
    })
      .populate({
        path: "patient",
        select: "patientCode age gender dateOfBirth phone email name photo medicalHistory",
        populate: {
          path: "user",
          select: "name email phone photo"
        }
      })
      .populate({
        path: "doctor",
        select: "doctorId department consultationFee specialization",
        populate: {
          path: "user",
          select: "name email phone specialization photo"
        }
      })
      .sort({ createdAt: -1 });

    // 3️⃣ Create DoctorEarning records if they don't exist
    for (const appointment of appointments) {
      const existingEarning = await DoctorEarning.findOne({ 
        appointment: appointment._id 
      });
      
      if (!existingEarning) {
        // Calculate net amount based on payment status
        let earningAmount = appointment.amount || 0;
        let earningStatus = 'pending';
        
        if (appointment.paymentStatus === 'completed') {
          earningStatus = 'completed';
        } else if (appointment.paymentStatus === 'refunded') {
          earningStatus = 'refunded';
          earningAmount = -(appointment.refundAmount || appointment.amount || 0);
        }
        
        await DoctorEarning.create({
          doctor: appointment.doctor._id,
          appointment: appointment._id,
          patient: appointment.patient._id,
          amount: Math.abs(earningAmount),
          netAmount: earningAmount,
          paymentId: appointment.paymentId || `pay_${Date.now()}`,
          refundId: appointment.refundId,
          refundAmount: appointment.refundAmount,
          refundDate: appointment.refundDate,
          status: earningStatus,
          earningDate: appointment.date || appointment.createdAt
        });
      }
    }

    // 4️⃣ Now fetch all doctor earnings
    const doctorEarnings = await DoctorEarning.find({
      doctor: doctor._id
    })
      .populate({
        path: 'appointment',
        select: 'appointmentId date time type status paymentStatus refundStatus'
      })
      .populate({
        path: 'patient',
        select: 'patientCode age gender',
        populate: {
          path: 'user',
          select: 'name email phone photo'
        }
      })
      .sort({ earningDate: -1 });

    // 5️⃣ Calculate totals with refund adjustments
    const totalEarnings = doctorEarnings
      .filter(e => e.status === 'completed')
      .reduce((sum, earning) => sum + (earning.amount || 0), 0);

    const totalRefunded = doctorEarnings
      .filter(e => e.status === 'refunded')
      .reduce((sum, earning) => sum + (earning.refundAmount || earning.amount || 0), 0);

    const netEarnings = totalEarnings - totalRefunded;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const thisMonthEarnings = doctorEarnings
      .filter(e => {
        const earningDate = new Date(e.earningDate);
        return earningDate.getMonth() === currentMonth && 
               earningDate.getFullYear() === currentYear &&
               e.status === 'completed';
      })
      .reduce((sum, earning) => sum + (earning.amount || 0), 0);

    const thisMonthRefunded = doctorEarnings
      .filter(e => {
        const earningDate = new Date(e.earningDate);
        return earningDate.getMonth() === currentMonth && 
               earningDate.getFullYear() === currentYear &&
               e.status === 'refunded';
      })
      .reduce((sum, earning) => sum + (earning.refundAmount || earning.amount || 0), 0);

    const thisMonthNet = thisMonthEarnings - thisMonthRefunded;

    // 6️⃣ Unique patients
    const uniquePatientIds = [...new Set(doctorEarnings.map(e => e.patient?._id?.toString()))];
    const uniquePatients = uniquePatientIds.filter(id => id).length;

    // 7️⃣ Calculate refund rate
    const totalTransactions = doctorEarnings.length;
    const refundCount = doctorEarnings.filter(e => e.status === 'refunded').length;
    const refundRate = totalTransactions > 0 ? Math.round((refundCount / totalTransactions) * 100) : 0;

    // 8️⃣ Calculate cancellation rate
    const cancelledAppointments = await Appointment.countDocuments({
      doctor: doctor._id,
      status: 'cancelled'
    });
    const totalAppointments = await Appointment.countDocuments({ doctor: doctor._id });
    const cancellationRate = totalAppointments > 0 ? Math.round((cancelledAppointments / totalAppointments) * 100) : 0;

    // 9️⃣ Average earnings
    const completedEarnings = doctorEarnings.filter(e => e.status === 'completed');
    const averageEarnings = completedEarnings.length > 0 
      ? totalEarnings / completedEarnings.length 
      : 0;

    // 🔟 Pending earnings
    const pendingEarnings = doctorEarnings
      .filter(e => e.status === 'pending')
      .reduce((sum, earning) => sum + (earning.amount || 0), 0);

    // Format earnings for UI with net amounts
    const earnings = doctorEarnings.map(earning => {
      const patientUser = earning.patient?.user;
      const appointmentData = earning.appointment;
      
      return {
        _id: earning._id,
        appointmentId: appointmentData?.appointmentId || 'N/A',
        patientName: patientUser?.name || 'Unknown Patient',
        patientCode: earning.patient?.patientCode || 'N/A',
        doctorName: req.user.name ? `Dr. ${req.user.name}` : 'Dr. Unknown',
        amount: earning.amount || 0,
        netAmount: earning.netAmount || earning.amount || 0,
        paymentId: earning.paymentId || 'N/A',
        razorpayOrderId: appointmentData?.razorpayOrderId || 'N/A',
        refundId: earning.refundId,
        refundAmount: earning.refundAmount,
        refundDate: earning.refundDate,
        refundReason: appointmentData?.cancellationReason,
        date: earning.earningDate ? new Date(earning.earningDate).toLocaleDateString('en-IN') : 'N/A',
        time: appointmentData?.time || 'N/A',
        type: appointmentData?.type || 'consultation',
        department: doctor.department || 'N/A',
        status: earning.status || 'completed',
        paymentStatus: appointmentData?.paymentStatus || 'completed',
        createdAt: earning.createdAt,
        updatedAt: earning.updatedAt,
        patient: {
          _id: earning.patient?._id,
          name: patientUser?.name,
          phone: patientUser?.phone,
          email: patientUser?.email,
          photo: patientUser?.photo || 'default-avatar.png'
        },
        appointment: {
          appointmentId: appointmentData?.appointmentId,
          status: appointmentData?.status,
          paymentStatus: appointmentData?.paymentStatus,
          refundStatus: appointmentData?.refundStatus
        }
      };
    });

    // 🎯 Response
    res.status(200).json({
      success: true,
      doctor: {
        doctorId: doctor.doctorId,
        name: req.user.name,
        department: doctor.department,
        consultationFee: doctor.consultationFee,
        photo: req.user.photo
      },
      earnings,
      stats: {
        totalEarnings,
        totalRefunded,
        netEarnings,
        thisMonth: thisMonthEarnings,
        thisMonthRefunded,
        thisMonthNet,
        monthlyEarnings: thisMonthNet,
        completedAppointments: doctorEarnings.filter(e => e.status === 'completed').length,
        cancelledAppointments,
        pendingEarnings,
        totalPatients: uniquePatients,
        refundRate,
        cancellationRate,
        averageEarnings: Math.round(averageEarnings),
        totalTransactions,
        refundCount
      },
      balance: {
        gross: totalEarnings,
        refunded: totalRefunded,
        net: netEarnings,
        pending: pendingEarnings,
        available: netEarnings - pendingEarnings
      },
      summary: {
        totalTransactions: doctorEarnings.length,
        totalAmount: totalEarnings,
        totalRefunded,
        netAmount: netEarnings,
        thisMonth: thisMonthNet,
        refundRate: `${refundRate}%`,
        cancellationRate: `${cancellationRate}%`
      }
    });

  } catch (error) {
    console.error("getDoctorEarnings ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching earnings data",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// ✅ REQUEST REFUND
const requestRefund = asyncHandler(async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    console.log(`Refund requested for ${appointmentId} by user ${userId}`);

    const appointment = await Appointment.findOne({ appointmentId })
      .populate({
        path: "patient",
        populate: { path: "user", select: "name email phone" }
      })
      .populate({
        path: "doctor",
        populate: { path: "user", select: "name email" }
      });


    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check authorization
    if (
      req.user.role !== 'admin' &&
      appointment.patient.user._id.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to request refund'
      });
    }

    // Check if appointment can be refunded
    if (appointment.paymentStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'No payment found to refund'
      });
    }

    if (appointment.refundId) {
      return res.status(400).json({
        success: false,
        message: 'Refund already processed'
      });
    }

    // Check if appointment is cancelled
    if (appointment.status !== 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Appointment must be cancelled before requesting refund'
      });
    }

    // Check appointment timing (24 hours before)
    const appointmentDate = new Date(appointment.date);
    const now = new Date();
    const hoursDifference = (appointmentDate - now) / (1000 * 60 * 60);

    if (hoursDifference < 24 && appointmentDate > now) {
      return res.status(400).json({
        success: false,
        message: 'Refund can only be requested at least 24 hours before appointment'
      });
    }

    // Check if appointment already passed
    if (appointmentDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot request refund for past appointments'
      });
    }

    // Process refund via Razorpay (in production)
    try {
      // In production, call Razorpay API
      // const refund = await razorpay.payments.refund(appointment.paymentId, {
      //   amount: appointment.amount * 100,
      //   speed: 'normal',
      //   notes: {
      //     reason: reason,
      //     appointmentId: appointment.appointmentId
      //   }
      // });

      // For demo, simulate refund
      const mockRefundId = 'rfnd_' + Math.random().toString(36).substr(2, 9);

      // Update appointment with refund info
      appointment.refundId = mockRefundId;
      appointment.refundAmount = appointment.amount;
      appointment.refundStatus = 'initiated';
      appointment.refundDate = new Date();
      appointment.refundReason = reason;
      appointment.paymentStatus = 'refunded';
      await appointment.save();

      // Update doctor earning record
      await DoctorEarning.findOneAndUpdate(
        { appointment: appointment._id },
        {
          status: 'refunded',
          refundId: mockRefundId,
          updatedAt: new Date()
        }
      );

      // Send notification
      try {
        await sendEmail({
          to: appointment.patient.user.email,
          subject: 'Refund Request Initiated',
          template: 'refund-initiated',
          context: {
            patientName: appointment.patient.user.name,
            appointmentId: appointment.appointmentId,
            refundAmount: appointment.amount,
            refundId: mockRefundId,
            estimatedProcessingTime: '5-7 business days',
            doctorName: appointment.doctor.user.name
          }
        });
      } catch (emailError) {
        console.error('Refund email notification failed:', emailError);
      }

      res.json({
        success: true,
        message: 'Refund request submitted successfully',
        refund: {
          refundId: mockRefundId,
          amount: appointment.amount,
          status: 'initiated',
          estimatedProcessingTime: '5-7 business days',
          note: 'The amount will be credited to your original payment method'
        }
      });

    } catch (refundError) {
      console.error('Refund processing error:', refundError);
      res.status(500).json({
        success: false,
        message: 'Failed to process refund request',
        error: refundError.message
      });
    }

  } catch (error) {
    console.error('Request refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to request refund',
      error: error.message
    });
  }
});


// ✅ DOWNLOAD RECEIPT


const downloadReceipt = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;

  // Find the appointment with patient and doctor info
  const appointment = await Appointment.findById(appointmentId)
    .populate("patient")
    .populate({ path: "doctor", populate: { path: "user" } });

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  // Only patient who owns it can download
  if (
    req.user.role === "patient" &&
    appointment.patient.user.toString() !== req.user._id.toString()
  ) {
    return res.status(403).json({ message: "Not authorized" });
  }

  // Only completed payments
  if (appointment.paymentStatus !== "completed") {
    return res.status(400).json({ message: "Payment not completed" });
  }

  // Set headers to download PDF
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=receipt-${appointment._id}.pdf`
  );

  const doc = new PDFDocument({ margin: 50 });

  // Pipe PDF directly to response
  doc.pipe(res);

  // Add receipt content
  doc
    .fontSize(20)
    .text("Payment Receipt", { align: "center" })
    .moveDown();

  doc.fontSize(12).text(`Appointment ID: ${appointment._id}`);
  doc.text(`Patient: ${appointment.patient.name}`);
  doc.text(`Doctor: Dr. ${appointment.doctor.user.name}`);
  doc.text(`Date: ${new Date(appointment.date).toLocaleDateString("en-IN")}`);
  doc.text(`Amount: ₹${appointment.amount}`);
  doc.text(`Payment ID: ${appointment.paymentId}`);

  doc.moveDown();
  doc.text("Thank you for your payment!", { align: "center" });

  doc.end();
});



// ✅ DOWNLOAD DOCTOR REPORT
const downloadDoctorReport = asyncHandler(async (req, res) => {
  const doctorUserId = req.user._id;
  const { filter, dateRange, searchTerm } = req.body;

  // Fetch completed appointments for this doctor
  const query = {
    paymentStatus: "completed",
  };

  const appointments = await Appointment.find(query)
    .populate("patient", "name phone")
    .populate({ path: "doctor", populate: { path: "user" } });

  // Optional: filter by logged-in doctor
  const doctorAppointments = appointments.filter(
    (a) => a.doctor?.user?._id?.toString() === doctorUserId.toString()
  );

  // Create PDF
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=earnings-report-${new Date()
      .toISOString()
      .split("T")[0]}.pdf`
  );

  doc.pipe(res);

  // Header
  doc.fontSize(18).text("Doctor Earnings Report", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`);
  doc.moveDown();

  let total = 0;

  doctorAppointments.forEach((a, i) => {
    total += a.amount || 0;
    doc
      .fontSize(10)
      .text(
        `${i + 1}. Patient: ${a.patient?.name || "N/A"} | Date: ${new Date(
          a.date
        ).toLocaleDateString("en-IN")} | Amount: ₹${a.amount}`
      );
  });

  doc.moveDown();
  doc.fontSize(14).text(`Total Earnings: ₹${total}`, { align: "right" });

  doc.end();
});


// Handle payment failed
const handlePaymentFailed = async (payload) => {
  const { payment } = payload;
  
  const appointment = await Appointment.findOne({ paymentId: payment.id });
  
  if (appointment) {
    appointment.paymentStatus = 'failed';
    appointment.status = 'payment_failed';
    await appointment.save();
  }
};


// Get all transactions for doctor dashboard
const getDoctorTransactions = asyncHandler(async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor profile not found'
      });
    }

    const {
      startDate,
      endDate,
      status = 'all',
      page = 1,
      limit = 10
    } = req.query;

    // Build query
    const query = { doctor: doctor._id, paymentStatus: 'completed' };

    // Date filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [total, appointments] = await Promise.all([
      Appointment.countDocuments(query),
      Appointment.find(query)
        .populate({
          path: 'patient',
          select: 'patientCode user',
          populate: {
            path: 'user',
            select: 'name email phone'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean()
    ]);

    // Format response for UI
    const transactions = appointments.map(appt => {
      const patientUser = appt.patient?.user || {};
      
      return {
        date: appt.date 
          ? new Date(appt.date).toLocaleDateString('en-IN')
          : appt.createdAt 
            ? new Date(appt.createdAt).toLocaleDateString('en-IN')
            : 'N/A',
        appointmentId: appt.appointmentId || 'N/A',
        patient: {
          name: patientUser.name || 'Unknown Patient',
          email: patientUser.email || 'N/A',
          phone: patientUser.phone || 'N/A',
          patientCode: appt.patient?.patientCode || 'N/A'
        },
        amount: appt.amount || 0,
        paymentId: appt.paymentId || 'N/A',
        razorpayOrderId: appt.razorpayOrderId || '-',
        type: appt.type || 'consultation',
        department: doctor.department,
        status: appt.status || 'confirmed',
        paymentStatus: appt.paymentStatus || 'completed'
      };
    });

    res.status(200).json({
      success: true,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      transactions,
      summary: {
        totalEarnings: appointments.reduce((sum, appt) => sum + (appt.amount || 0), 0),
        totalTransactions: total
      }
    });

  } catch (error) {
    console.error('getDoctorTransactions ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transactions'
    });
  }
});


// =====================
// DELETE SINGLE APPOINTMENT (ADMIN)
// =====================
const deleteAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params; // get _id from URL

  if (!id) {
    return res.status(400).json({ success: false, message: "Appointment ID is required" });
  }

  const appointment = await Appointment.findByIdAndDelete(id); // ✅ ID only

  if (!appointment) {
    return res.status(404).json({ success: false, message: "Appointment not found" });
  }

  res.json({
    success: true,
    message: "Appointment deleted successfully",
  });
});


// =====================
// DELETE MULTIPLE APPOINTMENTS (ADMIN)
// =====================

const deleteMultipleAppointments = asyncHandler(async (req, res) => {
  let { ids } = req.body; // expect an array of IDs

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No appointment IDs provided" });
  }

  // Ensure all IDs are strings
  ids = ids.map(id => id.toString());

  const result = await Appointment.deleteMany({ _id: { $in: ids } });

  res.json({
    success: true,
    message: `${result.deletedCount} appointment(s) deleted successfully`,
  });
});

//================================
// In controllers/appointmentController.js - Add these functions:
//===============================

const createAppointmentWithPayment = asyncHandler(async (req, res) => {
  try {
    const { patient, doctor, date, time, type, purpose, amount, paymentMethod } = req.body;

    // Create appointment
    const appointment = await Appointment.create({
      patient,
      doctor,
      date,
      time,
      type,
      purpose,
      amount: amount || 0,
      paymentStatus: paymentMethod ? 'pending' : 'pending',
      status: 'pending_payment',
      createdBy: req.user._id
    });

    // If payment method is provided, create invoice
    if (paymentMethod && amount > 0) {
      const invoiceId = `INV${moment().format('YYYYMMDD')}${String(await Billing.countDocuments() + 1).padStart(3, '0')}`;
      
      const invoice = await Billing.create({
        invoiceId,
        appointment: appointment._id,
        patient: appointment.patient,
        doctor: appointment.doctor,
        invoiceDate: new Date(),
        dueDate: moment().add(7, 'days').toDate(),
        items: [{
          description: `${type} Consultation`,
          quantity: 1,
          price: amount,
          total: amount
        }],
        subTotal: amount,
        tax: 0,
        discount: 0,
        totalAmount: amount,
        paidAmount: 0,
        balanceAmount: amount,
        paymentStatus: 'pending',
        status: 'active',
        paymentMethod: paymentMethod,
        createdBy: req.user._id
      });

      // Link invoice to appointment
      appointment.invoice = invoice._id;
      await appointment.save();

      // Return both appointment and invoice
      const populatedAppointment = await Appointment.findById(appointment._id)
        .populate('patient doctor invoice')
        .populate({
          path: 'invoice',
          select: 'invoiceId totalAmount balanceAmount paymentStatus'
        });

      res.status(201).json({
        success: true,
        message: 'Appointment created with invoice',
        appointment: populatedAppointment
      });
    } else {
      // Return appointment without invoice
      const populatedAppointment = await Appointment.findById(appointment._id)
        .populate('patient doctor');

      res.status(201).json({
        success: true,
        message: 'Appointment created successfully',
        appointment: populatedAppointment
      });
    }
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create appointment',
      error: error.message
    });
  }
});



const updateAppointmentPayment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, amount, paymentId, paymentMethod } = req.body;

    const appointment = await Appointment.findById(id)
      .populate('patient doctor');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Update appointment payment details
    appointment.paymentStatus = paymentStatus || appointment.paymentStatus;
    appointment.amount = amount || appointment.amount;
    appointment.paymentId = paymentId || appointment.paymentId;
    appointment.paymentMethod = paymentMethod || appointment.paymentMethod;
    
    // Update status based on payment
    if (paymentStatus === 'completed') {
      appointment.status = 'confirmed';
      appointment.confirmedAt = new Date();
    } else if (paymentStatus === 'failed') {
      appointment.status = 'payment_failed';
    }

    await appointment.save();

    // If appointment has invoice, update it too
    if (appointment.invoice) {
      await Billing.findByIdAndUpdate(appointment.invoice, {
        paymentStatus: paymentStatus === 'completed' ? 'paid' : 'pending',
        paymentMethod,
        transactionId: paymentId,
        paymentDate: paymentStatus === 'completed' ? new Date() : null
      });
    }

    const updatedAppointment = await Appointment.findById(id)
      .populate('patient doctor invoice');

    res.status(200).json({
      success: true,
      message: 'Appointment payment updated',
      appointment: updatedAppointment
    });
  } catch (error) {
    console.error('Update appointment payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update appointment payment',
      error: error.message
    });
  }
});


// Cancel appointment with automatic refund
const cancelAppointmentWithRefund = asyncHandler(async (req, res) => {
  const { appointmentId, cancellationReason } = req.body;

  if (!appointmentId || !cancellationReason || cancellationReason.trim().length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Appointment ID and valid cancellation reason (min 10 chars) are required'
    });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate({
      path: 'patient',
      populate: { path: 'user', select: 'name email phone' }
    })
    .populate({
      path: 'doctor',
      populate: { path: 'user', select: 'name email phone' }
    });

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Appointment not found' });
  }

  // 🔐 Authorization
  const isDoctor =
    req.user.role === 'doctor' &&
    appointment.doctor.user._id.toString() === req.user._id.toString();

  const isPatient =
    req.user.role === 'patient' &&
    appointment.patient.user._id.toString() === req.user._id.toString();

  const isAdmin = req.user.role === 'admin';

  if (!isDoctor && !isPatient && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  if (appointment.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Appointment already cancelled' });
  }

  // ================================
  // 💸 REFUND (SAFE + IDEMPOTENT)
  // ================================
  if (
    appointment.paymentStatus === 'completed' &&
    appointment.paymentId &&
    !appointment.refundId
  ) {
    try {
      const refund = await razorpay.payments.refund(
        appointment.paymentId,
        {
          amount: Math.round(appointment.amount * 100),
          speed: 'normal',
          notes: {
            appointmentId: appointment.appointmentId,
            reason: cancellationReason,
            cancelledBy: req.user.role
          }
        }
      );

      // ✅ Update appointment
      appointment.refundId = refund.id;
      appointment.refundStatus = 'initiated'; // webhook will mark processed
      appointment.refundAmount = appointment.amount;
      appointment.refundDate = new Date();
      appointment.paymentStatus = 'refunded';

      // ✅ Prevent duplicate transaction
      const txnExists = await Transaction.findOne({
        refundId: refund.id,
        type: 'refund'
      });

      if (!txnExists) {
        await Transaction.create({
          appointment: appointment._id,
          patient: appointment.patient._id,
          doctor: appointment.doctor._id,
          type: 'refund',
          amount: appointment.amount,
          paymentId: appointment.paymentId,
          refundId: refund.id,
          status: 'initiated',
          notes: 'Refund initiated for cancelled appointment'
        });
      }

      // ✅ Update doctor earnings
      await DoctorEarning.findOneAndUpdate(
        { appointment: appointment._id },
        {
          status: 'refunded',
          refundId: refund.id,
          refundAmount: appointment.amount,
          refundDate: new Date()
        }
      );

    } catch (refundError) {
      // 🔁 Already refunded (retry/webhook case)
      if (refundError?.error?.description?.includes('fully refunded')) {
        appointment.paymentStatus = 'refunded';
        appointment.refundStatus = 'processed';
      } else {
        appointment.refundStatus = 'failed';
        appointment.refundError =
          refundError?.error?.description || refundError.message;

        await Transaction.create({
          appointment: appointment._id,
          patient: appointment.patient._id,
          doctor: appointment.doctor._id,
          type: 'refund',
          amount: appointment.amount,
          paymentId: appointment.paymentId,
          refundId: refund.id,
          status: 'processed', // ✅ instead of 'completed'
          notes: 'Refund initiated for cancelled appointment'
        });

      }
    }
  } else {
    appointment.refundStatus = 'not_applicable';
  }

  // ================================
  // ❌ CANCEL APPOINTMENT
  // ================================
    appointment.status = 'cancelled';
    appointment.cancellationReason = cancellationReason.trim();
    appointment.cancelledAt = new Date();
    appointment.cancelledBy = {
      user: req.user._id,
      role: req.user.role
    };


  await appointment.save();

  return res.status(200).json({
    success: true,
    message: 'Appointment cancelled successfully',
    appointment: {
      appointmentId: appointment.appointmentId,
      status: appointment.status,
      paymentStatus: appointment.paymentStatus,
      refundStatus: appointment.refundStatus,
      refundId: appointment.refundId,
      refundAmount: appointment.refundAmount
    }
  });
});

// Doctor cancellation endpoint
const doctorCancelAppointment = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;

    console.log(`Doctor cancelling appointment ${id}`);

    if (!cancellationReason || cancellationReason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason must be at least 10 characters long'
      });
    }

    // Check if appointment exists and belongs to this doctor
    const appointment = await Appointment.findOne({
      _id: id
    })
      .populate({
        path: 'patient',
        select: 'name email phone patientCode user',
        populate: {
          path: 'user',
          select: 'name email phone'
        }
      })
      .populate({
        path: 'doctor',
        select: 'doctorId department consultationFee user',
        populate: {
          path: 'user',
          select: 'name email phone specialization'
        }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Verify doctor owns this appointment
    if (appointment.doctor.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this appointment'
      });
    }

    // Call the main cancellation function
    req.body.appointmentId = id;
    return cancelAppointmentWithRefund(req, res);
  } catch (error) {
    console.error('Doctor cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling appointment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify Razorpay Payment (Updated with refund handling)
const verifyPayment = asyncHandler(async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      appointmentId
    } = req.body;

    console.log("🔍 Verifying payment for appointment:", appointmentId);

    // Validation
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !appointmentId) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment verification data"
      });
    }

    // Signature verification
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature"
      });
    }

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate({
        path: "patient",
        select: "patientCode user",
        populate: {
          path: "user",
          select: "name email phone"
        }
      })
      .populate({
        path: "doctor",
        select: "doctorId department consultationFee user",
        populate: {
          path: "user",
          select: "name email specialization photo"
        }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found"
      });
    }

    // Update payment details
    appointment.paymentStatus = "completed";
    appointment.status = "confirmed";
    appointment.paymentId = razorpay_payment_id;
    appointment.razorpayOrderId = razorpay_order_id;
    appointment.paymentDate = new Date();
    appointment.confirmedAt = new Date();

    // Ensure amount exists
    if (!appointment.amount || appointment.amount <= 0) {
      appointment.amount = appointment.doctor?.consultationFee || 0;
    }

    await appointment.save();

    // Create doctor earning record
    await DoctorEarning.create({
      doctor: appointment.doctor._id,
      appointment: appointment._id,
      patient: appointment.patient._id,
      amount: appointment.amount,
      paymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      status: "completed",
      earningDate: new Date()
    });

    // Create payment transaction record
    await Transaction.create({
      appointment: appointment._id,
      patient: appointment.patient._id,
      doctor: appointment.doctor._id,
      type: 'payment',
      amount: appointment.amount,
      paymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      status: 'completed',
      notes: `Payment for appointment ${appointment.appointmentId}`,
      metadata: {
        paymentMethod: 'Razorpay',
        appointmentDate: appointment.date,
        appointmentTime: appointment.time
      }
    });

    // Email notification
    try {
      await sendEmail({
        to: appointment.patient.user.email,
        subject: "Appointment Confirmed - Payment Successful",
        template: "appointment-confirmed",
        context: {
          patientName: appointment.patient.user.name,
          doctorName: appointment.doctor.user.name,
          appointmentId: appointment.appointmentId,
          date: appointment.date ? new Date(appointment.date).toLocaleDateString("en-IN") : "N/A",
          time: appointment.time || "To be scheduled",
          amount: appointment.amount,
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id
        }
      });
    } catch (emailError) {
      console.error("📧 Email send failed:", emailError.message);
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified & appointment confirmed",
      appointment: {
        _id: appointment._id,
        appointmentId: appointment.appointmentId,
        patient: {
          name: appointment.patient.user.name,
          email: appointment.patient.user.email,
          phone: appointment.patient.user.phone,
          patientCode: appointment.patient.patientCode
        },
        doctor: {
          name: appointment.doctor.user.name,
          specialization: appointment.doctor.user.specialization,
          department: appointment.doctor.department,
          doctorId: appointment.doctor.doctorId
        },
        date: appointment.date,
        time: appointment.time,
        amount: appointment.amount,
        paymentId: appointment.paymentId,
        razorpayOrderId: appointment.razorpayOrderId,
        status: appointment.status,
        paymentStatus: appointment.paymentStatus,
        createdAt: appointment.createdAt
      }
    });

  } catch (error) {
    console.error("❌ verifyPayment ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Error verifying payment",
      error: error.message
    });
  }
});

// Get payment history with refunds
const getPaymentHistory = asyncHandler(async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user._id;

    // Validate appointmentId
    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: 'Appointment ID is required'
      });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate({
        path: 'patient',
        populate: { path: 'user' }
      })
      .populate({
        path: 'doctor',
        populate: { path: 'user' }
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Authorization check
    const isAuthorized = 
      req.user.role === 'admin' ||
      (appointment.patient?.user?._id.toString() === userId.toString()) ||
      (appointment.doctor?.user?._id.toString() === userId.toString());

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payment history'
      });
    }

    // Get all transactions for this appointment
    const transactions = await Transaction.find({
      appointment: appointmentId
    }).sort({ createdAt: -1 });

    // Build payment history
    const paymentHistory = [];

    // Add payment transaction if exists
    if (appointment.paymentId) {
      paymentHistory.push({
        date: appointment.paymentDate || appointment.createdAt,
        type: 'payment',
        amount: appointment.amount,
        status: appointment.paymentStatus,
        transactionId: appointment.paymentId,
        razorpayOrderId: appointment.razorpayOrderId,
        method: 'Razorpay',
        description: `Appointment with Dr. ${appointment.doctor?.user?.name || 'Unknown'}`,
        icon: 'payment'
      });
    }

    // Add refund transaction if exists
    if (appointment.refundId) {
      paymentHistory.push({
        date: appointment.refundDate || appointment.updatedAt,
        type: 'refund',
        amount: appointment.refundAmount || appointment.amount,
        status: appointment.refundStatus,
        transactionId: appointment.refundId,
        method: 'Razorpay',
        description: appointment.cancellationReason || 'Appointment cancellation refund',
        icon: 'refund'
      });
    }

    // Add other transactions from Transaction model
    transactions.forEach(transaction => {
      if (!paymentHistory.some(item => item.transactionId === transaction.paymentId || item.transactionId === transaction.refundId)) {
        paymentHistory.push({
          date: transaction.createdAt,
          type: transaction.type,
          amount: transaction.amount,
          status: transaction.status,
          transactionId: transaction.paymentId || transaction.refundId,
          method: 'Razorpay',
          description: transaction.notes,
          icon: transaction.type
        });
      }
    });

    // Sort by date
    paymentHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.json({
      success: true,
      paymentHistory,
      appointment: {
        appointmentId: appointment.appointmentId,
        totalAmount: appointment.amount,
        paymentStatus: appointment.paymentStatus,
        refundStatus: appointment.refundStatus,
        patientName: appointment.patient?.user?.name,
        doctorName: appointment.doctor?.user?.name
      }
    });

  } catch (error) {
    console.error('Get payment history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

// Get refund details
const getRefundDetails = asyncHandler(async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user._id;

    console.log("Fetching refund details for:", appointmentId);

    const appointment = await Appointment.findById(appointmentId)
      .populate({
        path: "patient",
        populate: {
          path: "user",
          select: "name email phone",
        },
      })
      .populate({
        path: "doctor",
        populate: {
          path: "user",
          select: "name email",
        },
      });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // 🔐 Authorization
    const isAuthorized =
      req.user.role === "admin" ||
      appointment.patient?.user?._id?.toString() === userId.toString() ||
      appointment.doctor?.user?._id?.toString() === userId.toString();

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view refund details",
      });
    }

    if (!appointment.refundId) {
      return res.status(400).json({
        success: false,
        message: "No refund found for this appointment",
      });
    }

    // 🧾 Doctor earning
    const doctorEarning = await DoctorEarning.findOne({
      appointment: appointmentId,
    });

    // 💳 Refund transaction
    const refundTransaction = await Transaction.findOne({
      refundId: appointment.refundId,
    });

    // ✅ FINAL REFUND AMOUNT LOGIC (IMPORTANT)
    const finalRefundAmount =
      typeof appointment.refundAmount === "number" && appointment.refundAmount > 0
        ? appointment.refundAmount
        : refundTransaction?.amount
        ? refundTransaction.amount
        : appointment.amount;

    // 🧪 Debug (run once)
    console.log({
      appointmentRefundAmount: appointment.refundAmount,
      transactionAmount: refundTransaction?.amount,
      appointmentAmount: appointment.amount,
      finalRefundAmount,
    });

    const refundDetails = {
      refundId: appointment.refundId,
      paymentId: appointment.paymentId,
      originalAmount: appointment.amount,
      refundAmount: finalRefundAmount,
      refundDate: appointment.refundDate,
      status: appointment.refundStatus || "initiated",
      reason: appointment.cancellationReason || "Appointment cancellation",
      notes: "Refund will reflect in your account within 5-7 business days",

      appointment: {
        appointmentId: appointment.appointmentId,
        patientName: appointment.patient?.user?.name || "N/A",
        doctorName: appointment.doctor?.user?.name || "Dr. Unknown",
        date: appointment.date
          ? new Date(appointment.date).toLocaleDateString("en-IN")
          : "N/A",
        time: appointment.time,
      },

      timeline: [
        {
          date: appointment.cancelledAt || appointment.updatedAt,
          status: "Cancellation Requested",
          description: "Appointment cancellation requested",
          icon: "cancelled",
        },
        {
          date: appointment.refundDate || appointment.updatedAt,
          status: "Refund Initiated",
          description: "Refund request processed",
          icon: "initiated",
        },
        {
          date: new Date(
            new Date(appointment.refundDate || appointment.updatedAt).getTime() +
              24 * 60 * 60 * 1000
          ),
          status: "Refund Processing",
          description: "Refund being processed by payment gateway",
          icon: "processing",
        },
        {
          date: new Date(
            new Date(appointment.refundDate || appointment.updatedAt).getTime() +
              5 * 24 * 60 * 60 * 1000
          ),
          status: "Refund Completed",
          description: "Amount credited to your account",
          icon: "completed",
        },
      ],

      doctorEarning: doctorEarning
        ? {
            status: doctorEarning.status,
            refundId: doctorEarning.refundId,
            amount: doctorEarning.amount,
            earningDate: doctorEarning.earningDate,
          }
        : null,

      transaction: refundTransaction
        ? {
            status: refundTransaction.status,
            amount: refundTransaction.amount,
            createdAt: refundTransaction.createdAt,
            notes: refundTransaction.notes,
          }
        : null,
    };

    res.json({
      success: true,
      refund: refundDetails,
    });
  } catch (error) {
    console.error("Get refund details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch refund details",
      error: error.message,
    });
  }
});

// RAZORPAY WEBHOOK HANDLER for refunds
const razorpayWebhook = asyncHandler(async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify webhook signature
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('Invalid webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log('Webhook received:', event);

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload);
        break;

      case 'payment.failed':
        await handlePaymentFailed(payload);
        break;

      case 'refund.created':
        await handleRefundCreated(payload);
        break;

      case 'refund.processed':
        await handleRefundProcessed(payload);
        break;

      default:
        console.log('Unhandled event:', event);
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions for webhook
const handlePaymentCaptured = async (payload) => {
  const { payment } = payload;
  
  // Find appointment by payment ID
  const appointment = await Appointment.findOne({ paymentId: payment.id });
  
  if (appointment) {
    appointment.paymentStatus = 'completed';
    appointment.status = 'confirmed';
    appointment.paymentDate = new Date(payment.created_at * 1000);
    await appointment.save();

    // Create doctor earning record
    await DoctorEarning.create({
      doctor: appointment.doctor,
      appointment: appointment._id,
      patient: appointment.patient,
      amount: payment.amount / 100, // Convert from paise
      paymentId: payment.id,
      status: 'completed',
      earningDate: new Date()
    });

    // Create transaction record
    await Transaction.create({
      appointment: appointment._id,
      patient: appointment.patient,
      doctor: appointment.doctor,
      type: 'payment',
      amount: payment.amount / 100,
      paymentId: payment.id,
      status: 'completed',
      notes: 'Payment captured via Razorpay'
    });
  }
};


const handleRefundCreated = async (payload) => {
  const { refund } = payload;

  if (!refund || !refund.payment_id) return;

  // 🔍 Find appointment by paymentId
  const appointment = await Appointment.findOne({
    paymentId: refund.payment_id
  });

  if (!appointment) return;

  // 🚫 Prevent duplicate processing (VERY IMPORTANT)
  if (appointment.refundId === refund.id) {
    return;
  }

  // ==========================
  // UPDATE APPOINTMENT
  // ==========================
  appointment.refundId = refund.id;
  appointment.refundStatus = 'initiated'; // webhook: refund.created
  appointment.paymentStatus = 'refunded';
  appointment.refundAmount = refund.amount / 100;
  appointment.refundDate = new Date(refund.created_at * 1000);

  await appointment.save();

  // ==========================
  // UPDATE DOCTOR EARNING
  // ==========================
  await DoctorEarning.findOneAndUpdate(
    { paymentId: refund.payment_id },
    {
      status: 'refunded',
      refundId: refund.id,
      refundAmount: refund.amount / 100,
      refundDate: new Date(refund.created_at * 1000)
    },
    { new: true }
  );

  // ==========================
  // CREATE TRANSACTION (SAFE)
  // ==========================
  const existingTxn = await Transaction.findOne({
    refundId: refund.id,
    type: 'refund'
  });

  if (!existingTxn) {
    await Transaction.create({
      appointment: appointment._id,
      patient: appointment.patient,
      doctor: appointment.doctor,
      type: 'refund',
      amount: refund.amount / 100,
      paymentId: refund.payment_id,
      refundId: refund.id,
      status: 'initiated',
      notes: 'Refund initiated via Razorpay webhook'
    });
  }
};


const handleRefundProcessed = async (payload) => {
  const { refund } = payload;
  
  const appointment = await Appointment.findOne({ refundId: refund.id });
  
  if (appointment) {
    appointment.refundStatus = 'processed';
    appointment.paymentStatus = 'refunded';
    await appointment.save();

    // Update doctor earning
    await DoctorEarning.findOneAndUpdate(
      { refundId: refund.id },
      { 
        status: 'refunded',
        updatedAt: new Date()
      }
    );

    // Update transaction
    await Transaction.findOneAndUpdate(
      { refundId: refund.id },
      { 
        status: 'processed',
        updatedAt: new Date()
      }
    );

    // Send notification
    try {
      const patient = await Patient.findById(appointment.patient).populate('user');
      if (patient && patient.user.email) {
        await sendEmail({
          to: patient.user.email,
          subject: 'Refund Processed Successfully',
          template: 'refund-processed',
          context: {
            patientName: patient.user.name,
            refundAmount: refund.amount / 100,
            refundId: refund.id,
            appointmentId: appointment.appointmentId
          }
        });
      }
    } catch (emailError) {
      console.error('Failed to send refund processed email:', emailError);
    }
  }
};

// ============================
// EXPORT ALL FUNCTIONS
// ============================
module.exports = {
  getServices,
  getDoctorsByService,
  getAvailableTimeSlots,
  getAllDoctors,
  getDoctorDetails,
  getDoctorSchedule,
  createDynamicAppointment,
  getAppointments,
  getDashboardStats,
  getPatientAppointments,
  getPatientAppointmentStats,
  cancelPatientAppointment,
  getTodayAppointments,
  updateAppointmentStatus,
  getMyPatientProfile,
  updateMyPatientProfile,


  getDoctorAppointments,
  confirmAppointment,
  doctorCancelAppointment,
  doctorUpdateAppointmentStatus,
  getAppointmentDetails,
  checkAppointmentStatus,
  getUpcomingAppointments,
 

  // New Payment Functions
  createRazorpayOrder,
  getDoctorEarnings,
  verifyPayment,
  getPaymentHistory,
  getRefundDetails,
  requestRefund,
  downloadReceipt,
  downloadDoctorReport,
  razorpayWebhook,
  cancelAppointmentWithRefund,
  getDoctorTransactions,

  deleteAppointment,
  deleteMultipleAppointments,
  createAppointmentWithPayment,
  updateAppointmentPayment
};
