# Cold Leads Bucket Feature

## Overview

All contacts synced from GoHighLevel with the "cold lead" tag are automatically organized into a **"Cold Leads"** bucket in CallTools. This feature helps you keep your cold outreach contacts organized and makes it easy to target them with the CallTools dialer.

## How It Works

### Automatic Bucket Management

1. **Bucket Creation**: When you run your first sync, the worker automatically checks if a "Cold Leads" bucket exists in CallTools
2. **Auto-Create**: If the bucket doesn't exist, it's created automatically with the description "Auto-created bucket for Cold Leads contacts"
3. **Bucket Assignment**: Every contact synced is automatically added to this bucket
4. **Update Handling**: If a contact already exists and is updated, they're still ensured to be in the Cold Leads bucket

### GoHighLevel Tag Matching

The worker looks for contacts with the **"cold lead"** tag specifically:

```typescript
// Primary match (exact)
tag === 'cold lead'

// Also matches these variations
tag.includes('cold')
tag.includes('new lead')
tag.includes('prospect')
```

### CallTools Integration

The bucket functionality uses the CallTools API to:

- **GET** `/buckets` - List all existing buckets
- **POST** `/buckets` - Create the "Cold Leads" bucket if needed
- **PUT** `/buckets/{bucket_id}/contacts/{contact_id}` - Add contact to bucket

## Benefits

✅ **Organized Dialing**: All cold leads are in one place
✅ **Campaign Targeting**: Easy to create campaigns for cold leads only
✅ **Automatic Management**: No manual bucket assignment needed
✅ **Consistent Process**: Every cold lead ends up in the same bucket

## API Response

When you trigger a sync, the response includes bucket information:

```json
{
  "success": true,
  "data": {
    "total_processed": 50,
    "synced": 45,
    "updated": 5,
    "excluded_customers": 0,
    "failed": 0,
    "bucket_name": "Cold Leads",
    "bucket_id": "bucket_abc123",
    "errors": []
  }
}
```

## Customization

If you want to change the bucket name or use multiple buckets based on different tags, you can modify the sync service:

### Change Bucket Name

Edit `src/services/contactSyncService.ts`:

```typescript
async syncColdContacts(): Promise<SyncResult> {
  const bucketName = 'Your Custom Bucket Name'; // Change this
  // ... rest of the code
}
```

### Multiple Buckets Based on Tags

You can extend the logic to use different buckets for different lead types:

```typescript
private getBucketNameForContact(contact: GHLContact): string {
  const tags = (contact.tags || []).map(t => t.toLowerCase());
  
  if (tags.includes('cold lead')) return 'Cold Leads';
  if (tags.includes('warm lead')) return 'Warm Leads';
  if (tags.includes('hot lead')) return 'Hot Leads';
  
  return 'Cold Leads'; // default
}
```

## Troubleshooting

### Bucket Not Created

If the bucket isn't being created, check:

1. **API Permissions**: Ensure your CallTools API key has permission to create buckets
2. **Logs**: Run `wrangler tail` to see error messages
3. **Manual Creation**: Create the bucket manually in CallTools if needed

### Contacts Not in Bucket

If contacts exist but aren't in the bucket:

1. Re-run the sync - updates will add them to the bucket
2. Check that the contact IDs match between systems
3. Verify the bucket ID is correct in the logs

### Multiple Buckets with Similar Names

If you accidentally create multiple buckets (e.g., "Cold Leads" and "cold leads"):

1. The worker matches bucket names case-insensitively
2. Delete duplicate buckets in CallTools manually
3. Re-run sync to ensure contacts are in the correct bucket

## Best Practices

1. **Single Source of Truth**: Use the "cold lead" tag consistently in GoHighLevel
2. **Regular Syncs**: Schedule syncs to keep the bucket up to date
3. **Monitor Stats**: Check `/sync/stats` regularly to ensure syncs are successful
4. **Clean Up**: Remove contacts from the bucket when they're no longer cold leads

## Related Configuration

- **Bucket Name**: `Cold Leads` (hardcoded in `src/services/contactSyncService.ts`)
- **Tag Match**: `cold lead` (case-insensitive, in `src/clients/gohighlevel.ts`)
- **Auto-Create**: Enabled by default
- **Duplicate Prevention**: Bucket is fetched first before attempting to create
