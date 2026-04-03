const User = require("../models/userModels");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");


/* 🧑‍💼 GET ALL USERS */
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};


/* 👤 GET SINGLE USER */
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch {
    res.status(500).json({ message: "Invalid user ID" });
  }
};

// controllers/userController.js - Update updateUser function
exports.updateUser = async (req, res) => {
  try {
    const { name, email, phone, role, ...otherData } = req.body;
    const userId = req.params.id;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if email/phone already exists (excluding current user)
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    if (phone && phone !== user.phone) {
      const existingPhone = await User.findOne({ 
        phone, 
        _id: { $ne: userId } 
      });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number already exists" });
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        name, 
        email, 
        phone, 
        role,
        ...(role === 'patient' && otherData.bio && { bio: otherData.bio })
      },
      { new: true, runValidators: true }
    ).select('-password');

    // If user is a patient, also update patient profile
    if (updatedUser.role === 'patient' && updatedUser.patientProfile) {
      const patientData = {};
      
      // Map user data to patient data if needed
      if (phone) patientData.phone = phone;
      if (name) patientData.name = name;
      
      await Patient.findByIdAndUpdate(
        updatedUser.patientProfile,
        patientData,
        { new: true }
      );
    }

    res.status(200).json({ 
      message: "Updated successfully", 
      user: updatedUser 
    });

  } catch (error) {
    console.error('Update error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: "Validation failed", 
        errors: error.errors 
      });
    }
    
    res.status(500).json({ 
      message: "Update failed", 
      error: error.message 
    });
  }
};

// Create user with patient profile
exports.createUser = async (req, res) => {
  try {
    const { name, email, phone, password, role, ...patientData } = req.body;

    // Create user
    const user = new User({
      name,
      email,
      phone,
      password,
      role
    });

    await user.save();

    // If role is patient, create patient profile
    if (role === 'patient') {
      const patient = new Patient({
        user: user._id,
        phone: user.phone,
        name: user.name,
        ...patientData
      });

      await patient.save();

      // Link patient profile to user
      user.patientProfile = patient._id;
      await user.save();
    }

    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      message: 'User created successfully',
      user: userResponse
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      message: 'Create user failed',
      error: error.message
    });
  }
};

// Get user with patient data
exports.getUserWithPatient = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('patientProfile');

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* 🗑 DELETE USER */
exports.deleteUser = async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User deleted" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
};
