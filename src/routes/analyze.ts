import { Hono } from "hono";
import { Api } from "telegram";
import { createTelegramClient, isConfigured } from "../telegram-client";
import { completeText } from "../llm-provider";

const app = new Hono();

app.post("/", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Body = {
    sessionString: string;
    dialogId: string;
    contactName: string;
    sinceTimestamp: number;
    question?: string;
    systemPrompt: string;
  };

  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const { sessionString, dialogId, contactName, sinceTimestamp, question, systemPrompt } = body;
  if (!sessionString || !dialogId || !contactName || !sinceTimestamp || !systemPrompt) {
    return c.json({ ok: false, error: "Missing required fields" }, 400);
  }

  const client = createTelegramClient(sessionString);
  try {
    await client.connect();

    const peer = await client.getInputEntity(BigInt(dialogId));
    const raw = await client.invoke(
      new Api.messages.Search({
        peer,
        q: "",
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: sinceTimestamp,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit: 300,
        maxId: 0,
        minId: 0,
        hash: BigInt(0),
      })
    );

    const msgs: any[] = "messages" in raw ? (raw as any).messages : [];
    const textMsgs = msgs.filter((m) => m.message?.trim());

    if (!textMsgs.length) {
      return c.json({
        ok: true,
        messageCount: 0,
        summary: `За выбранный период текстовых сообщений с ${contactName} не найдено.`,
        usage: { inputTokens: 0, outputTokens: 0, model: "none", provider: "none" },
      });
    }

    const lines = [...textMsgs].reverse().map((m) => {
      const date = new Date((m.date ?? 0) * 1000).toLocaleDateString("ru-RU");
      return `[${date}] ${m.out ? "Я" : contactName}: ${m.message}`;
    });

    const userContent = question?.trim()
      ? `Переписка (${lines.length} сообщений):\n\n${lines.join("\n").slice(0, 8000)}\n\nВопрос: ${question.trim()}`
      : `Переписка (${lines.length} сообщений):\n\n${lines.join("\n").slice(0, 8000)}`;

    const llmResult = await completeText(systemPrompt, [{ role: "user", content: userContent }]);

    return c.json({
      ok: true,
      messageCount: textMsgs.length,
      summary: llmResult.data,
      usage: llmResult.usage,
    });
  } catch (err: any) {
    console.error("[analyze] error:", err);
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

export default app;
