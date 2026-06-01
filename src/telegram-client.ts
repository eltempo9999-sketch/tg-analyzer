import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

const API_ID = parseInt(process.env.TELEGRAM_API_ID ?? "0", 10);
const API_HASH = process.env.TELEGRAM_API_HASH ?? "";

export function createTelegramClient(sessionString = ""): TelegramClient {
  const session = new StringSession(sessionString);
  return new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    requestRetries: 3,
    appVersion: "1.0",
    deviceModel: "SpyNetwork",
    systemVersion: "Linux",
  });
}

export function isConfigured(): boolean {
  return API_ID > 0 && API_HASH.length > 0;
}
