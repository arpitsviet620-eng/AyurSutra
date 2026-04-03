// controllers/medicalZoneController.js
const Patient = require('../models/patientModels');
const MedicalRecord = require('../models/medicalRecord');
const Appointment = require('../models/appointmentModels');
const Treatment = require('../models/treatmentModels');
const moment = require('moment');
const { normalizeArrayObjects } = require('../utils/normalize');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

// Helper function to get patient from appointment
const getPatientFromAppointment = async (appointmentId) => {
  if (!appointmentId || !mongoose.Types.ObjectId.isValid(appointmentId)) {
    throw new Error("Invalid appointment ID");
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    throw new Error("Appointment not found");
  }

  return appointment.patient;
};

exports.getMedicalDataByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    if (!appointmentId || !mongoose.Types.ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ success: false, message: "Invalid appointment ID" });
    }

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate("doctor", "name")
      .populate({ path: "patient", populate: { path: "user", select: "name photo email age" } });

    if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found" });

    const patientId = appointment.patient._id;

    // Fetch medical records and treatments for this patient
    const [medicalRecords, treatments] = await Promise.all([
      MedicalRecord.find({ patient: patientId }).populate("doctor", "name").sort({ createdAt: -1 }),
      Treatment.find({ patient: patientId }).populate("doctor", "name").sort({ createdAt: -1 })
    ]);

    const symptoms = [];
    const diagnoses = [];
    const notes = [];
    const prescriptions = [];
    const treatmentPlans = [];

    medicalRecords.forEach(record => {
      record.symptoms?.forEach(s => symptoms.push({ ...s, date: record.date, doctor: record.doctor }));
      if (record.diagnosis && record.diagnosis !== "Clinical Note") diagnoses.push({ id: record._id, name: record.diagnosis, notes: record.notes, doctor: record.doctor, date: record.date });
      if (record.notes) notes.push({ id: record._id, content: record.notes, doctor: record.doctor, date: record.date });
    });

    treatments.forEach(t => t.type === "treatment" ? treatmentPlans.push(t) : prescriptions.push(t));

    res.json({
      success: true,
      appointment,
      patient: appointment.patient,
      medicalRecords,
      treatments,
      prescriptions,
      treatmentPlans,
      symptoms,
      diagnoses,
      notes
    });

  } catch (error) {
    console.error("Error in getMedicalDataByAppointment:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Add symptom for patient from appointment
exports.addSymptom = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const symptomData = req.body;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    let medicalRecord = await MedicalRecord.findOne({
      patient: patient._id,
      visitType: "symptom_record"
    }).sort({ date: -1 });

    if (!medicalRecord) {
      medicalRecord = new MedicalRecord({
        patient: patient._id,
        diagnosis: "Symptom recording",
        doctor: req.user?._id || req.body.doctorId,
        visitType: "symptom_record",
        symptoms: []
      });
    }

    const allowedStatuses = ["active", "resolved", "monitoring"];

    medicalRecord.symptoms.push({
      name: symptomData.name,
      severity: symptomData.severity || "moderate",
      duration: symptomData.duration,
      description: symptomData.description,
      onset: symptomData.onset,
      pattern: symptomData.pattern,
      triggers: symptomData.triggers,
      notes: symptomData.notes,
      status: allowedStatuses.includes(symptomData.status)
        ? symptomData.status
        : "active"
    });

    await medicalRecord.save();

    await medicalRecord.populate("patient", "fullName patientId");
    if (medicalRecord.doctor) {
      await medicalRecord.populate("doctor", "name email");
    }

    res.status(201).json({
      message: "Symptom added successfully",
      symptom: medicalRecord.symptoms.at(-1),
      record: medicalRecord
    });
  } catch (error) {
    console.error("Error adding symptom:", error);
    res.status(500).json({
      message: "Error adding symptom",
      error: error.message
    });
  }
};

