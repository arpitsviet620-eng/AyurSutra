const OTP = require('../models/otpModels');
const crypto = require('crypto');

class OTPService {
  async generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    
    return otp;
  }

  async createOTP(email, type = 'password_reset', userId = null) {
    // Delete any existing OTPs for this email and type
    await OTP.deleteMany({ 
      email, 
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    const otpCode = await this.generateOTP(process.env.OTP_LENGTH || 6);
    
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10));

    const otp = new OTP({
      email,
      otp: otpCode,
      type,
      expiresAt,
      userId,
    });

    await otp.save();
    return otp;
  }

  async verifyOTP(email, otpCode, type = 'password_reset') {
    const otp = await OTP.findOne({
      email,
      otp: otpCode,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otp) {
      throw new Error('Invalid or expired OTP');
    }

    if (otp.attempts >= (process.env.OTP_MAX_ATTEMPTS || 3)) {
      otp.isUsed = true;
      await otp.save();
      throw new Error('Maximum OTP attempts reached. Please request a new OTP.');
    }

    otp.isUsed = true;
    await otp.save();

    // Generate a reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // You might want to store this token in a separate collection for validation
    // For simplicity, we'll return it and you can verify it with a hash

    return {
      resetToken,
      userId: otp.userId,
    };
  }

  async isValidOTP(email, otpCode, type = 'password_reset') {
    const otp = await OTP.findOne({
      email,
      otp: otpCode,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: process.env.OTP_MAX_ATTEMPTS || 3 }
    });

    return !!otp;
  }

  async getActiveOTP(email, type = 'password_reset') {
    return await OTP.findOne({
      email,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });
  }
}

module.exports = new OTPService();