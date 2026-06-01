export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

export interface LLMResult {
  data: string;
  usage: LLMUsage;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function completeAnthropic(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<LLMResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) throw new Error("[Anthropic] ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`[Anthropic] request failed: ${res.status} ${text}`);
  }

  type AnthropicResponse = {
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  };
  const json = (await res.json()) as AnthropicResponse;
  const completion = json.content.find((b) => b.type === "text")?.text ?? "";

  return {
    data: completion,
    usage: {
      inputTokens: json.usage?.input_tokens ?? estimateTokens(systemPrompt),
      outputTokens: json.usage?.output_tokens ?? estimateTokens(completion),
      model: json.model ?? model,
      provider: "anthropic",
    },
  };
}

// ─── GigaChat ─────────────────────────────────────────────────────────────────

const GIGACHAT_INSECURE =
  process.env.GIGACHAT_INSECURE === "1" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
const GIGACHAT_OAUTH_URL =
  "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_API_URL =
  "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";

let _gcToken: { access_token: string; expires_at: number } | null = null;

async function fetchGigaChatToken(): Promise<string> {
  const now = Date.now();
  if (_gcToken && _gcToken.expires_at > now + 60_000) return _gcToken.access_token;

  const authKey = process.env.GIGACHAT_AUTH_KEY ?? "";
  const scope = process.env.GIGACHAT_SCOPE ?? "GIGACHAT_API_PERS";

  const fetchOpts: RequestInit & { tls?: unknown } = {
    method: "POST",
    headers: {
      Authorization: `Basic ${authKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      RqUID: crypto.randomUUID(),
      Accept: "application/json",
    },
    body: `scope=${scope}`,
  };
  if (GIGACHAT_INSECURE) fetchOpts.tls = { rejectUnauthorized: false };

  const res = await fetch(GIGACHAT_OAUTH_URL, fetchOpts as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`[GigaChat] OAuth failed: ${res.status} ${text}`);
  }

  type OAuthResponse = { access_token: string; expires_at: number };
  const json = (await res.json()) as OAuthResponse;
  _gcToken = { access_token: json.access_token, expires_at: json.expires_at };
  return json.access_token;
}

async function completeGigaChat(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<LLMResult> {
  const token = await fetchGigaChatToken();
  const model = process.env.GIGACHAT_MODEL ?? "GigaChat-Pro";
  const inputTokens = estimateTokens(
    systemPrompt + messages.map((m) => m.content).join("")
  );

  const fetchOpts: RequestInit & { tls?: unknown } = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  };
  if (GIGACHAT_INSECURE) fetchOpts.tls = { rejectUnauthorized: false };

  const res = await fetch(GIGACHAT_API_URL, fetchOpts as RequestInit);
  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`[GigaChat] request failed: ${res.status} ${text}`);
  }

  type GigaChatResponse = {
    choices: { message: { content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  const json = (await res.json()) as GigaChatResponse;
  const completion = json.choices[0]?.message?.content ?? "";
  const outputTokens = json.usage?.completion_tokens ?? estimateTokens(completion);

  return {
    data: completion,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? inputTokens,
      outputTokens,
      model: json.model ?? model,
      provider: "gigachat",
    },
  };
}

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────

async function completeAzureOpenAI(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<LLMResult> {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-01";

  if (!endpoint || !apiKey) throw new Error("[AzureOpenAI] endpoint/key not set");

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const inputTokens = estimateTokens(
    systemPrompt + messages.map((m) => m.content).join("")
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`[AzureOpenAI] request failed: ${res.status} ${text}`);
  }

  type AzureResponse = {
    choices: { message: { content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  const json = (await res.json()) as AzureResponse;
  const completion = json.choices[0]?.message?.content ?? "";
  const outputTokens = json.usage?.completion_tokens ?? estimateTokens(completion);

  return {
    data: completion,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? inputTokens,
      outputTokens,
      model: json.model ?? deployment,
      provider: "azureopenai",
    },
  };
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────

async function completeOpenRouter(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<LLMResult> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) throw new Error("[OpenRouter] OPENROUTER_API_KEY not set");
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6";

  const inputTokens = estimateTokens(
    systemPrompt + messages.map((m) => m.content).join("")
  );

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`[OpenRouter] request failed: ${res.status} ${text}`);
  }

  type ORResponse = {
    choices: { message: { content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };
  const json = (await res.json()) as ORResponse;
  const completion = json.choices[0]?.message?.content ?? "";
  const outputTokens = json.usage?.completion_tokens ?? estimateTokens(completion);

  return {
    data: completion,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? inputTokens,
      outputTokens,
      model: json.model ?? model,
      provider: "openrouter",
    },
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function completeText(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<LLMResult> {
  const provider = process.env.TG_LLM_PROVIDER ?? "anthropic";
  console.log(`[tg-analyzer/llm] provider=${provider}`);
  if (provider === "gigachat") return completeGigaChat(systemPrompt, messages);
  if (provider === "azureopenai") return completeAzureOpenAI(systemPrompt, messages);
  if (provider === "openrouter") return completeOpenRouter(systemPrompt, messages);
  return completeAnthropic(systemPrompt, messages);
}