exports.updateSymptom = async (req, res) => {
  try {
    const { appointmentId, symptomId } = req.params;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patientObjectId = new mongoose.Types.ObjectId(patientId);

    const medicalRecord = await MedicalRecord.findOne({
      patient: patientObjectId,
      "symptoms._id": symptomId
    });

    if (!medicalRecord) {
      return res.status(404).json({ message: "Symptom not found" });
    }

    const symptom = medicalRecord.symptoms.id(symptomId);

    Object.keys(req.body).forEach((key) => {
      if (req.body[key] !== undefined) {
        symptom[key] = req.body[key];
      }
    });

    await medicalRecord.save();

    res.json({
      message: "Symptom updated successfully",
      symptom
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSymptom = async (req, res) => {
  try {
    const { appointmentId, symptomId } = req.params;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patientObjectId = new mongoose.Types.ObjectId(patientId);

    const medicalRecord = await MedicalRecord.findOne({
      patient: patientObjectId,
      "symptoms._id": symptomId
    });

    if (!medicalRecord) {
      return res.status(404).json({ message: "Symptom not found" });
    }

    medicalRecord.symptoms.pull({ _id: symptomId });
    await medicalRecord.save();

    res.json({ message: "Symptom deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAllSymptoms = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patientObjectId = new mongoose.Types.ObjectId(patientId);

    const records = await MedicalRecord.find({
      patient: patientObjectId,
      symptoms: { $exists: true, $not: { $size: 0 } }
    })
      .populate("patient", "fullName patientId")
      .populate("doctor", "name email")
      .sort({ createdAt: -1 });

    const symptoms = records.flatMap(record =>
      record.symptoms.map(symptom => ({
        ...symptom.toObject(),
        recordId: record._id,
        recordedDate: record.date,
        doctor: record.doctor
      }))
    );

    res.json({
      patient: records[0]?.patient || null,
      symptoms,
      count: symptoms.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// CRUD operations for diagnoses
exports.addDiagnosis = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    
    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found" });

    const record = new MedicalRecord({
      patient: patient._id,
      diagnosis: req.body.name,
      notes: req.body.notes,
      confidence: req.body.confidence,
      visitType: req.body.type || "routine",
      doctor: req.user._id,
      date: new Date()
    });

    await record.save();
    res.status(201).json(record);
  } catch (error) {
    console.error("Error adding diagnosis:", error);
    res.status(500).json({ message: "Error adding diagnosis", error: error.message });
  }
};

exports.updateDiagnosis = async (req, res) => {
  try {
    const { appointmentId, recordId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      return res.status(400).json({ message: "Invalid diagnosis record ID" });
    }

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({ message: "Diagnosis record not found" });
    }

    // 🔁 MAP frontend labels → backend enum
    let visitType = req.body.type;

    const visitTypeMap = {
      Primary: "routine",
      "Follow-up": "follow-up",
      Emergency: "emergency",
      Other: "other"
    };

    if (visitTypeMap[visitType]) {
      visitType = visitTypeMap[visitType];
    }

    record.diagnosis = req.body.name;
    record.notes = req.body.notes;
    record.confidence = req.body.confidence;
    record.visitType = visitType || record.visitType;

    await record.save();

    res.json({ message: "Diagnosis updated successfully" });
  } catch (error) {
    console.error("Update Diagnosis Error:", error);
    res.status(500).json({
      message: "Update failed",
      error: error.message
    });
  }
};

exports.deleteDiagnosis = async (req, res) => {
  try {
    const { appointmentId, recordId } = req.params;

    if (!recordId || !mongoose.Types.ObjectId.isValid(recordId)) {
      return res.status(400).json({
        message: "Invalid diagnosis record ID"
      });
    }

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({ message: "Diagnosis not found" });
    }

    await record.deleteOne();

    res.json({ message: "Diagnosis deleted successfully" });
  } catch (error) {
    console.error("Delete Diagnosis Error:", error);
    res.status(500).json({ message: "Delete failed", error: error.message });
  }
};

exports.addTreatment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const data = req.body;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);

    const treatment = await Treatment.create({
      treatmentId: `TRT-${Date.now()}`,
      patient: patientId,
      doctor: req.user._id,
      diagnosis: data.name || "General Treatment",
      symptoms: Array.isArray(data.symptoms) ? data.symptoms : [],
      prescribedTherapies: normalizeArrayObjects(data.therapies, "therapy"),
      medicines: normalizeArrayObjects(data.medicines, "medicine"),
      dietRecommendations: data.diet || [],
      lifestyleChanges: data.lifestyle || [],
      notes: data.notes,
      followUpDate: data.followUpDate || null,
      duration: data.duration || null,
      status: data.status || "ongoing"
    });

    res.status(201).json({
      message: "Treatment added successfully",
      treatment
    });

  } catch (error) {
    console.error("ADD TREATMENT ERROR:", error);
    res.status(500).json({
      message: "Error adding treatment",
      error: error.message
    });
  }
};

const normalizeTherapies = (therapies = []) => {
  if (!Array.isArray(therapies)) return [];

  return therapies
    .filter(t => t && t.therapy)
    .filter(t => mongoose.Types.ObjectId.isValid(t.therapy))
    .map(t => ({
      therapy: t.therapy,
      duration: t.duration || null,
      notes: t.notes || ""
    }));
};

const normalizeMedicines = (medicines = []) => {
  if (!Array.isArray(medicines)) return [];

  return medicines
    .filter(m => m && m.name)
    .map(m => ({
      name: m.name,
      dosage: m.dosage || "As directed",
      frequency: m.frequency || "Once a day",
      duration: m.duration || "7 days"
    }));
};

exports.updateTreatment = async (req, res) => {
  try {
    const { appointmentId, treatmentId } = req.params;
    const data = req.body;

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const treatment = await Treatment.findById(treatmentId);
    if (!treatment) {
      return res.status(404).json({ message: "Treatment not found" });
    }

    // Basic fields
    if (data.name !== undefined) treatment.diagnosis = data.name;
    if (Array.isArray(data.symptoms)) treatment.symptoms = data.symptoms;
    if (Array.isArray(data.diet)) treatment.dietRecommendations = data.diet;
    if (Array.isArray(data.lifestyle)) treatment.lifestyleChanges = data.lifestyle;
    if (data.notes !== undefined) treatment.notes = data.notes;
    if (data.followUpDate !== undefined) treatment.followUpDate = data.followUpDate;
    if (data.status !== undefined) treatment.status = data.status;

    // 🔐 SAFE arrays
    if ("therapies" in data) {
      treatment.prescribedTherapies = normalizeTherapies(data.therapies);
    }

    if ("medicines" in data) {
      treatment.medicines = normalizeMedicines(data.medicines);
    }

    await treatment.save();

    const populated = await Treatment.findById(treatment._id)
      .populate("doctor", "name email")
      .populate("prescribedTherapies.therapy", "name category");

    res.json({
      message: "Treatment updated successfully",
      treatment: populated
    });

  } catch (error) {
    console.error("UPDATE TREATMENT ERROR:", error);
    res.status(500).json({
      message: "Error updating treatment",
      error: error.message
    });
  }
};

exports.deleteTreatment = async (req, res) => {
  try {
    const { appointmentId, treatmentId } = req.params;

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const treatment = await Treatment.findByIdAndDelete(treatmentId);
    if (!treatment) {
      return res.status(404).json({ message: "Treatment not found" });
    }

    res.json({
      message: "Treatment deleted successfully"
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting treatment",
      error: error.message
    });
  }
};

// Add clinical note
exports.addClinicalNote = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { content } = req.body;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    const medicalRecord = new MedicalRecord({
      patient: patient._id,
      date: new Date(),
      diagnosis: "Clinical Note",
      notes: content,
      doctor: req.user._id,
      visitType: "other",
      status: "confirmed"
    });

    await medicalRecord.save();
    await medicalRecord.populate("doctor", "name email");

    res.status(201).json({
      success: true,
      message: "Clinical note added successfully",
      note: {
        id: medicalRecord._id,
        content: medicalRecord.notes,
        date: medicalRecord.date,
        doctor: medicalRecord.doctor
      }
    });

  } catch (error) {
    console.error("Error adding note:", error);
    res.status(500).json({
      success: false,
      message: "Error adding note",
      error: error.message
    });
  }
};

exports.getClinicalNotesByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { page = 1, limit = 10, search } = req.query;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found"
      });
    }

    // ---------------- Query ----------------
    const query = {
      patient: patient._id,
      diagnosis: "Clinical Note"
    };

    if (search) {
      query.notes = { $regex: search, $options: "i" };
    }

    // ---------------- Fetch Notes ----------------
    const notes = await MedicalRecord.find(query)
      .populate("doctor", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await MedicalRecord.countDocuments(query);

    // ---------------- Response ----------------
    res.status(200).json({
      success: true,
      notes: notes.map(note => ({
        id: note._id,
        content: note.notes,
        date: note.date,
        doctor: note.doctor,
        visitType: note.visitType,
        status: note.status
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        totalRecords: total
      }
    });

  } catch (error) {
    console.error("Error fetching clinical notes:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching clinical notes",
      error: error.message
    });
  }
};

