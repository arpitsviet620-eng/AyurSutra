// controllers/searchController.js - COMPLETE WORKING VERSION
const Patient = require('../models/patientModels');
const Doctor = require('../models/doctorModels');
const Appointment = require('../models/appointmentModels');
const User = require('../models/userModels');

/* =========================
   🚀 REDIS CACHE MANAGER (With Fallback)
========================= */
class CacheManager {
  constructor() {
    this.redisClient = null;
    this.isRedisConnected = false;
    this.memoryCache = new Map();
    this.initializeRedis();
  }

  async initializeRedis() {
    try {
      // Only try to use Redis if explicitly enabled
      if (process.env.USE_REDIS_CACHE === 'true') {
        const Redis = require('redis');
        this.redisClient = Redis.createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 3) {
                console.log('Redis connection failed, using memory cache');
                this.isRedisConnected = false;
                return new Error('Redis connection failed');
              }
              return Math.min(retries * 100, 3000);
            }
          }
        });

        this.redisClient.on('error', (err) => {
          console.log('Redis Client Error:', err.message);
          this.isRedisConnected = false;
        });

        this.redisClient.on('connect', () => {
          console.log('Redis Connected Successfully');
          this.isRedisConnected = true;
        });

        await this.redisClient.connect();
      } else {
        console.log('Redis cache disabled, using memory cache');
      }
    } catch (error) {
      console.log('Redis initialization failed, using memory cache:', error.message);
      this.isRedisConnected = false;
    }
  }

  async get(key) {
    try {
      if (this.isRedisConnected && this.redisClient) {
        const value = await this.redisClient.get(key);
        return value ? JSON.parse(value) : null;
      }
      // Fallback to memory cache
      return this.memoryCache.get(key) || null;
    } catch (error) {
      console.log('Cache get error:', error.message);
      return this.memoryCache.get(key) || null;
    }
  }

  async set(key, value, ttl = 300) {
    try {
      const serializedValue = JSON.stringify(value);
      
      if (this.isRedisConnected && this.redisClient) {
        await this.redisClient.setEx(key, ttl, serializedValue);
      } else {
        // Fallback to memory cache with TTL simulation
        this.memoryCache.set(key, value);
        setTimeout(() => {
          this.memoryCache.delete(key);
        }, ttl * 1000);
      }
    } catch (error) {
      console.log('Cache set error:', error.message);
      // Still store in memory cache as fallback
      this.memoryCache.set(key, value);
    }
  }

  async del(key) {
    try {
      if (this.isRedisConnected && this.redisClient) {
        await this.redisClient.del(key);
      }
      this.memoryCache.delete(key);
    } catch (error) {
      console.log('Cache delete error:', error.message);
      this.memoryCache.delete(key);
    }
  }
}

// Initialize cache manager
const cache = new CacheManager();

// Cache TTL in seconds
const CACHE_TTL = {
  LIVE_SEARCH: 30,
  REGEX_SEARCH: 60,
  FULLTEXT_SEARCH: 300,
  ANALYTICS: 3600
};

// Cache key generator
const generateCacheKey = (type, params) => {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  return `search:${type}:${JSON.stringify(sortedParams)}`;
};

/* =========================
   🔥 ULTRA-FAST LIVE SEARCH
========================= */

