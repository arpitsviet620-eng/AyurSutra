const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");

const {
  getServices,
  getDoctorsByService,
  getAvailableTimeSlots,
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
  verifyPayment,
  cancelAppointmentWithRefund,
  createRazorpayOrder,
  getPaymentHistory,
  getRefundDetails,
  requestRefund,
  downloadReceipt,
  razorpayWebhook,
  getDoctorEarnings,
  deleteAppointment,
  deleteMultipleAppointments,
  getDoctorTransactions,
  getAllDoctors,
  getDoctorDetails,
  getDoctorSchedule,
  downloadDoctorReport
} = require("../controllers/appointmentController");

/* =======================
   PUBLIC ROUTES
======================= */
router.get("/services", getServices);
router.get("/timeslots", getAvailableTimeSlots);
router.get("/doctors", getAllDoctors);
router.get("/doctors/:id", getDoctorDetails);
router.get("/doctors/:id/schedule", getDoctorSchedule);
router.get("/:serviceId/doctors", getDoctorsByService); // This should come BEFORE dynamic routes

/* =======================
   WEBHOOK (NO AUTH)
======================= */
router.post("/webhook", razorpayWebhook);

/* =======================
   PROTECTED ROUTES
======================= */
router.use(protect);

/* ===== PATIENT PROFILE ===== */
router.get("/me", getMyPatientProfile);
router.put("/me", updateMyPatientProfile);

/* ===== APPOINTMENT PAYMENT ===== */
router.post("/book", createDynamicAppointment);
router.post("/create-order", createRazorpayOrder);
router.post("/verify-payment", verifyPayment);

/* ===== PATIENT APPOINTMENTS ===== */
router.get("/patient/my-appointments", authorize("patient"), getPatientAppointments);
router.get("/patient/upcoming", authorize("patient"), getUpcomingAppointments);
router.get("/patient/stats", authorize("patient"), getPatientAppointmentStats);
router.get("/patient/status", authorize("patient"), checkAppointmentStatus);
router.get("/patient/appointment/:id", authorize("patient"), getAppointmentDetails);
router.put("/patient/appointment/:id/cancel", authorize("patient"), cancelPatientAppointment);

/* ===== DOCTOR ROUTES ===== */
router.get("/doctor/earnings", authorize("doctor"), getDoctorEarnings);
router.get("/doctor/my-appointments", authorize("doctor"), getDoctorAppointments);
router.get("/doctor/transactions", authorize("doctor"), getDoctorTransactions);
router.put("/doctor/appointment/:id/confirm", authorize("doctor"), confirmAppointment);
router.put("/doctor/appointment/:id/cancel", authorize("doctor"), doctorCancelAppointment);
router.put("/doctor/appointment/:id/update-status", authorize("doctor"), doctorUpdateAppointmentStatus);


/* ===== ADMIN ROUTES ===== */
router.get("/admin/appointments/all", authorize("admin"), getAppointments);
router.get("/admin/stats/dashboard", authorize("admin"), getDashboardStats);
router.get("/admin/today", authorize("admin", "doctor"), getTodayAppointments);
router.put("/admin/appointment/:id/status", authorize("admin", "doctor"), updateAppointmentStatus);
router.delete("/admin/appointment/:id", authorize("admin"), deleteAppointment);
router.post("/admin/appointments/delete-multiple", authorize("admin"), deleteMultipleAppointments);
router.post("/doctor/download-report",authorize("doctor"),downloadDoctorReport);

/* ===== PAYMENT-SPECIFIC ROUTES (with appointmentId) ===== */
router.get("/appointment/:appointmentId/payments", getPaymentHistory);
router.get("/:appointmentId/refund-details", getRefundDetails);
router.post("/appointment/:appointmentId/request-refund", requestRefund);
router.get( "/:appointmentId/receipt", authorize("patient", "doctor", "admin"), downloadReceipt );
router.post("/cancel-with-refund", cancelAppointmentWithRefund);

module.exports = router;