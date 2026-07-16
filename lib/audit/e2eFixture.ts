/**
 * Shared e2e fixture strings — kept dependency-free so both the app-layer mock
 * model (lib/audit/testModel.ts, which imports `ai/test`) and the Playwright
 * spec can import the SAME article without the spec's loader pulling in the ai
 * SDK. The mock rewrite's `before` is E2E_WEAK_INTRO verbatim, and E2E_ARTICLE
 * embeds it verbatim, so the workbench accept path applies the hunk cleanly.
 */

/** The article the e2e pastes. Its opening paragraph is E2E_WEAK_INTRO verbatim. */
export const E2E_WEAK_INTRO =
  "In today's fast-paced world there are many many considerations people weigh when they try to understand heat pumps deeply and thoroughly and this opening paragraph deliberately runs well past seventy five words while beginning with a recognised fluff opener phrase so the answer first intro signal scores low which is exactly what this journey needs in order to show the intro rewrite moving the score bar upward once the crisp answer-first replacement is accepted by the user.";

/** The answer-first replacement the mock rewrite proposes (and the e2e accepts). */
export const E2E_INTRO_AFTER =
  "A heat pump moves heat rather than making it, reaching about 300% efficiency.";

export const E2E_ARTICLE = `# Heat pumps

${E2E_WEAK_INTRO}

## What is a heat pump?

A heat pump moves heat, achieving 300% efficiency. According to the DOE it holds capacity to 5F.

## What does a heat pump cost?

A typical install runs $4,000 to $8,000, and rebates cover up to $2,000.
`;
