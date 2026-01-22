# Credit System Implementation

## Overview

The credit system manages user access to audit features (SEO, GEO, GBP) through two types of credits:
1. **Subscription Credits** - Monthly limits from active subscription plans
2. **Addon Credits** - One-time credits purchased separately

---

## How It Works

### 1. Subscription Credits (Monthly Limits)

When a user purchases a subscription plan (e.g., Starter Plan):
- Subscription record is created in `subscriptions` table
- Monthly limits are stored in `plan.limits` (e.g., 30 SEO audits, 10 GEO audits, 5 GBP audits)
- Usage is tracked in `subscription.usage` (e.g., `seo_audits_used`, `geo_audits_used`)
- Credits reset monthly based on `current_period_end`

**Example:**
- Starter Plan: 30 SEO audits/month
- User uses 5 audits → `subscription.usage.seo_audits_used = 5`
- Remaining: 25 audits available this month
- Next month: Counter resets to 0

### 2. Addon Credits (One-time Purchases)

When a user purchases an addon (e.g., "Extra 10 SEO Audits"):
- Credits are added to `user.credits` (e.g., `user.credits.seo_audits += 10`)
- These credits don't expire and are used after subscription credits
- Stored in `users` table, `credits` field

**Example:**
- User has 10 addon SEO credits
- User uses 1 audit → `user.credits.seo_audits = 9`
- Remaining: 9 addon credits

---

## Credit Priority

When a user runs an audit, credits are consumed in this order:

1. **Subscription Credits First** - Use monthly subscription limits
2. **Addon Credits Second** - Use one-time purchased credits

**Example Flow:**
```
User has:
- Subscription: 30 SEO audits/month (5 used, 25 remaining)
- Addon: 10 SEO audits

User runs SEO audit:
1. Check subscription credits → 25 available ✅
2. Use 1 subscription credit → 24 remaining
3. Addon credits remain untouched
```

---

## Implementation Details

### Credit Middleware (`credit.middleware.js`)

**Purpose:** Check if user has available credits before allowing audit action

**Usage:**
```javascript
router.post('/', checkCredit('seo_audits'), controller.runAudit);
```

**What it does:**
1. Gets user's active subscription
2. Resets monthly usage if needed (new month)
3. Calculates available credits:
   - Subscription available = `plan.limits.seo_audits - subscription.usage.seo_audits_used`
   - Addon credits = `user.credits.seo_audits`
   - Total available = Subscription available + Addon credits
4. Returns 403 error if no credits available
5. Attaches `creditInfo` to `req` for controller use

### Credit Decrement (In Controllers)

After successful audit, credits are decremented:

```javascript
// In seoAudit.controller.js
if (creditInfo) {
  const { subscription, userCredits } = creditInfo;
  
  // Try subscription credits first
  if (subscription && subscription.usage?.seo_audits_used < subscription.plan_id?.limits?.seo_audits) {
    await subscription.incrementUsage('seo_audits', 1);
  } 
  // Then use addon credits
  else if (userCredits > 0) {
    user.credits.seo_audits = Math.max(0, user.credits.seo_audits - 1);
    await user.save();
  }
}
```

---

## Routes with Credit Protection

All audit creation routes are protected:

- `POST /api/v1/seo-audits` → `checkCredit('seo_audits')`
- `POST /api/v1/geo-audits` → `checkCredit('geo_audits')`
- `POST /api/v1/gbp-audits` → `checkCredit('gbp_audits')`

---

## Database Schema

### User Credits (`users.credits`)
```javascript
{
  seo_audits: Number,      // Addon credits only
  geo_audits: Number,       // Addon credits only
  gbp_audits: Number,       // Addon credits only
  ai_generations: Number   // Addon credits only
}
```