exports.updateClinicalNote = async (req, res) => {
  try {
    const { appointmentId, noteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ message: "Invalid note ID" });
    }

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const record = await MedicalRecord.findById(noteId);

    if (!record) {
      return res.status(404).json({ message: "Clinical note not found" });
    }

    record.notes = req.body.content;
    await record.save();

    res.json({ message: "Clinical note updated", record });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err.message });
  }
};

exports.deleteClinicalNote = async (req, res) => {
  try {
    const { appointmentId, noteId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ message: "Invalid note ID" });
    }

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const record = await MedicalRecord.findByIdAndDelete(noteId);

    if (!record) {
      return res.status(404).json({ message: "Clinical note not found" });
    }

    res.json({ message: "Clinical note deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed", error: err.message });
  }
};

exports.getPrescriptionsByAppointment = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;

  const {
    status,
    search,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    includeStats = true
  } = req.query;

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));

  /* =========================
     🔍 GET PATIENT FROM APPOINTMENT
  ========================= */
  const patientId = await getPatientFromAppointment(appointmentId);
  const patient = await Patient.findById(patientId);

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Patient not found"
    });
  }

  /* =========================
     📄 BUILD QUERY
  ========================= */
  const query = { patient: patient._id };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i');
    query.$or = [
      { diagnosis: regex },
      { notes: regex },
      { treatmentId: regex },
      { 'medicines.name': regex }
    ];
  }

  const sort = {
    [sortBy]: sortOrder === 'asc' ? 1 : -1
  };

  /* =========================
     📦 FETCH PRESCRIPTIONS
  ========================= */
  const prescriptions = await Treatment.find(query)
    .populate('doctor', 'name email phone specialization')
    .populate('patient', 'patientCode age gender bloodGroup phone email address')
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .sort(sort)
    .lean();

  const totalItems = await Treatment.countDocuments(query);

  /* =========================
     📊 RESPONSE
  ========================= */
  const response = {
    success: true,
    prescriptions,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum),
      totalItems
    },
    patientInfo: {
      id: patient._id,
      patientCode: patient.patientCode,
      age: patient.age,
      gender: patient.gender,
      bloodGroup: patient.bloodGroup,
      phone: patient.phone,
      email: patient.email,
      address: patient.address
    }
  };

  /* =========================
     📈 STATISTICS (OPTIONAL)
  ========================= */
  if (includeStats === true || includeStats === 'true') {
    const statusCounts = await Treatment.aggregate([
      { $match: { patient: patient._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    response.statistics = {
      statusCounts: statusCounts.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {})
    };
  }

  res.status(200).json(response);
});

// Add prescription
exports.addPrescription = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const prescriptionData = req.body;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Get doctor from request
    const doctorId = req.user._id;

    // Create prescription
    const prescription = new Treatment({
      ...prescriptionData,
      patient: patient._id,
      doctor: doctorId,
      type: 'prescription',
      status: prescriptionData.status || 'ongoing'
    });

    // Calculate validUntil if durationDays is provided
    if (prescriptionData.durationDays) {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + prescriptionData.durationDays);
      prescription.validUntil = validUntil;
    }

    await prescription.save();

    // Populate references
    await prescription.populate('doctor', 'name email specialty');
    await prescription.populate('patient', 'fullName patientId age gender');

    res.status(201).json({
      message: 'Prescription created successfully',
      prescription
    });

  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ 
      message: 'Error creating prescription', 
      error: error.message 
    });
  }
};

