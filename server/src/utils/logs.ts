export type ClientLogPayload = {
  level: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
};

export const parseClientLogPayload = (body: unknown): ClientLogPayload | null => {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!record) return null;

  const level = typeof record.level === "string" ? record.level : null;
  if (!level) return null;

  const message = typeof record.message === "string" ? record.message : null;
  if (!message) return null;

  const context =
    record.context && typeof record.context === "object"
      ? (record.context as Record<string, unknown>)
      : undefined;
  const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;

  return { level, message, context, timestamp };
};

export const normalizeLogLevel = (level: string): "error" | "warn" | "info" | "debug" => {
  const normalized = level.toLowerCase();
  if (normalized === "error") return "error";
  if (normalized === "warn") return "warn";
  if (normalized === "info") return "info";
  if (normalized === "debug") return "debug";
  return "info";
};
