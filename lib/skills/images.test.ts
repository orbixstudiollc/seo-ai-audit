import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchArticle: vi.fn(), safeFetchText: vi.fn() }));
vi.mock("@/lib/import", () => ({ fetchArticle: mocks.fetchArticle, safeFetchText: mocks.safeFetchText }));

import { extractImgTags, isBadFilename, runImages } from "./images";

const url = "https://example.com/page";

function article(html: string): void {
  mocks.fetchArticle.mockResolvedValue({ title: "", html, finalUrl: url });
}

beforeEach(() => {
  mocks.fetchArticle.mockReset();
  mocks.safeFetchText.mockReset();
  mocks.safeFetchText.mockResolvedValue({ finalUrl: "", status: 200, contentType: "image/jpeg", text: "x" });
});

describe("extractImgTags", () => {
  it("parses src/alt/dimensions/loading regardless of attribute order", () => {
    const html = `<img loading="lazy" src="/a.jpg" width="100" alt="A cat" height="80">`;
    expect(extractImgTags(html)).toEqual([
      { src: "/a.jpg", alt: "A cat", hasWidth: true, hasHeight: true, loading: "lazy" },
    ]);
  });

  it("returns null fields for a bare <img src>", () => {
    expect(extractImgTags(`<img src="/a.jpg">`)).toEqual([
      { src: "/a.jpg", alt: null, hasWidth: false, hasHeight: false, loading: null },
    ]);
  });

  it("returns an empty array when there are no images", () => {
    expect(extractImgTags("<html><body>no images</body></html>")).toEqual([]);
  });
});

describe("isBadFilename", () => {
  it.each(["/img/IMG_1234.jpg", "/img/screenshot.png", "/img/photo-2.webp"])("flags %s", (src) => {
    expect(isBadFilename(src)).toBe(true);
  });

  it("accepts a descriptive filename", () => {
    expect(isBadFilename("/img/blue-running-shoes.webp")).toBe(false);
  });
});

describe("runImages", () => {
  it("counts images and finds none missing alt on a clean page", async () => {
    article(`<img src="/a.jpg" alt="A descriptive cat photo" width="10" height="10">`);
    const result = await runImages(url);
    expect(result.imageCount).toBe(1);
    expect(result.missingAlt).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("reports missing alt text, resolved to an absolute url, capped at 20", async () => {
    const imgs = Array.from({ length: 25 }, (_, i) => `<img src="/img${i}.jpg">`).join("");
    article(imgs);
    const result = await runImages(url);
    expect(result.missingAlt).toHaveLength(20);
    expect(result.missingAlt[0]).toBe("https://example.com/img0.jpg");
  });

  it("flags images missing width/height as missing-dimensions", async () => {
    article(`<img src="/a.jpg" alt="ok">`);
    const result = await runImages(url);
    const issue = result.issues.find((i) => i.code === "missing-dimensions");
    expect(issue?.count).toBe(1);
  });

  it("flags an image after the first 3 without loading=lazy as below-the-fold", async () => {
    const first3 = `<img src="/1.jpg" alt="a" width="1" height="1" loading="lazy">`.repeat(3);
    const fourth = `<img src="/4.jpg" alt="a" width="1" height="1">`;
    article(first3 + fourth);
    const result = await runImages(url);
    const issue = result.issues.find((i) => i.code === "no-lazy-below-fold");
    expect(issue?.count).toBe(1);
    expect(issue?.urls).toEqual(["https://example.com/4.jpg"]);
  });

  it("does not flag the first 3 images even without loading=lazy", async () => {
    const first3 = `<img src="/1.jpg" alt="a" width="1" height="1">`.repeat(3);
    article(first3);
    const result = await runImages(url);
    expect(result.issues.find((i) => i.code === "no-lazy-below-fold")).toBeUndefined();
  });

  it("flags a generic filename as bad-filename", async () => {
    article(`<img src="/IMG_0001.jpg" alt="a" width="1" height="1">`);
    const result = await runImages(url);
    const issue = result.issues.find((i) => i.code === "bad-filename");
    expect(issue?.count).toBe(1);
  });

  it("flags a sampled image whose body hits the 300KB cap as oversized", async () => {
    article(`<img src="/big.jpg" alt="a" width="1" height="1">`);
    mocks.safeFetchText.mockResolvedValue({
      finalUrl: "",
      status: 200,
      contentType: "image/jpeg",
      text: "x".repeat(300 * 1024),
    });
    const result = await runImages(url);
    expect(result.oversized).toEqual([{ url: "https://example.com/big.jpg", bytes: 300 * 1024 }]);
  });

  it("does not flag a small sampled image", async () => {
    article(`<img src="/small.jpg" alt="a" width="1" height="1">`);
    mocks.safeFetchText.mockResolvedValue({ finalUrl: "", status: 200, contentType: "image/jpeg", text: "x" });
    const result = await runImages(url);
    expect(result.oversized).toEqual([]);
  });

  it("skips a sample that fails to fetch", async () => {
    article(`<img src="/broken.jpg" alt="a" width="1" height="1">`);
    mocks.safeFetchText.mockRejectedValue(new Error("network down"));
    const result = await runImages(url);
    expect(result.oversized).toEqual([]);
  });

  it("returns zero images for a page with none", async () => {
    article("<html><body>no images</body></html>");
    const result = await runImages(url);
    expect(result).toEqual({ imageCount: 0, missingAlt: [], oversized: [], issues: [] });
  });
});
