# GoHighLevel Workflow Setup Guide

This guide explains how to sync contacts using **GoHighLevel Workflows** (custom automations), which is what you're currently using.

---

## 🎯 What You're Using: GHL Workflows

You created a workflow automation that sends an HTTP POST to your worker. This is simpler than webhooks but works great!

**Differences:**
- ✅ **Workflow** - Custom automation in workflow builder (what you have)
- 🔐 **Webhook** - Official integration with signature verification (more secure)

Both work! Workflows are easier to set up.

---

## 📋 Setup Steps

### Step 1: Deploy Your Worker

```bash
# Make sure you have API keys set
wrangler secret put GHL_API_KEY
wrangler secret put CALLTOOLS_API_KEY

# Deploy
npm run deploy
```

You'll get a URL like:
```
https://calltools-and-gohighlevel.workers.dev
```

### Step 2: Your Workflow Endpoint

Use this URL in your workflow:
```
https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow
                                                      └─ Note: ghl-workflow
```

**Important:** Use `/webhook/ghl-workflow` NOT `/webhook/ghl`

### Step 3: Configure Your Workflow in GoHighLevel

1. **Go to:** Automations → Workflows

2. **Edit your workflow** or create new one

3. **Trigger:** Contact Tag Added = "cold lead"

4. **Action:** Send Webhook / HTTP Request
   - **URL:** `https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow`
   - **Method:** POST
   - **Content-Type:** application/json
   - **Body:** (See options below)

### Step 4: Configure the Request Body

You have several options for what data to send:

#### Option 1: Just Contact ID (Recommended)

```json
{
  "contact_id": "{{contact.id}}"
}
```

The worker will fetch full contact details from GHL.

#### Option 2: Full Contact Data

```json
{
  "contact_id": "{{contact.id}}",
  "first_name": "{{contact.first_name}}",
  "last_name": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}",
  "tags": "{{contact.tags}}"
}
```

#### Option 3: Alternative Field Names

```json
{
  "id": "{{contact.id}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "name": "{{contact.full_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}"
}
```

**The worker is flexible and accepts any of these formats!**

---

## 🧪 Testing Your Workflow

### Test 1: Check Worker Deployment

```bash
# Test if the endpoint is live
curl https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"contact_id": "test123"}'
```

Expected response (if worker is deployed):
```json
{
  "success": false,
  "message": "Failed to sync contact: ...",
  "data": {
    "contact_id": "test123",
    "action": "failed",
    "bucket_id": null
  }
}
```

