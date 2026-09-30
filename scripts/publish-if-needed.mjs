import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}`, {
  headers: { accept: "application/vnd.npm.install-v1+json" },
});

if (response.ok) {
  const metadata = await response.json();
  if (metadata.versions?.[packageJson.version]) {
    console.log(`${packageJson.name}@${packageJson.version} is already published; skipping.`);
    process.exit(0);
  }
} else if (response.status !== 404) {
  throw new Error(`Could not look up ${packageJson.name}: registry returned ${response.status}.`);
}

const child = spawn("npm", ["publish"], { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => (process.exitCode = code ?? (signal ? 1 : 0)));
