// utils/idGenerator.js

const Counter = require('../models/counterModels');

/* ======================================================
   GENERIC COUNTER HELPER (REUSABLE)
====================================================== */
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

/* ======================================================
   PATIENT ID
   PAT-2026-0001
====================================================== */
const generatePatientCode = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(100000 + Math.random() * 900000);
  return `PAT-${year}-${random}`;
};


/* ======================================================
   DOCTOR ID
   DOC-2026-0001
====================================================== */
const generateDoctorId = async () => {
  const seq = await getNextSequence('doctor');
  const year = new Date().getFullYear();
  return `DOC-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   APPOINTMENT ID
   APT-2026-0001
====================================================== */
const generateAppointmentId = async () => {
  const seq = await getNextSequence('appointment');
  const year = new Date().getFullYear();
  return `APT-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   THERAPY ID
   THR-2026-0001
====================================================== */
const generateTherapyId = async () => {
  const seq = await getNextSequence('therapy');
  const year = new Date().getFullYear();
  return `THR-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   TREATMENT ID
   TRE-2026-0001
====================================================== */
const generateTreatmentId = async () => {
  const seq = await getNextSequence('treatment');
  const year = new Date().getFullYear();
  return `TRE-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   INVENTORY ID
   ITEM-2026-0001
====================================================== */
const generateInventoryId = async () => {
  const seq = await getNextSequence('inventory');
  const year = new Date().getFullYear();
  return `ITEM-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   BILLING / INVOICE ID
   INV-2026-0001
====================================================== */
const generateBillingId = async () => {
  const seq = await getNextSequence('billing');
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   REPORT ID
   REP-2026-0001
====================================================== */
const generateReportId = async () => {
  const seq = await getNextSequence('report');
  const year = new Date().getFullYear();
  return `REP-${year}-${String(seq).padStart(4, '0')}`;
};

/* ======================================================
   EXPORT ALL
====================================================== */
module.exports = {
  generatePatientCode,
  generateDoctorId,
  generateAppointmentId,
  generateTherapyId,
  generateTreatmentId,
  generateInventoryId,
  generateBillingId,
  generateReportId
};
