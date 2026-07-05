import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { authMiddleware } from "./middleware/auth";
import analyzeRoute from "./routes/analyze";
import findDialogsRoute from "./routes/find-dialogs";
import fetchMessagesRoute from "./routes/fetch-messages";
import authRoute from "./routes/auth";

// Load env file if running outside systemd
const envFile = process.env.ENV_FILE ?? "/etc/tg-analyzer/analyzer.env";
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const port = Number(process.env.TG_ANALYZER_PORT ?? 4600);

const protected_ = new Hono();
protected_.use("/*", authMiddleware);
protected_.route("/analyze", analyzeRoute);
protected_.route("/find-dialogs", findDialogsRoute);
protected_.route("/fetch-messages", fetchMessagesRoute);
protected_.route("/auth", authRoute);

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, service: "tg-analyzer" }));
app.route("/", protected_);

export default {
  port,
  fetch: app.fetch,
};

console.log(`[tg-analyzer] listening on port ${port}`);
