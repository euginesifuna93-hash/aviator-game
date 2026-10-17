const helmet = require('helmet');
const cors = require('cors');
const express = require('express');
const config = require('../config');

// 1. Helmet: Sets secure HTTP headers (XSS protection, no sniffing, etc.)
const helmetMiddleware = helmet({
  contentSecurityPolicy: config.isProd ? undefined : false, // Disable strict CSP in dev for easier testing
  crossOriginEmbedderPolicy: false,
});

// 2. CORS: Strictly allow only our frontend origin
const corsMiddleware = cors({
  origin: config.server.origin,
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// 3. Body Parsing: JSON and URL-encoded
const jsonMiddleware = express.json({ limit: '10kb' }); // Limit payload size
const urlencodedMiddleware = express.urlencoded({ extended: true, limit: '10kb' });

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  jsonMiddleware,
  urlencodedMiddleware,
};