// Update prescription
exports.updatePrescription = async (req, res) => {
  try {
    const { appointmentId, prescriptionId } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(prescriptionId)) {
      return res.status(400).json({ message: "Invalid prescription ID" });
    }

    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);

    const prescription = await Treatment.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    // ✅ Allowed Treatment statuses ONLY
    const allowedStatuses = ["ongoing", "completed", "cancelled", "printed"];

    Object.keys(updateData).forEach(key => {
      if (
        key === "status" &&
        !allowedStatuses.includes(updateData.status)
      ) {
        // ❌ Skip invalid status like "active"
        return;
      }

      if (!["_id", "__v", "treatmentId"].includes(key)) {
        prescription[key] = updateData[key];
      }
    });

    // ✅ Recalculate validUntil safely
    if (updateData.durationDays) {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + Number(updateData.durationDays));
      prescription.validUntil = validUntil;
    }

    await prescription.save();

    await prescription.populate("doctor", "name email specialty");
    await prescription.populate("patient", "fullName patientId age gender");

    res.json({
      message: "Prescription updated successfully",
      prescription
    });

  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({
      message: "Error updating prescription",
      error: error.message
    });
  }
};

// Delete prescription
exports.deletePrescription = async (req, res) => {
  try {
    const { appointmentId, prescriptionId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(prescriptionId)) {
      return res.status(400).json({ message: 'Invalid prescription ID' });
    }
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const result = await Treatment.findByIdAndDelete(prescriptionId);
    
    if (!result) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    res.json({
      message: 'Prescription deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting prescription:', error);
    res.status(500).json({ 
      message: 'Error deleting prescription', 
      error: error.message 
    });
  }
};

// Mark as printed
exports.markAsPrinted = async (req, res) => {
  try {
    const { appointmentId, prescriptionId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(prescriptionId)) {
      return res.status(400).json({ message: 'Invalid prescription ID' });
    }
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const prescription = await Treatment.findById(prescriptionId);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }
    
    prescription.isPrinted = true;
    prescription.printedAt = new Date();
    await prescription.save();
    
    res.json({
      message: 'Prescription marked as printed',
      prescription
    });
    
  } catch (error) {
    console.error('Error marking as printed:', error);
    res.status(500).json({ 
      message: 'Error marking as printed', 
      error: error.message 
    });
  }
};

