const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(), // ✅ no local file
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only image files allowed"));
  },
});

module.exports = upload;
