const mongoose = require("mongoose");

exports.validateObjectId = (paramName) => (req, res, next) => {
  const value = req.params[paramName];

  if (!mongoose.Types.ObjectId.isValid(value)) {
    return res.status(400).json({
      message: `Invalid ${paramName}`
    });
  }

  next();
};
