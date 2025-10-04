# Quick Start Guide

This is a quick reference to get your GoHighLevel to CallTools sync worker up and running fast.

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
```

### 4. Deploy
```bash
npm run deploy
```

## Usage

Once deployed, you'll get a URL like: `https://your-worker.workers.dev`

### Trigger a Sync
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
- Contacts tagged with: `cold`, `new lead`, `prospect`
- Contacts with valid phone numbers
- Not marked as customers

❌ **Excluded Contacts:**
- Contacts tagged with: `customer`, `client`, `won`, `purchased`
- Contacts without phone numbers
- Contacts manually marked as customers

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
