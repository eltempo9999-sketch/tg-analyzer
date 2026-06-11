import { Hono } from "hono";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import {
  createTelegramClient,
  getApiCredentials,
  getSessionString,
  isConfigured,
} from "../telegram-client";

const app = new Hono();

function meInfo(me: Api.User) {
  return {
    username: me.username ?? null,
    firstName: String(me.firstName ?? ""),
    lastName: me.lastName ?? null,
  };
}

app.post("/start", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Body = { tgPhone: string };
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body.tgPhone) {
    return c.json({ ok: false, error: "tgPhone required" }, 400);
  }

  const { apiId, apiHash } = getApiCredentials();
  const client = createTelegramClient("");
  try {
    await client.connect();
    const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, body.tgPhone);
    return c.json({ ok: true, phoneCodeHash, sessionString: getSessionString(client) });
  } catch (err: any) {
    console.error("[auth/start] error:", err);
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

app.post("/verify-code", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Body = { sessionString: string; tgPhone: string; phoneCodeHash: string; code: string };
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body.sessionString || !body.tgPhone || !body.phoneCodeHash || !body.code) {
    return c.json({ ok: false, error: "Missing required fields" }, 400);
  }

  const client = createTelegramClient(body.sessionString);
  try {
    await client.connect();
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: body.tgPhone,
          phoneCodeHash: body.phoneCodeHash,
          phoneCode: body.code,
        })
      );
    } catch (e: any) {
      if (e.errorMessage === "SESSION_PASSWORD_NEEDED") {
        return c.json({ ok: true, need2FA: true, sessionString: getSessionString(client) });
      }
      if (e.errorMessage === "PHONE_CODE_INVALID") {
        return c.json({ ok: false, errorCode: "PHONE_CODE_INVALID", error: e.errorMessage }, 400);
      }
      if (e.errorMessage === "PHONE_CODE_EXPIRED") {
        return c.json({ ok: false, errorCode: "PHONE_CODE_EXPIRED", error: e.errorMessage }, 400);
      }
      return c.json({ ok: false, errorCode: "OTHER", error: String(e?.message ?? e) }, 500);
    }

    const me = (await client.getMe()) as Api.User;
    return c.json({
      ok: true,
      need2FA: false,
      sessionString: getSessionString(client),
      me: meInfo(me),
    });
  } catch (err: any) {
    console.error("[auth/verify-code] error:", err);
    return c.json({ ok: false, errorCode: "OTHER", error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

app.post("/verify-2fa", async (c) => {
  if (!isConfigured()) {
    return c.json({ ok: false, error: "TELEGRAM_API_ID/HASH not configured" }, 503);
  }

  type Body = { sessionString: string; password: string };
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body.sessionString || !body.password) {
    return c.json({ ok: false, error: "Missing required fields" }, 400);
  }

  const client = createTelegramClient(body.sessionString);
  try {
    await client.connect();
    try {
      const passwordData = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(passwordData, body.password);
      await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } catch (e: any) {
      if (e.errorMessage === "PASSWORD_HASH_INVALID") {
        return c.json({ ok: false, errorCode: "PASSWORD_HASH_INVALID", error: e.errorMessage }, 400);
      }
      return c.json({ ok: false, errorCode: "OTHER", error: String(e?.message ?? e) }, 500);
    }

    const me = (await client.getMe()) as Api.User;
    return c.json({ ok: true, sessionString: getSessionString(client), me: meInfo(me) });
  } catch (err: any) {
    console.error("[auth/verify-2fa] error:", err);
    return c.json({ ok: false, errorCode: "OTHER", error: String(err?.message ?? err) }, 500);
  } finally {
    await client.disconnect();
  }
});

app.post("/logout", async (c) => {
  type Body = { sessionString: string };
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ ok: false, error: "Invalid JSON" }, 400);
  }
  if (!body.sessionString) {
    return c.json({ ok: true });
  }

  const client = createTelegramClient(body.sessionString);
  try {
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
  } catch (err) {
    console.error("[auth/logout] error:", err);
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
  return c.json({ ok: true });
});

export default app;
