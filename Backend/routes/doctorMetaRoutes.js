const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');

// 🔹 Helper function
const toLabelValue = (arr) =>
  arr.map(item => ({
    label: item
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()),
    value: item
  }));


const genderOptions = toLabelValue(['male', 'female', 'other']);

const bloodGroupOptions = [
  'A+','A-','B+','B-','O+','O-','AB+','AB-','Not Specified'
].map(v => ({
  label: v,
  value: v
}));


// ===================== DOCTOR META =====================
const departments = [
  { label: "General Medicine", value: "general" },
  { label: "Panchakarma", value: "panchakarma" },
  { label: "Kayachikitsa", value: "kayachikitsa" },
  { label: "Shalya Tantra", value: "shalya" },
  { label: "Shalakya Tantra", value: "shalakya" },
  { label: "Prasuti & Stri Roga", value: "prasuti" },
  { label: "Kaumarabhritya", value: "kaumarabhritya" },
  { label: "Swasthavritta", value: "swasthavritta" }
];




// Days of the week as { label, value } for frontend
const daysOfWeek = [
  { label: "Monday", value: "monday" },
  { label: "Tuesday", value: "tuesday" },
  { label: "Wednesday", value: "wednesday" },
  { label: "Thursday", value: "thursday" },
  { label: "Friday", value: "friday" },
  { label: "Saturday", value: "saturday" },
  { label: "Sunday", value: "sunday" }
];

// ===================== MEDICAL CATEGORY =====================
const medicalCategories = toLabelValue([
  'fever',
  'headache',
  'cough',
  'vomiting',
  'allergy',
  'pain',
  'antibiotic',
  'antiviral',
  'other'
]);


// ===================== THERAPY =====================
const therapyCategories = toLabelValue([
  'panchakarma','swedana','basti','nasya',
  'virechana','rakta-mokshana','others'
]);

// ===================== APPOINTMENT =====================
const appointmentStatus = toLabelValue([
  'scheduled','confirmed','checked-in',
  'in-progress','completed','cancelled','no-show'
]);

// ===================== BILLING =====================
const paymentStatus = toLabelValue([
  'pending','partial','paid','overdue','cancelled'
]);

const paymentMethods = toLabelValue([
  'cash','card','upi','cheque','insurance','online'
]);

// ===================== INVENTORY =====================
const inventoryCategories = toLabelValue([
  'medicine','herb','oil','equipment','other'
]);

const inventoryUnits = toLabelValue([
  'kg','g','mg','l','ml','pieces','packets','boxes'
]);

// ===================== MEDICAL =====================
const symptomStatusOptions = toLabelValue([
  'active','resolved','monitoring'
]);

const symptomSeverity = toLabelValue([
  'low','moderate','high'
]);

// ===================== PATIENT =====================
const maritalStatusOptions = toLabelValue([
  'single','married','divorced','widowed'
]);

const patientStatusOptions = toLabelValue([
  'active','inactive','deceased'
]);

// ===================== REPORT =====================
const reportTypes = toLabelValue([
  'financial','patient','doctor',
  'therapy','inventory','appointment','custom'
]);

const reportFrequencies = toLabelValue([
  'daily','weekly','monthly','quarterly','yearly'
]);

const chartTypes = toLabelValue([
  'bar','line','pie','table'
]);

const typeStatus = toLabelValue([
  'generated','processing','failed','sent'
]);

// ===================== TREATMENT =====================
const prakritiTypes = toLabelValue([
  'vata','pitta','kapha',
  'vata-pitta','vata-kapha','pitta-kapha','sama'
]);

const treatmentStatus = toLabelValue([
  'ongoing','completed','cancelled','follow-up'
]);

const treatmentFrequency = toLabelValue([
  'once daily','twice daily','thrice daily','as needed'
]);

const treatmentDurations = toLabelValue([
  '1 week','2 weeks','1 month','3 months','6 months','custom'
]);

const treatmentDosages = toLabelValue([
  '250mg','500mg','1g','5ml','10ml'
]);

const treatmentInstructions = toLabelValue([
  'before meals','after meals',
  'with warm water','with milk','at bedtime'
]);

// ===================== USER ROLE =====================
const roleTypes = toLabelValue([
  'admin','doctor','therapist','patient'
]);


//========================NotesCleanUp=========================
const categoryTypes = toLabelValue([
  'consultation',
  'follow-up',
  'emergency',
  'clinical-note',
  'other'
]);
const priorityOptions = [
  { label: 'All Priorities', value: 'all' },
  ...toLabelValue(['low', 'medium', 'high', 'critical'])
];


const dobConstraints = {
  minAge: 0,
  maxAge: 120
};

// ===================== META API =====================
router.get('/meta', asyncHandler(async (req, res) => {
  res.json({
    success: true,

    roleTypes,

    departments,
    daysOfWeek,
    medicalCategories,

    appointmentStatus,

    therapyCategories,

    paymentStatus,
    paymentMethods,

    inventoryCategories,
    inventoryUnits,

    symptomStatusOptions,
    symptomSeverity,

    maritalStatusOptions,
    patientStatusOptions,

    reportTypes,
    reportFrequencies,
    chartTypes,
    typeStatus,

    prakritiTypes,
    treatmentStatus,
    treatmentFrequency,
    treatmentDurations,
    treatmentDosages,
    treatmentInstructions,

    categoryTypes,
    priorityOptions,

    genderOptions,
    dobConstraints,
    bloodGroupOptions

  });
}));

module.exports = router;
