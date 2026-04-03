// routes/searchRoutes.js - COMPLETE WORKING VERSION
const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { protect, authorize } = require('../middleware/authMiddleware');

/* =========================
   🚀 MAIN SEARCH ROUTES
========================= */

// 🔹 LIVE TYPING SEARCH (For autocomplete)
router.get('/live', protect, searchController.liveSearch);

// 🔹 SMART SEARCH (Main search with ranking)
router.get('/smart', protect, searchController.smartSearch);

// 🔹 DEFAULT SEARCH (Compatibility)
router.get('/', protect, searchController.searchAll);

// 🔹 REGEX SEARCH (For short queries)
router.get('/regex', protect, searchController.regexSearch);

// 🔹 FULL-TEXT SEARCH
router.get('/fulltext', protect, searchController.fullTextSearch);

// 🔹 SEARCH BY TYPE
router.get('/:type', protect, searchController.searchByType);

// 🔹 ADVANCED SEARCH
router.get('/advanced/filter', protect, searchController.advancedSearch);

/* =========================
   📊 ANALYTICS & HISTORY
========================= */

// Search suggestions
router.get('/suggestions/:prefix', protect, async (req, res) => {
  try {
    const suggestions = await searchController.generateSearchSuggestions(req.params.prefix);
    res.json({ success: true, suggestions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get suggestions' });
  }
});

// Update search history
router.post('/history', protect, async (req, res) => {
  try {
    const { query, resultsCount } = req.body;
    await searchController.updateSearchHistory(req.user._id, query, resultsCount || 0);
    res.json({ success: true, message: 'Search history updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update history' });
  }
});

// Get recent searches
router.get('/history/recent', protect, async (req, res) => {
  try {
    const user = await require('../models/userModels').findById(req.user._id)
      .select('searchHistory')
      .lean();
    
    const recentSearches = user?.searchHistory
      ?.slice(-10)
      .reverse()
      .map(item => ({
        query: item.query,
        timestamp: item.timestamp,
        resultsCount: item.resultsCount
      })) || [];
    
    res.json({ success: true, searches: recentSearches });
  } catch (error) {
    console.error('Get search history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get search history' });
  }
});

/* =========================
   👑 ADMIN ONLY ROUTES
========================= */
router.get('/admin/analytics', 
  protect, 
  authorize('admin', 'superadmin'), 
  searchController.searchAnalytics
);

router.get('/admin/export', 
  protect, 
  authorize('admin', 'superadmin'), 
  searchController.exportSearchResults
);

// routes/searchRoutes.js - Add global search route
router.get('/global', protect, searchController.globalSearch);
/* =========================
   🎯 HEALTH CHECK
========================= */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Search API is working',
    timestamp: new Date().toISOString(),
    endpoints: [
      { path: '/live', method: 'GET', description: 'Live typing search' },
      { path: '/smart', method: 'GET', description: 'Smart search with ranking' },
      { path: '/regex', method: 'GET', description: 'Regex search for short queries' },
      { path: '/fulltext', method: 'GET', description: 'Full-text search' },
      { path: '/:type', method: 'GET', description: 'Search by type (patient/doctor/appointment/user)' },
      { path: '/advanced/filter', method: 'GET', description: 'Advanced search with filters' },
      { path: '/history', method: 'POST', description: 'Update search history' },
      { path: '/history/recent', method: 'GET', description: 'Get recent searches' }
    ]
  });
});

module.exports = router;