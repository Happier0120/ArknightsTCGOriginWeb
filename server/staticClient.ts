import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "same-origin");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
) {
  const extension = path.extname(filePath).toLowerCase();
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    contentTypes[extension] ?? "application/octet-stream",
  );
  response.setHeader(
    "cache-control",
    filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  setSecurityHeaders(response);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
  stream.pipe(response);
}

export function createStaticClientHandler(clientRoot: string) {
  const resolvedRoot = path.resolve(clientRoot);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  const indexPath = path.join(resolvedRoot, "index.html");

  return (request: IncomingMessage, response: ServerResponse) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      return false;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("请求地址无效");
      return true;
    }
    if (pathname === "/socket.io" || pathname.startsWith("/socket.io/")) {
      return false;
    }
    const relativePath = pathname.replace(/^\/+/, "");
    const requestedPath = path.resolve(resolvedRoot, relativePath);
    const isInsideRoot =
      requestedPath === resolvedRoot || requestedPath.startsWith(rootPrefix);
    if (!isInsideRoot) {
      response.writeHead(404);
      response.end();
      return true;
    }
    if (
      requestedPath !== resolvedRoot &&
      existsSync(requestedPath) &&
      statSync(requestedPath).isFile()
    ) {
      sendFile(request, response, requestedPath);
      return true;
    }
    if (!path.extname(relativePath) && existsSync(indexPath)) {
      sendFile(request, response, indexPath);
      return true;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return true;
  };
}
