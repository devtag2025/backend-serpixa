
export const USER_TYPES = {
  USER: 'user',
  ADMIN: 'admin',
};

// Billing periods for plans/subscriptions
export const BILLING_PERIODS = {
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  ONE_TIME: 'one_time'
};

// Subscription status values
export const SUBSCRIPTION_STATUS = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  UNPAID: 'unpaid',
  LIFETIME: 'lifetime'
};

// Convert objects to arrays for Mongoose enum validation
export const getUserTypesArray = () => Object.values(USER_TYPES);
export const getBillingPeriodsArray = () => Object.values(BILLING_PERIODS);
export const getSubscriptionStatusArray = () => Object.values(SUBSCRIPTION_STATUS);
