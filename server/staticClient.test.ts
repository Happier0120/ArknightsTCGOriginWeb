import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStaticClientHandler } from "./staticClient";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function createFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "atcg-static-"));
  temporaryDirectories.push(directory);
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(path.join(directory, "index.html"), "<main>ATCG</main>", "utf8");
  writeFileSync(path.join(directory, "assets", "app.js"), "export {};", "utf8");
  const handler = createStaticClientHandler(directory);
  const server = createServer((request, response) => {
    if (!handler(request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务启动失败");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  };
}

describe("生产静态页面服务", () => {
  it("提供首页、静态资源与SPA路由回退", async () => {
    const fixture = await createFixture();
    try {
      const home = await fetch(`${fixture.baseUrl}/`);
      const route = await fetch(`${fixture.baseUrl}/multiplayer/room/ATCG81`);
      const asset = await fetch(`${fixture.baseUrl}/assets/app.js`);

      expect(await home.text()).toBe("<main>ATCG</main>");
      expect(await route.text()).toBe("<main>ATCG</main>");
      expect(home.headers.get("content-security-policy")).toContain("connect-src 'self'");
      expect(await asset.text()).toBe("export {};");
      expect(asset.headers.get("cache-control")).toContain("immutable");
    } finally {
      await fixture.close();
    }
  });

  it("拒绝目录逃逸且不把缺失资源回退到首页", async () => {
    const fixture = await createFixture();
    try {
      const traversal = await fetch(`${fixture.baseUrl}/%2e%2e/package.json`);
      const missingAsset = await fetch(`${fixture.baseUrl}/assets/missing.js`);
      expect(traversal.status).toBe(404);
      expect(missingAsset.status).toBe(404);
    } finally {
      await fixture.close();
    }
  });
});
