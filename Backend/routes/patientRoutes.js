// // routes/patientRoutes.js
// const express = require("express");
// const router = express.Router();
// const upload = require("../middleware/upload");
// const { protect, authorize } = require("../middleware/authMiddleware");

// const {
//   createPatient,
//   getPatients,
//   getPatientById,
//   updatePatient,
//   deletePatient,
//   getMedicalRecords,
//   createMedicalRecord,
//   deleteMedicalRecord,
//   uploadPatientPhoto
// } = require("../controllers/patientController");

// router.use(protect);

// /* ================= PATIENT CRUD ================= */
// router.route("/")
//   .get(authorize("admin", "doctor"), getPatients)
//   .post(authorize("admin", "doctor"), createPatient);

// router.route("/:id")
//   .get(authorize("admin", "doctor", "patient"), getPatientById)
//   .put(authorize("admin", "doctor"), updatePatient)
//   .delete(authorize("admin"), deletePatient);

// /* ================= MEDICAL RECORDS ================= */
// router.get("/:id/medical-records", getMedicalRecords);
// router.post("/:id/medical-records", authorize("doctor"), createMedicalRecord);
// router.delete("/:id/medical-records/:recordId", authorize("doctor"), deleteMedicalRecord);

// /* ================= PHOTO ================= */
// router.post(
//   "/:id/photo",
//   authorize("patient", "admin"),
//   upload.single("photo"),
//   uploadPatientPhoto
// );

// module.exports = router;


const express = require("express");
const router = express.Router();
const {
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
  getMyPrescriptions
} = require("../controllers/patientController");

const { protect, authorize } = require("../middleware/authMiddleware");

/* ===================== MY PROFILE (MUST BE FIRST) ===================== */
router.get("/me", protect, getMyPatientProfile);
router.put("/me", protect, updateMyPatientProfile);
router.get("/me/prescriptions",protect,authorize("patient"),getMyPrescriptions);



/* ===================== ADMIN / STAFF ===================== */
router.post("/", protect, authorize("admin", "staff"), createPatient);
router.get("/", protect, authorize("admin", "doctor", "patient"), getPatients);

/* ===================== ID BASED (MUST BE LAST) ===================== */
router.get("/:id", protect, authorize("admin", "doctor", "patient"), getPatientById);
router.put("/:id", protect, authorize("admin", "doctor", "patient"), updatePatient);
router.delete("/:id", protect, authorize("admin"), deletePatient);

/* ===================== MEDICAL RECORDS ===================== */
router.get("/:id/records", protect, getMedicalRecords);
router.post("/:id/records", protect, createMedicalRecord);
router.delete("/:id/records/:recordId", protect, deleteMedicalRecord);

/* ===================== PHOTO ===================== */
router.put("/:id/photo", protect, uploadPatientPhoto);

module.exports = router;