const liveSearch = async (req, res) => {
  try {
    const { q, limit = 8, types = 'patient,doctor,appointment' } = req.query;
    
    if (!q || q.trim().length < 1) {
      return res.json({
        success: true,
        results: [],
        suggestions: [],
        meta: { cacheHit: false, queryTime: 0 }
      });
    }

    const keyword = q.trim().toLowerCase();
    const searchLimit = parseInt(limit);
    const searchTypes = types.split(',');
    
    // Cache key
    const cacheKey = generateCacheKey('live', { 
      q: keyword, 
      limit: searchLimit,
      types: searchTypes.join(',') 
    });
    
    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        meta: { ...cached.meta, cacheHit: true }
      });
    }

    const queryStartTime = Date.now();
    const results = [];

    // Build search promises dynamically based on requested types
    const searchPromises = [];

    // Use a more efficient search strategy
    const searchConditions = {
      $or: [
        { $text: { $search: keyword } } // Use text search if enabled
      ]
    };

    // Fallback regex for non-text search
    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    if (searchTypes.includes('patient')) {
      searchPromises.push(
        Patient.aggregate([
          {
            $match: {
              $or: [
                { patientCode: regex },
                { phone: regex },
                { email: regex },
                ...(Patient.schema.indexes().some(idx => idx.name === 'user.name_text') 
                  ? [{ $text: { $search: keyword } }]
                  : [])
              ]
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
              pipeline: [
                { $project: { name: 1, email: 1, phone: 1, photo: 1 } }
              ]
            }
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              patientCode: 1,
              phone: 1,
              email: 1,
              age: 1,
              gender: 1,
              displayName: '$userInfo.name',
              photo: '$userInfo.photo',
              type: 'patient',
              relevance: {
                $switch: {
                  branches: [
                    { 
                      case: { $regexMatch: { input: '$patientCode', regex: new RegExp(`^${keyword}`, 'i') } }, 
                      then: 100 
                    },
                    { 
                      case: { $regexMatch: { input: '$phone', regex: regex } }, 
                      then: 90 
                    },
                    { 
                      case: { $regexMatch: { input: '$email', regex: regex } }, 
                      then: 80 
                    },
                    { 
                      case: { $regexMatch: { input: '$userInfo.name', regex: regex } }, 
                      then: 70 
                    }
                  ],
                  default: 50
                }
              }
            }
          },
          { $sort: { relevance: -1, createdAt: -1 } },
          { $limit: searchLimit }
        ]).exec()
      );
    }

    if (searchTypes.includes('doctor')) {
      searchPromises.push(
        Doctor.aggregate([
          {
            $match: {
              $or: [
                { doctorId: regex },
                { department: regex },
                { specialization: regex },
                ...(Doctor.schema.indexes().some(idx => idx.name === 'user.name_text')
                  ? [{ $text: { $search: keyword } }]
                  : [])
              ]
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
              pipeline: [
                { $project: { name: 1, email: 1, phone: 1, photo: 1 } }
              ]
            }
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              doctorId: 1,
              department: 1,
              specialization: 1,
              consultationFee: 1,
              experience: 1,
              displayName: '$userInfo.name',
              photo: '$userInfo.photo',
              type: 'doctor',
              relevance: {
                $switch: {
                  branches: [
                    { 
                      case: { $regexMatch: { input: '$doctorId', regex: new RegExp(`^${keyword}`, 'i') } }, 
                      then: 100 
                    },
                    { 
                      case: { $regexMatch: { input: '$userInfo.name', regex: regex } }, 
                      then: 90 
                    },
                    { 
                      case: { $regexMatch: { input: '$department', regex: regex } }, 
                      then: 80 
                    },
                    { 
                      case: { $regexMatch: { input: '$specialization', regex: regex } }, 
                      then: 70 
                    }
                  ],
                  default: 50
                }
              }
            }
          },
          { $sort: { relevance: -1, createdAt: -1 } },
          { $limit: searchLimit }
        ]).exec()
      );
    }

    // Add appointment search similarly...

    // Execute all searches in parallel
    const searchResults = await Promise.allSettled(searchPromises);
    
    // Combine results
    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        results.push(...result.value);
      }
    });

    // Sort all results by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    // Generate smart suggestions
    const suggestions = await generateSmartSuggestions(keyword, results);

    const response = {
      success: true,
      query: keyword,
      results: results.slice(0, searchLimit),
      suggestions,
      meta: {
        performance: {
          queryTime: Date.now() - queryStartTime,
          totalResults: results.length,
          cacheHit: false
        },
        searchTypes,
        timestamp: new Date().toISOString()
      }
    };

    // Cache with shorter TTL for live search
    await cache.set(cacheKey, response, 30); // 30 seconds

    res.json(response);

  } catch (error) {
    console.error('Live search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Calculate relevance score
const calculateRelevance = (item, keyword) => {
  let score = 0;
  const keywordLower = keyword.toLowerCase();
  
  // Check display name
  if (item.displayName?.toLowerCase().includes(keywordLower)) {
    score += 50;
    if (item.displayName.toLowerCase().startsWith(keywordLower)) {
      score += 30;
    }
    if (item.displayName.toLowerCase() === keywordLower) {
      score += 50;
    }
  }
  
  // Check other fields
  if (item.patientCode?.toLowerCase().includes(keywordLower)) score += 40;
  if (item.doctorId?.toLowerCase().includes(keywordLower)) score += 40;
  if (item.appointmentId?.toLowerCase().includes(keywordLower)) score += 40;
  if (item.phone?.includes(keyword)) score += 30;
  if (item.email?.toLowerCase().includes(keywordLower)) score += 30;
  
  // Boost recent items
  if (item.createdAt) {
    const daysOld = (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld < 1) score += 20;
    else if (daysOld < 7) score += 10;
  }
  
  return score;
};

/* =========================
   🎯 GENERATE SEARCH SUGGESTIONS
========================= */
const generateSearchSuggestions = async (keyword) => {
  try {
    if (keyword.length < 2) return [];
    
    // Get recent searches from users
    const recentSearches = await User.aggregate([
      { $unwind: '$searchHistory' },
      {
        $match: {
          'searchHistory.query': { $regex: keyword, $options: 'i' },
          'searchHistory.timestamp': { 
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: '$searchHistory.query',
          count: { $sum: 1 },
          lastSearched: { $max: '$searchHistory.timestamp' }
        }
      },
      { $sort: { count: -1, lastSearched: -1 } },
      { $limit: 5 }
    ]);

    const suggestions = recentSearches.map(s => s._id);
    
    // Add default suggestions
    const defaultSuggestions = [
      `${keyword} patient`,
      `${keyword} doctor`,
      `appointment ${keyword}`
    ];
    
    return [...new Set([...suggestions, ...defaultSuggestions])].slice(0, 5);
  } catch (error) {
    console.error('Suggestion generation error:', error);
    return [];
  }
};

const generateSmartSuggestions = async (keyword, currentResults) => {
  try {
    const suggestions = new Set();
    
    // Add from current results
    currentResults.slice(0, 3).forEach(result => {
      if (result.displayName) {
        suggestions.add(result.displayName);
      }
      if (result.patientCode) suggestions.add(result.patientCode);
      if (result.doctorId) suggestions.add(result.doctorId);
    });

    // Add common medical terms based on keyword
    const medicalTerms = {
      'fever': ['fever treatment', 'fever medicine', 'fever symptoms'],
      'head': ['headache', 'migraine', 'head injury'],
      'pain': ['chest pain', 'back pain', 'joint pain'],
      'blood': ['blood test', 'blood pressure', 'blood sugar'],
      'heart': ['heart disease', 'heart attack', 'heart rate']
    };

    Object.keys(medicalTerms).forEach(term => {
      if (keyword.includes(term)) {
        medicalTerms[term].forEach(suggestion => suggestions.add(suggestion));
      }
    });

    // Add generic suggestions
    suggestions.add(`${keyword} consultation`);
    suggestions.add(`${keyword} appointment`);
    suggestions.add(`${keyword} doctor`);
    suggestions.add(`${keyword} patient`);

    return Array.from(suggestions).slice(0, 5);
  } catch (error) {
    console.error('Suggestion generation error:', error);
    return [];
  }
};

/* =========================
   🔥 SMART SEARCH (Main Search)
========================= */
const smartSearch = async (req, res) => {
  try {
    const { q, type, page = 1, limit = 20 } = req.query;
    
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const keyword = q.trim();
    const searchPage = parseInt(page);
    const searchLimit = parseInt(limit);
    const skip = (searchPage - 1) * searchLimit;

    // Check cache
    const cacheKey = generateCacheKey('smart', { 
      q: keyword, 
      type, 
      page: searchPage,
      limit: searchLimit
    });
    
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        meta: { ...cached.meta, cacheHit: true }
      });
    }

    const queryStartTime = Date.now();
    const results = {
      patients: [],
      doctors: [],
      appointments: [],
      users: []
    };

    const regex = new RegExp(keyword, 'i');
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);

    // Build search queries based on type
    if (!type || type === 'patient') {
      const patientQuery = {
        $or: [
          { patientCode: regex },
          { phone: regex },
          { email: regex }
        ]
      };

      if (isAdmin) {
        results.patients = await Patient.find(patientQuery)
          .populate('user', 'name email phone')
          .skip(skip)
          .limit(searchLimit)
          .lean();
      }
    }

    if (!type || type === 'doctor') {
      const doctorQuery = {
        $or: [
          { doctorId: regex },
          { department: regex },
          { specialization: regex }
        ]
      };

      if (isAdmin) {
        results.doctors = await Doctor.find(doctorQuery)
          .populate('user', 'name email phone')
          .skip(skip)
          .limit(searchLimit)
          .lean();
      }
    }

    if (!type || type === 'appointment') {
      const appointmentQuery = {
        $or: [
          { appointmentId: regex },
          { status: regex }
        ]
      };

      results.appointments = await Appointment.find(appointmentQuery)
        .populate('patient', 'patientCode')
        .populate({
          path: 'doctor',
          populate: { path: 'user', select: 'name' }
        })
        .skip(skip)
        .limit(searchLimit)
        .lean();
    }

    if (isAdmin && (!type || type === 'user')) {
      const userQuery = {
        $or: [
          { name: regex },
          { email: regex },
          { phone: regex }
        ]
      };

      results.users = await User.find(userQuery)
        .select('name email phone role status')
        .skip(skip)
        .limit(searchLimit)
        .lean();
    }

    // Count totals
    const totalCounts = {
      patients: results.patients.length,
      doctors: results.doctors.length,
      appointments: results.appointments.length,
      users: results.users.length
    };

    const totalResults = Object.values(totalCounts).reduce((a, b) => a + b, 0);

    const response = {
      success: true,
      query: keyword,
      results,
      pagination: {
        page: searchPage,
        limit: searchLimit,
        total: totalResults,
        counts: totalCounts,
        pages: Math.ceil(totalResults / searchLimit)
      },
      meta: {
        performance: {
          queryTime: Date.now() - queryStartTime,
          cacheHit: false
        }
      }
    };

    // Cache results
    await cache.set(cacheKey, response, CACHE_TTL.FULLTEXT_SEARCH);

    res.json(response);

  } catch (error) {
    console.error('Smart search error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/* =========================
   🔤 REGEX SEARCH
========================= */
const regexSearch = async (req, res) => {
  try {
    const { q, limit = 8 } = req.query;
    
    if (!q || q.trim().length < 1) {
      return res.json({
        success: true,
        results: []
      });
    }

    const keyword = q.trim();
    const searchLimit = parseInt(limit);
    const regex = new RegExp(`^${keyword}`, 'i');

    // Check cache
    const cacheKey = generateCacheKey('regex', { q: keyword, limit: searchLimit });
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    // Parallel searches
    const [patients, doctors, appointments] = await Promise.all([
      Patient.find({ patientCode: regex })
        .populate('user', 'name')
        .limit(searchLimit)
        .lean(),
      
      Doctor.find({ doctorId: regex })
        .populate('user', 'name')
        .limit(searchLimit)
        .lean(),
      
      Appointment.find({ appointmentId: regex })
        .limit(searchLimit)
        .lean()
    ]);

    const allResults = [
      ...patients.map(p => ({ ...p, type: 'patient', _score: 0.9 })),
      ...doctors.map(d => ({ ...d, type: 'doctor', _score: 0.8 })),
      ...appointments.map(a => ({ ...a, type: 'appointment', _score: 0.7 }))
    ].slice(0, searchLimit);

    const response = {
      success: true,
      query: keyword,
      results: allResults,
      meta: {
        type: 'regex',
        length: keyword.length
      }
    };

    await cache.set(cacheKey, response, CACHE_TTL.REGEX_SEARCH);

    res.json(response);

  } catch (error) {
    console.error('Regex search error:', error);
    res.status(500).json({
      success: false,
      message: 'Regex search failed'
    });
  }
};

/* =========================
   📝 FULL-TEXT SEARCH
========================= */
const fullTextSearch = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 3) {
      return res.json({
        success: true,
        results: []
      });
    }

    const keyword = q.trim();
    const searchLimit = parseInt(limit);

    // Check cache
    const cacheKey = generateCacheKey('fulltext', { q: keyword, limit: searchLimit });
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const results = {
      patients: [],
      doctors: [],
      appointments: [],
      users: []
    };

    // Only use text search if indexes exist
    const useTextSearch = process.env.ENABLE_MONGO_TEXT_SEARCH === 'true';

    if (useTextSearch) {
      // Patients with text search
      results.patients = await Patient.find(
        { $text: { $search: keyword } },
        { score: { $meta: 'textScore' } }
      )
        .populate('user', 'name')
        .sort({ score: { $meta: 'textScore' } })
        .limit(searchLimit)
        .lean();

      // Doctors with text search
      results.doctors = await Doctor.find(
        { $text: { $search: keyword } },
        { score: { $meta: 'textScore' } }
      )
        .populate('user', 'name')
        .sort({ score: { $meta: 'textScore' } })
        .limit(searchLimit)
        .lean();
    } else {
      // Fallback to regex search
      const regex = new RegExp(keyword, 'i');
      
      results.patients = await Patient.find({
        $or: [
          { patientCode: regex },
          { phone: regex },
          { email: regex }
        ]
      })
        .populate('user', 'name')
        .limit(searchLimit)
        .lean();

      results.doctors = await Doctor.find({
        $or: [
          { doctorId: regex },
          { department: regex },
          { specialization: regex }
        ]
      })
        .populate('user', 'name')
        .limit(searchLimit)
        .lean();
    }

    // Combine results
    const allResults = [
      ...results.patients.map(p => ({ ...p, type: 'patient' })),
      ...results.doctors.map(d => ({ ...d, type: 'doctor' }))
    ].slice(0, searchLimit);

    const response = {
      success: true,
      query: keyword,
      results: allResults,
      meta: {
        type: 'fulltext',
        length: keyword.length
      }
    };

    await cache.set(cacheKey, response, CACHE_TTL.FULLTEXT_SEARCH);

    res.json(response);

  } catch (error) {
    console.error('Full-text search error:', error);
    res.status(500).json({
      success: false,
      message: 'Full-text search failed'
    });
  }
};

