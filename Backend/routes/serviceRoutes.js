// routes/serviceRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");

const {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
  activateService,
  getActiveServices,
} = require("../controllers/serviceController");

// Public routes
router.get("/", getServices);
router.get("/active", getActiveServices);
router.get("/:id", getServiceById);

// Protected admin routes
router.post("/", protect, authorize("admin"), createService);
router.put("/:id", protect, authorize("admin"), updateService);
router.delete("/:id", protect, authorize("admin"), deleteService);
router.put("/:id/activate", protect, authorize("admin"), activateService);

module.exports = router;