// controllers/profileControllers.js
const User = require("../models/userModels");
const Doctor = require("../models/doctorModels");
const Patient = require("../models/patientModels");
const bcrypt = require("bcryptjs");

/* =========================
   CREATE / COMPLETE PROFILE
========================= */
exports.completeProfile = async (req, res) => {
  try {
    const { name, phone, bio, photo, role, ...rest } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // Update User fields
    const userUpdates = {};
    if (name) userUpdates.name = name;
    if (phone) userUpdates.phone = phone;
    if (bio) userUpdates.bio = bio;
    if (photo) userUpdates.photo = photo;
    if (role) userUpdates.role = role;

    await User.findByIdAndUpdate(userId, userUpdates, { new: true, runValidators: true });

    // Create role-specific profile if not exists
    if (role === "doctor") {
      const existingDoctor = await Doctor.findOne({ user: userId });
      if (!existingDoctor) await createDoctorProfile(userId, rest);
    } else if (role === "patient") {
      const existingPatient = await Patient.findOne({ user: userId });
      if (!existingPatient) await createPatientProfile(userId, rest);
    }

    const profile = await getFullProfile(userId);
    res.status(200).json({ success: true, message: "Profile completed", data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   GET FULL PROFILE
========================= */
exports.getMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = await getFullProfile(userId);
    if (!profile)
      return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   UPDATE PROFILE (FULL / PUT)
========================= */
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = { ...req.body };

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    /* =========================
       1️⃣ UPDATE USER FIELDS SAFELY
    ========================= */
    const allowedUserFields = [
      "name", "phone", "bio", "photo",
      "medicalRegistrationNumber", "doctorLicenseId", "email"
    ];
    const userUpdates = {};

    allowedUserFields.forEach(field => {
      const val = updateData[field];
      // ✅ Only include fields if they are not undefined/null/empty string
      if (val !== undefined && val !== null && val !== "") {
        userUpdates[field] = val;
      }
    });

    // Update User and catch duplicate key errors
    try {
      await User.findByIdAndUpdate(userId, userUpdates, {
        new: true,
        runValidators: true,
      });
    } catch (err) {
      if (err.code === 11000) {
        const dupField = Object.keys(err.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: `${dupField} already exists`
        });
      } else {
        throw err;
      }
    }

    /* =========================
       2️⃣ UPDATE ROLE-SPECIFIC PROFILE
    ========================= */
    if (user.role === "doctor") {
      const doctorFields = [
        "department", "specialization", "experience", "consultationFee",
        "availableDays", "workingHours", "maxPatientsPerDay",
        "licenseNumber", "education", "location", "qualifications"
      ];
      const doctorUpdates = {};
      doctorFields.forEach(f => {
        if (updateData[f] !== undefined && updateData[f] !== null) {
          doctorUpdates[f] = updateData[f];
        }
      });

      try {
        await Doctor.findOneAndUpdate(
          { user: userId },
          doctorUpdates,
          { new: true, runValidators: true }
        );
      } catch (err) {
        if (err.code === 11000) {
          const dupField = Object.keys(err.keyPattern)[0];
          return res.status(400).json({
            success: false,
            message: `Doctor ${dupField} already exists`
          });
        } else {
          throw err;
        }
      }

    } else if (user.role === "patient") {
      const patientFields = [
        "dateOfBirth", "gender", "bloodGroup", "allergies",
        "medicalHistory", "emergencyContact", "occupation",
        "maritalStatus", "address", "phone", "email", "photo"
      ];
      const patientUpdates = {};
      patientFields.forEach(f => {
        const val = updateData[f];
        if (val !== undefined && val !== null && val !== "") {
          patientUpdates[f] = val;
        }
      });

      // Calculate age if dateOfBirth changed
      if (patientUpdates.dateOfBirth) {
        patientUpdates.age = calculateAge(new Date(patientUpdates.dateOfBirth));
      }

      try {
        await Patient.findOneAndUpdate(
          { user: userId },
          patientUpdates,
          { new: true, runValidators: true }
        );
      } catch (err) {
        if (err.code === 11000) {
          const dupField = Object.keys(err.keyPattern)[0];
          return res.status(400).json({
            success: false,
            message: `Patient ${dupField} already exists`
          });
        } else {
          throw err;
        }
      }
    }

    /* =========================
       3️⃣ RETURN FULL PROFILE
    ========================= */
    const profile = await getFullProfile(userId);
    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: profile
    });

  } catch (error) {
    console.error("UpdateMyProfile Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update profile"
    });
  }
};

/* =========================
   HELPER: CALCULATE AGE
========================= */
function calculateAge(dob) {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}


/* =========================
   PARTIAL UPDATE (PATCH)
========================= */
exports.partialUpdate = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = { ...req.body };

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // Update User fields
    await User.findByIdAndUpdate(userId, updates, { new: true, runValidators: true });

    // Role-specific partial updates
    if (user.role === "doctor") {
      await updateDoctorProfile(userId, updates);
    } else if (user.role === "patient") {
      if (updates.dateOfBirth) updates.age = calculateAge(new Date(updates.dateOfBirth));
      await updatePatientProfile(userId, updates);
    }

    const profile = await getFullProfile(userId);
    res.status(200).json({ success: true, message: "Profile partially updated", data: profile });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* =========================
   SOFT DELETE PROFILE
========================= */
exports.deleteMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    user.isActive = false;
    user.deletedAt = new Date();
    user.deletionReason = reason;
    await user.save();

    res.status(200).json({ success: true, message: "Account deactivated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// -------------------- Change Password --------------------
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Both current and new passwords are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(userId).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
};



/* =========================
   HELPER FUNCTIONS
========================= */
function calculateAge(dob) {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

async function getFullProfile(userId) {
  const user = await User.findById(userId).select("-password");
  if (!user) return null;

  const profile = user.toObject();
  if (user.role === "doctor") profile.doctorProfile = await Doctor.findOne({ user: userId }).lean();
  if (user.role === "patient") profile.patientProfile = await Patient.findOne({ user: userId }).lean();

  return profile;
}

/* =========================
   DOCTOR PROFILE CRUD
========================= */
async function createDoctorProfile(userId, data) {
  const doctor = new Doctor({ user: userId, ...data });
  await doctor.save();
  await User.findByIdAndUpdate(userId, { doctorProfile: doctor._id });
}

async function updateDoctorProfile(userId, data) {
  const updates = { ...data };
  await Doctor.findOneAndUpdate({ user: userId }, updates, { new: true, runValidators: true });
}

/* =========================
   PATIENT PROFILE CRUD
========================= */
async function createPatientProfile(userId, data) {
  const patient = new Patient({ user: userId, ...data, createdBy: userId });
  await patient.save();
  await User.findByIdAndUpdate(userId, { patientProfile: patient._id });
}

async function updatePatientProfile(userId, data) {
  const updates = { ...data };
  await Patient.findOneAndUpdate({ user: userId }, updates, { new: true, runValidators: true });
}

