# Auto Insurance Line

## Overview

The GoHighLevel → CallTools integration now supports multiple **insurance lines
(verticals)**. Each line routes its cold leads and active clients to its own
CallTools bucket and applies its own tags, so campaigns stay isolated.

This mirrors the existing **ACA / Health Insurance** flow and adds a parallel
**Auto Insurance** flow with three states: **hot**, **cold**, and **active**.

### Auto Insurance: tag → bucket rules

These are the exact rules implemented for Auto:

| GoHighLevel tag added | CallTools bucket added to | Removed from |
|-----------------------|---------------------------|--------------|
| `auto – autoquote click` | **Auto Insurance Hot Leads** (`11879`) | Cold Leads (`11880`) |
| `cold_lead_auto` | **Auto Insurance Cold Leads** (`11880`) | Hot Leads (`11879`) |
| `auto – active` | **Auto Active Clients** (`11881`) | Cold Leads (`11880`) + Hot Leads (`11879`) |

Cold and Hot are mutually exclusive — a lead can move **cold ↔ hot** freely (e.g.
a cold lead that shows renewed buying intent becomes hot and leaves the cold
bucket), and going active leaves both.

The matching tag also gets a CallTools tag applied (`Auto Hot lead`,
`Auto Cold lead`, `Auto Active client`) and the removed-bucket tags are stripped.
Only `auto – active` marks the contact as a customer.

### CallTools buckets

| Line | State | Bucket | Default ID | CallTools tag |
|------|-------|--------|-----------|---------------|
| ACA / Health | Cold | `ACA_COLD_LEADS_BUCKET_ID` | `11237` | `ACA Cold lead` |
| ACA / Health | Active | `ACA_ACTIVE_CLIENTS_BUCKET_ID` | `11252` | `ACA Active client` |
| Auto | Hot | `AUTO_HOT_LEADS_BUCKET_ID` | `11879` (Auto Insurance Hot Leads) | `Auto Hot lead` |
| Auto | Cold | `AUTO_COLD_LEADS_BUCKET_ID` | `11880` (Auto Insurance Cold Leads) | `Auto Cold lead` |
| Auto | Active | `AUTO_ACTIVE_CLIENTS_BUCKET_ID` | `11881` (Auto Active Clients) | `Auto Active client` |

## How a contact is routed

When a contact is received (via webhook, workflow, or batch sync) its
GoHighLevel tags are normalized (lowercased, en/em dashes → hyphen, whitespace
collapsed) and inspected by `matchInsuranceLine()`. Each line declares states
with the tags that trigger them and the buckets/tags to add and remove.

If a contact has accumulated multiple matching tags, the **highest priority
state wins**, in the order **active > hot > cold** (ties broken by line order,
so Auto beats ACA). Hot beats cold so a lead showing renewed buying intent is
not dragged back to the cold bucket by a stale cold tag. Practical effect:

- `cold_lead_auto` only → **Cold**.
- later tagged `auto – autoquote click` (renewed intent) → **Hot**, removed from Cold.
- later tagged `auto – active` → **Active**, removed from Cold + Hot.

To move a lead from hot back to cold, remove the `auto – autoquote click` tag in
GoHighLevel (or have your workflow remove it) when adding `cold_lead_auto`.

Contacts tagged with generic `customer` / `won` / `purchased` (and not matched
as an active state) are marked as customers and skipped.

Lines are evaluated **Auto before ACA** because Auto tags can contain generic
words like `cold` that the ACA line also matches.

### GoHighLevel tags that trigger the Auto line

| State | GoHighLevel tags (case / dash / spacing insensitive) |
|-------|------------------------------------------------------|
| Auto hot lead | `auto – autoquote click` (also `autoquote click`, `autoquote`) |
| Auto cold lead | `cold_lead_auto` |
| Auto active client | `auto – active` (also `auto active`, `auto active 2025/2026`, `auto active client`) |

### What happens in CallTools

**`auto – autoquote click` (hot lead):**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Insurance Hot Leads** bucket (`11879`)
- Removes it from the **Cold Leads** bucket (`11880`) and removes the `Auto Cold lead` tag
- Applies the **`Auto Hot lead`** tag

**`cold_lead_auto` (cold lead):**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Insurance Cold Leads** bucket (`11880`)
- Removes it from the **Hot Leads** bucket (`11879`) and removes the `Auto Hot lead` tag
- Applies the **`Auto Cold lead`** tag

**`auto – active` (active client):**
- Creates/updates the contact in CallTools
- Adds it to the **Auto Active Clients** bucket (`11881`)
- Removes it from the **Cold Leads** (`11880`) and **Hot Leads** (`11879`) buckets and removes their tags
- Applies the **`Auto Active client`** tag
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

1. **Trigger:** Contact Tag Added → tag is `auto – autoquote click` (hot
   campaign), `cold_lead_auto` (cold campaign), or `auto – active` (active
   client).
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
its `states` (each state's trigger tags, target bucket/tag, and which
buckets/tags to remove). No changes to the sync service are required.

## Related Documentation

- [ACTIVE_CLIENTS_FEATURE.md](./ACTIVE_CLIENTS_FEATURE.md) - ACA active clients
- [BUCKET_FEATURE.md](./BUCKET_FEATURE.md) - Cold Leads bucket details
- [WEBHOOK_SETUP.md](./WEBHOOK_SETUP.md) - Webhook configuration
