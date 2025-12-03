// Stripe Price IDs - These are the actual price IDs from Stripe
export const STRIPE_PRICE_IDS = {
  // Subscription Plans
  STARTER_PLAN: 'price_1SEAEPARwLtnMWsCAhLU5QZD',
  PREMIUM_PLAN: 'price_1SEAF6ARwLtnMWsCkqGwvqLc',
  
  // One-time Add-ons
  EXTRA_10_SEO_AUDITS: 'price_1SEAHDARwLtnMWsCunuOdJTG',
  EXTRA_10_GEO_AUDITS: 'price_1SEAI3ARwLtnMWsChwregnfz',
  EXTRA_5_GBP_AUDITS: 'price_1SEAIuARwLtnMWsCM7UJxjcY',
  EXTRA_50_AI_GENERATIONS: 'price_1SEAJjARwLtnMWsCuNI05fYL',
};

// Map price IDs to their types and metadata
export const PRICE_ID_METADATA = {
  [STRIPE_PRICE_IDS.STARTER_PLAN]: {
    type: 'subscription',
    name: 'Starter Plan',
    mode: 'subscription',
  },
  [STRIPE_PRICE_IDS.PREMIUM_PLAN]: {
    type: 'subscription',
    name: 'Premium Plan',
    mode: 'subscription',
  },
  [STRIPE_PRICE_IDS.EXTRA_10_SEO_AUDITS]: {
    type: 'addon',
    name: 'Extra 10 SEO Audits',
    mode: 'payment',
    credits: { seo_audits: 10 },
  },
  [STRIPE_PRICE_IDS.EXTRA_10_GEO_AUDITS]: {
    type: 'addon',
    name: 'Extra 10 GEO Audits',
    mode: 'payment',
    credits: { geo_audits: 10 },
  },
  [STRIPE_PRICE_IDS.EXTRA_5_GBP_AUDITS]: {
    type: 'addon',
    name: 'Extra 5 GBP Audits',
    mode: 'payment',
    credits: { gbp_audits: 5 },
  },
  [STRIPE_PRICE_IDS.EXTRA_50_AI_GENERATIONS]: {
    type: 'addon',
    name: 'Extra 50 AI Generations',
    mode: 'payment',
    credits: { ai_generations: 50 },
  },
};

// Helper function to get price metadata
export const getPriceMetadata = (priceId) => {
  return PRICE_ID_METADATA[priceId] || null;
};

// Helper function to check if price ID is valid
export const isValidPriceId = (priceId) => {
  return Object.values(STRIPE_PRICE_IDS).includes(priceId);
};

// Helper function to check if it's a subscription
export const isSubscriptionPrice = (priceId) => {
  const metadata = getPriceMetadata(priceId);
  return metadata?.type === 'subscription';
};

// Helper function to check if it's an addon
export const isAddonPrice = (priceId) => {
  const metadata = getPriceMetadata(priceId);
  return metadata?.type === 'addon';
};


