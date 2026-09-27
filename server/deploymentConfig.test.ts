import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("模块8.3部署声明", () => {
  it("Render免费单服务配置与生产脚本、健康检查和临时快照保持一致", () => {
    const blueprint = readFileSync(path.join(projectRoot, "render.yaml"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      engines: { node: string };
    };

    expect(blueprint).toContain("type: web");
    expect(blueprint).toContain("runtime: node");
    expect(blueprint).toContain("numInstances: 1");
    expect(blueprint).toContain(
      "buildCommand: npm ci --include=dev && npm run build && npm prune --omit=dev",
    );
    expect(blueprint).toContain("startCommand: npm start");
    expect(blueprint).toContain("healthCheckPath: /health");
    expect(blueprint).toContain("plan: free");
    expect(blueprint).not.toContain("mountPath:");
    expect(blueprint).not.toContain("disk:");
    expect(blueprint).toContain("value: /tmp/rooms.json");
    expect(blueprint).toContain("value: /tmp/rooms.backup.json");
    expect(blueprint).toContain("ATCG_SOCKET_MAX_PAYLOAD_BYTES");
    expect(blueprint).toContain("ATCG_ENTRY_RATE_LIMIT");
    expect(blueprint).toContain("ATCG_CONTROL_RATE_LIMIT");
    expect(blueprint).toContain("ATCG_COMMAND_RATE_LIMIT");
    expect(packageJson.scripts.start).toBe("tsx server/index.ts");
    expect(packageJson.dependencies.tsx).toBeTruthy();
    expect(packageJson.engines.node).toContain(">=22.12.0");
  });

  it("环境变量文件不会意外提交真实配置", () => {
    const ignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
    const example = readFileSync(path.join(projectRoot, ".env.example"), "utf8");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("!.env.example");
    expect(example).not.toMatch(/TOKEN|SECRET|PASSWORD/);
    expect(example).toContain("ATCG_ROOM_BACKUP_PATH");
    expect(example).toContain("ATCG_SOCKET_MAX_PAYLOAD_BYTES=131072");
  });
});