// Schedule follow-up
exports.scheduleFollowUp = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const followUpData = req.body;

    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const appointment = new Appointment({
      patient: patient._id,
      doctor: req.user._id,
      date: followUpData.date,
      time: followUpData.time,
      type: 'follow-up',
      purpose: followUpData.purpose,
      status: 'scheduled',
      priority: followUpData.priority || 'medium',
      notes: followUpData.notes,
      duration: followUpData.duration || 30,
      location: followUpData.location || 'Clinic',
      reminder: followUpData.reminder ?? true,
      reminderTime: followUpData.reminderTime || '1 day before'
    });

    await appointment.save();
    await appointment.populate('doctor', 'name email specialty');
    await appointment.populate('patient', 'name patientId dob gender');

    res.status(201).json({
      success: true,
      message: 'Follow-up scheduled successfully',
      appointment
    });
  } catch (error) {
    console.error('Error scheduling follow-up:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error scheduling follow-up'
    });
  }
};

// Get all follow-ups for a patient from appointment
exports.getFollowUpsByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { 
      page = 1, 
      limit = 10, 
      status, 
      priority,
      dateFrom,
      dateTo,
      search 
    } = req.query;
    
    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ 
        success: false,
        message: 'Patient not found' 
      });
    }
    
    // Build query
    let query = {
      patient: patient._id,
      type: 'follow-up'
    };
    
    // Filter by status
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // Filter by priority
    if (priority && priority !== 'all') {
      query.priority = priority;
    }
    
    // Date range filter
    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }
    
    // Search in purpose and notes
    if (search) {
      query.$or = [
        { purpose: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [followUps, total] = await Promise.all([
      Appointment.find(query)
        .sort({ date: 1, time: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('doctor', 'name email specialty')
        .populate('patient', 'name patientId dob gender'),
      Appointment.countDocuments(query)
    ]);
    
    // Get upcoming and overdue counts
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcomingCount = await Appointment.countDocuments({
      ...query,
      date: { $gte: today },
      status: { $in: ['scheduled', 'confirmed'] }
    });
    
    const overdueCount = await Appointment.countDocuments({
      ...query,
      date: { $lt: today },
      status: { $in: ['scheduled', 'confirmed'] }
    });
    
    res.status(200).json({
      success: true,
      count: followUps.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      upcomingCount,
      overdueCount,
      followUps
    });
  } catch (error) {
    console.error('Error fetching follow-ups:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching follow-ups', 
      error: error.message 
    });
  }
};

// Get recent follow-ups (for 4-card display)
exports.getRecentFollowUpsByAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { limit = 4 } = req.query;
    
    // Get patient from appointment
    const patientId = await getPatientFromAppointment(appointmentId);
    
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ 
        success: false,
        message: 'Patient not found' 
      });
    }
    
    const followUps = await Appointment.find({
      patient: patient._id,
      type: 'follow-up',
      status: { $in: ['scheduled', 'confirmed'] }
    })
    .sort({ date: 1 })
    .limit(parseInt(limit))
    .populate('doctor', 'name email specialty')
    .populate('patient', 'name patientId dob gender')
    .lean();
    
    // Add time remaining info
    const enrichedFollowUps = followUps.map(followUp => {
      const now = moment();
      const followUpDate = moment(followUp.date);
      const daysUntil = followUpDate.diff(now, 'days');
      
      return {
        ...followUp,
        daysUntil,
        isToday: daysUntil === 0,
        isTomorrow: daysUntil === 1,
        isOverdue: daysUntil < 0,
        timeSlot: `${followUp.time} (${followUp.duration || 30} mins)`
      };
    });
    
    res.status(200).json({
      success: true,
      count: enrichedFollowUps.length,
      followUps: enrichedFollowUps
    });
  } catch (error) {
    console.error('Error fetching recent follow-ups:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching recent follow-ups', 
      error: error.message 
    });
  }
};

