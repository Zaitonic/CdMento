import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env };
for (const key of Object.keys(env)) {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  if (
    normalized.startsWith("npm_config_cache") &&
    normalized !== "npm_config_cache"
  ) {
    delete env[key];
  }
}
const globalConfig = join(tmpdir(), "cdmento-empty-global.npmrc");
const userConfig = join(tmpdir(), "cdmento-empty-user.npmrc");
writeFileSync(globalConfig, "");
writeFileSync(userConfig, "");
env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
env.NPM_CONFIG_USERCONFIG = userConfig;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["ci", "--no-audit", "--no-fund"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
