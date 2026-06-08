# Auto Insurance Line

## Overview

The GoHighLevel → CallTools integration now supports multiple **insurance lines
(verticals)**. Each line routes its cold leads and active clients to its own
CallTools bucket and applies its own tags, so campaigns stay isolated.

This mirrors the existing **ACA / Health Insurance** flow and adds a parallel
**Auto Insurance** flow.

| Line | Cold lead bucket | Active client bucket | Cold lead tag | Active client tag |
|------|------------------|----------------------|---------------|-------------------|
| ACA / Health | `ACA_COLD_LEADS_BUCKET_ID` (default `11237`) | `ACA_ACTIVE_CLIENTS_BUCKET_ID` (default `11252`) | `ACA Cold lead` | `ACA Active client` |
| Auto | `AUTO_COLD_LEADS_BUCKET_ID` | `AUTO_ACTIVE_CLIENTS_BUCKET_ID` | `Auto Cold lead` | `Auto Active client` |

## How a contact is routed

When a contact is received (via webhook, workflow, or batch sync) its
GoHighLevel tags are inspected by `matchInsuranceLine()`:

1. **Active client check (highest priority).** If a tag exactly matches a
   line's active-client tags, the contact is treated as an active client for
   that line.
2. **Generic customer exclusion.** Contacts tagged `customer` / `won` /
   `purchased` (and not active for a line) are marked as customers and skipped.
3. **Cold lead check.** If a tag contains one of a line's cold-lead fragments,
   the contact is synced as a cold lead for that line.

Lines are evaluated **Auto before ACA** because Auto tags (e.g.
`auto cold lead`) also contain the generic word `cold` that the ACA line
matches. Evaluating Auto first prevents Auto leads from being swept into the ACA
bucket.

### GoHighLevel tags that trigger the Auto line

| Intent | Example GoHighLevel tags (case-insensitive) |
|--------|---------------------------------------------|
| Auto cold lead | `Auto Cold lead`, `Auto cold`, `Auto lead`, `Auto prospect`, `Auto new lead`, `Auto insurance` |
| Auto active client | `Auto Active 2025`, `Auto Active 2026`, `Auto Active client` |

### What happens in CallTools

**Auto cold lead:**
- Creates/updates the contact in CallTools
- Adds it to the **Auto cold leads** bucket
- Applies the **`Auto Cold lead`** tag

**Auto active client:**
- Creates/updates the contact in CallTools
- Adds it to the **Auto active clients** bucket
- Removes it from the **Auto cold leads** bucket (if present)
- Applies the **`Auto Active client`** tag and removes **`Auto Cold lead`**
- Marks the contact as a customer in the database

## Configuration

Set the Auto bucket IDs so the line is active. Until both are set, Auto contacts
are skipped with a clear `No ... bucket configured for line "Auto Insurance"`
error (the ACA flow is unaffected).

### Local / `.env`

```bash
AUTO_COLD_LEADS_BUCKET_ID=<your auto cold leads bucket id>
AUTO_ACTIVE_CLIENTS_BUCKET_ID=<your auto active clients bucket id>
```

### Cloudflare Worker

These are plain (non-secret) vars, set in `wrangler.jsonc`:

```jsonc
"vars": {
  "AUTO_COLD_LEADS_BUCKET_ID": "12345",
  "AUTO_ACTIVE_CLIENTS_BUCKET_ID": "12346"
}
```

Find the bucket IDs in CallTools (Lists / Buckets) or via the API
`GET /api/lists/`. Create two new buckets first, e.g. "Auto Cold Leads" and
"Auto Active Clients".

## GoHighLevel workflow setup

Reuse the same webhook endpoint as ACA (`/webhook/ghl-workflow` or
`/webhook/ghl`). Create workflows that fire when an Auto tag is added:

1. **Trigger:** Contact Tag Added → tag is `Auto Cold lead` (cold campaign) or
   `Auto Active 2025` / `Auto Active 2026` (active client).
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
