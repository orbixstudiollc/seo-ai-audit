import type { SkillId, SkillTask } from "@/lib/skills/types";
import { schemaMocks } from "./schema";
import { sitemapMocks } from "./sitemap";
import { hreflangMocks } from "./hreflang";
import { imagesMocks } from "./images";
import { aiAccessMocks } from "./ai-access";
import { serpMocks } from "./serp";
import { keywordsMocks } from "./keywords";
import { labsMocks } from "./labs";
import { backlinksMocks } from "./backlinks";
import { compareMocks } from "./compare";

export { schemaMocks } from "./schema";
export { sitemapMocks } from "./sitemap";
export { hreflangMocks } from "./hreflang";
export { imagesMocks } from "./images";
export { aiAccessMocks } from "./ai-access";
export { serpMocks } from "./serp";
export { keywordsMocks } from "./keywords";
export { labsMocks } from "./labs";
export { backlinksMocks } from "./backlinks";
export { compareMocks } from "./compare";

/** Every skill's mocks, keyed by skillId — the source /dev/mock-skills and the
 * structural mock tests iterate over (DATA-CONTRACT §8 mock mandate). */
export const ALL_SKILL_MOCKS: Array<{ skillId: SkillId; states: Record<string, SkillTask> }> = [
  { skillId: "schema", states: schemaMocks },
  { skillId: "sitemap", states: sitemapMocks },
  { skillId: "hreflang", states: hreflangMocks },
  { skillId: "images", states: imagesMocks },
  { skillId: "ai-access", states: aiAccessMocks },
  { skillId: "serp", states: serpMocks },
  { skillId: "keywords", states: keywordsMocks },
  { skillId: "labs", states: labsMocks },
  { skillId: "backlinks", states: backlinksMocks },
  { skillId: "compare", states: compareMocks },
];
