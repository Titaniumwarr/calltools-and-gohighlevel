# Auto Insurance Line

## Overview

The GoHighLevel → CallTools integration now supports multiple **insurance lines
(verticals)**. Each line routes its cold leads and active clients to its own
CallTools bucket and applies its own tags, so campaigns stay isolated.

This mirrors the existing **ACA / Health Insurance** flow and adds a parallel
**Auto Insurance** flow. Auto additionally has a **Hot Leads** tier (an engaged
lead that isn't sold yet), so a contact progresses **cold → hot → active**.

### CallTools buckets

| Line | Tier | Bucket | Default ID | CallTools tag |
|------|------|--------|-----------|---------------|
| ACA / Health | Cold | `ACA_COLD_LEADS_BUCKET_ID` | `11237` | `ACA Cold lead` |
| ACA / Health | Active | `ACA_ACTIVE_CLIENTS_BUCKET_ID` | `11252` | `ACA Active client` |
| Auto | Cold | `AUTO_COLD_LEADS_BUCKET_ID` | `11880` (Auto Insurance Cold Leads) | `Auto Cold lead` |
| Auto | Hot | `AUTO_HOT_LEADS_BUCKET_ID` | `11879` (Auto Insurance Hot Leads) | `Auto Hot lead` |
| Auto | Active | `AUTO_ACTIVE_CLIENTS_BUCKET_ID` | `11881` (Auto Active Clients) | `Auto Active client` |

## How a contact is routed

When a contact is received (via webhook, workflow, or batch sync) its
GoHighLevel tags are inspected by `matchInsuranceLine()`:

1. **Active client check (highest priority).** If a tag exactly matches a
   line's active-client tags, the contact is treated as an active client.
2. **Hot lead check.** If a tag contains one of a line's hot-lead fragments
   (only lines with a hot tier, i.e. Auto), the contact is promoted to the hot
   bucket.
3. **Generic customer exclusion.** Contacts tagged `customer` / `won` /
   `purchased` (and not active/hot for a line) are marked as customers and skipped.
4. **Cold lead check.** If a tag contains one of a line's cold-lead fragments,
   the contact is synced as a cold lead for that line.

When a contact is promoted to a higher tier, it is added to that tier's bucket
and tag and **removed from all lower-tier buckets/tags** (e.g. a hot lead is
removed from the cold bucket; an active client is removed from both cold and hot
buckets). Active clients are marked as customers; hot leads are not.

Lines are evaluated **Auto before ACA** because Auto tags (e.g.
`auto cold lead`) also contain the generic word `cold` that the ACA line
matches. Evaluating Auto first prevents Auto leads from being swept into the ACA
bucket.

### GoHighLevel tags that trigger the Auto line

| Intent | Example GoHighLevel tags (case-insensitive) |
|--------|---------------------------------------------|
| Auto cold lead | `Auto Cold lead`, `Auto cold`, `Auto lead`, `Auto prospect`, `Auto new lead`, `Auto insurance` |
| Auto hot lead | `Auto Hot lead`, `Auto hot`, `Auto warm` |
| Auto active client | `Auto Active 2025`, `Auto Active 2026`, `Auto Active client` |

### What happens in CallTools

**Auto cold lead:**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Insurance Cold Leads** bucket (`11880`)
- Applies the **`Auto Cold lead`** tag

**Auto hot lead:**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Insurance Hot Leads** bucket (`11879`)
- Removes it from the **Cold Leads** bucket (if present)
- Applies the **`Auto Hot lead`** tag and removes **`Auto Cold lead`**

**Auto active client:**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Active Clients** bucket (`11881`)
- Removes it from the **Cold Leads** and **Hot Leads** buckets (if present)
- Applies the **`Auto Active client`** tag and removes **`Auto Cold lead`** / **`Auto Hot lead`**
- Marks the contact as a customer in the database

## Configuration

The Auto bucket IDs are configured out of the box with the real CallTools
buckets (cold `11880`, hot `11879`, active `11881`). They can be overridden per
deployment via env vars. If a required bucket is missing, that contact is
skipped with a clear `No ... bucket configured for line "Auto Insurance"` error
(the ACA flow is unaffected).

### Cloudflare Worker (`wrangler.jsonc`)

These are plain (non-secret) vars:

```jsonc
"vars": {
  "AUTO_COLD_LEADS_BUCKET_ID": "11880",
  "AUTO_HOT_LEADS_BUCKET_ID": "11879",
  "AUTO_ACTIVE_CLIENTS_BUCKET_ID": "11881"
}
```

Find bucket IDs in CallTools (Lists / Buckets) or via `GET /api/lists/`.

## GoHighLevel workflow setup

Reuse the same webhook endpoint as ACA (`/webhook/ghl-workflow` or
`/webhook/ghl`). Create workflows that fire when an Auto tag is added:

1. **Trigger:** Contact Tag Added → tag is `Auto Cold lead` (cold campaign),
   `Auto Hot lead` (hot campaign), or `Auto Active 2025` / `Auto Active 2026`
   (active client).
2. **Action:** HTTP POST to your worker webhook URL with body:

```json
{
  "contact_id": "{{contact.id}}"
}
```

The integration reads the contact's tags and routes it to the correct Auto
bucket automatically.

## Adding more lines later

The line definitions live in
[`src/config/insuranceLines.ts`](./src/config/insuranceLines.ts). To add another
vertical (e.g. Life, Medicare), add a new entry to `getInsuranceLines()` with
its detection tags, bucket IDs, and CallTools tags. No changes to the sync
service are required.

## Related Documentation

- [ACTIVE_CLIENTS_FEATURE.md](./ACTIVE_CLIENTS_FEATURE.md) - ACA active clients
- [BUCKET_FEATURE.md](./BUCKET_FEATURE.md) - Cold Leads bucket details
- [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) - Webhook configuration
