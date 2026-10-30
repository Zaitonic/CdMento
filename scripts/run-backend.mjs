import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const python = resolve(
  projectRoot,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
if (!existsSync(python)) {
  console.error(
    "Set up Python first: python -m venv .venv, then install backend/requirements.txt. See README.md.",
  );
  process.exit(1);
}
const child = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "backend.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    ...(process.argv.includes("--reload")
      ? ["--reload", "--reload-dir", "backend"]
      : []),
  ],
  { stdio: "inherit", cwd: projectRoot },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
