const helmet = require('helmet');
const cors = require('cors');
const express = require('express');
const config = require('../config');

// 1. Helmet: Sets secure HTTP headers (XSS protection, no sniffing, etc.)
// Disable Content Security Policy to allow Socket.io and analytics to connect
const helmetMiddleware = helmet({
  contentSecurityPolicy: false, 
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