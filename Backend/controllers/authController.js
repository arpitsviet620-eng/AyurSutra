const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require('../models/userModels');
const Patient = require('../models/patientModels');
const EmailService = require('../utils/emailService');
const { generateToken } = require("../utils/token");

/* ======================================================
   CREATE DEFAULT ADMIN (auto-run on server start)
====================================================== */
async function createDefaultAdmin() {
  try {
    await User.createDefaultAdmin();
  } catch (error) {
    console.error('Failed to create default admin:', error);
  }
}

/* ======================================================
    GET ALL DOCTORS FOR ADMIN
====================================================== */
exports.getAllDoctorsForAdmin = async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      doctors
    });
  } catch (error) {
    console.error('ADMIN GET ALL DOCTORS ERROR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors'
    });
  }
};

// Run once when server starts
createDefaultAdmin();

/* ======================================================
  GET PENDING DOCTORS
====================================================== */
exports.getPendingDoctors = async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor", status: "pending" }).select(
      "-password"
    ); // hide password
    res.status(200).json({ success: true, doctors });
  } catch (err) {
    console.error("GET PENDING DOCTORS ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ======================================================
  APPROVE DOCTOR
====================================================== */

exports.approveDoctor = async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);

    if (!doctor)
      return res.status(404).json({ success: false, message: "Doctor not found" });

    if (doctor.role !== "doctor")
      return res.status(400).json({ success: false, message: "Not a doctor" });

    doctor.status = "active";
    doctor.isEmailVerified = true;
    doctor.isAdminVerified = true;

    await doctor.save();

    await EmailService.sendEmail({
      to: doctor.email,
      subject: "Doctor Account Approved",
      html: `
        <h3>Hello Dr. ${doctor.name},</h3>
        <p>Your account has been approved.</p>
        <p>You can now log in.</p>
        <br/>
        <p>– AyurSutra Team</p>
      `
    });

    res.status(200).json({
      success: true,
      message: "Doctor approved and email sent successfully"
    });

  } catch (err) {
    console.error("APPROVE DOCTOR ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


/* ======================================================
  REJECT DOCTOR
====================================================== */
  exports.rejectDoctor = async (req, res) => {
    try {
      const rejectionReason =
        req.body?.rejectionReason || "Application did not meet requirements";

      const doctor = await User.findById(req.params.id);

      if (!doctor)
        return res.status(404).json({ success: false, message: "Doctor not found" });

      if (doctor.role !== "doctor")
        return res.status(400).json({ success: false, message: "User is not a doctor" });

      if (doctor.status === "active")
        return res.status(400).json({
          success: false,
          message: "Approved doctor cannot be rejected",
        });

      doctor.status = "rejected";
      doctor.isApprovedByAdmin = false;
      doctor.isActive = false;
      doctor.rejectionReason = rejectionReason;
      doctor.rejectedAt = new Date();

      await doctor.save({ validateBeforeSave: false });

      // 📧 Send rejection email
      await EmailService.sendEmail({
        to: doctor.email,
        subject: "Doctor Application Rejected ❌",
        html: `
          <h3>Hello Dr. ${doctor.name}</h3>
          <p>Your application has been <b>rejected</b>.</p>
          <p><b>Reason:</b> ${rejectionReason}</p>
          <br/>
          <p>– AyurSutra Team</p>
        `,
      });

      return res.status(200).json({
        success: true,
        message: "Doctor rejected successfully",
      });

    } catch (error) {
      console.error("REJECT DOCTOR ERROR:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };

/* ======================================================
   REGISTER USER
====================================================== */

// Doctor/Patient Registration
exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      doctorLicenseId,
      medicalRegistrationNumber,
      dateOfBirth, // <-- patient-specific
      gender // <-- patient-specific
    } = req.body;

    if (role === 'doctor') {
      if (!doctorLicenseId || !medicalRegistrationNumber) {
        return res.status(400).json({
          success: false,
          message: "Doctor License ID and Medical Registration Number are required"
        });
      }
    }

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ success: false, message: "Email already exists" });

    const verifyCode = crypto.randomBytes(32).toString("hex");

    // Create user first
    const user = await User.create({
      name,
      email,
      password,
      role,
      doctorLicenseId,
      medicalRegistrationNumber,
      emailVerificationCode: role === "doctor" ? verifyCode : undefined,
      emailVerificationExpire:
        role === "doctor" ? Date.now() + 24 * 60 * 60 * 1000 : undefined,
      isEmailVerified: role !== "doctor",
      isApprovedByAdmin: role !== "doctor",
      status: role === "doctor" ? "pending" : "active"
    });

    // ===== Patient Profile Creation =====
    if (role === 'patient') {
      const profile = await Patient.create({
        user: user._id,
        dateOfBirth,
        gender,
        createdBy: user._id
      });
      user.patientProfile = profile._id;
      await user.save();
    }

    res.status(201).json({
      success: true,
      message:
        role === "doctor"
          ? "Doctor registered. Verify email & wait for admin approval."
          : "Registration successful"
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ======================================================
   Verify DOCTOR EMAIL
====================================================== */
exports.verifyDoctorEmail = async (req, res) => {
  const { token, email } = req.query;

  const user = await User.findOne({
    email,
    emailVerificationCode: token,
    emailVerificationExpire: { $gt: Date.now() }
  });

  if (!user)
    return res.status(400).json({ success: false, message: "Invalid or expired link" });

  user.isEmailVerified = true;
  user.emailVerificationCode = undefined;
  user.emailVerificationExpire = undefined;

  await user.save();

  res.json({
    success: true,
    message: "Email verified. Waiting for admin approval."
  });
};

/* ======================================================
    LOGIN USER  
====================================================== */
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    console.log("👉 Login attempt:", identifier);

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/Phone and password are required",
      });
    }

    // 🔍 Find user by email OR phone
    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: identifier }],
    }).select(
      "+password +status +isApprovedByAdmin +isEmailVerified +isDeleted +isSuspended"
    );

    if (!user) {
      console.log("❌ User not found");
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    console.log(
      "✅ User found:",
      user.email,
      "Role:",
      user.role,
      "Status:",
      user.status,
      "Approved:",
      user.isApprovedByAdmin
    );

    // 🔑 Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log("❌ Password mismatch");
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    /* ================= DOCTOR APPROVAL LOGIC ================= */
     if (user.role === "doctor") {
      const approved = user.isAdminVerified === true;
      const active = user.status === "active";

      if (!approved || !active) {
        return res.status(403).json({
          success: false,
          code: "DOCTOR_NOT_APPROVED",
          message:
            user.status === "pending"
              ? "Your doctor account is pending admin approval."
              : user.status === "rejected"
              ? "Your doctor account has been rejected."
              : "Doctor account is not active.",
          debug: {
            status: user.status,
            isAdminVerified: user.isAdminVerified
          }
        });
      }
    }

    /* ================= EMAIL VERIFICATION ================= */
    if (
      process.env.REQUIRE_EMAIL_VERIFICATION === "true" &&
      !user.isEmailVerified
    ) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before logging in",
      });
    }

    /* ================= ACCOUNT STATUS ================= */
    if (user.isDeleted || user.isSuspended) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_SUSPENDED",
        message: "Your account has been suspended. Please contact support.",
      });
    }

    // 🔐 Generate JWT
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // ❌ Remove sensitive fields
    user.password = undefined;
    user.__v = undefined;

    console.log("✅ Login successful - Role:", user.role);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        isApprovedByAdmin: user.isApprovedByAdmin,
        isEmailVerified: user.isEmailVerified,
        profileImage: user.profileImage,

        ...(user.role === "doctor" && {
          medicalRegistrationNumber: user.medicalRegistrationNumber,
          specialization: user.specialization,
          experience: user.experience,
          qualifications: user.qualifications,
          consultationFee: user.consultationFee,
        }),
      },
      redirectTo: getDashboardRoute(user.role),
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({
      success: false,
      message: "Login failed. Please try again.",
    });
  }
};


