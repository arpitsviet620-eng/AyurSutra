const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

const {
  getUsers,
  getUser,
  updateUser,
  deleteUser,
} = require("../controllers/userControllers");

const { uploadUserImage } = require("../controllers/uploadControllers");

// 📌 USER ROUTES
router.get("/", getUsers);            // GET    /api/users
router.get("/:id", getUser);          // GET    /api/users/123
router.put("/:id", updateUser);       // PUT    /api/users/123
router.delete("/:id", deleteUser);    // DELETE /api/users/123

// 📌 UPLOAD ROUTE
router.post("/upload-image", upload.single("image"), uploadUserImage);

module.exports = router;
