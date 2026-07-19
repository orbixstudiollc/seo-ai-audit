import { describe, expect, it } from "vitest";
import { parseRobots, ALLOW_ALL_ROBOTS } from "../robots";

describe("parseRobots", () => {
  it("allows everything when the file has no User-agent lines", () => {
    const rules = parseRobots("# just a comment\n");
    expect(rules.isAllowed("/anything")).toBe(true);
  });

  it("allows everything when disallow is empty (the de-facto 'no restriction' form)", () => {
    const rules = parseRobots("User-agent: *\nDisallow:\n");
    expect(rules.isAllowed("/private")).toBe(true);
  });

  it("blocks paths under a Disallow prefix for the wildcard group", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /admin\nDisallow: /private/\n");
    expect(rules.isAllowed("/admin")).toBe(false);
    expect(rules.isAllowed("/admin/users")).toBe(false);
    expect(rules.isAllowed("/private/data")).toBe(false);
    expect(rules.isAllowed("/public")).toBe(true);
  });

  it("longest-prefix Allow wins over a shorter Disallow", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /blog\nAllow: /blog/public\n");
    expect(rules.isAllowed("/blog/secret")).toBe(false);
    expect(rules.isAllowed("/blog/public/post")).toBe(true);
  });

  it("only applies rules from the wildcard group, ignoring named-agent-only groups", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /google-only\n\nUser-agent: *\nDisallow: /all\n");
    expect(rules.isAllowed("/google-only")).toBe(true); // not in the wildcard group
    expect(rules.isAllowed("/all")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const rules = parseRobots("\n# comment\nUser-agent: *\n\n# another comment\nDisallow: /x # inline note\n");
    expect(rules.isAllowed("/x/y")).toBe(false);
  });
});

describe("ALLOW_ALL_ROBOTS", () => {
  it("allows any path", () => {
    expect(ALLOW_ALL_ROBOTS.isAllowed("/whatever")).toBe(true);
  });
});