// Helper function to determine dashboard route based on role
function getDashboardRoute(role) {
  const routes = {
    'admin': '/admin/dashboard',
    'doctor': '/doctor/dashboard',
    'patient': '/patient/dashboard',
    'therapist': '/therapist/dashboard',
  };
  return routes[role] || '/dashboard';
}

/* ======================================================
    Delete DOCTOR 
====================================================== */
  exports.deleteDoctor = async (req, res) => {
  try {
    const doctor = await User.findById(req.params.id);

    if (!doctor)
      return res.status(404).json({ success: false, message: "Doctor not found" });

    doctor.isDeleted = true;
    doctor.deletedAt = new Date();
    doctor.isActive = false;

    await doctor.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Doctor deleted successfully",
    });
  } catch (error) {
    console.error("DELETE DOCTOR ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/* ======================================================
    FORGOT PASSWORD   
====================================================== */
exports.verifyOTP = async (req, res) => {
  try {
    let { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "Email और OTP दोनों चाहिए",
      });
    }

    otp = otp.toString().trim();

    const user = await User.findOne({ email }).select(
      "+resetPasswordOTP +resetPasswordOTPExpiry"
    );

    if (!user || !user.resetPasswordOTP) {
      return res.status(400).json({
        success: false,
        code: "OTP_NOT_FOUND",
        message: "OTP not found or already used",
      });
    }

    console.log("DB OTP:", user.resetPasswordOTP);
    console.log("INPUT OTP:", otp);
    console.log("EXPIRY:", user.resetPasswordOTPExpiry);
    console.log("NOW:", new Date());

    if (user.resetPasswordOTP !== otp) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OTP",
        message: "Invalid OTP",
      });
    }

    if (new Date() > user.resetPasswordOTPExpiry) {
      return res.status(400).json({
        success: false,
        code: "OTP_EXPIRED",
        message: "OTP expired",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = resetToken;
    user.resetPasswordTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpiry = undefined;

    await user.save();

    return res.status(200).json({
      success: true,
      resetToken,
    });
  } catch (error) {
    console.error("VERIFY OTP ERROR:", error);
    res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "OTP verification failed",
    });
  }
};