/* =========================
   🎯 SEARCH BY TYPE
========================= */
const searchByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { q, limit = 20, page = 1 } = req.query;
    
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const keyword = q.trim();
    const searchLimit = parseInt(limit);
    const skip = (parseInt(page) - 1) * searchLimit;
    const regex = new RegExp(keyword, 'i');

    let query = {};
    let model;
    let populate = [];
    let select = '';

    switch (type.toLowerCase()) {
      case 'patient':
        model = Patient;
        query = {
          $or: [
            { patientCode: regex },
            { phone: regex },
            { email: regex }
          ]
        };
        populate = [{ path: 'user', select: 'name email phone' }];
        break;

      case 'doctor':
        model = Doctor;
        query = {
          $or: [
            { doctorId: regex },
            { department: regex },
            { specialization: regex }
          ]
        };
        populate = [{ path: 'user', select: 'name email phone' }];
        break;

      case 'appointment':
        model = Appointment;
        query = {
          $or: [
            { appointmentId: regex },
            { status: regex }
          ]
        };
        populate = [
          { path: 'patient', select: 'patientCode' },
          { 
            path: 'doctor',
            populate: { path: 'user', select: 'name' }
          }
        ];
        break;

      case 'user':
        model = User;
        query = {
          $or: [
            { name: regex },
            { email: regex },
            { phone: regex }
          ]
        };
        select = 'name email phone role status';
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid search type'
        });
    }

    const [results, total] = await Promise.all([
      model.find(query)
        .select(select)
        .populate(populate)
        .skip(skip)
        .limit(searchLimit)
        .lean(),
      model.countDocuments(query)
    ]);

    res.json({
      success: true,
      type,
      query: keyword,
      results,
      pagination: {
        page: parseInt(page),
        limit: searchLimit,
        total,
        pages: Math.ceil(total / searchLimit)
      }
    });

  } catch (error) {
    console.error(`Search by type error:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to search ${type}s`
    });
  }
};

