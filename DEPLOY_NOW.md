# Quick Deploy Guide - Get Running Now!

## 🚀 Deploy in 3 Steps

### Step 1: Set API Keys (2 minutes)

```bash
# Set GoHighLevel API key
wrangler secret put GHL_API_KEY
# When prompted, paste your GHL API key

# Set CallTools API key  
wrangler secret put CALLTOOLS_API_KEY
# When prompted, paste your CallTools API key
```

**Where to get API keys:**
- **GHL API Key:** GoHighLevel → Settings → Integrations → API → Create/Copy API Key
- **CallTools API Key:** CallTools → Account Settings → API → Generate API Key

---

### Step 2: Deploy Worker (1 minute)

```bash
# Apply database migrations
npm run predeploy

# Deploy to Cloudflare
npm run deploy
```

You'll see output like:
```
✨ Published calltools-and-gohighlevel
   https://calltools-and-gohighlevel.workers.dev
```

**Copy this URL!** You'll need it for GHL.

---

### Step 3: Configure GoHighLevel Webhook (1 minute)

1. **In GoHighLevel, go to:** Settings → Integrations → Webhooks

2. **Click:** "Add Webhook" or "Create Webhook"

3. **Fill in:**

   | Field | Value |
   |-------|-------|
   | **Action Name** | Cold Lead to CallTools |
   | **Method** | POST |
   | **URL** | `https://calltools-and-gohighlevel.workers.dev/webhook/ghl` |
   | **Custom Data** | Leave empty |
   | **Headers** | Leave empty |

4. **Select Events** (Important!):
   - ✅ Contact Created
   - ✅ Contact Updated  
   - ✅ Contact Tag Added
   - ✅ Contact Tag Removed

5. **Optional Filter:** Only trigger when tag contains "cold lead"

6. **Click Save**

7. **Click "Test Webhook"** button in GHL

---

## ✅ Test It Works

### Test 1: Watch Logs

Open a terminal and run:
```bash
wrangler tail
```

Leave this running. You should see webhook activity when you test.

### Test 2: Send Test from GHL

In the GHL webhook screen, click **"Test Webhook"** button.

You should see in your logs:
```
Processing ContactUpdate webhook for contact xyz
Using bucket ID: bucket_abc
Contact synced successfully
```

### Test 3: Tag a Real Contact

1. Go to any contact in GHL
2. Add tag: **"cold lead"**
3. Wait 2-4 seconds
4. Check CallTools → "Cold Leads" bucket
5. Contact should be there! ✅

---

## 🐛 If Nothing Happens

### Check 1: Is Worker Deployed?

```bash
curl https://calltools-and-gohighlevel.workers.dev/sync/stats
```

Should return JSON (not 404).

### Check 2: Are API Keys Set?

```bash
wrangler secret list
```

Should show:
- `GHL_API_KEY`
- `CALLTOOLS_API_KEY`

### Check 3: Is URL Correct?

In GHL webhook, make sure URL ends with `/webhook/ghl`:
```
https://calltools-and-gohighlevel.workers.dev/webhook/ghl
                                            └─ Must include this!
```

### Check 4: View Logs

```bash
wrangler tail
```

Then trigger webhook in GHL. What do you see?

- **Nothing?** → Wrong URL or worker not deployed
- **"API key not configured"?** → Run `wrangler secret put` commands
- **"Invalid webhook signature"?** → That's fine, we can fix later
- **"Contact synced successfully"?** → It's working! 🎉

---

## 📊 After It's Working

### Check Sync Statistics

```bash
curl https://calltools-and-gohighlevel.workers.dev/sync/stats
```

### View API Documentation

Visit in browser:
```
https://calltools-and-gohighlevel.workers.dev/
```

### Monitor in Real-Time

```bash
wrangler tail
```

---

## 🎉 You're Done!

Now whenever you tag a contact with "cold lead" in GoHighLevel:
1. Webhook fires automatically (< 1 second)
2. Worker syncs to CallTools (2-3 seconds)  
3. Contact appears in "Cold Leads" bucket
4. Ready to dial! 📞

**Total time from tag to dialable: ~3-4 seconds** ⚡

---

## 🔐 Optional: Add Security Later

To add webhook signature verification:

```bash
# Generate secret
openssl rand -hex 32

# Set in Cloudflare
wrangler secret put GHL_WEBHOOK_SECRET

# Add to GHL webhook headers:
# Key: x-ghl-signature
# Value: [your secret]
```

But this is optional - works fine without it!

---

## 🆘 Need Help?

Run these debug commands and share the output:

```bash
# 1. Check deployment
npm run deploy

# 2. Test endpoint
curl https://calltools-and-gohighlevel.workers.dev/webhook/ghl \
  -X POST -H "Content-Type: application/json" \
  -d '{"type":"ContactUpdate","id":"test123","contact":{"id":"test123","tags":["cold lead"]}}'

# 3. View logs
wrangler tail

# 4. Check secrets
wrangler secret list

# 5. Check sync stats  
curl https://calltools-and-gohighlevel.workers.dev/sync/stats
```