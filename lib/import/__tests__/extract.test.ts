import { describe, expect, it } from "vitest";
import { computeParsedDocument } from "@aeo/scoring";
import { ImportError } from "../errors";
import { extractArticle } from "../extract";

// A realistic article page: boilerplate chrome around long-enough body copy
// (Readability's default charThreshold is 500 chars of real content).
const FIXTURE_URL = "https://blog.example.com/answer-first-writing";
const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Answer-First Writing for AI Search | Example Blog</title>
  <meta name="description" content="How answer-first intros change AI citability.">
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav>
  <div class="sidebar"><h3>Popular posts</h3><ul><li><a href="/one">One</a></li></ul></div>
  <article>
    <h1>Answer-First Writing for AI Search</h1>
    <p>Answer-first writing means putting the direct answer to your reader's question in the
    first three sentences of the article, before any context or storytelling. Large language
    models that assemble AI search results overwhelmingly quote passages that resolve a query
    immediately, so an article that buries its answer under four paragraphs of preamble is
    an article that never gets cited, no matter how good the underlying research happens to be.</p>
    <h2>How answer-first intros change citability</h2>
    <p>When a model retrieves candidate passages, it scores each one for how completely it
    resolves the user's question on its own. A self-contained paragraph of forty to sixty
    words that names the entity, states the fact, and includes one concrete number is the
    single most extractable unit of text you can produce. According to a 2025 analysis of
    12,000 AI Overview citations, pages with answer-first intros were cited 3.4 times more
    often than pages with narrative intros covering identical topics.</p>
    <h2>What to do in practice</h2>
    <p>Rewrite your introduction so the core claim lands within the first 25 words. Follow it
    with one sentence of evidence and one sentence of scope. Then use question-shaped H2
    headings, and open every section with the answer to its own heading. Keep sections between
    100 and 300 words so retrieval systems can chunk them cleanly without splitting ideas.</p>
    <ul>
      <li>State the answer in sentence one, with a number if you have one.</li>
      <li>Make each H2 a question your readers actually ask.</li>
      <li>Open each section with a 40-60 word extractable summary paragraph.</li>
    </ul>
    <p>Relative links like <a href="/guides/schema">our schema guide</a> should survive
    extraction, and so should external citations like
    <a href="https://research.example.org/aio-study">the AIO citation study</a>.</p>
  </article>
  <footer><p>© 2026 Example Blog. All rights reserved.</p></footer>
</body>
</html>`;

describe("extractArticle", () => {
  it("extracts title, content, excerpt and word count from a real page", () => {
    const article = extractArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.title).toContain("Answer-First Writing");
    expect(article.contentHtml).toContain("<p");
    expect(article.contentHtml).toContain("answer-first intros");
    expect(article.excerpt.length).toBeGreaterThan(0);
    expect(article.wordCount).toBeGreaterThan(200);
  });

  it("strips page chrome (nav/sidebar/footer) from the extracted content", () => {
    const article = extractArticle(FIXTURE_HTML, FIXTURE_URL);
    expect(article.contentHtml).not.toContain("Popular posts");
    expect(article.contentHtml).not.toContain("All rights reserved");
  });

  it("produces contentHtml that @aeo/scoring computeParsedDocument can parse", () => {
    const article = extractArticle(FIXTURE_HTML, FIXTURE_URL);
    const parsed = computeParsedDocument(article.contentHtml, true);
    expect(parsed.wordCount).toBeGreaterThan(200);
    expect(parsed.plainText).toContain("answer-first intros");
    expect(
      parsed.headings.some((h) => h.text.includes("How answer-first intros change citability")),
    ).toBe(true);
  });

  it("throws a paste-fallback ImportError when no article is extractable", () => {
    let caught: unknown;
    try {
      extractArticle("<html><head><title>x</title></head><body></body></html>", FIXTURE_URL);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ImportError);
    expect(caught).toMatchObject({
      kind: "not_html",
      message: expect.stringContaining("paste the article text"),
    });
  });
});
