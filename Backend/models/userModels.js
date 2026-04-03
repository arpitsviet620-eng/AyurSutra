const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    // 🔐 AUTH FIELDS
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Please provide a valid email address',
      },
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^[6-9]\d{9}$/.test(v);
        },
        message:
          'Phone number must be a valid 10-digit Indian mobile number starting with 6-9',
      },
      set: function (v) {
        return v ? v.replace(/\D/g, '') : v;
      },
    },
    bio:{
      type: String,
      trim: true,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false,
      minlength: [6, 'Password must be at least 6 characters'],
    },

    photo: {
      type: String,
      default: 'default-avatar.png',
    },

    role: {
      type: String,
      enum: ['admin', 'doctor', 'therapist', 'patient'],
      default: 'patient',
      required: true,
    },

    // 🩺 DOCTOR UNIQUE FIELD (ONLY FOR DOCTOR)
    medicalRegistrationNumber: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          if (this.role !== 'doctor') return true;
          if (!v) return false;
          return /^[A-Z0-9-]{6,20}$/.test(v);
        },
        message:
          'Medical Registration Number must be 6–20 characters (A-Z, 0-9, -)',
      },
    },
    doctorLicenseId: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      required: function () {
        return this.role === 'doctor';
      },
      match: [/^[A-Z0-9-]{6,20}$/, 'Invalid Doctor License ID'],
    },
    
    // 🔐 ADMIN VERIFICATION (Doctor only)
    isAdminVerified: {
      type: Boolean,
      default: function () {
        return this.role === 'doctor' ? false : true;
      },
    },

    status: {
      type: String,
      enum: ['pending', 'active', 'rejected'],
      default: function () {
        return this.role === 'doctor' ? 'pending' : 'active';
      }
    },

    // 🔗 PATIENT PROFILE LINK
    patientProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      sparse: true,
    },

    lastLogin: Date,

    isActive: {
      type: Boolean,
      default: true,
    },

    // 📧 EMAIL VERIFICATION
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationToken: String,
    emailVerificationExpire: Date,

    // 📧 ADMIN EMAIL VERIFICATION CODE
    adminVerificationCode: {
      type: String,
      select: false,
    },

    adminVerificationExpire: {
      type: Date,
      select: false,
    },

    // 🔑 RESET PASSWORD
    resetPasswordOTP: {
      type: String,
      select: false,
    },

    resetPasswordOTPExpiry: {
      type: Date,
      select: false,
    },

    resetPasswordToken: {
      type: String,
      select: false,
    },

    resetPasswordTokenExpiry: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.resetPasswordOTP;
        delete ret.resetPasswordOTPExpiry;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordTokenExpiry;
        delete ret.adminVerificationCode;
        delete ret.adminVerificationExpire;
        return ret;
      },
    },
  }
);



/* =========================
   ⚡ PERFORMANCE INDEXES
========================= */
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ name: 'text', email: 'text', phone: 'text', role: 'text' });
/* =========================
   🔐 PASSWORD HASH
========================= */
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/* =========================
   🔑 PASSWORD MATCH
========================= */
UserSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/* =========================
   ✅ CREATE DEFAULT ADMIN
========================= */
UserSchema.statics.createDefaultAdmin = async function () {
  try {
    const adminEmail = 'mkchauhan9263@gmail.com';
    const adminExists = await this.findOne({
      email: adminEmail,
      role: 'admin',
    });

    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Mkchauhan@9263', salt);

      await this.create({
        name: 'System Administrator',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        isActive: true,
        status: 'active',
        isEmailVerified: true,
        isAdminVerified: true,
      });

      console.log('Default admin created successfully');
    }
  } catch (error) {
    console.error('Failed to create default admin:', error.message);
  }
};

module.exports = mongoose.model('User', UserSchema);
