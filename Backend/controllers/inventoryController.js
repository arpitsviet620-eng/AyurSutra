const Inventory = require('../models/inventoryModels');
const asyncHandler = require('express-async-handler');
const {generateInventoryId} = require('../utils/generatePatientId');
// @desc    Get all inventory items
// @route   GET /api/inventory
// @access  Private
const getInventoryItems = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search, category, isCritical, lowStock } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { itemId: { $regex: search, $options: 'i' } },
      { batchNumber: { $regex: search, $options: 'i' } },
      { manufacturer: { $regex: search, $options: 'i' } }
    ];
  }

  if (category) query.category = category;
  if (isCritical) query.isCritical = isCritical === 'true';

  let items = await Inventory.find(query)
    .populate('createdBy', 'name')
    .sort('-createdAt')
    .limit(limit * 1)
    .skip((page - 1) * limit);

  if (lowStock === 'true') {
    items = items.filter(item => item.quantity <= item.minStockLevel);
  }

  const total = await Inventory.countDocuments(query);

  res.json({
    success: true,
    count: items.length,
    total,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    items
  });
});

// @desc    Get single inventory item
// @route   GET /api/inventory/:id
// @access  Private
const getInventoryItem = asyncHandler(async (req, res) => {
  const item = await Inventory.findById(req.params.id).populate('createdBy', 'name');
  if (!item) {
    res.status(404);
    throw new Error('Inventory item not found');
  }
  res.json({ success: true, item });
});

// @desc    Create inventory item
// @route   POST /api/inventory
// @access  Private
const createInventoryItem = asyncHandler(async (req, res) => {
  const {
    name, category, description, batchNumber, manufacturer,
    expiryDate, quantity, unit, unitPrice, minStockLevel,
    maxStockLevel, supplier, location
  } = req.body;

  // Check duplicate
  const existingItem = await Inventory.findOne({ name, batchNumber, manufacturer });
  if (existingItem) {
    res.status(400);
    throw new Error('Item with same batch and manufacturer already exists');
  }

  const itemId = await generateInventoryId();
  const item = await Inventory.create({
    itemId,
    name,
    category,
    description,
    batchNumber,
    manufacturer,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    quantity: parseInt(quantity),
    unit,
    unitPrice: parseFloat(unitPrice),
    minStockLevel: parseInt(minStockLevel) || 10,
    maxStockLevel: maxStockLevel ? parseInt(maxStockLevel) : null,
    supplier,
    location,
    isCritical: parseInt(quantity) <= (parseInt(minStockLevel) || 10),
    createdBy: req.user._id,
    lastRestocked: new Date()
  });

  res.status(201).json({
    success: true,
    message: 'Inventory item created successfully',
    item
  });
});

// @desc    Update inventory item
// @route   PUT /api/inventory/:id
// @access  Private
const updateInventoryItem = asyncHandler(async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Inventory item not found');
  }

  if (req.body.quantity !== undefined) {
    req.body.lastRestocked = new Date();
    req.body.isCritical = req.body.quantity <= (req.body.minStockLevel || item.minStockLevel);
  }

  const updatedItem = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

  res.json({ success: true, message: 'Inventory item updated successfully', item: updatedItem });
});

// @desc    Delete inventory item
// @route   DELETE /api/inventory/:id
// @access  Private/Admin
const deleteInventoryItem = asyncHandler(async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Inventory item not found');
  }

  await item.deleteOne();
  res.json({ success: true, message: 'Inventory item deleted successfully' });
});

// @desc    Restock inventory
// @route   POST /api/inventory/:id/restock
// @access  Private
const restockInventory = asyncHandler(async (req, res) => {
  const { quantity, unitPrice, supplier } = req.body;
  const item = await Inventory.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Inventory item not found');
  }

  item.quantity += parseInt(quantity);
  if (unitPrice) item.unitPrice = parseFloat(unitPrice);
  if (supplier) item.supplier = supplier;
  item.lastRestocked = new Date();
  item.isCritical = item.quantity <= item.minStockLevel;

  await item.save();

  res.json({
    success: true,
    message: 'Inventory restocked successfully',
    item,
    restockRecord: {
      item: item._id,
      quantityAdded: parseInt(quantity),
      unitPrice: unitPrice || item.unitPrice,
      supplier: supplier || item.supplier,
      restockedBy: req.user._id,
      date: new Date()
    }
  });
});

// @desc    Get low stock alerts
// @route   GET /api/inventory/alerts/low-stock
// @access  Private
const getLowStockAlerts = asyncHandler(async (req, res) => {
  const lowStockItems = await Inventory.find({ $expr: { $lte: ['$quantity', '$minStockLevel'] } }).sort('quantity');
  const criticalItems = await Inventory.find({ isCritical: true, quantity: { $gt: 0 } });
  const expiredItems = await Inventory.find({ expiryDate: { $lt: new Date() } });

  res.json({
    success: true,
    alerts: {
      lowStock: lowStockItems.length,
      criticalItems: criticalItems.length,
      expiredItems: expiredItems.length
    },
    lowStockItems,
    criticalItems,
    expiredItems
  });
});

// @desc    Get inventory stats
// @route   GET /api/inventory/stats/overview
// @access  Private
const getInventoryStats = asyncHandler(async (req, res) => {
  const totalItems = await Inventory.countDocuments();
  const totalValue = await Inventory.aggregate([{ $group: { _id: null, value: { $sum: { $multiply: ['$quantity', '$unitPrice'] } } } }]);
  const categoryStats = await Inventory.aggregate([{ $group: { _id: '$category', count: { $sum: 1 }, value: { $sum: { $multiply: ['$quantity', '$unitPrice'] } } } }, { $sort: { value: -1 } }]);
  const lowStockCount = await Inventory.countDocuments({ $expr: { $lte: ['$quantity', '$minStockLevel'] } });
  const thirtyDaysFromNow = new Date(); thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const expiringSoon = await Inventory.countDocuments({ expiryDate: { $lt: thirtyDaysFromNow, $gte: new Date() } });
  const recentlyAdded = await Inventory.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } });

  res.json({
    success: true,
    stats: {
      totalItems,
      totalValue: totalValue[0]?.value || 0,
      categoryStats,
      lowStockCount,
      expiringSoon,
      recentlyAdded
    }
  });
});

module.exports = {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  restockInventory,
  getLowStockAlerts,
  getInventoryStats
};
