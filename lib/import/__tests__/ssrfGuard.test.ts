import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The guard resolves hostnames through node:dns/promises — mock it so no test
// ever touches the network and so we can simulate hostile DNS answers.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

// Capture every undici Agent constructed so the pinning tests can inspect the
// exact `connect.lookup` override assertSafeUrl builds, without needing a
// real socket (see "pinned dispatcher" describe block below).
const capturedAgentOptions: unknown[] = [];
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    Agent: vi.fn(function (this: unknown, opts: unknown) {
      capturedAgentOptions.push(opts);
      return { close: vi.fn(async () => undefined) };
    }),
  };
});

import { lookup } from "node:dns/promises";
import { assertSafeUrl, validateRedirectHop } from "../ssrfGuard";
import { ImportError } from "../errors";

const lookupMock = lookup as unknown as Mock;

interface CapturedConnectOptions {
  connect: {
    lookup: (
      hostname: string,
      options: unknown,
      callback: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void,
    ) => void;
  };
}

async function expectBlocked(url: string): Promise<void> {
  await expect(assertSafeUrl(url)).rejects.toMatchObject({
    name: "ImportError",
    kind: "blocked",
  });
}

async function expectAllowed(url: string): Promise<URL> {
  const result = await assertSafeUrl(url);
  expect(result.url).toBeInstanceOf(URL);
  expect(result.dispatcher).toBeDefined();
  return result.url;
}

beforeEach(() => {
  lookupMock.mockReset();
  capturedAgentOptions.length = 0;
  delete process.env.AUDIT_TEST_ALLOW_LOOPBACK;
});

describe("assertSafeUrl — schemes and URL shape", () => {
  it("rejects non-http(s) schemes", async () => {
    await expectBlocked("file:///etc/passwd");
    await expectBlocked("ftp://example.com/file");
    await expectBlocked("javascript:alert(1)");
    await expectBlocked("gopher://example.com/");
  });

  it("rejects URLs with embedded credentials", async () => {
    await expectBlocked("https://user:pass@example.com/article");
    await expectBlocked("https://user@example.com/article");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("throws fetch_failed (not a crash) for garbage input", async () => {
    await expect(assertSafeUrl("not a url at all")).rejects.toMatchObject({
      kind: "fetch_failed",
    });
  });
});

describe("assertSafeUrl — IPv4 literals", () => {
  it("blocks the cloud metadata endpoint 169.254.169.254", async () => {
    await expectBlocked("http://169.254.169.254/latest/meta-data/");
  });

  it("blocks private, loopback and reserved IPv4 ranges", async () => {
    await expectBlocked("http://10.0.0.1/");
    await expectBlocked("http://172.16.0.1/");
    await expectBlocked("http://172.31.255.255/");
    await expectBlocked("http://192.168.1.1/admin");
    await expectBlocked("http://127.0.0.1:8080/");
    await expectBlocked("http://0.0.0.0/");
    await expectBlocked("http://100.64.0.1/"); // CGNAT
    await expectBlocked("http://169.254.0.10/"); // link-local generally
  });

  it("blocks obfuscated IPv4 literals (WHATWG canonicalization)", async () => {
    await expectBlocked("http://2130706433/"); // decimal 127.0.0.1
    await expectBlocked("http://0x7f000001/"); // hex 127.0.0.1
  });

  it("allows public IPv4 literals, including private-range boundaries", async () => {
    await expectAllowed("http://93.184.216.34/article");
    await expectAllowed("http://172.15.255.255/");
    await expectAllowed("http://172.32.0.1/");
    await expectAllowed("http://11.0.0.1/");
    expect(lookupMock).not.toHaveBeenCalled(); // literals never hit DNS
  });
});

describe("assertSafeUrl — IPv6 literals", () => {
  it("blocks loopback, unspecified, unique-local and link-local", async () => {
    await expectBlocked("http://[::1]/");
    await expectBlocked("http://[::]/");
    await expectBlocked("http://[fc00::1]/");
    await expectBlocked("http://[fd12:3456:789a::1]/");
    await expectBlocked("http://[fe80::1]/");
  });

  it("blocks IPv4-mapped and NAT64 addresses embedding private IPv4", async () => {
    await expectBlocked("http://[::ffff:127.0.0.1]/");
    await expectBlocked("http://[::ffff:10.0.0.5]/");
    await expectBlocked("http://[::ffff:169.254.169.254]/");
    await expectBlocked("http://[64:ff9b::a00:1]/"); // NAT64 of 10.0.0.1
  });

  it("allows public IPv6 literals", async () => {
    await expectAllowed("http://[2606:4700:4700::1111]/");
  });
});

describe("assertSafeUrl — DNS resolution (rebinding vector)", () => {
  it("blocks a hostname that resolves to a private IPv4", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expectBlocked("https://internal-jump.example.com/doc");
    expect(lookupMock).toHaveBeenCalledWith("internal-jump.example.com", { all: true });
  });

  it("blocks a hostname that resolves to the metadata IP", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expectBlocked("https://metadata-alias.example.com/");
  });

  it("blocks if ANY resolved address is private (public + private mix)", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.10", family: 4 },
    ]);
    await expectBlocked("https://rebind.example.com/");
  });

  it("blocks a hostname that resolves to a private IPv6", async () => {
    lookupMock.mockResolvedValue([{ address: "fd00::1", family: 6 }]);
    await expectBlocked("https://ula.example.com/");
  });

  it("blocks localhost names without consulting DNS", async () => {
    await expectBlocked("http://localhost:3000/");
    await expectBlocked("http://foo.localhost/");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a hostname resolving only to public addresses", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
    const url = await expectAllowed("https://example.com/article");
    expect(url.hostname).toBe("example.com");
  });

  it("maps resolution failure to fetch_failed with the paste fallback", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeUrl("https://no-such-host.example.com/")).rejects.toMatchObject({
      kind: "fetch_failed",
      message: expect.stringContaining("paste the article text"),
    });
  });
});

