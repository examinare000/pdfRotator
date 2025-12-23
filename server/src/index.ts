import dotenv from "dotenv";
import { createApp } from "./app";

dotenv.config();

const port = process.env.PORT ?? "3001";
const app = createApp();

app.listen(Number(port), () => {
  const logger = app.locals.logger;
  logger?.info(`server listening on :${port}`);
});
