import type { RequestHandler } from "express";
import type { AppConfig } from "../config";

export const createHealthHandler = (config: AppConfig): RequestHandler => {
  return (_req, res) => {
    res.json({
      status: "ok",
      version: process.env.npm_package_version ?? "dev",
      ocrEnabled: config.ocrEnabled,
    });
  };
};
