# GoHighLevel to CallTools Contact Sync - Setup Guide

This worker automatically syncs cold contacts from GoHighLevel to CallTools, excluding customers, so you can efficiently use the CallTools dialer for outreach.

## Features

- ✅ Automatically syncs cold contacts from GoHighLevel to CallTools
- ✅ Adds contacts to "Cold Leads" bucket in CallTools for organized dialing
- ✅ Excludes contacts marked as customers
- ✅ Tracks sync status in a database
- ✅ Prevents duplicate contacts
- ✅ Updates existing contacts if they already exist
- ✅ Provides detailed sync statistics
- ✅ RESTful API endpoints for triggering and monitoring syncs

## Prerequisites

1. **GoHighLevel Account** with API access
2. **CallTools Account** with API access
3. **Cloudflare Account** (for Workers and D1 database)

## Installation & Setup

### Step 1: Clone and Install Dependencies

```bash
npm install
# or
pnpm install
```

### Step 2: Set Up Database

Run the migrations to create the necessary tables:

```bash
# For local development
npm run seedLocalDb

# For production
npm run predeploy
```

This will create:
- `tasks` table (from initial migration)
- `synced_contacts` table (for tracking synced contacts)

### Step 3: Configure API Keys

You need to set up two API keys as Cloudflare Worker secrets:

#### Option 1: Using Wrangler CLI (Recommended for Production)

```bash
# Set GoHighLevel API key
wrangler secret put GHL_API_KEY

# Set CallTools API key
wrangler secret put CALLTOOLS_API_KEY
```

When prompted, paste your API keys.

#### Option 2: Using Cloudflare Dashboard

1. Go to your Cloudflare Workers dashboard
2. Select your worker
3. Go to Settings → Variables
4. Add the following secrets:
   - `GHL_API_KEY`: Your GoHighLevel API key
   - `CALLTOOLS_API_KEY`: Your CallTools API key

### Step 4: Get Your API Keys

#### GoHighLevel API Key

1. Log in to your GoHighLevel account
2. Go to **Settings** → **Integrations** → **API**
3. Create a new API key or use an existing one
4. Copy the API key

#### CallTools API Key

1. Log in to your CallTools account
2. Go to **Account Settings** → **API**
3. Generate a new API key
4. Copy the API key

### Step 5: Deploy

```bash
npm run deploy
```

## Usage

### API Endpoints

Once deployed, you'll have access to the following endpoints:

#### 1. Trigger Contact Sync

**Endpoint:** `POST /sync/trigger`

Triggers a sync of cold contacts from GoHighLevel to CallTools.

**Example:**
```bash
curl -X POST https://your-worker.workers.dev/sync/trigger
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_processed": 150,
    "synced": 120,
    "updated": 25,
    "excluded_customers": 5,
    "failed": 0,
    "bucket_name": "Cold Leads",
    "bucket_id": "bucket_12345",
    "errors": []
  }
}
```

#### 2. Get Sync Statistics

**Endpoint:** `GET /sync/stats`

Returns statistics about synced contacts.

**Example:**
```bash
curl https://your-worker.workers.dev/sync/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_contacts": 150,
    "synced": 145,
    "failed": 0,
    "excluded_customers": 5,
    "pending": 0
  }
}
```

#### 3. Mark Contact as Customer

**Endpoint:** `POST /sync/mark-customer/:ghl_contact_id`

Marks a specific contact as a customer to exclude them from future syncs.

**Example:**
```bash
curl -X POST https://your-worker.workers.dev/sync/mark-customer/abc123
```

**Response:**
```json
{
  "success": true,
  "message": "Contact marked as customer and excluded from future syncs"
}
```

## How It Works

### Contact Filtering Logic

The worker uses the following logic to determine which contacts to sync:

#### ✅ Contacts that WILL be synced (Cold Contacts):
- Contacts with the **"cold lead"** tag in GoHighLevel (primary match)
- Contacts with tags containing: `cold`, `new lead`, `prospect`
- Contacts without customer-related tags

#### ❌ Contacts that will NOT be synced (Customers):
- Contacts with tags containing: `customer`, `client`, `won`, `purchased`
- Contacts manually marked as customers via the API

### CallTools Bucket Organization