### Subscription Usage (`subscriptions.usage`)
```javascript
{
  seo_audits_used: Number,      // Monthly usage counter
  geo_audits_used: Number,      // Monthly usage counter
  gbp_audits_used: Number,      // Monthly usage counter
  ai_generations_used: Number,  // Monthly usage counter
  searches_performed: Number,
  api_calls_made: Number,
  last_reset: Date              // Last monthly reset date
}
```

### Plan Limits (`plans.limits`)
```javascript
{
  seo_audits: Number,           // Monthly limit
  geo_audits: Number,           // Monthly limit
  gbp_audits: Number,           // Monthly limit
  ai_generations: Number,       // Monthly limit
  searches_per_month: Number,
  api_calls_per_month: Number
}
```

---

## Testing the Credit System

### Test Scenario 1: Subscription Credits
1. User purchases Starter Plan (30 SEO audits/month)
2. Check credits: `GET /api/v1/subscriptions/credits`
3. Run SEO audit: `POST /api/v1/seo-audits`
4. Verify: `subscription.usage.seo_audits_used` increases
5. Run 30 audits → Should fail on 31st (no credits)

### Test Scenario 2: Addon Credits
1. User purchases "Extra 10 SEO Audits" addon
2. Check: `user.credits.seo_audits = 10`
3. Use all subscription credits (30/30)
4. Run SEO audit → Should use addon credit
5. Verify: `user.credits.seo_audits = 9`

### Test Scenario 3: No Credits
1. User has no subscription and no addon credits
2. Try to run audit → Should get 403 error:
   ```json
   {
     "statusCode": 403,
     "message": "Insufficient SEO Audits credits. Please upgrade your plan or purchase addon credits.",
     "data": {
       "credit_type": "seo_audits",
       "available": 0,
       "used": 0,
       "limit": 0,
       "addon_credits": 0
     }
   }
   ```

---

## Monthly Reset Logic

Credits reset automatically when:
- New month starts (based on `last_reset` date)
- Called via `subscription.resetMonthlyUsage()`
- Triggered automatically in credit middleware

**Reset Process:**
```javascript
// In subscription.model.js
resetMonthlyUsage() {
  const now = new Date();
  const lastReset = this.usage.last_reset;
  
  if (now.getMonth() !== lastReset.getMonth() || 
      now.getFullYear() !== lastReset.getFullYear()) {
    // Reset all usage counters
    this.usage.seo_audits_used = 0;
    this.usage.geo_audits_used = 0;
    // ... etc
    this.usage.last_reset = now;
    await this.save();
  }
}
```

---

## API Endpoints

### Get Credits
```
GET /api/v1/subscriptions/credits
```

**Response:**
```json
{
  "statusCode": 200,
  "data": {
    "seo_audits": {
      "total_remaining": 25,
      "total_limit": 30,
      "used": 5,
      "addon_credits": 10,
      "subscription_available": 25
    },
    "geo_audits": { ... },
    "gbp_audits": { ... },
    "ai_generations": { ... },
    "subscription": {
      "plan_name": "Starter Plan",
      "status": "active",
      "current_period_end": "2024-02-15T00:00:00.000Z"
    }
  }
}
```

---

## Error Handling

### Insufficient Credits
- **Status:** 403 Forbidden
- **Message:** "Insufficient [Credit Type] credits. Please upgrade your plan or purchase addon credits."
- **Data:** Credit breakdown (available, used, limit, addon_credits)

### No Active Subscription
- **Status:** 403 Forbidden  
- **Message:** "Active subscription required. Please subscribe to a plan."
- **Note:** Only if `requireSubscription` middleware is used

---

## Summary

✅ **Subscription Credits** - Monthly limits, tracked in `subscription.usage`  
✅ **Addon Credits** - One-time purchases, stored in `user.credits`  
✅ **Credit Middleware** - Protects all audit routes  
✅ **Automatic Decrement** - Credits consumed after successful audit  
✅ **Monthly Reset** - Usage counters reset automatically  
✅ **Priority System** - Subscription credits used first, then addon credits  

The system ensures users can only run audits when they have available credits, whether from their subscription or purchased addons.







