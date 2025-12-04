import Stripe from 'stripe';
import { User, Plan, Subscription } from '../models/index.js';
import { env } from '../config/index.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

class StripeService {

  async createCheckout(userId, priceId) {
    // Find plan by stripe_price_id
    const plan = await Plan.findOne({ stripe_price_id: priceId, is_active: true });
    
    if (!plan) {
      throw new Error(`Plan not found for price ID: ${priceId}. Please run the seed script to populate plans.`);
    }

    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const customerId = await this._ensureCustomer(user);

    // Determine checkout mode based on plan type
    const mode = plan.plan_type === 'subscription' ? 'subscription' : 'payment';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: mode,
      success_url: `${env.CLIENT_URL}/checkout/success?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.CLIENT_URL}/checkout/cancel?canceled=true`,
      metadata: { 
        user_id: userId.toString(),
        plan_id: plan._id.toString(),
        price_id: priceId,
        plan_type: plan.plan_type,
        plan_name: plan.name
      }
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
    console.log("Handling checkout session:", session.id);
    const { user_id, plan_id, price_id, plan_type } = session.metadata;
    
    if (!user_id) {
      console.error('No user_id in checkout session metadata');
      return;
    }

    // Find plan by plan_id or price_id
    let plan = null;
    if (plan_id) {
      plan = await Plan.findById(plan_id);
    } else if (price_id) {
      plan = await Plan.findOne({ stripe_price_id: price_id });
    }

    if (!plan) {
      console.error('Plan not found in checkout session metadata');
      return;
    }

    // Handle addon purchases (one-time payments)
    if (plan.plan_type === 'addon' || plan.billing_period === 'one_time') {
      await this._handleAddonPurchase(user_id, plan);
      return;
    }

    // Handle subscription plans
    if (plan.plan_type === 'subscription') {
      let stripeData = { customer: session.customer, payment_intent: session.payment_intent };

      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        stripeData = { ...stripeData, subscription: sub.id, ...sub };
      }

      await this._upsertSubscription(user_id, plan._id.toString(), stripeData);
    }
  }

  async _handleAddonPurchase(userId, plan) {
    if (!plan.credits) {
      console.error('No credits defined for addon plan');
      return;
    }

    // Update user credits
    const user = await User.findById(userId);
    if (!user) {
      console.error('User not found for addon purchase');
      return;
    }

    // Initialize credits if not exists
    if (!user.credits) {
      user.credits = {
        seo_audits: 0,
        geo_audits: 0,
        gbp_audits: 0,
        ai_generations: 0,
      };
    }

    // Add credits from plan
    if (plan.credits.seo_audits) {
      user.credits.seo_audits = (user.credits.seo_audits || 0) + plan.credits.seo_audits;
    }
    if (plan.credits.geo_audits) {
      user.credits.geo_audits = (user.credits.geo_audits || 0) + plan.credits.geo_audits;
    }
    if (plan.credits.gbp_audits) {
      user.credits.gbp_audits = (user.credits.gbp_audits || 0) + plan.credits.gbp_audits;
    }
    if (plan.credits.ai_generations) {
      user.credits.ai_generations = (user.credits.ai_generations || 0) + plan.credits.ai_generations;
    }

    await user.save();
    console.log(`Added credits to user ${userId} from plan ${plan.name}:`, plan.credits);
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

