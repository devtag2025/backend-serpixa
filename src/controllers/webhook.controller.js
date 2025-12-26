import { stripeService } from '../services/index.js';
import { ApiResponse } from '../utils/index.js';

// ===== STRIPE WEBHOOKS =====

export const handleStripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.body;

    if (!signature) {
      return res.status(400).json(
        new ApiResponse(400, null, "Missing Stripe signature")
      );
    }

    const result = await stripeService.processWebhook(rawBody, signature);
    
    res.status(200).json(
      new ApiResponse(200, result, "Webhook processed successfully")
    );

  } catch (error) {
    // Handle signature verification errors
    if (error.message.includes('signature')) {
      return res.status(400).json(
        new ApiResponse(400, null, "Webhook signature verification failed")
      );
    }
    res.status(200).json(
      new ApiResponse(200, { processed: false }, "Webhook received but processing failed")
    );
  }
};



