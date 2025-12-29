import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { env } from './config/index.js';
import routes from './routes/index.js';
import helmet from "helmet";
import { ApiResponse } from './utils/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { handleStripeWebhook } from './controllers/webhook.controller.js';

const app = express();

// Compression
app.use(compression());

// Security Headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', "Cookie"],
  })
);

// Cookie parser
app.use(cookieParser());

// Request logging (dev only)
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Stripe webhook endpoint - MUST be before express.json() to preserve raw body
app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Parse JSON 
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting (exclude webhook endpoint)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/v1/webhooks/stripe', // Skip rate limiting for webhooks
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

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
