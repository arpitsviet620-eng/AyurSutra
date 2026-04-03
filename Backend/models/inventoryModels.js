const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
  itemId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['medicine', 'herb', 'oil', 'equipment', 'consumable', 'furniture', 'other'],
    required: true
  },
  description: String,
  batchNumber: String,
  manufacturer: String,
  expiryDate: Date,
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    enum: ['kg', 'g', 'mg', 'l', 'ml', 'pieces', 'packets', 'boxes'],
    required: true
  },
  unitPrice: {
    type: Number,
    required: true
  },
  minStockLevel: {
    type: Number,
    default: 10
  },
  maxStockLevel: Number,
  supplier: {
    name: String,
    contact: String,
    email: String,
    address: String
  },
  location: String,
  isCritical: {
    type: Boolean,
    default: false
  },
  lastRestocked: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Generate item ID
inventorySchema.pre('save', async function() {
  if (!this.itemId) {
    const prefix =
      this.category === 'medicine' ? 'MED' :
      this.category === 'herb' ? 'HRB' :
      this.category === 'oil' ? 'OIL' :
      this.category === 'equipment' ? 'EQP' : 'INV';

    const count = await mongoose.model('Inventory').countDocuments();
    this.itemId = `${prefix}${String(count + 1).padStart(6, '0')}`;
  }
  // no next() needed for async
});

// Low stock alert virtual
inventorySchema.virtual('isLowStock').get(function() {
  return this.quantity <= this.minStockLevel;
});

module.exports = mongoose.model('Inventory', inventorySchema);