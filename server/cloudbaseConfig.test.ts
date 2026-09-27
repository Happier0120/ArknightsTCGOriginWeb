import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("模块8.3 CloudBase Run 部署声明", () => {
  it("使用多阶段 Node 镜像构建并以单端口启动生产服务", () => {
    const dockerfile = readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      engines: { node: string };
    };

    expect(dockerfile).toContain("FROM node:24-alpine AS build");
    expect(dockerfile).toContain("RUN npm ci --include=dev");
    expect(dockerfile).toContain("RUN npm run build && npm prune --omit=dev");
    expect(dockerfile).toContain("FROM node:24-alpine AS runtime");
    expect(dockerfile).toContain("PORT=8080");
    expect(dockerfile).toContain("ATCG_ROOM_STATE_PATH=/tmp/rooms.json");
    expect(dockerfile).toContain("ATCG_ROOM_BACKUP_PATH=/tmp/rooms.backup.json");
    expect(dockerfile).toContain("EXPOSE 8080");
    expect(dockerfile).toContain("/health");
    expect(dockerfile).toContain('CMD ["npm", "start"]');
    expect(packageJson.scripts.start).toBe("tsx server/index.ts");
    expect(packageJson.dependencies.tsx).toBeTruthy();
    expect(packageJson.engines.node).toContain(">=22.12.0");
  });

  it("排除本地与敏感产物并停用 Render Blueprint", () => {
    const ignore = readFileSync(path.join(projectRoot, ".dockerignore"), "utf8");
    expect(ignore).toContain(".git");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("node_modules");
    expect(ignore).toContain("server/data");
    expect(ignore).toContain("outputs");
    expect(existsSync(path.join(projectRoot, "render.yaml"))).toBe(false);
  });
});
