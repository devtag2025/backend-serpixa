import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import { env } from './config/index.js';
import routes from './routes/index.js';
import { ApiResponse } from './utils/index.js';

const app = express();

// Compression
app.use(compression());

// Security Headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: env.NODE_ENV === 'development'
      ? ['http://localhost:3000', 'http://localhost:5173']
      : process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Cookie parser
app.use(cookieParser());

// Request logging (dev only)
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Parse JSON
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// API routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, null, 'Serpixa API is running'));
});

export default app;
