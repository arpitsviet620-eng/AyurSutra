// routes/doctorMedicalRecordsRoutes.js
const express = require('express');
const router = express.Router();

const {
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
} = require('../controllers/medicalRecordController');

const { protect, authorize } = require('../middleware/authMiddleware');

router.use(protect);
router.use(authorize('doctor', 'admin'));

// Dashboard
router.get('/dashboard/stats', getDashboardStats);

// Patients & appointments

router.get('/my-records', getMyRecords);
router.get('/patients', getPatientsList);
router.get('/appointments', getDoctorAppointments);

// Patient medical records
router.get('/patient/:patientId/records', getPatientRecords);

// Create records
router.post('/from-appointment/:appointmentId', createRecordFromAppointment);
router.post('/patient/:patientId', createRecordForPatient);

// Record CRUD
router.get('/:recordId', getRecordDetails);
router.put('/:recordId', updateRecord);
router.delete('/:recordId', deleteRecord);

// Attachments
router.delete('/:recordId/attachments/:attachmentId', deleteAttachment);
router.get('/download/:recordId/:fileIndex', downloadRecordFile);

// Send to patient
router.post('/:recordId/send', sendRecordToPatient);

module.exports = router;