All synced contacts are automatically added to the **"Cold Leads"** bucket in CallTools:
- The bucket is created automatically if it doesn't exist
- Contacts are added to this bucket during both creation and updates
- This allows you to easily target cold leads in the CallTools dialer
- You can configure campaigns and call flows specifically for this bucket

### Sync Process

1. **Get or Create Cold Leads Bucket**: Ensures the "Cold Leads" bucket exists in CallTools
2. **Fetch Cold Contacts**: Retrieves all contacts from GoHighLevel with "cold lead" tag
3. **Filter Out Customers**: Excludes contacts with customer-related tags
4. **Check Existing Records**: Queries the database to see if contact was previously synced
5. **Validate Phone Number**: Ensures contact has a valid phone number (required for CallTools)
6. **Create or Update in CallTools**:
   - If contact doesn't exist in CallTools, create new
   - If contact exists, update their information
7. **Add to Cold Leads Bucket**: Assigns contact to the "Cold Leads" bucket
8. **Track in Database**: Records sync status in the `synced_contacts` table

### Database Schema

The `synced_contacts` table tracks:
- `ghl_contact_id`: GoHighLevel contact ID
- `calltools_contact_id`: CallTools contact ID
- `sync_status`: `pending`, `synced`, `failed`, or `excluded`
- `is_customer`: Flag to mark customers (0 = false, 1 = true)
- `last_sync_at`: Timestamp of last successful sync
- `error_message`: Error details if sync failed

## Customizing Tag Logic

If you need to customize which contacts are considered "cold" or "customers", edit the filtering logic in:

**File:** `src/clients/gohighlevel.ts`

**Method:** `getColdContactsExcludingCustomers()`

```typescript
// Customize customer tags
const isCustomer = tags.some(tag => 
  tag.includes('customer') || 
  tag.includes('client') ||
  tag.includes('won') ||
  tag.includes('purchased') ||
  tag.includes('your-custom-tag')  // Add your custom tags here
);

// Customize cold contact tags
const isCold = tags.some(tag => 
  tag.includes('cold') ||
  tag.includes('new lead') ||
  tag.includes('prospect') ||
  tag.includes('your-custom-tag')  // Add your custom tags here
);
```

## Automation (Scheduled Syncs)

To automate syncs, you can set up a Cloudflare Cron Trigger:

### Add to `wrangler.jsonc`:

```jsonc
{
  // ... existing config
  "triggers": {
    "crons": ["0 */6 * * *"]  // Run every 6 hours
  }
}
```

### Create a scheduled handler in `src/index.ts`:

```typescript
export default {
  async fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Trigger sync automatically
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

## Development

### Run Locally

```bash
npm run dev
```

This will:
1. Apply database migrations to your local D1 database
2. Start the development server
3. Open the API documentation at `http://localhost:8787/`

### Run Tests

```bash
npm test
```

## Troubleshooting

### Common Issues

#### 1. "GoHighLevel API key not configured"
- Make sure you've set the `GHL_API_KEY` secret using `wrangler secret put GHL_API_KEY`

#### 2. "CallTools API error: 401"
- Verify your CallTools API key is correct
- Check that the API key has the necessary permissions

#### 3. "No phone number" errors
- Some contacts in GoHighLevel may not have phone numbers
- These contacts will be skipped (required for CallTools dialer)
- Check sync stats to see how many contacts were skipped

#### 4. Rate Limiting
- The worker includes built-in rate limiting protection
- Contacts are synced in batches with delays between batches
- If you hit rate limits, the sync will continue from where it left off

### Viewing Logs

```bash
# View real-time logs
wrangler tail

# View logs in Cloudflare Dashboard
# Go to Workers → Your Worker → Logs
```

## API Documentation

Once deployed, visit your worker URL (e.g., `https://your-worker.workers.dev/`) to see the full OpenAPI documentation with interactive examples.

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use Cloudflare Secrets** for all sensitive values
3. **Rotate API keys regularly**
4. **Monitor sync logs** for suspicious activity
5. **Limit API key permissions** to only what's needed

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the API documentation at your worker URL
3. Check Cloudflare Workers logs for detailed error messages

## License

This project is provided as-is for integration purposes.
