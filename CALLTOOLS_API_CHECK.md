# CallTools API Configuration Check

## ⚠️ CallTools API Error

Your worker is getting this error:
```
CallTools API error: 530 - error code: 1016
```

**Error 530** means the CallTools API is unreachable.

---

## 🔍 Possible Causes

### 1. Wrong CallTools API URL

The worker is configured to use:
```
https://api.calltools.com/v1
```

**This might not be the correct URL for CallTools!**

### 2. CallTools API Might Use Different URL

Common CallTools API URLs:
- `https://api.calltools.io`
- `https://api.calltools.net`
- `https://app.calltools.com/api`
- `https://calltools.com/api`

### 3. CallTools API Might Be Down

Check if CallTools is accessible.

---

## ✅ How to Fix

### Step 1: Find the Correct CallTools API URL

**Option A: Check CallTools Documentation**
- Log in to CallTools
- Go to Settings → API or Integrations
- Look for "API Endpoint" or "API URL"

**Option B: Contact CallTools Support**
- Ask: "What is the correct API base URL for making API calls?"

**Option C: Check Your CallTools Account**
- The API URL might be in your account settings

### Step 2: Update the Worker

Once you have the correct URL, update it:

```bash
# Update the environment variable
wrangler secret put CALLTOOLS_BASE_URL

# Or update in Cloudflare Dashboard:
# Workers & Pages → calltools-and-gohighlevel → Settings → Variables
# Change CALLTOOLS_BASE_URL to the correct URL
```

### Step 3: Redeploy

```bash
npm run deploy
```

---

## 🧪 Test CallTools API Directly

Try calling the CallTools API directly to verify:

```bash
# Test if API is reachable
curl https://api.calltools.com/v1/buckets \
  -H "Authorization: Bearer YOUR_CALLTOOLS_API_KEY"

# If that doesn't work, try:
curl https://api.calltools.io/v1/buckets \
  -H "Authorization: Bearer YOUR_CALLTOOLS_API_KEY"
```

If you get a 401 (Unauthorized), that's actually GOOD - it means the API is reachable, just needs proper auth.

If you get no response or connection error, the URL is wrong.

---

## 📋 What to Check

1. **CallTools API URL** - Get the correct one from CallTools
2. **CallTools API Key** - Make sure it's valid
3. **API Key Permissions** - Ensure it has permission to:
   - Create/read buckets
   - Create/update contacts

---

## 🆘 Need Help?

**Tell me:**
1. What is the correct CallTools API URL? (Check your CallTools account)
2. Does CallTools have API documentation you can share?
3. Can you test the API URL with curl?

Once we have the correct URL, I'll update the configuration!