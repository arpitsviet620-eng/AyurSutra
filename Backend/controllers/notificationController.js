const User = require("../models/userModels");
const { sendNotification } = require("../services/notificationService");

exports.appointmentCreated = async (appointment, patient, doctor, userId) => {
  return sendNotification({
    type: "appointment_created",
    title: "New Appointment Booked",
    message: `Appointment booked with Dr. ${doctor.user.name}`,
    triggeredBy: userId,
    recipients: [
      { user: doctor.user._id, role: "doctor" },
      { user: patient.user, role: "patient" }
    ]
  });
};

exports.appointmentConfirmed = async (appointment, doctorUser) => {
  return sendNotification({
    type: "appointment_confirmed",
    title: "Appointment Confirmed",
    message: `Dr. ${doctorUser.name} confirmed your appointment`,
    triggeredBy: doctorUser._id,
    recipients: [
      { user: appointment.patient.user._id, role: "patient" }
    ]
  });
};

exports.appointmentCancelled = async (appointment, doctorUser) => {
  return sendNotification({
    type: "appointment_cancelled",
    title: "Appointment Cancelled",
    message: `Dr. ${doctorUser.name} cancelled your appointment`,
    triggeredBy: doctorUser._id,
    recipients: [
      { user: appointment.patient.user._id, role: "patient" }
    ],
    priority: "high"
  });
};

exports.paymentStatus = async (appointment, status) => {
  const admins = await User.find({ role: "admin" }).select("_id");

  return sendNotification({
    type: status === "success" ? "payment_success" : "payment_failed",
    title: `Payment ${status}`,
    message: `Payment ${status} for appointment`,
    triggeredBy: appointment.patient.user,
    recipients: [
      { user: appointment.patient.user, role: "patient" },
      ...admins.map(a => ({ user: a._id, role: "admin" }))
    ],
    category: "payment",
    priority: status === "failed" ? "urgent" : "medium"
  });
};
