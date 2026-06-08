/**
 * Insurance line (vertical) configuration.
 *
 * The integration syncs contacts from GoHighLevel into CallTools. Different
 * insurance products ("lines of business") are routed to different CallTools
 * buckets and tagged differently so each campaign stays isolated.
 *
 * Each line declares a set of "states" (cold lead, hot lead, active client).
 * A state is triggered by GoHighLevel tags and, when matched, the contact is:
 *   - added to that state's CallTools bucket + tag
 *   - removed from the buckets/tags listed in `removeBucketIds` / `removeTags`
 *
 * This explicit add/remove model lets each tag do exactly what the business
 * wants (e.g. "cold removes from hot"), without assuming a fixed tier ordering.
 *
 * Lines are evaluated so that more specific lines (Auto, whose tags contain
 * generic words like "cold") win over generic lines (ACA) at the same state
 * priority.
 */

export type StateName = 'cold' | 'hot' | 'active';

/**
 * Detection/priority ordering when a contact matches more than one state.
 * Lower number = higher priority. A contact that has accumulated several tags
 * resolves to the highest priority state, so: active > hot > cold.
 *
 * Hot beats cold so that a lead showing renewed buying intent (hot) is not
 * pulled back into the cold bucket just because an old cold tag is still
 * present. To move a lead back to cold, remove the hot tag in GoHighLevel.
 */
export const STATE_PRIORITY: Record<StateName, number> = {
  active: 0,
  hot: 1,
  cold: 2,
};

export interface LineState {
  /** Which tier this state represents. */
  name: StateName;
  /**
   * GoHighLevel tag fragments (will be normalized) that trigger this state.
   * Matched as a normalized substring (case/dash/space insensitive).
   */
  matchers: string[];
  /** CallTools bucket/list ID the contact is added to. */
  bucketId: string;
  /** CallTools tag applied to the contact. */
  tag: string;
  /** CallTools bucket/list IDs the contact is removed from. */
  removeBucketIds: string[];
  /** CallTools tags removed from the contact. */
  removeTags: string[];
  /** Whether reaching this state marks the contact as a customer (excluded from cold syncs). */
  isCustomer: boolean;
}

export interface InsuranceLineConfig {
  /** Stable identifier for the line, e.g. "aca" or "auto". */
  key: string;
  /** Human friendly label used in logs / responses. */
  label: string;
  /** The states (tiers) this line supports. */
  states: LineState[];
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
  AUTO_HOT_LEADS_BUCKET_ID?: string;
  AUTO_ACTIVE_CLIENTS_BUCKET_ID?: string;
}

function pick(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Normalize a tag (or matcher) for comparison: lowercase, convert en/em dashes
 * to a plain hyphen, and collapse runs of whitespace. Underscores are kept so
 * tags like `cold_lead_auto` match exactly.
 */
export function normalizeTag(tag: string): string {
  return String(tag)
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-') // figure/en/em/horizontal dashes -> hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the list of insurance lines for the current environment.
 *
 * NOTE: Auto is listed before ACA so that Auto tags (which contain generic
 * words like "cold") are routed to Auto buckets rather than ACA.
 */
export function getInsuranceLines(env: InsuranceLineEnv): InsuranceLineConfig[] {
  const autoCold = pick(env.AUTO_COLD_LEADS_BUCKET_ID, '11880');
  const autoHot = pick(env.AUTO_HOT_LEADS_BUCKET_ID, '11879');
  const autoActive = pick(env.AUTO_ACTIVE_CLIENTS_BUCKET_ID, '11881');

  const acaCold = pick(env.ACA_COLD_LEADS_BUCKET_ID, '11237');
  const acaActive = pick(env.ACA_ACTIVE_CLIENTS_BUCKET_ID, '11252');

  return [
    {
      key: 'auto',
      label: 'Auto Insurance',
      states: [
        {
          name: 'hot',
          // GHL trigger tag(s): "auto – autoquote click" or "Auto Insurance Hot Leads"
          matchers: [
            'auto - autoquote click',
            'autoquote click',
            'autoquote',
            'auto insurance hot leads',
            'auto insurance hot',
          ],
          bucketId: autoHot,
          // CallTools tag (id 142724)
          tag: 'Auto Insurance Hot Leads',
          // Leads can move cold <-> hot, so going hot removes the cold bucket/tag.
          removeBucketIds: [autoCold],
          removeTags: ['Auto Insurance Cold Leads'],
          isCustomer: false,
        },
        {
          name: 'cold',
          // GHL trigger tag(s): "cold_lead_auto" or "Auto Insurance Cold Leads"
          matchers: [
            'cold_lead_auto',
            'cold lead auto',
            'auto insurance cold leads',
            'auto insurance cold',
          ],
          bucketId: autoCold,
          // CallTools tag (id 142725)
          tag: 'Auto Insurance Cold Leads',
          // Adding to cold removes the contact from the hot bucket/tag.
          removeBucketIds: [autoHot],
          removeTags: ['Auto Insurance Hot Leads'],
          isCustomer: false,
        },
        {
          name: 'active',
          // GHL trigger tag: "auto – active"
          matchers: ['auto - active', 'auto active', 'auto active client', 'auto active 2025', 'auto active 2026'],
          bucketId: autoActive,
          // CallTools tag (id 142754) - note the en-dash to match the existing tag
          tag: 'auto – active',
          // Active removes the contact from both cold and hot.
          removeBucketIds: [autoCold, autoHot],
          removeTags: ['Auto Insurance Cold Leads', 'Auto Insurance Hot Leads'],
          isCustomer: true,
        },
      ],
    },
    {
      key: 'aca',
      label: 'ACA / Health Insurance',
      states: [
        {
          name: 'cold',
          matchers: ['cold lead', 'cold', 'new lead', 'prospect'],
          bucketId: acaCold,
          // CallTools tag (id 128365)
          tag: 'ACA Cold Lead',
          removeBucketIds: [],
          removeTags: [],
          isCustomer: false,
        },
        {
          name: 'active',
          matchers: ['aca active 2025', 'aca active 2026', 'aca active client'],
          bucketId: acaActive,
          // CallTools tag (id 129315)
          tag: 'ACA Active Client',
          removeBucketIds: [acaCold],
          removeTags: ['ACA Cold Lead'],
          isCustomer: true,
        },
      ],
    },
  ];
}

export interface LineMatch {
  line: InsuranceLineConfig;
  state: LineState;
}

/**
 * Determine which insurance line + state a set of GoHighLevel tags maps to.
 *
 * If multiple states match (e.g. accumulated tags), the highest priority state
 * wins (active > hot > cold). Ties are broken by line order, so Auto beats ACA.
 */
export function matchInsuranceLine(
  tags: string[],
  lines: InsuranceLineConfig[]
): LineMatch | null {
  const normalizedTags = tags.map(normalizeTag).filter((t) => t.length > 0);

  let best: LineMatch | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  lines.forEach((line, lineIndex) => {
    for (const state of line.states) {
      const matched = normalizedTags.some((tag) =>
        state.matchers.some((matcher) => tag.includes(normalizeTag(matcher)))
      );
      if (!matched) {
        continue;
      }
      // Composite rank: state priority dominates, line order is the tie-breaker.
      const rank = STATE_PRIORITY[state.name] * 100 + lineIndex;
      if (rank < bestRank) {
        bestRank = rank;
        best = { line, state };
      }
    }
  });

  return best;
}
