# Active Clients Feature

## Overview

This document describes how to sync active clients (sold contacts) from GoHighLevel to CallTools. When a contact becomes a paying customer in GoHighLevel, they are automatically moved from the "Cold Leads" bucket to the "ACA Active clients" bucket in CallTools.

## How It Works

### Workflow

1. **Contact Sale in GoHighLevel**: When a contact becomes a customer, they receive one of these tags:
   - `ACA Active 2025`
   - `ACA Active 2026`

2. **Webhook Trigger**: The GoHighLevel workflow fires a webhook to CallTools integration

3. **Automatic Processing**: The integration automatically:
   - ✅ Creates/updates the contact in CallTools
   - ✅ Adds the contact to **"ACA Active clients" bucket** (ID: `11252`)
   - ✅ Adds the **"ACA Active client"** tag in CallTools
   - ✅ Removes the contact from **"Cold Leads" bucket** (ID: `11237`)
   - ✅ Removes the **"ACA Cold lead"** tag (if present)
   - ✅ Marks the contact as a customer in the database

### Tag Detection

The system detects active clients by looking for these **exact tags** (case-insensitive):
- `ACA Active 2025`
- `ACA Active 2026`

## GoHighLevel Workflow Setup

### Step 1: Create Workflow Trigger

1. Go to **Automations** → **Workflows** in GoHighLevel
2. Create a new workflow or modify existing one
3. Set trigger: **Contact Tag Added**
4. Configure trigger to fire when tag is one of:
   - `ACA Active 2025`
   - `ACA Active 2026`

### Step 2: Add HTTP POST Action

1. Add an **HTTP POST** action to the workflow
2. Configure the action:
   
   | Field | Value |
   |-------|-------|
   | **Method** | POST |
   | **URL** | `https://your-worker.workers.dev/webhook/ghl-workflow` |
   | **Content Type** | `application/json` |
   | **Body** | See below |

3. **Request Body Template**:
```json
{
  "contact_id": "{{contact.id}}"
}
```

### Step 3: Test the Workflow

1. Find a test contact in GoHighLevel
2. Add tag `ACA Active 2025` or `ACA Active 2026`
3. Check CallTools to verify:
   - Contact appears in "ACA Active clients" bucket
   - Contact has "ACA Active client" tag
   - Contact is removed from "Cold Leads" bucket
   - "ACA Cold lead" tag is removed

## Technical Details

### Bucket IDs

| Bucket Name | Bucket ID | Purpose |
|-------------|-----------|---------|
| **ACA Active clients** | `11252` | Contains all active/paying clients |
| **Cold Leads** | `11237` | Contains cold leads/prospects |

### Tags

| Tag Name | Purpose |
|----------|---------|
| **ACA Active client** | Applied in CallTools to mark active clients |
| **ACA Cold lead** | Applied in CallTools to mark cold leads (removed when converted to active) |

### Contact Flow

```
┌─────────────────────────────────────────┐
│  GoHighLevel: Contact Tagged            │
│  "ACA Active 2025" or "ACA Active 2026" │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Webhook Fires to CallTools Integration  │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Integration Fetches Contact from GHL    │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Checks if Contact Exists in CallTools   │
└──────────────┬───────────────────────────┘
               │
         ┌─────┴─────┐
         │           │
      Exists      New Contact
         │           │
         ▼           ▼
    ┌─────────┐  ┌─────────┐
    │ Update  │  │ Create  │
    └────┬────┘  └────┬────┘
         │           │
         └─────┬─────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Add to "ACA Active clients" bucket      │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Remove from "Cold Leads" bucket         │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Add "ACA Active client" tag             │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Remove "ACA Cold lead" tag              │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Contact Ready in CallTools!             │
│  ✓ In correct bucket                     │
│  ✓ Properly tagged                       │
│  ✓ Marked as customer                    │
└──────────────────────────────────────────┘
```

## Code Implementation

### CallTools Client Methods

Two new methods were added to handle tags:

```typescript
// Add a tag to a contact
await callToolsClient.addTagToContact(contactId, 'ACA Active client');

// Remove a tag from a contact
await callToolsClient.removeTagFromContact(contactId, 'ACA Cold lead');
```

### Sync Service

The `ContactSyncService` now includes a `syncActiveClient()` method that:
1. Detects contacts with "ACA Active 2025" or "ACA Active 2026" tags
2. Creates or updates the contact in CallTools
3. Manages bucket assignments (add to active, remove from cold)
4. Manages tags (add active client, remove cold lead)
5. Marks the contact as a customer in the database

## Error Handling

The system gracefully handles errors:

- **Missing Phone Number**: Contact is skipped with error message
- **Tag Doesn't Exist**: Removal is skipped (no error thrown)
- **Bucket Doesn't Exist**: Error is logged but process continues
- **Network Errors**: Full error details are logged

## Webhook Response

### Success Response
```json
{
  "success": true,
  "message": "Contact updated successfully in CallTools",
  "data": {
    "contact_id": "abc123",
    "action": "updated",
    "bucket_id": "11252"
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Failed to sync contact: No phone number",
  "data": {
    "contact_id": "abc123",
    "action": "failed",
    "bucket_id": null
  }
}
```

## Monitoring

Check the CloudFlare Workers logs to monitor:
- Successful syncs
- Failed syncs
- Tag operations
- Bucket operations

Example log output:
```
Processing active client: abc123
Updating existing contact abc123 as active client
Added contact to Active Clients bucket (11252)
Removed contact from Cold Leads bucket (11237)
Added "ACA Active client" tag
Removed "ACA Cold lead" tag
Successfully updated contact abc123 as active client
```

## Comparison: Cold Leads vs Active Clients

| Feature | Cold Leads | Active Clients |
|---------|-----------|----------------|
| **GHL Tags** | "cold lead", "prospect", etc. | "ACA Active 2025", "ACA Active 2026" |
| **CallTools Bucket** | Cold Leads (11237) | ACA Active clients (11252) |
| **CallTools Tag** | ACA Cold lead | ACA Active client |
| **Database Status** | is_customer = 0 | is_customer = 1 |
| **Use Case** | Outreach campaigns | Active client management |

## Troubleshooting

### Contact Not Appearing in CallTools

1. Check GoHighLevel workflow logs
2. Verify tag is exactly "ACA Active 2025" or "ACA Active 2026"
3. Check CloudFlare Workers logs for errors
4. Verify webhook URL is correct
5. Ensure contact has a phone number

### Contact Still in Cold Leads Bucket

The system attempts to remove contacts from Cold Leads bucket. If a contact remains:
1. Check logs for errors
2. Manually remove from Cold Leads bucket
3. The contact should still be in Active Clients bucket

### Tag Not Applied

1. Check CallTools API logs
2. Verify tag name is "ACA Active client" (exact)
3. Check if tag already exists in CallTools

## Related Documentation

- [BUCKET_FEATURE.md](./BUCKET_FEATURE.md) - Cold Leads bucket details
- [GHL_WORKFLOW_SETUP.md](./GHL_WORKFLOW_SETUP.md) - Cold leads workflow setup
- [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) - Webhook configuration
