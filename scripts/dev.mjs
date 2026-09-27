import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn(process.execPath, [
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(root, "server", "index.ts"),
  ], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")], {
    cwd: root,
    stdio: "inherit",
  }),
];
let stopping = false;

function stop() {
  stopping = true;
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (stopping) return;
    stopping = true;
    for (const sibling of children) {
      if (sibling !== child) sibling.kill();
    }
    process.exitCode = code && code !== 0 ? code : 1;
  });
}
