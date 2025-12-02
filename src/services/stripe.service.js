import Stripe from 'stripe';
import { User, Plan, Subscription } from '../models/index.js';
import { env } from '../config/index.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

class StripeService {

  // ===== CORE BUSINESS LOGIC =====

  async createCheckout(userId, planId) {
    const [user, plan] = await this._validateCheckout(userId, planId);
    const customerId = await this._ensureCustomer(user);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      mode: plan.billing_period === 'one_time' ? 'payment' : 'subscription',
      success_url: `${env.CLIENT_URL}/checkout/success?success=true`,
      cancel_url: `${env.CLIENT_URL}/checkout/cancel?canceled=true`,
      metadata: { user_id: userId.toString(), plan_id: planId.toString() }
    });

    return { checkout_url: session.url };
  }

  async createPortal(userId) {
    const user = await User.findById(userId);
    if (!user?.stripe_customer_id) throw new Error('No billing account');

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${env.CLIENT_URL}/dashboard`
    });

    return { portal_url: session.url };
  }

  async processWebhook(rawBody, signature) {
    const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

    const handlers = {
      'checkout.session.completed': this._handleCheckout,
      'customer.subscription.updated': this._handleSubscriptionUpdate,
      'customer.subscription.deleted': this._handleSubscriptionCancel,
      'invoice.payment_succeeded': this._handlePaymentSuccess,
      'invoice.payment_failed': this._handlePaymentFailed
    };

    const handler = handlers[event.type];
    if (handler) {
      await handler.call(this, event.data.object);
      console.log(`✓ Processed ${event.type}`);
    }

    return { received: true };
  }

  // ===== PRIVATE HELPERS =====

  async _validateCheckout(userId, planId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const plan = await Plan.findOne({ _id: planId, is_active: true });
    if (!plan) throw new Error('Plan not found');

    return [user, plan];
  }

  async _ensureCustomer(user) {
    if (user.stripe_customer_id) return user.stripe_customer_id;

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { user_id: user._id.toString() }
    });

    user.stripe_customer_id = customer.id;
    await user.save();
    return customer.id;
  }

  async _upsertSubscription(userId, planId, stripeData) {
    // Cancel existing
    await Subscription.updateMany(
      { user_id: userId, status: { $in: ['active', 'trial'] } },
      { status: 'canceled', canceled_at: new Date() }
    );

    // Create new
    return Subscription.create({
      user_id: userId,
      plan_id: planId,
      stripe_customer_id: stripeData.customer,
      stripe_subscription_id: stripeData.subscription,
      stripe_payment_intent_id: stripeData.payment_intent,
      status: this._determineStatus(stripeData),
      current_period_start: stripeData.current_period_start ? new Date(stripeData.current_period_start * 1000) : undefined,
      current_period_end: stripeData.current_period_end ? new Date(stripeData.current_period_end * 1000) : undefined,
      trial_end: stripeData.trial_end ? new Date(stripeData.trial_end * 1000) : undefined
    });
  }

  _determineStatus(stripeData) {
    if (stripeData.payment_intent && !stripeData.subscription) return 'lifetime';
    if (stripeData.trial_end) return 'trial';
    return 'active';
  }

  _mapStripeStatus(status) {
    const map = { active: 'active', trialing: 'trial', past_due: 'past_due', canceled: 'canceled', unpaid: 'unpaid' };
    return map[status] || 'canceled';
  }

  // ===== WEBHOOK HANDLERS =====

  async _handleCheckout(session) {
    console.log("Handling checkout session:");
    const { user_id, plan_id } = session.metadata;
    if (!user_id || !plan_id) return;

    let stripeData = { customer: session.customer, payment_intent: session.payment_intent };

    if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(session.subscription);
      stripeData = { ...stripeData, subscription: sub.id, ...sub };
    }

    await this._upsertSubscription(user_id, plan_id, stripeData);
  }

  async _handleSubscriptionUpdate(stripeSub) {
    await Subscription.updateOne(
      { stripe_subscription_id: stripeSub.id },
      {
        status: this._mapStripeStatus(stripeSub.status),
        current_period_start: new Date(stripeSub.current_period_start * 1000),
        current_period_end: new Date(stripeSub.current_period_end * 1000),
        cancel_at_period_end: stripeSub.cancel_at_period_end,
        canceled_at: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null
      }
    );
  }

  async _handleSubscriptionCancel(stripeSub) {
    await Subscription.updateOne(
      { stripe_subscription_id: stripeSub.id },
      { status: 'canceled', canceled_at: new Date() }
    );
  }

  async _handlePaymentSuccess(invoice) {
    if (invoice.subscription) {
      await Subscription.updateOne(
        { stripe_subscription_id: invoice.subscription, status: 'past_due' },
        { status: 'active' }
      );
    }
  }

  async _handlePaymentFailed(invoice) {
    if (invoice.subscription) {
      await Subscription.updateOne(
        { stripe_subscription_id: invoice.subscription },
        { status: 'past_due' }
      );
    }
  }
}

export const stripeService = new StripeService();

