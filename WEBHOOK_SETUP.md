# Webhook Setup Guide - Real-Time Sync

This guide explains how to set up **real-time webhook-based syncing** from GoHighLevel to CallTools. This is the **recommended approach** for immediate contact syncing.

## 🎯 Why Webhooks?

### Webhook Approach (✅ Recommended)
- ⚡ **Real-Time**: Contacts sync instantly when tagged "cold lead"
- 💰 **Cost Efficient**: Only syncs changed contacts, fewer API calls
- 🚀 **Scalable**: Handles high volumes without constant polling
- ✨ **Better UX**: Cold leads ready to dial immediately
- 📊 **Event-Driven**: Modern, efficient architecture

### Batch Sync Approach
- ⏰ **Delayed**: Sync happens on schedule (e.g., every hour)
- 💸 **Higher Cost**: Fetches all contacts every time
- 🐌 **Slower**: Lag between tag change and CallTools availability
- 🔄 **Redundant**: Re-syncs unchanged contacts

## 🏗️ Architecture: Hybrid Approach (Best Practice)

**Use Both Methods:**

1. **Webhooks (Primary)** - Real-time syncing for immediate updates
2. **Batch Sync (Backup)** - Runs daily to catch any missed webhooks

This ensures 100% reliability while maintaining real-time performance!

---

## 📋 Setup Instructions

### Step 1: Deploy Your Worker

First, deploy the worker with webhook support:

```bash
npm run deploy
```

Your worker will be available at: `https://your-worker.workers.dev`

### Step 2: Set Webhook Secret

Create a secure random string for webhook verification:

```bash
# Generate a random secret (or use your own)
openssl rand -hex 32

# Set it as a Cloudflare secret
wrangler secret put GHL_WEBHOOK_SECRET
# Paste your generated secret when prompted
```

**Important:** Save this secret! You'll need it for GoHighLevel configuration.

### Step 3: Configure Webhook in GoHighLevel

1. **Go to GoHighLevel Settings**
   - Log in to your GoHighLevel account
   - Navigate to: **Settings** → **Integrations** → **Webhooks**

2. **Create New Webhook**
   - Click **"Add Webhook"** or **"Create Webhook"**

3. **Configure Webhook Settings**

   | Setting | Value |
   |---------|-------|
   | **Name** | CallTools Cold Lead Sync |
   | **Webhook URL** | `https://your-worker.workers.dev/webhook/ghl` |
   | **Method** | POST |
   | **Secret** | [Your GHL_WEBHOOK_SECRET from Step 2] |

4. **Select Events to Subscribe To**

   Check these events:
   - ✅ **Contact Created**
   - ✅ **Contact Updated**
   - ✅ **Contact Tag Added**
   - ✅ **Contact Tag Removed**

5. **Optional: Set Filters (Recommended)**

   To reduce unnecessary webhook calls, add a filter:
   - **Filter by Tag**: Only send webhook when tag contains "cold lead"
   - This reduces webhook volume significantly

6. **Save the Webhook**

7. **Test the Webhook**
   - GoHighLevel provides a "Test Webhook" button
   - Click it to verify your worker receives the webhook
   - Check your worker logs: `wrangler tail`

### Step 4: Test Real-Time Sync

1. **In GoHighLevel:**
   - Open any contact
   - Add the tag **"cold lead"**
   - Save the contact

2. **Check CallTools:**
   - Within seconds, the contact should appear in CallTools
   - They should be in the "Cold Leads" bucket

3. **Check Worker Logs:**
   ```bash
   wrangler tail
   ```
   You should see:
   ```
   Processing ContactTagUpdate webhook for contact abc123
   Using bucket ID: bucket_xyz
   Created contact abc123 in CallTools and added to Cold Leads bucket
   ```

---

## 🔒 Security Features

### Webhook Signature Verification

The worker automatically verifies webhooks using HMAC-SHA256:

- **Signature Header**: `X-GHL-Signature`
- **Algorithm**: HMAC-SHA256
- **Secret**: Your `GHL_WEBHOOK_SECRET`

This ensures webhooks are genuinely from GoHighLevel, not from malicious sources.

### Timestamp Verification

Webhooks older than 5 minutes are rejected to prevent replay attacks.

### Rate Limiting

Consider adding Cloudflare's rate limiting if you expect high webhook volume:

```jsonc
// Add to wrangler.jsonc
{
  "limits": {
    "cpu_ms": 50
  }
}
```

---

## 📊 Monitoring Webhooks

### View Webhook Activity

```bash
# Real-time logs
wrangler tail

# Filter for webhook events only
wrangler tail | grep "webhook"
```

### Check Sync Statistics

```bash
curl https://your-worker.workers.dev/sync/stats
```

Response:
```json
{
  "success": true,
  "data": {
    "total_contacts": 250,
    "synced": 245,
    "failed": 0,
    "excluded_customers": 5,
    "pending": 0
  }
}
```

---

## 🔄 Hybrid Approach: Webhooks + Scheduled Batch Sync

### Why Use Both?

- **Webhooks can fail** due to network issues, downtime, etc.
- **Batch sync catches missed contacts** as a safety net
- **Best of both worlds**: Real-time + Reliability

### Set Up Scheduled Batch Sync

#### Option 1: Cloudflare Cron Trigger (Recommended)

Add to `wrangler.jsonc`:

```jsonc
{
  // ... existing config
  "triggers": {
    "crons": ["0 2 * * *"]  // Run daily at 2 AM UTC
  }
}
```