(It will fail because test123 doesn't exist, but the endpoint is working!)

### Test 2: View Live Logs

```bash
# Watch logs in real-time
wrangler tail
```

Keep this running and trigger your workflow in GHL.

### Test 3: Trigger Workflow in GHL

1. Go to any contact in GHL
2. Add the tag "cold lead"
3. Watch your `wrangler tail` output
4. You should see:
   ```
   === GHL Workflow Received ===
   Parsed workflow data: {...}
   Processing workflow for contact: abc123
   Syncing contact abc123 to CallTools...
   ```

---

## 📊 What the Workflow Does

```
┌─────────────────────────────────────────┐
│  1. Contact tagged "cold lead" in GHL   │
└───────────────────┬─────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  2. Workflow triggers → sends POST      │
│     to your worker with contact ID      │
└───────────────────┬─────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  3. Worker receives POST                │
│     - Extracts contact ID               │
│     - Fetches full contact from GHL     │
│     - Validates (cold lead? not customer?)│
└───────────────────┬─────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  4. Worker syncs to CallTools           │
│     - Creates/updates contact           │
│     - Adds to "Cold Leads" bucket       │
│     - Tracks in database                │
└───────────────────┬─────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│  5. Contact ready for dialing! ✅       │
└─────────────────────────────────────────┘
```

---

## 🐛 Troubleshooting

### "No contact ID found in workflow data"

**Problem:** The workflow isn't sending the contact ID.

**Solution:** Make sure your workflow body includes one of:
- `contact_id`
- `contactId`
- `id`

Example:
```json
{
  "contact_id": "{{contact.id}}"
}
```

### No logs appear when I trigger workflow

**Possible causes:**

1. **Worker not deployed**
   ```bash
   npm run deploy
   ```

2. **Wrong URL in workflow**
   - Should be: `/webhook/ghl-workflow`
   - NOT: `/webhook/ghl`

3. **Workflow not saved**
   - Make sure to save and publish the workflow

4. **Workflow not triggered**
   - Check workflow trigger conditions
   - Test by manually adding "cold lead" tag

### Worker returns 500 error

**Check API keys are set:**
```bash
wrangler secret put GHL_API_KEY
wrangler secret put CALLTOOLS_API_KEY
```

**View detailed error:**
```bash
wrangler tail
```

### Contact not appearing in CallTools

**Check these:**

1. **Does contact have phone number?**
   - CallTools requires a phone number
   - Check: `wrangler tail` for "No phone number" message

2. **Is contact a customer?**
   - Contacts with customer tags are excluded
   - Tags like: "customer", "client", "won", "purchased"

3. **Does contact have "cold lead" tag?**
   - Tag must be exactly "cold lead" (case-insensitive)
   - Check contact in GHL

---

## 🔍 Debug Checklist

Use this checklist to debug issues:

```bash
# 1. Verify worker is deployed
npm run deploy

# 2. Test endpoint is live
curl https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow \
  -X POST -H "Content-Type: application/json" -d '{"contact_id":"test"}'

# 3. Watch logs
wrangler tail

# 4. In another terminal, trigger workflow
# (Tag a contact in GHL with "cold lead")

# 5. Check logs for errors

# 6. Verify API keys are set
wrangler secret list

# 7. Check sync stats
curl https://calltools-and-gohighlevel.workers.dev/sync/stats
```

---

## 📋 Complete Workflow Configuration Template

Copy this into your GHL workflow:

**Trigger:**
- When: Contact Tag Added
- Tag: "cold lead"

**Action:**
- Type: Send Webhook / HTTP Request
- URL: `https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow`
- Method: `POST`
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "contact_id": "{{contact.id}}",
  "first_name": "{{contact.first_name}}",
  "last_name": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}"
}
```

**Note:** The `{{contact.xxx}}` are GHL placeholders that get replaced with actual values.

---

## ✅ Success Response

When working correctly, your workflow should receive:

```json
{
  "success": true,
  "message": "Contact synced successfully in CallTools",
  "data": {
    "contact_id": "abc123",
    "action": "synced",
    "bucket_id": "bucket_xyz"
  }
}
```

---

## 🔒 Security Note

This workflow endpoint does NOT require signature verification (simpler setup). If you need higher security, use the official webhook endpoint instead:

- **Workflow endpoint:** `/webhook/ghl-workflow` (no signature)
- **Official webhook:** `/webhook/ghl` (requires signature)

See [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) for the more secure option.

---

## 🆘 Still Having Issues?

1. **Check deployment:**
   ```bash
   npm run deploy
   ```

2. **View logs:**
   ```bash
   wrangler tail
   ```

3. **Test manually:**
   ```bash
   curl -X POST https://calltools-and-gohighlevel.workers.dev/webhook/ghl-workflow \
     -H "Content-Type: application/json" \
     -d '{"contact_id": "REAL_CONTACT_ID_FROM_GHL"}'
   ```

4. **Check the logs show:**
   - "GHL Workflow Received"
   - "Processing workflow for contact: xxx"
   - "Syncing contact xxx to CallTools"
   - "Contact synced successfully"

---

## 🎉 You're All Set!

Once configured:
1. Tag any contact with "cold lead" in GHL
2. Workflow triggers automatically
3. Worker syncs to CallTools
4. Contact appears in "Cold Leads" bucket
5. Ready to dial! 📞

**Need more help?** Check `wrangler tail` logs for detailed error messages.