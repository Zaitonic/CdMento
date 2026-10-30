import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm uses cmd.exe on Windows, so launch the virtualenv directly instead of
// relying on a shell-specific .venv/Scripts/python command.
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const python = resolve(
  projectRoot,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(python)) {
  console.error("Set up the Python virtual environment first. See README.md.");
  process.exit(1);
}
const child = spawn(python, process.argv.slice(2), {
  cwd: projectRoot,
  stdio: "inherit",
});
child.on("error", () => {
  console.error("Could not start the project Python interpreter.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