// Get single follow-up
exports.getFollowUpById = async (req, res) => {
  try {
    const { appointmentId, followUpId } = req.params;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const followUp = await Appointment.findOne({
      _id: followUpId,
      type: 'follow-up'
    })
    .populate('doctor', 'name email specialty phone')
    .populate('patient', 'name patientId dob gender phone email address');
    
    if (!followUp) {
      return res.status(404).json({ 
        success: false,
        message: 'Follow-up not found' 
      });
    }
    
    // Calculate time info
    const now = moment();
    const followUpDate = moment(followUp.date);
    const daysUntil = followUpDate.diff(now, 'days');
    
    const enrichedFollowUp = {
      ...followUp.toObject(),
      daysUntil,
      isToday: daysUntil === 0,
      isTomorrow: daysUntil === 1,
      isOverdue: daysUntil < 0,
      timeSlot: `${followUp.time} (${followUp.duration || 30} mins)`,
      dateFormatted: followUpDate.format('dddd, MMMM Do YYYY')
    };
    
    res.status(200).json({
      success: true,
      followUp: enrichedFollowUp
    });
  } catch (error) {
    console.error('Error fetching follow-up:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching follow-up', 
      error: error.message 
    });
  }
};

// Update follow-up
exports.updateFollowUp = async (req, res) => {
  try {
    const { appointmentId, followUpId } = req.params;
    const updateData = req.body;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const followUp = await Appointment.findOne({
      _id: followUpId,
      type: 'follow-up'
    });
    
    if (!followUp) {
      return res.status(404).json({ 
        success: false,
        message: 'Follow-up not found' 
      });
    }
    
    // Check if user is authorized
    if (followUp.doctor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to update this follow-up' 
      });
    }
    
    // Update allowed fields
    const allowedUpdates = ['date', 'time', 'purpose', 'priority', 'notes', 'status', 'duration', 'location'];
    allowedUpdates.forEach(field => {
      if (updateData[field] !== undefined) {
        followUp[field] = updateData[field];
      }
    });
    
    followUp.updatedAt = new Date();
    
    await followUp.save();
    
    await followUp.populate('doctor', 'name email specialty');
    await followUp.populate('patient', 'name patientId dob gender');
    
    res.status(200).json({
      success: true,
      message: 'Follow-up updated successfully',
      followUp
    });
  } catch (error) {
    console.error('Error updating follow-up:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating follow-up', 
      error: error.message 
    });
  }
};

