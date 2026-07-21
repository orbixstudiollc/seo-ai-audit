import { fetchArticle } from "@/lib/import";
import type { HreflangSkillResult } from "./types";

/**
 * Hreflang validation — $0, deterministic (seo-hreflang SKILL.md v2.2.4).
 * Regex-parses `<link rel="alternate" hreflang… href…>` tags (tolerant of
 * attribute order) and runs the seven checks the rubric calls out.
 */

// ISO 639-1 (two-letter language codes), current officially assigned set.
const ISO_639_1 = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
    "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz " +
    "ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv " +
    "mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw " +
    "sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz " +
    "ve vi vo wa wo xh yi yo za zh zu"
  ).split(" "),
);

// ISO 3166-1 alpha-2 (two-letter region codes), current officially assigned set.
const ISO_3166_1 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET " +
    "FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU " +
    "ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ " +
    "LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA " +
    "RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

export interface HreflangTag {
  hreflang: string;
  href: string;
}

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const REL_ALTERNATE_RE = /rel\s*=\s*["']alternate["']/i;
const REL_CANONICAL_RE = /rel\s*=\s*["']canonical["']/i;
const HREFLANG_ATTR_RE = /hreflang\s*=\s*["']([^"']+)["']/i;
const HREF_ATTR_RE = /href\s*=\s*["']([^"']*)["']/i;

/** Every `<link rel="alternate" hreflang… href…>` tag on the page. */
export function extractHreflangTags(html: string): HreflangTag[] {
  const tags: HreflangTag[] = [];
  for (const tagMatch of html.matchAll(LINK_TAG_RE)) {
    const tag = tagMatch[0];
    if (!REL_ALTERNATE_RE.test(tag)) continue;
    const hreflangMatch = HREFLANG_ATTR_RE.exec(tag);
    const hrefMatch = HREF_ATTR_RE.exec(tag);
    if (!hreflangMatch || !hrefMatch) continue;
    tags.push({ hreflang: hreflangMatch[1] ?? "", href: hrefMatch[1] ?? "" });
  }
  return tags;
}

/** The page's `<link rel="canonical">` href, or null if absent. */
export function extractCanonical(html: string): string | null {
  for (const tagMatch of html.matchAll(LINK_TAG_RE)) {
    const tag = tagMatch[0];
    if (!REL_CANONICAL_RE.test(tag)) continue;
    const hrefMatch = HREF_ATTR_RE.exec(tag);
    if (hrefMatch) return hrefMatch[1] ?? null;
  }
  return null;
}

/** `language[-Script][-REGION]` against ISO 639-1 + ISO 3166-1, or `x-default`. */
export function isValidHreflangCode(code: string): boolean {
  const trimmed = code.trim();
  if (trimmed.toLowerCase() === "x-default") return true;
  const parts = trimmed.split("-");
  const lang = (parts[0] ?? "").toLowerCase();
  if (!ISO_639_1.has(lang)) return false;
  let idx = 1;
  // Optional ISO 15924 script subtag (4 letters) — not validated against a
  // script list, only its shape, since the rubric only calls out lang/region.
  if (parts[idx] && /^[A-Za-z]{4}$/.test(parts[idx])) idx += 1;
  if (idx === parts.length) return true;
  if (idx === parts.length - 1) return ISO_3166_1.has((parts[idx] ?? "").toUpperCase());
  return false; // trailing extra subtags this rubric doesn't cover
}

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function isAbsoluteUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface HreflangCheck {
  code: string;
  pass: boolean;
  detail: string;
  urls: string[];
}

function checkValidCodes(tags: HreflangTag[]): HreflangCheck {
  const invalid = tags.filter((t) => !isValidHreflangCode(t.hreflang));
  return {
    code: "valid-codes",
    pass: invalid.length === 0,
    detail:
      invalid.length === 0
        ? "All hreflang codes are valid ISO 639-1/3166-1 (or x-default)"
        : `${invalid.length} invalid hreflang code(s): ${invalid.map((t) => t.hreflang).join(", ")}`,
    urls: invalid.map((t) => t.href),
  };
}

function checkSelfReference(tags: HreflangTag[], finalUrl: string): HreflangCheck {
  const pass = tags.some((t) => normalizeUrl(t.href) === normalizeUrl(finalUrl));
  return {
    code: "self-reference",
    pass,
    detail: pass ? "A self-referencing hreflang tag is present" : "No hreflang tag points back to this page",
    urls: pass ? [] : [finalUrl],
  };
}

function checkXDefault(tags: HreflangTag[]): HreflangCheck {
  const pass = tags.some((t) => t.hreflang.toLowerCase() === "x-default");
  return {
    code: "x-default",
    pass,
    detail: pass ? "x-default fallback is present" : "No x-default tag found",
    urls: [],
  };
}

function checkAbsoluteUrls(tags: HreflangTag[]): HreflangCheck {
  const invalid = tags.filter((t) => !isAbsoluteUrl(t.href));
  return {
    code: "absolute-urls",
    pass: invalid.length === 0,
    detail: invalid.length === 0 ? "All hreflang hrefs are absolute" : `${invalid.length} relative or invalid href(s)`,
    urls: invalid.map((t) => t.href),
  };
}

function checkProtocolConsistent(tags: HreflangTag[]): HreflangCheck {
  const protocols = new Set(
    tags.filter((t) => isAbsoluteUrl(t.href)).map((t) => new URL(t.href).protocol),
  );
  const pass = protocols.size <= 1;
  return {
    code: "protocol-consistent",
    pass,
    detail: pass ? "All hreflang URLs share one protocol" : "Mixed http:// and https:// URLs across the hreflang set",
    urls: pass ? [] : tags.filter((t) => isAbsoluteUrl(t.href)).map((t) => t.href),
  };
}

function checkCanonicalAlignment(tags: HreflangTag[], finalUrl: string, canonical: string | null): HreflangCheck {
  if (canonical === null) {
    return { code: "canonical-alignment", pass: true, detail: "No canonical tag found on the page", urls: [] };
  }
  const selfTag = tags.find((t) => normalizeUrl(t.href) === normalizeUrl(finalUrl));
  if (!selfTag) {
    return {
      code: "canonical-alignment",
      pass: false,
      detail: "No self-referencing hreflang tag to compare against the canonical URL",
      urls: [canonical],
    };
  }
  const pass = normalizeUrl(selfTag.href) === normalizeUrl(canonical);
  return {
    code: "canonical-alignment",
    pass,
    detail: pass ? "Self-referencing hreflang matches the canonical URL" : "Self-referencing hreflang does not match the canonical URL",
    urls: pass ? [] : [canonical],
  };
}

const MAX_RECIPROCAL_SAMPLES = 5;

async function checkReciprocal(tags: HreflangTag[], finalUrl: string): Promise<HreflangCheck> {
  const others = tags.filter((t) => normalizeUrl(t.href) !== normalizeUrl(finalUrl));
  if (others.length === 0) {
    return { code: "reciprocal", pass: true, detail: "not checked", urls: [] };
  }

  const sample = others.slice(0, MAX_RECIPROCAL_SAMPLES);
  const missing: string[] = [];
  for (const alt of sample) {
    try {
      const altFetched = await fetchArticle(alt.href);
      const altTags = extractHreflangTags(altFetched.html);
      const linksBack = altTags.some((t) => normalizeUrl(t.href) === normalizeUrl(finalUrl));
      if (!linksBack) missing.push(alt.href);
    } catch {
      missing.push(alt.href); // unreachable alternate — can't confirm reciprocity
    }
  }
  return {
    code: "reciprocal",
    pass: missing.length === 0,
    detail:
      missing.length === 0
        ? `All ${sample.length} sampled alternate(s) link back`
        : `${missing.length} of ${sample.length} sampled alternate(s) do not link back`,
    urls: missing,
  };
}

export async function runHreflang(url: string): Promise<HreflangSkillResult> {
  const fetched = await fetchArticle(url);
  const tags = extractHreflangTags(fetched.html);
  const canonical = extractCanonical(fetched.html);

  const checks: HreflangCheck[] = [
    checkValidCodes(tags),
    checkSelfReference(tags, fetched.finalUrl),
    checkXDefault(tags),
    checkAbsoluteUrls(tags),
    checkProtocolConsistent(tags),
    checkCanonicalAlignment(tags, fetched.finalUrl, canonical),
    await checkReciprocal(tags, fetched.finalUrl),
  ];

  return { tags, checks };
}
