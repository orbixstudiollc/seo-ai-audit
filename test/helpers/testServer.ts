import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal local HTTP fixture for the audit route's integration tests — a real
 * server so `fetchArticle` exercises actual socket/streaming/header behavior,
 * not a hand-rolled `Response` stand-in (that's what the lib/import unit
 * tests already cover in isolation).
 */

export interface RouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

export function createTestServer(routes: Record<string, RouteResponse>): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    const route = routes[req.url ?? "/"];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, route.headers ?? { "content-type": "text/html" });
    res.end(route.body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
