# CallTools API ↔ Live Filters: Integration Audit

This documents what our GoHighLevel → CallTools integration can and cannot do
with respect to CallTools **Live Filters**, based on the CallTools developer
docs and our current client (`src/clients/calltools.ts`).

## TL;DR

- **Live Filters are configured in the CallTools UI**, not through the API.
  (Contact Center → Campaigns → Live Filters.) They are IF/THEN rule sets that
  dynamically decide which contacts are dialable, refreshing ~every 15 minutes,
  up to 20 active filters.
- **The API cannot create or manage Live Filters.** Per CallTools API
  conventions: *"you cannot manage Live Filters directly via the API, but you
  can filter API data results using the same fields available in the platform."*
- **Our leverage is the data we push in.** Live Filters segment on bucket/list
  membership, tags, contact status, dispositions, and custom field values — all
  of which we (the integration) populate. So the way to "do more with Live
  Filters" is to feed CallTools richer, well-structured data, then build the
  matching Live Filters once in the UI.

## What Live Filters can segment on

Live Filters build dialer queues using IF/THEN rules over:

- **Lists/Buckets** (include/exclude) — e.g. our `Auto Insurance Hot Leads`,
  `Auto Insurance Cold Leads`, `Auto Active Clients` buckets.
- **Tags** — e.g. `Auto Hot lead`, `Auto Cold lead`, `Auto Active client`.
- **Contact status / disposition** — call outcomes set by agents/dialer.
- **Custom field values** — any custom contact fields defined in the account.
- **Compliance** — DNC (FDNC) suppression, State calling hours, Holidays,
  Time-Zone protection, and callback (True/False) logic.

## What our integration already feeds (usable by Live Filters today)

From `src/clients/calltools.ts` + `src/services/contactSyncService.ts`:

- **Bucket membership** — contacts are added to the correct line/state bucket
  and removed from the others (cold ↔ hot ↔ active). ✔
- **Tags** — line/state tags are added and the opposing tags removed. ✔
- **Core fields** — `first_name`, `last_name`, `mobile_phone_number`,
  `personal_email_address`. ✔

This is already enough to build solid Live Filters (see below).

## Recommended Live Filters to configure in CallTools (UI)

Create these once in the UI; our integration keeps the bucket/tag membership
accurate so the queues stay correct automatically.

| Live Filter | Include | Exclude | Compliance |
|-------------|---------|---------|------------|
| **Auto – Hot Queue** | bucket `Auto Insurance Hot Leads` (11879) | `Auto Active Clients` (11881) | FDNC + State hours + Time-zone |
| **Auto – Cold Queue** | bucket `Auto Insurance Cold Leads` (11880) | Hot (11879), Active (11881) | FDNC + State hours + Time-zone |
| **Auto – Active (service)** | bucket `Auto Active Clients` (11881) | — | Time-zone |
| **ACA – Cold Queue** | bucket `Cold Leads` (11237) | `ACA Active clients` (11252) | FDNC + State hours + Time-zone |
| **ACA – Active** | bucket `ACA Active clients` (11252) | — | Time-zone |

Because hot/cold/active membership is mutually exclusive in our sync, the
"Exclude" rules are mostly belt-and-suspenders, but they protect against any
contact that briefly carries two tags between webhook events.

## Optional enhancement: push custom fields for richer filtering

Today we only send name/phone/email. If you want Live Filters (and reporting)
to segment on more than bucket/tag, we can also write **custom contact fields**.
Useful candidates:

| Field (suggested slug) | Example value | Enables Live Filter like… |
|------------------------|---------------|---------------------------|
| `insurance_line` | `auto` / `aca` | "only Auto leads" |
| `lead_state` | `hot` / `cold` / `active` | "hot leads updated today" |
| `lead_source` | `ghl` / campaign name | source-based queues |
| `ghl_contact_id` | GHL id | dedupe / write-back to GHL |
| `state_changed_at` | `YYYY-MM-DD HH:MM:SS` (UTC) | "went hot in last 24h" |

Requirements / caveats before implementing:
- **Custom fields must first be created in the CallTools account** (by
  name/slug). The API writes to existing fields; unknown fields are ignored.
- Date/datetime custom fields must use `YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`.
  User-entered date fields are treated as naive/local (not UTC).
- Our `CallToolsContact` type already has a `custom_fields` slot, so wiring this
  is small once the field slugs are known.

If you create those fields in CallTools and share the exact slugs, the
integration can start populating them on every sync.

## API conventions — our client is compliant

Verified against https://calltools.com/developers/api-conventions/:

- **Auth**: `Authorization: Token {key}` ✔ (we use this)
- **Trailing slash** on endpoints (`/api/contacts/`, `/api/buckets/{id}/`,
  `/api/alltags/`) ✔
- **Silo subdomain**: we use `https://east-1.calltools.io` ✔ (CallTools is
  sharded into per-client `*.calltools.io` silos; ours is `east-1`)
- **JSON** request bodies ✔
- **Filtering** via query params (we use `?phone_number=` and `?name=`) ✔

### Things to watch

- **Rate limit: 1000 requests/hour per API key.** A single active-client sync
  makes several calls (search + update + add bucket + add tag + N× remove
  bucket/tag, and each tag op is a GET + PATCH). High webhook volume could
  approach the limit; consider batching or backoff if you scale up.
- **Paging defaults to 25, max 250** (`?page_size=max`). Not an issue for our
  current phone-number lookups, but relevant if we ever list all
  buckets/contacts.
- **Bulk delete** is available on `/api/contacts/` with query-param filters —
  powerful but dangerous (no filter = deletes everything). We don't use it.

## Bottom line

We don't (and can't) build Live Filters from code. The integration's job is to
keep CallTools' **buckets, tags, and (optionally) custom fields** accurate and
well-structured; the Live Filters are then configured once in the CallTools UI
to turn that structure into compliant, dynamic dialer queues. Our current
bucket + tag sync is already a solid foundation; adding custom fields is the
main lever for finer-grained Live Filters.
