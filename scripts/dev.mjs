import { spawn } from "node:child_process";

const resolveNpmCommand = () => {
  if (process.platform !== "win32") {
    return { command: "npm", prefixArgs: [] };
  }
  return { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "npm"] };
};

const npmCommand = resolveNpmCommand();

const spawnNpm = (cwd, args, name) => {
  const child = spawn(npmCommand.command, [...npmCommand.prefixArgs, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) return;

    if (typeof code === "number" && code !== 0) {
      shutdown(`[${name}] が終了しました (exit=${code})`);
      process.exitCode = code;
      return;
    }

    shutdown(`[${name}] が終了しました`);
  });

  child.on("error", (err) => {
    console.error(`[${name}] 起動に失敗しました:`, err);
    process.exitCode = 1;
  });

  return child;
};

const children = [
  spawnNpm("frontend", ["run", "dev"], "frontend"),
  spawnNpm("server", ["run", "dev"], "server"),
];

const shutdown = (reason) => {
  if (reason) {
    console.error(reason);
  }
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

process.on("exit", () => shutdown());
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
process.on("uncaughtException", (err) => shutdown(err));
process.on("unhandledRejection", (err) => shutdown(err));
