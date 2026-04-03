// config/geminiConfig.js
require("dotenv").config();

module.exports = {
  API_KEY: process.env.GEMINI_API_KEY,
  MODEL: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
};