# Quick Start Guide

This is a quick reference to get your GoHighLevel to CallTools sync worker up and running fast.

## ⚡ Sync Methods

This worker supports **two sync methods**:

1. **🎯 Webhooks (Recommended)** - Real-time sync when contacts are tagged
2. **🔄 Batch Sync** - Manual or scheduled bulk sync

**Best Practice:** Use both! Webhooks for speed + batch sync as backup.

## Prerequisites

- GoHighLevel account with API access
- CallTools account with API access
- Cloudflare account

## Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Apply Database Migrations
```bash
# Local development
npm run seedLocalDb

# Production
npm run predeploy
```

### 3. Set API Keys
```bash
# Set GoHighLevel API key
wrangler secret put GHL_API_KEY
# Paste your GoHighLevel API key when prompted

# Set CallTools API key
wrangler secret put CALLTOOLS_API_KEY
# Paste your CallTools API key when prompted

# Set webhook secret (for real-time sync)
wrangler secret put GHL_WEBHOOK_SECRET
# Generate and paste a secure random string (e.g., openssl rand -hex 32)
```

### 4. Deploy
```bash
npm run deploy
```

## Usage

Once deployed, you'll get a URL like: `https://your-worker.workers.dev`

### Option 1: Real-Time Webhook Sync (⚡ Recommended)

**Set up in GoHighLevel:**
1. Go to Settings → Integrations → Webhooks
2. Add new webhook:
   - URL: `https://your-worker.workers.dev/webhook/ghl`
   - Secret: [Your GHL_WEBHOOK_SECRET]
   - Events: Contact Created, Contact Updated, Contact Tag Added/Removed
3. Save and test

**Now contacts sync automatically when tagged "cold lead"!**

📖 **Detailed Instructions:** [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md)

### Option 2: Manual Batch Sync

```bash
curl -X POST https://your-worker.workers.dev/sync/trigger
```

### Check Sync Statistics
```bash
curl https://your-worker.workers.dev/sync/stats
```

### Mark a Contact as Customer (to exclude from future syncs)
```bash
curl -X POST https://your-worker.workers.dev/sync/mark-customer/CONTACT_ID
```

## What Gets Synced?

✅ **Synced Contacts:**
- Contacts with **"cold lead"** tag in GoHighLevel
- Contacts tagged with: `cold`, `new lead`, `prospect`
- Contacts with valid phone numbers
- Not marked as customers
- **Automatically added to "Cold Leads" bucket in CallTools**

❌ **Excluded Contacts:**
- Contacts tagged with: `customer`, `client`, `won`, `purchased`
- Contacts without phone numbers
- Contacts manually marked as customers

### Cold Leads Bucket

All synced contacts are automatically organized into a **"Cold Leads"** bucket in CallTools:
- ✅ Automatically created if it doesn't exist
- ✅ All cold contacts are added to this bucket
- ✅ Easy to target in CallTools dialer campaigns
- ✅ Keeps your cold outreach organized

## API Documentation

Visit your worker URL to see the full OpenAPI documentation:
```
https://your-worker.workers.dev/
```

## Troubleshooting

**"API key not configured"**
- Run `wrangler secret put GHL_API_KEY` and `wrangler secret put CALLTOOLS_API_KEY`

**"No phone number" errors**
- Some contacts don't have phone numbers and can't be added to CallTools dialer
- These are tracked but skipped

**Check Logs**
```bash
wrangler tail
```

## Need More Details?

See [SETUP.md](./SETUP.md) for detailed documentation and customization options.
