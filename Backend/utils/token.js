const crypto = require("crypto");

// Random token generator
exports.generateToken = () => {
  return crypto.randomBytes(32).toString("hex");
};
