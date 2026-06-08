/**
 * Insurance line (vertical) configuration.
 *
 * The integration syncs contacts from GoHighLevel into CallTools. Different
 * insurance products ("lines of business") are routed to different CallTools
 * buckets and tagged differently so each campaign stays isolated.
 *
 * Each line defines:
 *  - how to detect cold leads / active clients from GoHighLevel tags
 *  - which CallTools bucket cold leads and active clients land in
 *  - which CallTools tags are applied for cold leads and active clients
 *
 * Lines are evaluated in array order, so more specific lines (e.g. Auto, whose
 * tags also contain generic words like "cold") MUST come before more generic
 * lines (ACA) to avoid mis-routing.
 */

export interface InsuranceLineConfig {
  /** Stable identifier for the line, e.g. "aca" or "auto". */
  key: string;
  /** Human friendly label used in logs / responses. */
  label: string;
  /**
   * GoHighLevel tags (lowercase) that mark a contact as an active/sold client
   * for this line. Matched exactly (case-insensitive).
   */
  activeClientTags: string[];
  /**
   * GoHighLevel tag fragments (lowercase) that mark a contact as a cold lead
   * for this line. Matched as a substring (case-insensitive).
   */
  coldLeadMatchers: string[];
  /** CallTools bucket/list ID that cold leads are added to. */
  coldLeadsBucketId: string;
  /** CallTools bucket/list ID that active clients are moved to. */
  activeClientsBucketId: string;
  /** CallTools tag applied to cold leads for this line. */
  coldLeadTag: string;
  /** CallTools tag applied to active clients for this line. */
  activeClientTag: string;
}

/**
 * Minimal shape of the environment values consumed here. Bucket IDs are
 * overridable via environment variables so they can differ per deployment
 * without code changes.
 */
export interface InsuranceLineEnv {
  ACA_COLD_LEADS_BUCKET_ID?: string;
  ACA_ACTIVE_CLIENTS_BUCKET_ID?: string;
  AUTO_COLD_LEADS_BUCKET_ID?: string;
  AUTO_ACTIVE_CLIENTS_BUCKET_ID?: string;
}

function pick(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Build the list of insurance lines for the current environment.
 *
 * NOTE: order matters. Auto is listed first because its cold-lead tags (e.g.
 * "auto cold lead") also contain generic words like "cold" that the ACA line
 * matches. Evaluating Auto first guarantees Auto contacts are not swept into
 * the ACA bucket.
 */
export function getInsuranceLines(env: InsuranceLineEnv): InsuranceLineConfig[] {
  return [
    {
      key: 'auto',
      label: 'Auto Insurance',
      activeClientTags: ['auto active 2025', 'auto active 2026', 'auto active client'],
      coldLeadMatchers: [
        'auto cold lead',
        'auto cold',
        'auto lead',
        'auto prospect',
        'auto insurance',
        'auto new lead',
      ],
      // Configure these via env vars; no safe default exists for Auto buckets.
      coldLeadsBucketId: pick(env.AUTO_COLD_LEADS_BUCKET_ID, ''),
      activeClientsBucketId: pick(env.AUTO_ACTIVE_CLIENTS_BUCKET_ID, ''),
      coldLeadTag: 'Auto Cold lead',
      activeClientTag: 'Auto Active client',
    },
    {
      key: 'aca',
      label: 'ACA / Health Insurance',
      activeClientTags: ['aca active 2025', 'aca active 2026', 'aca active client'],
      coldLeadMatchers: ['cold lead', 'cold', 'new lead', 'prospect'],
      // Preserve the historical hardcoded ACA bucket IDs as defaults.
      coldLeadsBucketId: pick(env.ACA_COLD_LEADS_BUCKET_ID, '11237'),
      activeClientsBucketId: pick(env.ACA_ACTIVE_CLIENTS_BUCKET_ID, '11252'),
      coldLeadTag: 'ACA Cold lead',
      activeClientTag: 'ACA Active client',
    },
  ];
}

export type MatchType = 'active' | 'cold';

export interface LineMatch {
  line: InsuranceLineConfig;
  type: MatchType;
}

/**
 * Determine which insurance line (and whether cold/active) a set of GoHighLevel
 * tags belongs to.
 *
 * Active-client detection takes priority over cold-lead detection, and lines
 * are evaluated in the order returned by {@link getInsuranceLines}.
 */
export function matchInsuranceLine(
  tags: string[],
  lines: InsuranceLineConfig[]
): LineMatch | null {
  const lowerTags = tags.map((t) => t.toLowerCase().trim());

  // 1. Active clients first (exact tag match) across all lines.
  for (const line of lines) {
    const isActive = lowerTags.some((tag) => line.activeClientTags.includes(tag));
    if (isActive) {
      return { line, type: 'active' };
    }
  }

  // 2. Cold leads (substring match) in line priority order.
  for (const line of lines) {
    const isCold = lowerTags.some((tag) =>
      line.coldLeadMatchers.some((matcher) => tag.includes(matcher))
    );
    if (isCold) {
      return { line, type: 'cold' };
    }
  }

  return null;
}
