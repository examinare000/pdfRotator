import { createLogger, format, transports, Logger } from "winston";

export const createAppLogger = (): Logger => {
  return createLogger({
    level: "info",
    format: format.combine(format.timestamp(), format.json()),
    transports: [new transports.Console()],
  });
};
