const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },

    icon: String,

    duration: {
      type: Number,
      required: true,
    },

    description: String,

    // 🔑 KEY USED BY DOCTOR
    category: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    categoryName: String,

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
