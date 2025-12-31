import Stripe from 'stripe';
import { User, Plan, Subscription } from '../models/index.js';
import { env } from '../config/index.js';
import { emailService } from './email.service.js';  // <-- ADD THIS

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
    const user = await User.findById(userId);
    if (!user) {
      console.error(`User not found: ${userId}`);
      throw new Error('User not found');
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      console.error(`Plan not found: ${planId}`);
      throw new Error('Plan not found');
    }

    // Cancel existing active subscriptions
    await Subscription.updateMany(
      { user_id: userId, status: { $in: ['active', 'trial'] } },
      { status: 'canceled', canceled_at: new Date() }
    );

    // Create new subscription
    const subscription = await Subscription.create({
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

    console.log(`Subscription created for user ${userId}, plan: ${plan.name}`);
    return subscription;
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
    const { user_id, plan_id, price_id } = session.metadata;
    
    if (!user_id) {
      console.error('No user_id in checkout session metadata');
      return;
    }

    const user = await User.findById(user_id);
    if (!user) {
      console.error('User not found:', user_id);
      return;
    }

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
      
      const updatedUser = await User.findById(user_id);
      await emailService.sendAddonPurchasedEmail(user.email, {
        userName: user.name,
        planName: plan.name,
        credits: plan.credits,
        totalCredits: updatedUser.credits,
        locale: user.preferred_locale || 'en'
      });
      return;
    }

    // Handle subscription plans
    if (plan.plan_type === 'subscription') {
      let stripeData = { customer: session.customer, payment_intent: session.payment_intent };

      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        stripeData = { ...stripeData, subscription: sub.id, ...sub };
      }

      const subscription = await this._upsertSubscription(user_id, plan._id.toString(), stripeData);
      
      await emailService.sendSubscriptionActivatedEmail(user.email, {
        userName: user.name,
        planName: plan.name,
        plan: plan,
        subscription: subscription,
        locale: user.preferred_locale || 'en'
      });
    }
  }

  async _handleAddonPurchase(userId, plan) {
    if (!plan.credits) {
      console.error('No credits defined for addon plan');
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      console.error('User not found for addon purchase');
      return;
    }

    if (!user.credits) {
      user.credits = {
        seo_audits: 0,
        geo_audits: 0,
        gbp_audits: 0,
        ai_generations: 0,
      };
    }

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
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSub.id })
      .populate('user_id', 'name email preferred_locale')
      .populate('plan_id', 'name');
    
    if (!subscription) {
      console.error('Subscription not found for update:', stripeSub.id);
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
      return;
    }

    const previousCancelAtPeriodEnd = subscription.cancel_at_period_end;
    
    subscription.status = this._mapStripeStatus(stripeSub.status);
    subscription.current_period_start = new Date(stripeSub.current_period_start * 1000);
    subscription.current_period_end = new Date(stripeSub.current_period_end * 1000);
    subscription.cancel_at_period_end = stripeSub.cancel_at_period_end;
    subscription.canceled_at = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;
    await subscription.save();

    const user = subscription.user_id;
    const planName = subscription.plan_id?.name || 'your plan';

    // Send cancellation email if cancel_at_period_end was just set
    if (stripeSub.cancel_at_period_end && !previousCancelAtPeriodEnd) {
      await emailService.sendSubscriptionCancelledEmail(user.email, {
        userName: user.name,
        planName: planName,
        immediate: false,
        endDate: subscription.current_period_end,
        locale: user.preferred_locale || 'en'
      });
    }
  }

  async _handleSubscriptionCancel(stripeSub) {
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSub.id })
      .populate('user_id', 'name email preferred_locale')
      .populate('plan_id', 'name');

    await Subscription.updateOne(
      { stripe_subscription_id: stripeSub.id },
      { status: 'canceled', canceled_at: new Date() }
    );

    if (subscription?.user_id) {
      const user = subscription.user_id;
      const planName = subscription.plan_id?.name || 'your plan';
      
      await emailService.sendSubscriptionCancelledEmail(user.email, {
        userName: user.name,
        planName: planName,
        immediate: true,
        endDate: null,
        locale: user.preferred_locale || 'en'
      });
    }
  }

  async _handlePaymentSuccess(invoice) {
    if (!invoice.subscription) return;

    const subscription = await Subscription.findOne({ stripe_subscription_id: invoice.subscription })
      .populate('user_id', 'name email preferred_locale')
      .populate('plan_id', 'name');
    
    await Subscription.updateOne(
      { stripe_subscription_id: invoice.subscription, status: 'past_due' },
      { status: 'active' }
    );

    // Send renewal email only for subscription cycle renewals
    if (subscription?.user_id && invoice.billing_reason === 'subscription_cycle') {
      const user = subscription.user_id;
      const planName = subscription.plan_id?.name || 'your plan';
      
      await emailService.sendSubscriptionRenewedEmail(user.email, {
        userName: user.name,
        planName: planName,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        periodStart: invoice.period_start * 1000,
        periodEnd: invoice.period_end * 1000,
        locale: user.preferred_locale || 'en'
      });
    }
  }

  async _handlePaymentFailed(invoice) {
    if (!invoice.subscription) return;

    const subscription = await Subscription.findOne({ stripe_subscription_id: invoice.subscription })
      .populate('user_id', 'name email preferred_locale')
      .populate('plan_id', 'name');
    
    await Subscription.updateOne(
      { stripe_subscription_id: invoice.subscription },
      { status: 'past_due' }
    );

    if (subscription?.user_id) {
      const user = subscription.user_id;
      const planName = subscription.plan_id?.name || 'your plan';
      
      await emailService.sendPaymentFailedEmail(user.email, {
        userName: user.name,
        planName: planName,
        locale: user.preferred_locale || 'en'
      });
    }
  }
}

export const stripeService = new StripeService();