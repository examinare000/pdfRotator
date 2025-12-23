export type LogLevel = "info" | "warn" | "error" | "debug";

type LogPayload = {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
};

const LOG_ENDPOINT = "/api/logs";

const sendLog = (payload: LogPayload): void => {
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(LOG_ENDPOINT, blob);
    return;
  }
  if (typeof fetch !== "function") {
    return;
  }
  void fetch(LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
};

export const logClient = (
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): void => {
  sendLog({
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  });
};