Create scheduled handler in `src/index.ts`:

```typescript
export default {
  async fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  },
  
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Run daily batch sync as backup
    console.log('Running scheduled batch sync...');
    
    const syncService = new ContactSyncService(
      env.GHL_API_KEY,
      env.CALLTOOLS_API_KEY,
      env.CALLTOOLS_BASE_URL,
      env.DB
    );
    
    const result = await syncService.syncColdContacts();
    console.log('Scheduled sync completed:', result);
  },
};
```

Deploy:
```bash
npm run deploy
```

#### Option 2: External Cron Service

Use a service like cron-job.org or EasyCron to call:

```bash
curl -X POST https://your-worker.workers.dev/sync/trigger
```

**Recommended Schedule:**
- **Development**: Every hour
- **Production**: Once per day (at night)

---

## 🐛 Troubleshooting

### Webhook Not Received

1. **Check Webhook URL**
   - Ensure URL is: `https://your-worker.workers.dev/webhook/ghl`
   - Must be HTTPS (HTTP won't work)

2. **Check GoHighLevel Webhook Status**
   - Go to: Settings → Integrations → Webhooks
   - Look for error indicators or failed delivery status
   - Click on webhook to see delivery history

3. **Check Worker Logs**
   ```bash
   wrangler tail
   ```

4. **Test with curl**
   ```bash
   curl -X POST https://your-worker.workers.dev/webhook/ghl \
     -H "Content-Type: application/json" \
     -d '{
       "type": "ContactUpdate",
       "location_id": "test",
       "id": "test123",
       "contact": {
         "id": "test123",
         "name": "Test Contact",
         "tags": ["cold lead"]
       }
     }'
   ```

### "Invalid webhook signature" Error

1. **Verify Secret Matches**
   - The secret in GoHighLevel webhook config must match `GHL_WEBHOOK_SECRET`

2. **Reset Secret**
   ```bash
   wrangler secret put GHL_WEBHOOK_SECRET
   # Update GoHighLevel webhook with the same secret
   ```

3. **Check Logs for Signature Details**
   ```bash
   wrangler tail
   ```

### Contact Not Syncing

1. **Check Tag Name**
   - Must be exactly "cold lead" (case-insensitive)
   - Check for typos or extra spaces

2. **Verify Contact Has Phone Number**
   - CallTools requires a phone number
   - Contacts without phones are skipped

3. **Check if Contact is Marked as Customer**
   - Customer tags exclude contacts from sync
   - Tags like: "customer", "client", "won", "purchased"

4. **Manual Sync as Fallback**
   ```bash
   curl -X POST https://your-worker.workers.dev/sync/trigger
   ```

### High Webhook Volume

If you're receiving too many webhooks:

1. **Add Tag Filter in GoHighLevel**
   - Only send webhooks for contacts with specific tags
   - Reduces noise significantly

2. **Optimize Event Subscriptions**
   - Only subscribe to necessary events
   - Disable events you don't need

3. **Add Rate Limiting**
   - Use Cloudflare's built-in rate limiting
   - Protects against webhook storms

---

## 📈 Performance Optimization

### Webhook Best Practices

1. **Quick Response**: Webhook endpoint responds immediately (< 200ms)
2. **Async Processing**: Sync happens after webhook acknowledgment
3. **Retry Logic**: GoHighLevel retries failed webhooks automatically
4. **Batch Updates**: Use batch sync for bulk operations

### Expected Performance

- **Webhook Response Time**: < 200ms
- **Contact Sync Time**: 1-3 seconds
- **CallTools Availability**: Within 5 seconds of tag update

---

## 🔍 Webhook Payload Examples

### Contact Created/Updated

```json
{
  "type": "ContactUpdate",
  "location_id": "abc123",
  "id": "contact_xyz789",
  "contact": {
    "id": "contact_xyz789",
    "firstName": "John",
    "lastName": "Doe",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "tags": ["cold lead"]
  },
  "timestamp": 1696123456789
}
```

### Tag Added

```json
{
  "type": "ContactTagUpdate",
  "location_id": "abc123",
  "id": "contact_xyz789",
  "contact": {
    "id": "contact_xyz789",
    "tags": ["cold lead", "interested"]
  },
  "timestamp": 1696123456789
}
```

---

## 🎉 Success Checklist

Before going live, verify:

- ✅ Worker deployed successfully
- ✅ `GHL_WEBHOOK_SECRET` configured in Cloudflare
- ✅ Webhook created in GoHighLevel with correct URL
- ✅ Secret matches between GoHighLevel and Cloudflare
- ✅ Events subscribed (Contact Created, Updated, Tag Added/Removed)
- ✅ Test contact synced successfully
- ✅ Contact appears in CallTools "Cold Leads" bucket
- ✅ Logs show successful webhook processing
- ✅ Batch sync scheduled as backup (optional but recommended)

---

## 📚 Additional Resources

- [GoHighLevel Webhook Documentation](https://highlevel.stoplight.io/docs/integrations/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [CallTools API Documentation](https://docs.calltools.com/)

## 🆘 Need Help?

If you encounter issues:

1. Check worker logs: `wrangler tail`
2. Review GoHighLevel webhook delivery history
3. Test with manual sync: `curl -X POST https://your-worker.workers.dev/sync/trigger`
4. Verify API keys are correct
5. Check sync stats: `curl https://your-worker.workers.dev/sync/stats`

---

**Congratulations! 🎉** You now have real-time, webhook-based contact syncing from GoHighLevel to CallTools!