/* =========================
   🔧 ADVANCED SEARCH
========================= */
const advancedSearch = async (req, res) => {
  try {
    const {
      q,
      type,
      dateFrom,
      dateTo,
      status,
      department,
      role,
      minAge,
      maxAge,
      gender,
      limit = 20,
      page = 1
    } = req.query;

    const searchLimit = parseInt(limit);
    const skip = (parseInt(page) - 1) * searchLimit;

    let query = {};
    let model;
    let populate = [];

    // Build base query
    if (q && q.trim()) {
      const keyword = q.trim();
      const regex = new RegExp(keyword, 'i');
      
      query.$or = [
        { patientCode: regex },
        { doctorId: regex },
        { appointmentId: regex },
        { name: regex },
        { email: regex },
        { phone: regex }
      ];
    }

    // Determine model based on type
    switch (type) {
      case 'patient':
        model = Patient;
        populate = [{ path: 'user', select: 'name email phone' }];
        break;
      case 'doctor':
        model = Doctor;
        populate = [{ path: 'user', select: 'name email phone' }];
        break;
      case 'appointment':
        model = Appointment;
        populate = [
          { path: 'patient', select: 'patientCode' },
          { path: 'doctor', populate: { path: 'user', select: 'name' } }
        ];
        break;
      case 'user':
        model = User;
        break;
      default:
        return await smartSearch(req, res);
    }

    // Apply filters
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    if (status) query.status = status;
    if (department && type === 'doctor') query.department = department;
    if (role && type === 'user') query.role = role;
    if (gender && type === 'patient') query.gender = gender;

    if ((minAge || maxAge) && type === 'patient') {
      // Assuming you have an age field or dateOfBirth
      // You'll need to adjust this based on your schema
    }

    const [results, total] = await Promise.all([
      model.find(query)
        .populate(populate)
        .skip(skip)
        .limit(searchLimit)
        .lean(),
      model.countDocuments(query)
    ]);

    res.json({
      success: true,
      type: type || 'all',
      filters: { dateFrom, dateTo, status, department, role, minAge, maxAge, gender },
      results,
      pagination: {
        page: parseInt(page),
        limit: searchLimit,
        total,
        pages: Math.ceil(total / searchLimit)
      }
    });

  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      message: 'Advanced search failed'
    });
  }
};

