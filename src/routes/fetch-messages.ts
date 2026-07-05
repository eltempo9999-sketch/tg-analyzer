import { Hono } from "hono";
import { createTelegramClient, isConfigured } from "../telegram-client";

/**
 * Возвращает новые сообщения по набору диалогов начиная с курсора
 * (sinceMessageId), БЕЗ LLM. Используется фоновым авто-синком бэкенда
 * (startTelegramSyncScheduler), т.к. прямой MTProto с прод-сервера
 * SpyNetwork заблокирован — вся работа с Telegram идёт через этот сервис.
 */
const app = new Hono();

app.post("/", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Dialog = { dialogId: string; sinceMessageId?: number };
  type Body = { sessionString: string; dialogs: Dialog[]; limit?: number };

  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const { sessionString, dialogs } = body;
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);
  if (!sessionString || !Array.isArray(dialogs)) {
    return c.json({ ok: false, error: "sessionString and dialogs required" }, 400);
  }

  const client = createTelegramClient(sessionString);
  try {
    await client.connect();

    // Наполняем кэш сущностей (access_hash) — иначе getInputEntity по «голому»
    // userId из find-dialogs падает с "Could not find the input entity".
    try {
      await client.getDialogs({ limit: 200 });
    } catch (e) {
      console.error("[fetch-messages] getDialogs warmup failed:", e);
    }

    const results: {
      dialogId: string;
      found: boolean;
      messages: { id: number; text: string; date: number; out: boolean }[];
      maxId: number;
      error?: string;
    }[] = [];

    // Sequential — не долбим Telegram API параллельно.
    for (const d of dialogs) {
      const minId = typeof d.sinceMessageId === "number" ? d.sinceMessageId : 0;
      try {
        const entity = await client.getInputEntity(BigInt(d.dialogId));
        const raw = await client.getMessages(entity, { limit, minId });
        const messages = raw
          .map((m: any) => ({
            id: m.id as number,
            text: "message" in m ? ((m as any).message ?? "") : "",
            date: (m.date ?? 0) as number,
            out: !!(m as any).out,
          }))
          .filter((m) => m.id > minId);
        const maxId = messages.length ? Math.max(...messages.map((m) => m.id)) : minId;
        results.push({ dialogId: d.dialogId, found: true, messages, maxId });
      } catch (e: any) {
        results.push({
          dialogId: d.dialogId,
          found: false,
          messages: [],
          maxId: minId,
          error: String(e?.message ?? e),
        });
      }
    }

    return c.json({ ok: true, connected: true, results });
  } catch (err: any) {
    console.error("[fetch-messages] error:", err);
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

export default app;
