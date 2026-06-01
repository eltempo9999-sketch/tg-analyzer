import { Hono } from "hono";
import { Api } from "telegram";
import { createTelegramClient, isConfigured } from "../telegram-client";

const app = new Hono();

app.post("/", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Body = {
    sessionString: string;
    phoneNumbers: string[];
    username?: string;
  };

  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const { sessionString, phoneNumbers, username } = body;
  if (!sessionString || !Array.isArray(phoneNumbers)) {
    return c.json({ ok: false, error: "sessionString and phoneNumbers required" }, 400);
  }

  const client = createTelegramClient(sessionString);
  try {
    await client.connect();

    const settled = await Promise.allSettled(
      phoneNumbers.map(async (phone) => {
        const clean = phone.replace(/\D/g, "");
        if (!clean) {
          return { phone, found: false, dialogId: null as string | null, name: null as string | null, username: null as string | null };
        }
        try {
          const resolved = await client.invoke(
            new Api.contacts.ResolvePhone({ phone: clean })
          );
          if (resolved.peer instanceof Api.PeerUser) {
            const user = resolved.users.find((u): u is Api.User => u instanceof Api.User);
            return {
              phone,
              found: true,
              dialogId: String(resolved.peer.userId),
              name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null,
              username: user?.username ?? null,
            };
          }
        } catch {}
        return { phone, found: false, dialogId: null, name: null, username: null };
      })
    );

    const results: { phone: string; found: boolean; dialogId: string | null; name: string | null; username: string | null }[] =
      settled.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { phone: phoneNumbers[i], found: false, dialogId: null, name: null, username: null }
      );

    if (username) {
      const clean = username.replace(/^@/, "");
      const key = `@${clean}`;
      try {
        const resolved = await client.invoke(
          new Api.contacts.ResolveUsername({ username: clean })
        );
        if (resolved.peer instanceof Api.PeerUser) {
          const user = resolved.users.find((u): u is Api.User => u instanceof Api.User);
          results.push({
            phone: key,
            found: true,
            dialogId: String(resolved.peer.userId),
            name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null,
            username: clean,
          });
        } else {
          results.push({ phone: key, found: false, dialogId: null, name: null, username: clean });
        }
      } catch {
        results.push({ phone: key, found: false, dialogId: null, name: null, username: clean });
      }
    }

    return c.json({ ok: true, connected: true, results });
  } catch (err: any) {
    console.error("[find-dialogs] error:", err);
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

export default app;
