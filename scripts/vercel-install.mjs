import { spawnSync } from "node:child_process";

const env = { ...process.env };
for (const key of Object.keys(env)) {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  if (normalized === "npm_config_cache_dir") delete env[key];
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["ci", "--no-audit", "--no-fund"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
