import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAppLogger, getAppLogger } from "../src/logger";

const waitForFileWrite = async (filePath: string): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

describe("logger", () => {
  const originalLogDir = process.env.LOG_DIR;

  afterEach(() => {
    process.env.LOG_DIR = originalLogDir;
  });

  it("LOG_DIR にログファイルを出力する", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfrotator-logs-"));
    process.env.LOG_DIR = tempDir;

    const logger = createAppLogger();
    logger.info("test_log", { case: "file" });
    const logPath = path.join(tempDir, "server.log");
    await waitForFileWrite(logPath);

    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("test_log");
  });

  it("作成したロガーを取得できる", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfrotator-logs-"));
    process.env.LOG_DIR = tempDir;

    const logger = createAppLogger();
    expect(getAppLogger()).toBe(logger);
  });
});
