// controllers/serviceController.js
const asyncHandler = require("express-async-handler");
const Service = require("../models/serviceModels"); // Change from serviceModel to serviceSchema
const Doctor = require("../models/doctorModels");

// @desc    Get all services (with pagination)
// @route   GET /api/services
// @access  Public
const getServices = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Build query
  let query = {};

  // Filter by active status if provided
  if (req.query.isActive !== undefined) {
    query.isActive = req.query.isActive === "true";
  }

  // Search by name if provided
  if (req.query.search) {
    query.name = { $regex: req.query.search, $options: "i" };
  }

  const [services, total] = await Promise.all([
    Service.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Service.countDocuments(query),
  ]);

  res.json({
    success: true,
    count: services.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    services,
  });
});

// @desc    Get active services for booking (matching doctor departments)
// @route   GET /api/services/active
// @access  Public
const getActiveServices = asyncHandler(async (req, res) => {
  // 1. Departments with active doctors
  const departments = await Doctor.distinct("department", {
    isAvailable: true,
  });

  // 2. Active services matching doctor departments
  const services = await Service.find({
    category: { $in: departments },
    isActive: true,
  }).sort({ name: 1 });

  res.json({
    success: true,
    count: services.length,
    services,
  });
});

// @desc    Get single service by ID
// @route   GET /api/services/:id
// @access  Public
const getServiceById = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: "Service not found",
    });
  }

  res.json({
    success: true,
    service,
  });
});

// @desc    Create new service
// @route   POST /api/services
// @access  Private/Admin
const createService = asyncHandler(async (req, res) => {
  // Check for duplicate name
  const existingName = await Service.findOne({ name: req.body.name });
  if (existingName) {
    return res.status(400).json({
      success: false,
      message: "Service name already exists. Please choose a different name.",
    });
  }

  // Check for duplicate category key
  const existingCategory = await Service.findOne({ 
    category: req.body.category.toLowerCase() 
  });
  if (existingCategory) {
    return res.status(400).json({
      success: false,
      message: "Category key already exists. Please choose a different category.",
    });
  }

  // Add createdBy user info
  const serviceData = {
    ...req.body,
    category: req.body.category.toLowerCase(),
    createdBy: req.user.id,
  };

  const service = await Service.create(serviceData);

  res.status(201).json({
    success: true,
    message: "Service created successfully",
    service,
  });
});

// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private/Admin
const updateService = asyncHandler(async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    /* ===============================
       CHECK DUPLICATE NAME
    =============================== */
    if (
      req.body.name &&
      req.body.name.trim().toLowerCase() !== service.name.toLowerCase()
    ) {
      const existingName = await Service.findOne({
        name: req.body.name.trim(),
        _id: { $ne: service._id },
      });

      if (existingName) {
        return res.status(400).json({
          success: false,
          message: "Service name already exists",
        });
      }
    }

    /* ===============================
       CHECK DUPLICATE CATEGORY
    =============================== */
    if (req.body.category) {
      const newCategory = req.body.category.toLowerCase();

      if (newCategory !== service.category) {
        const existingCategory = await Service.findOne({
          category: newCategory,
          _id: { $ne: service._id },
        });

        if (existingCategory) {
          return res.status(400).json({
            success: false,
            message: "Category key already exists",
          });
        }
      }
    }

    /* ===============================
       UPDATE DATA
    =============================== */
    const updateData = {
      ...req.body,
      updatedBy: req.user?._id, // ✅ SAFE
    };

    if (updateData.category) {
      updateData.category = updateData.category.toLowerCase();
    }

    const updatedService = await Service.findByIdAndUpdate(
      service._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Service updated successfully",
      service: updatedService,
    });
  } catch (error) {
    console.error("Update Service Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update service",
    });
  }
});

// @desc    Delete/Deactivate service
// @route   DELETE /api/services/:id
// @access  Private/Admin
const deleteService = asyncHandler(async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    // Soft delete
    service.isActive = false;

    // ✅ Safe user reference
    if (req.user) {
      service.updatedBy = req.user._id;
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: "Service deactivated successfully",
    });

  } catch (error) {
    console.error("Delete Service Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete service",
    });
  }
});


// @desc    Activate service
// @route   PUT /api/services/:id/activate
// @access  Private/Admin
const activateService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) {
    return res.status(404).json({
      success: false,
      message: "Service not found",
    });
  }

  service.isActive = true;
  service.updatedBy = req.user.id;
  await service.save();

  res.json({
    success: true,
    message: "Service activated successfully",
  });
});

module.exports = {
  getServices,
  getActiveServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
  activateService,
};