// Delete follow-up
exports.deleteFollowUp = async (req, res) => {
  try {
    const { appointmentId, followUpId } = req.params;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const followUp = await Appointment.findOne({
      _id: followUpId,
      type: 'follow-up'
    });
    
    if (!followUp) {
      return res.status(404).json({ 
        success: false,
        message: 'Follow-up not found' 
      });
    }
    
    // Check if user is authorized
    if (followUp.doctor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to delete this follow-up' 
      });
    }
    
    await followUp.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Follow-up deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting follow-up:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting follow-up', 
      error: error.message 
    });
  }
};

// Mark follow-up as complete
exports.markFollowUpComplete = async (req, res) => {
  try {
    const { appointmentId, followUpId } = req.params;
    const { outcomeNotes } = req.body;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const followUp = await Appointment.findOne({
      _id: followUpId,
      type: 'follow-up'
    });
    
    if (!followUp) {
      return res.status(404).json({ 
        success: false,
        message: 'Follow-up not found' 
      });
    }
    
    followUp.status = 'completed';
    followUp.outcomeNotes = outcomeNotes || followUp.outcomeNotes;
    followUp.completedAt = new Date();
    followUp.updatedAt = new Date();
    
    await followUp.save();
    
    res.status(200).json({
      success: true,
      message: 'Follow-up marked as complete',
      followUp
    });
  } catch (error) {
    console.error('Error marking follow-up complete:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error marking follow-up complete', 
      error: error.message 
    });
  }
};

// Reschedule follow-up
exports.rescheduleFollowUp = async (req, res) => {
  try {
    const { appointmentId, followUpId } = req.params;
    const { newDate, newTime, reason } = req.body;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const followUp = await Appointment.findOne({
      _id: followUpId,
      type: 'follow-up'
    });
    
    if (!followUp) {
      return res.status(404).json({ 
        success: false,
        message: 'Follow-up not found' 
      });
    }
    
    // Store reschedule history
    if (!followUp.rescheduleHistory) {
      followUp.rescheduleHistory = [];
    }
    
    followUp.rescheduleHistory.push({
      originalDate: followUp.date,
      originalTime: followUp.time,
      newDate: newDate,
      newTime: newTime,
      reason: reason,
      rescheduledBy: req.user._id,
      rescheduledAt: new Date()
    });
    
    // Update date and time
    followUp.date = newDate;
    followUp.time = newTime;
    followUp.status = 'rescheduled';
    followUp.updatedAt = new Date();
    
    await followUp.save();
    
    res.status(200).json({
      success: true,
      message: 'Follow-up rescheduled successfully',
      followUp
    });
  } catch (error) {
    console.error('Error rescheduling follow-up:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error rescheduling follow-up', 
      error: error.message 
    });
  }
};

// Delete medical record
exports.deleteRecord = async (req, res) => {
  try {
    const { appointmentId, recordId } = req.params;
    
    // Verify appointment exists and user has access
    await getPatientFromAppointment(appointmentId);
    
    const record = await MedicalRecord.findByIdAndDelete(recordId);
    
    if (!record) {
      return res.status(404).json({ message: 'Record not found' });
    }
    
    res.json({ 
      message: 'Record deleted successfully',
      recordId: recordId
    });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ 
      message: 'Error deleting record', 
      error: error.message 
    });
  }
};