/* ======================================================
    RESEND OTP   
====================================================== */
exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    console.log("🔄 Resend OTP request for:", email);

    // Find user
    const user = await User.findOne({ 
      email: { $regex: new RegExp(`^${email}$`, 'i') } 
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, you will receive an OTP shortly.",
        email: email,
        otpSent: false
      });
    }

    // Generate NEW OTP
    const newOTP = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    console.log("🔄 New OTP:", newOTP, "(Type:", typeof newOTP, ")");

    // Store NEW OTP
    user.resetPasswordOTP = newOTP;
    user.resetPasswordOTPExpiry = otpExpires;
    await user.save();

    console.log("💾 New OTP saved in DB:", user.resetPasswordOTP);

    // Send NEW OTP Email
    await sendEmail({
      to: user.email,
      subject: "🔄 AyurSutra - New Password Reset OTP",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #10b981; margin: 0;">AyurSutra Healthcare</h2>
            <p style="color: #6b7280; margin: 5px 0;">New Password Reset OTP</p>
          </div>
          
          <h3 style="color: #374151;">Hello ${user.name},</h3>
          
          <p style="color: #4b5563; line-height: 1.6;">
            You requested a new password reset OTP. Here is your new verification code:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 10px; display: inline-block;">
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: white;">
                ${newOTP}
              </div>
            </div>
          </div>
          
          <p style="color: #4b5563; line-height: 1.6;">
            <strong>Note:</strong> This NEW OTP will expire in <strong>10 minutes</strong>.<br>
            Your previous OTP is no longer valid.
          </p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
          
          <p style="color: #6b7280; font-size: 12px; text-align: center;">
            © ${new Date().getFullYear()} AyurSutra Healthcare. All rights reserved.<br>
            This is an automated security message.
          </p>
        </div>
      `,
    });

    console.log("📩 New OTP email sent to:", user.email);

    res.status(200).json({
      success: true,
      message: "New OTP sent successfully to your email",
      email: user.email,
      otpSent: true,
      expiresIn: "10 minutes"
    });

  } catch (error) {
    console.error("❌ Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend OTP"
    });
  }
};
  
// ----------------- RESET PASSWORD -----------------
exports.resetPassword = async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword)
      return res.status(400).json({ success: false, message: "सभी fields required हैं" });

    // DB से user fetch करो + reset token fields select करो
    const user = await User.findOne({ email }).select(
      "+resetPasswordToken +resetPasswordTokenExpiry"
    );
    if (!user) return res.status(404).json({ success: false, message: "User नहीं मिला" });

    console.log("DB TOKEN:", user.resetPasswordToken);
    console.log("DB EXPIRY:", user.resetPasswordTokenExpiry);
    console.log("PROVIDED TOKEN:", resetToken);

    const cleanToken = resetToken.trim(); // Extra space remove करो

    // Token validity check
    if (
      !user.resetPasswordToken ||
      user.resetPasswordToken !== cleanToken ||
      !user.resetPasswordTokenExpiry ||
      Date.now() > new Date(user.resetPasswordTokenExpiry).getTime()
    ) {
      return res.status(400).json({ success: false, message: "Invalid या expired reset token" });
    }

    // ✅ Password update करो
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpiry = undefined;

    await user.save();

    console.log("Password reset successful for:", email);

    res.status(200).json({ success: true, message: "Password reset सफलतापूर्वक हुआ" });
  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);
    res.status(500).json({ success: false, message: "Reset password failed" });
  }
};



// ✅ FORGOT PASSWORD - Send OTP
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Email is required" });

    const user = await User.findOne({ email }).select(
      "+resetPasswordOTP +resetPasswordOTPExpiry"
    );
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // ✅ If OTP already exists & not expired → reuse it
    if (
      user.resetPasswordOTP &&
      user.resetPasswordOTPExpiry &&
      new Date() < user.resetPasswordOTPExpiry
    ) {
      console.log("♻️ Reusing existing OTP:", user.resetPasswordOTP);

      await EmailService.sendOTPEmail(
        user.email,
        user.resetPasswordOTP,
        user.name
      );

      return res.status(200).json({
        success: true,
        message: "OTP already sent. Please check your email.",
      });
    }

    // 🔥 Generate NEW OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    console.log("✅ NEW OTP SAVED:", otp);

    await EmailService.sendOTPEmail(user.email, otp, user.name);

    res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};



/* ======================================================
   GET CURRENT USER
====================================================== */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      user
    });

  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user details"
    });
  }
};

/* ======================================================
   LOGOUT
====================================================== */
exports.logout = (req, res) => {
  res.status(200).json({
    success: true,
    message: "Logged out successfully"
  });
};

/* ======================================================
   CHECK ADMIN (for testing)
====================================================== */
exports.checkAdmin = async (req, res) => {
  try {
    const admin = await User.findOne({ 
      email: 'mkchauhan9263@gmail.com',
      role: 'admin' 
    });
    
    if (admin) {
      res.status(200).json({
        success: true,
        message: "Admin account exists",
        admin: {
          name: admin.name,
          email: admin.email,
          role: admin.role,
          isActive: admin.isActive
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Admin account not found"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};