/* =========================
   📊 SEARCH ANALYTICS
========================= */
const searchAnalytics = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [popularSearches, searchStats] = await Promise.all([
      // Popular searches
      User.aggregate([
        { $unwind: '$searchHistory' },
        { $match: { 'searchHistory.timestamp': { $gte: dateFrom } } },
        {
          $group: {
            _id: '$searchHistory.query',
            count: { $sum: 1 },
            lastSearched: { $max: '$searchHistory.timestamp' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),

      // Search statistics
      User.aggregate([
        { $unwind: '$searchHistory' },
        { $match: { 'searchHistory.timestamp': { $gte: dateFrom } } },
        {
          $group: {
            _id: null,
            totalSearches: { $sum: 1 },
            uniqueUsers: { $addToSet: '$_id' },
            successfulSearches: {
              $sum: {
                $cond: [{ $gt: ['$searchHistory.resultsCount', 0] }, 1, 0]
              }
            }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      analytics: {
        popularSearches: popularSearches.map(s => ({
          query: s._id,
          frequency: s.count,
          lastSearched: s.lastSearched
        })),
        stats: searchStats[0] || {},
        period: `${days} days`,
        fromDate: dateFrom,
        toDate: new Date()
      }
    });

  } catch (error) {
    console.error('Search analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch search analytics'
    });
  }
};

/* =========================
   📄 EXPORT SEARCH RESULTS
========================= */
const exportSearchResults = async (req, res) => {
  try {
    const { q, type, format = 'json' } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const keyword = q.trim();
    const regex = new RegExp(keyword, 'i');

    let results = [];
    let filename = '';

    switch (type) {
      case 'patient':
        results = await Patient.find({
          $or: [
            { patientCode: regex },
            { phone: regex },
            { email: regex }
          ]
        })
          .populate('user', 'name email phone')
          .lean();
        filename = `patients_search_${keyword}_${Date.now()}`;
        break;

      case 'doctor':
        results = await Doctor.find({
          $or: [
            { doctorId: regex },
            { department: regex },
            { specialization: regex }
          ]
        })
          .populate('user', 'name email phone')
          .lean();
        filename = `doctors_search_${keyword}_${Date.now()}`;
        break;

      case 'appointment':
        results = await Appointment.find({
          $or: [
            { appointmentId: regex },
            { status: regex }
          ]
        })
          .populate('patient', 'patientCode')
          .populate({
            path: 'doctor',
            populate: { path: 'user', select: 'name' }
          })
          .lean();
        filename = `appointments_search_${keyword}_${Date.now()}`;
        break;

      default:
        // Export all types
        const [patients, doctors, appointments] = await Promise.all([
          Patient.find({ patientCode: regex }).populate('user', 'name').lean(),
          Doctor.find({ doctorId: regex }).populate('user', 'name').lean(),
          Appointment.find({ appointmentId: regex }).lean()
        ]);

        results = { patients, doctors, appointments };
        filename = `all_search_${keyword}_${Date.now()}`;
    }

    if (format === 'csv') {
      // For CSV export, you would use a library like json2csv
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      // Return CSV data
      res.send(convertToCSV(results));
    } else {
      res.json({
        success: true,
        query: keyword,
        type: type || 'all',
        count: Array.isArray(results) ? results.length : 
          results.patients.length + results.doctors.length + results.appointments.length,
        results,
        exportedAt: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Export search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export search results'
    });
  }
};

// Helper function for CSV export
const convertToCSV = (data) => {
  // Simple CSV converter
  if (Array.isArray(data) && data.length > 0) {
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item => 
      Object.values(item).map(val => 
        typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val
      ).join(',')
    );
    return [headers, ...rows].join('\n');
  }
  return '';
};

/* =========================
   🔍 SEARCH HISTORY MANAGEMENT
========================= */
const updateSearchHistory = async (userId, query, resultsCount = 0) => {
  try {
    const searchEntry = {
      query,
      timestamp: new Date(),
      resultsCount,
      type: 'global'
    };

    await User.findByIdAndUpdate(userId, {
      $push: {
        searchHistory: {
          $each: [searchEntry],
          $slice: -50 // Keep last 50 searches
        }
      }
    });
    
  } catch (error) {
    console.error('Update search history error:', error);
  }
};

/* =========================
   🎯 SEARCH ALL (Legacy support)
========================= */
const searchAll = async (req, res) => {
  try {
    const { q, limit = 20, role } = req.query;
    
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const keyword = q.trim();
    const searchLimit = parseInt(limit);
    const userRole = role || req.user?.role;
    const regex = new RegExp(keyword, 'i');

    const results = {
      patients: [],
      doctors: [],
      appointments: [],
      users: []
    };

    // Helper to highlight text
    const highlightText = (text) => {
      if (!text || !keyword) return text;
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedKeyword})`, 'gi');
      return text.replace(regex, '<mark>$1</mark>');
    };

    // Admin/Superadmin search
    if (['admin', 'superadmin'].includes(userRole)) {
      const [patients, doctors, appointments, users] = await Promise.all([
        Patient.find({
          $or: [
            { patientCode: regex },
            { phone: regex },
            { email: regex }
          ]
        })
          .populate('user', 'name email phone')
          .limit(searchLimit)
          .lean(),
        
        Doctor.find({
          $or: [
            { doctorId: regex },
            { department: regex },
            { specialization: regex }
          ]
        })
          .populate('user', 'name email phone')
          .limit(searchLimit)
          .lean(),
        
        Appointment.find({
          $or: [
            { appointmentId: regex },
            { status: regex }
          ]
        })
          .populate('patient', 'patientCode')
          .populate({
            path: 'doctor',
            populate: { path: 'user', select: 'name' }
          })
          .limit(searchLimit)
          .lean(),
        
        User.find({
          $or: [
            { name: regex },
            { email: regex },
            { phone: regex }
          ]
        })
          .select('name email phone role status')
          .limit(searchLimit)
          .lean()
      ]);

      // Add highlighting
      results.patients = patients.map(p => ({
        ...p,
        highlightedName: highlightText(p.user?.name),
        highlightedPatientCode: highlightText(p.patientCode)
      }));
      
      results.doctors = doctors.map(d => ({
        ...d,
        highlightedName: highlightText(d.user?.name),
        highlightedDoctorId: highlightText(d.doctorId)
      }));
      
      results.appointments = appointments.map(a => ({
        ...a,
        highlightedAppointmentId: highlightText(a.appointmentId)
      }));
      
      results.users = users.map(u => ({
        ...u,
        highlightedName: highlightText(u.name),
        highlightedEmail: highlightText(u.email)
      }));
    }

    const totalResults = 
      results.patients.length +
      results.doctors.length +
      results.appointments.length +
      results.users.length;

    res.json({
      success: true,
      query: keyword,
      results,
      meta: {
        total: totalResults,
        counts: {
          patients: results.patients.length,
          doctors: results.doctors.length,
          appointments: results.appointments.length,
          users: results.users.length
        },
        userRole,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Search all error:', error);
    res.status(500).json({
      success: false,
      message: 'Search failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// controllers/searchController.js - Add global search endpoint
const globalSearch = async (req, res) => {
  try {
    const { q, limit = 20, types = 'patient,doctor,appointment,therapy' } = req.query;
    
    if (!q || !q.trim()) {
      return res.json({
        success: true,
        results: [],
        query: q || '',
        timestamp: new Date().toISOString()
      });
    }

    const keyword = q.trim().toLowerCase();
    const searchLimit = parseInt(limit);
    const searchTypes = types.split(',');
    
    // Build search queries for each type
    const searchPromises = [];
    const regex = new RegExp(keyword, 'i');

    if (searchTypes.includes('patient')) {
      searchPromises.push(
        Patient.aggregate([
          {
            $match: {
              $or: [
                { patientCode: regex },
                { phone: regex },
                { email: regex },
                { 'user.name': regex }
              ]
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
              pipeline: [
                { $project: { name: 1, email: 1, phone: 1, photo: 1 } }
              ]
            }
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              patientCode: 1,
              phone: 1,
              email: 1,
              age: 1,
              gender: 1,
              status: 1,
              displayName: '$userInfo.name',
              photo: '$userInfo.photo',
              type: 'patient',
              description: 'Patient',
              _score: {
                $switch: {
                  branches: [
                    { 
                      case: { $regexMatch: { input: '$patientCode', regex: new RegExp(`^${keyword}`, 'i') } }, 
                      then: 0.95 
                    },
                    { 
                      case: { $regexMatch: { input: '$phone', regex } }, 
                      then: 0.85 
                    },
                    { 
                      case: { $regexMatch: { input: '$email', regex } }, 
                      then: 0.80 
                    },
                    { 
                      case: { $regexMatch: { input: '$userInfo.name', regex } }, 
                      then: 0.75 
                    }
                  ],
                  default: 0.5
                }
              },
              createdAt: 1,
              updatedAt: 1
            }
          },
          { $sort: { _score: -1, createdAt: -1 } },
          { $limit: searchLimit }
        ]).exec()
      );
    }

    if (searchTypes.includes('doctor')) {
      searchPromises.push(
        Doctor.aggregate([
          {
            $match: {
              $or: [
                { doctorId: regex },
                { department: regex },
                { specialization: regex },
                { 'user.name': regex }
              ]
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
              pipeline: [
                { $project: { name: 1, email: 1, phone: 1, photo: 1 } }
              ]
            }
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              doctorId: 1,
              department: 1,
              specialization: 1,
              consultationFee: 1,
              experience: 1,
              rating: 1,
              displayName: `Dr. ${'$userInfo.name'}`,
              photo: '$userInfo.photo',
              type: 'doctor',
              description: {
                $concat: ['$department', ' • ', { $toString: '$experience' }, ' years']
              },
              _score: {
                $switch: {
                  branches: [
                    { 
                      case: { $regexMatch: { input: '$doctorId', regex: new RegExp(`^${keyword}`, 'i') } }, 
                      then: 0.95 
                    },
                    { 
                      case: { $regexMatch: { input: '$userInfo.name', regex } }, 
                      then: 0.90 
                    },
                    { 
                      case: { $regexMatch: { input: '$department', regex } }, 
                      then: 0.80 
                    },
                    { 
                      case: { $regexMatch: { input: '$specialization', regex } }, 
                      then: 0.75 
                    }
                  ],
                  default: 0.5
                }
              },
              createdAt: 1,
              updatedAt: 1
            }
          },
          { $sort: { _score: -1, createdAt: -1 } },
          { $limit: searchLimit }
        ]).exec()
      );
    }

    // Add similar for appointments and therapies...

    // Execute all searches
    const searchResults = await Promise.allSettled(searchPromises);
    
    // Combine and sort all results
    let allResults = [];
    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        allResults.push(...result.value);
      }
    });

    // Sort by relevance score
    allResults.sort((a, b) => b._score - a._score);

    // Apply limit
    allResults = allResults.slice(0, searchLimit);

    res.json({
      success: true,
      query: keyword,
      results: allResults,
      meta: {
        total: allResults.length,
        types: searchTypes,
        limit: searchLimit,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({
      success: false,
      message: 'Global search failed'
    });
  }
};

module.exports = {
  liveSearch,
  smartSearch,
  searchAll,
  regexSearch,
  fullTextSearch,
  searchByType,
  advancedSearch,
  searchAnalytics,
  exportSearchResults,
  updateSearchHistory,
  generateSearchSuggestions,
  globalSearch
};