// controllers/dashboardController.js
const asyncHandler = require('express-async-handler');
const Patient = require('../models/patientModels');
const Treatment = require('../models/treatmentModels');
const Appointment = require('../models/appointmentModels');
const Room = require('../models/roomModels'); // optional, if you track rooms

const getDashboardStats = asyncHandler(async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);

  const todayEnd = new Date();
  todayEnd.setHours(23,59,59,999);

  // Parallel fetch
  const [totalPatients, activeTreatments, todaysAppointments, availableRooms] = await Promise.all([
    Patient.countDocuments(),
    Treatment.countDocuments({ status: 'ongoing' }),
    Appointment.countDocuments({ date: { $gte: todayStart, $lte: todayEnd } }),
    Room.countDocuments({ isAvailable: true })
  ]);

  // Optional: compute simple trends (placeholder for now)
  const stats = [
    { title: "Total Patients", value: totalPatients, icon: "patients", color: "teal", trend: "↑ 12% this month" },
    { title: "Active Treatments", value: activeTreatments, icon: "treatments", color: "blue", trend: "24 in Panchakarma phase" },
    { title: "Today's Appointments", value: todaysAppointments, icon: "appointments", color: "amber", trend: "3 scheduled in next hour" },
    { title: "Available Rooms", value: availableRooms, icon: "rooms", color: "green", trend: "All equipped & ready" }
  ];

  res.json({
    success: true,
    stats
  });
});

module.exports = { getDashboardStats };
