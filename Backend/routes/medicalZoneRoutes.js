// routes/medicalZoneRoutes.js
// const express = require('express');
// const router = express.Router();
// const {
//   getMedicalZoneData,

//   getAllSymptoms,
//   addSymptom,
//   updateSymptom,
//   deleteSymptom,

//   addDiagnosis,
//   updateDiagnosis,
//   deleteDiagnosis,

//   addTreatment,
//   updateTreatment,
//   deleteTreatment,

//   addClinicalNote,
//   updateClinicalNote,
//   deleteClinicalNote,
//   getClinicalNotesByPatient,

//   getPrescriptionsByPatient,
//   addPrescription,
//   updatePrescription,
//   deletePrescription,
//   markAsPrinted,

//   scheduleFollowUp,
//   getFollowUps,
//   getFollowUpById,
//   updateFollowUp,
//   deleteFollowUp,
//   getRecentFollowUps,
//   markFollowUpComplete,
//   rescheduleFollowUp,


//   deleteRecord
// } = require('../controllers/medicalZoneController');
// const { protect, authorize } = require('../middleware/authMiddleware');

// // Get all medical zone data for a patient
// router.get('/:patientId', protect, getMedicalZoneData);

// // Symptoms
// router.post('/:patientId/symptoms', protect, addSymptom);
// router.put('/:patientId/symptoms/:symptomId',protect,updateSymptom);
// router.delete('/:patientId/symptoms/:symptomId',protect,deleteSymptom);
// router.get('/:patientId/symptoms', protect, getAllSymptoms );

// // Diagnosis
// router.post('/:patientId/diagnosis', protect, addDiagnosis);
// router.put('/:patientId/diagnosis/:recordId', protect, updateDiagnosis);
// router.delete('/:patientId/diagnosis/:recordId', protect, deleteDiagnosis);

// // routes/treatment.routes.js
// router.post("/:patientId/treatments", protect, addTreatment);
// router.put("/treatments/:treatmentId", protect, updateTreatment);
// router.delete("/treatments/:treatmentId", protect, deleteTreatment);

// // Clinical Notes
// router.get('/:patientId/notes', protect, getClinicalNotesByPatient);
// router.post('/:patientId/notes', protect, addClinicalNote);
// router.put('/notes/:noteId', protect, updateClinicalNote);
// router.delete('/notes/:noteId', protect, deleteClinicalNote);



// // Prescriptions
// router.get( "/:patientId/prescriptions", protect, authorize("doctor", "admin"), getPrescriptionsByPatient );
// router.post('/:patientId/prescriptions', protect, addPrescription);
// router.put('/prescriptions/:prescriptionId', protect, updatePrescription);
// router.delete('/prescriptions/:prescriptionId', protect, deletePrescription);
// router.put('/prescriptions/:prescriptionId/print', protect, markAsPrinted);

// // Follow-ups
// router.post('/:patientId/follow-ups', protect, scheduleFollowUp);
// router.get('/:patientId/follow-ups/recent', protect, getRecentFollowUps);
// router.get('/:patientId/follow-ups', protect, getFollowUps);

// router.get('/follow-ups/:followUpId', protect, getFollowUpById);
// router.put('/follow-ups/:followUpId', protect, updateFollowUp);
// router.delete('/follow-ups/:followUpId', protect, deleteFollowUp);
// router.patch('/follow-ups/:followUpId/complete', protect, markFollowUpComplete);
// router.patch('/follow-ups/:followUpId/reschedule', protect, rescheduleFollowUp);


// // Delete record
// router.delete('/records/:recordId', protect, deleteRecord);

// module.exports = router;



// routes/medicalZoneRoutes.js
const express = require('express');
const router = express.Router();
const {
  getMedicalDataByAppointment,
  
  getAllSymptoms,
  addSymptom,
  updateSymptom,
  deleteSymptom,

  addDiagnosis,
  updateDiagnosis,
  deleteDiagnosis,

  addTreatment,
  updateTreatment,
  deleteTreatment,

  addClinicalNote,
  updateClinicalNote,
  deleteClinicalNote,
  getClinicalNotesByAppointment,

  getPrescriptionsByAppointment,
  addPrescription,
  updatePrescription,
  deletePrescription,
  markAsPrinted,

  scheduleFollowUp,
  getFollowUpsByAppointment,
  getFollowUpById,
  updateFollowUp,
  deleteFollowUp,
  getRecentFollowUpsByAppointment,
  markFollowUpComplete,
  rescheduleFollowUp,

  deleteRecord
} = require('../controllers/medicalZoneController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Get all medical zone data for a patient via appointment
router.get("/appointment/:appointmentId", protect, getMedicalDataByAppointment);

// Symptoms (all routes now use appointmentId)
router.post('/:appointmentId/symptoms', protect, addSymptom);
router.put('/:appointmentId/symptoms/:symptomId', protect, updateSymptom);
router.delete('/:appointmentId/symptoms/:symptomId', protect, deleteSymptom);
router.get('/:appointmentId/symptoms', protect, getAllSymptoms);

// Diagnosis (all routes now use appointmentId)
router.post('/:appointmentId/diagnosis', protect, addDiagnosis);
router.put('/:appointmentId/diagnosis/:recordId', protect, updateDiagnosis);
router.delete('/:appointmentId/diagnosis/:recordId', protect, deleteDiagnosis);

// Treatments (all routes now use appointmentId)
router.post("/:appointmentId/treatments", protect, addTreatment);
router.put("/:appointmentId/treatments/:treatmentId", protect, updateTreatment);
router.delete("/:appointmentId/treatments/:treatmentId", protect, deleteTreatment);

// Clinical Notes (all routes now use appointmentId)
router.get('/:appointmentId/notes', protect, getClinicalNotesByAppointment);
router.post('/:appointmentId/notes', protect, addClinicalNote);
router.put('/:appointmentId/notes/:noteId', protect, updateClinicalNote);
router.delete('/:appointmentId/notes/:noteId', protect, deleteClinicalNote);

// Prescriptions (all routes now use appointmentId)
router.get("/:appointmentId/prescriptions", protect, authorize("doctor", "admin"), getPrescriptionsByAppointment);
router.post('/:appointmentId/prescriptions', protect, addPrescription);
router.put('/:appointmentId/prescriptions/:prescriptionId', protect, updatePrescription);
router.delete('/:appointmentId/prescriptions/:prescriptionId', protect, deletePrescription);
router.put('/:appointmentId/prescriptions/:prescriptionId/print', protect, markAsPrinted);

// Follow-ups (all routes now use appointmentId)
router.post('/:appointmentId/follow-ups', protect, scheduleFollowUp);
router.get('/:appointmentId/follow-ups/recent', protect, getRecentFollowUpsByAppointment);
router.get('/:appointmentId/follow-ups', protect, getFollowUpsByAppointment);

router.get('/:appointmentId/follow-ups/:followUpId', protect, getFollowUpById);
router.put('/:appointmentId/follow-ups/:followUpId', protect, updateFollowUp);
router.delete('/:appointmentId/follow-ups/:followUpId', protect, deleteFollowUp);
router.patch('/:appointmentId/follow-ups/:followUpId/complete', protect, markFollowUpComplete);
router.patch('/:appointmentId/follow-ups/:followUpId/reschedule', protect, rescheduleFollowUp);

// Delete record (now uses appointmentId)
router.delete('/:appointmentId/records/:recordId', protect, deleteRecord);

module.exports = router;