describe("assertSafeUrl — pinned dispatcher (DNS-rebinding TOCTOU)", () => {
  it("pins the dispatcher's connector to the exact validated address — a resolved-hostname case", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await assertSafeUrl("https://pin-me.example.com/article");

    expect(capturedAgentOptions).toHaveLength(1);
    const opts = capturedAgentOptions[0] as CapturedConnectOptions;
    const callback = vi.fn();

    // The regression: even when asked to resolve a COMPLETELY DIFFERENT
    // hostname (simulating whatever the connector would normally look up at
    // connect-time, i.e. exactly the moment a rebinding attack flips the DNS
    // record), the pinned lookup ignores it and hands back the address we
    // already validated. Real DNS is never consulted a second time.
    opts.connect.lookup("attacker-controlled-hostname.evil", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(lookupMock).toHaveBeenCalledTimes(1); // the ONE resolution assertSafeUrl itself did
  });

  it("pins IP-literal targets too (no DNS involved at all)", async () => {
    await assertSafeUrl("http://93.184.216.34/article");

    const opts = capturedAgentOptions[0] as CapturedConnectOptions;
    const callback = vi.fn();
    opts.connect.lookup("irrelevant", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("re-pins independently on every redirect hop via validateRedirectHop", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.9", family: 4 }]);
    const result = await validateRedirectHop("https://second-hop.example.com/next");

    const opts = capturedAgentOptions.at(-1) as CapturedConnectOptions;
    const callback = vi.fn();
    opts.connect.lookup("whatever", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: "203.0.113.9", family: 4 }]);
    expect(result.url.hostname).toBe("second-hop.example.com");
  });
});

describe("assertSafeUrl — AUDIT_TEST_ALLOW_LOOPBACK (test-only escape hatch)", () => {
  it("blocks loopback literals when the flag is unset (default/prod behavior)", async () => {
    await expectBlocked("http://127.0.0.1:4000/");
  });

  it("allows loopback literals only when the flag is set", async () => {
    process.env.AUDIT_TEST_ALLOW_LOOPBACK = "1";
    await expectAllowed("http://127.0.0.1:4000/");
  });

  it("does not widen the bypass to non-loopback private ranges", async () => {
    process.env.AUDIT_TEST_ALLOW_LOOPBACK = "1";
    await expectBlocked("http://10.0.0.5/");
    await expectBlocked("http://169.254.169.254/");
  });
});

describe("validateRedirectHop", () => {
  it("applies the exact same policy to redirect targets", async () => {
    await expect(validateRedirectHop("http://169.254.169.254/latest")).rejects.toBeInstanceOf(
      ImportError,
    );
    const result = await validateRedirectHop("http://93.184.216.34/next");
    expect(result.url).toBeInstanceOf(URL);
    expect(result.dispatcher).toBeDefined();
  });
});
