import { env } from "cloudflare:workers";
import { ApiError, type CloudflareEnv } from "@/lib/live-story";

type SolarMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SolarJsonOptions = {
  schemaName: string;
  schema: Record<string, unknown>;
  messages: SolarMessage[];
  maxTokens?: number;
  temperature?: number;
};

type SolarPayload = {
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      parsed?: unknown;
    };
  }>;
  output?: unknown;
  output_text?: unknown;
};

const UPSTAGE_ENDPOINT = "https://api.upstage.ai/v1/chat/completions";
const DEFAULT_MODEL = "solar-pro4";
const FALLBACK_MODEL = "solar-pro3";
const TIMEOUT_MS = 45_000;

export async function generateSolarJson<T>(options: SolarJsonOptions): Promise<T> {
  const key = getUpstageApiKey();
  const preferredModel = getUpstageModel();

  try {
    return await requestSolarJson<T>(key, preferredModel, options);
  } catch (error) {
    if (error instanceof SolarHttpError && shouldFallbackToSolarPro3(error, preferredModel)) {
      return requestSolarJson<T>(key, FALLBACK_MODEL, options);
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError("AI 생성 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}

async function requestSolarJson<T>(apiKey: string, model: string, options: SolarJsonOptions): Promise<T> {
  try {
    const bodyText = await sendSolarRequest(apiKey, model, options, true);
    return parseSolarResponse<T>(bodyText);
  } catch (error) {
    if (error instanceof SolarHttpError && shouldRetryWithoutResponseFormat(error)) {
      const bodyText = await sendSolarRequest(apiKey, model, options, false);
      return parseSolarResponse<T>(bodyText);
    }
    if (error instanceof SolarResponseLengthError) {
      const bodyText = await sendSolarRequest(apiKey, model, options, true, 2);
      return parseSolarResponse<T>(bodyText);
    }
    if (error instanceof SolarResponseFormatError) {
      const bodyText = await sendSolarRequest(apiKey, model, options, true);
      return parseSolarResponse<T>(bodyText);
    }
    throw error;
  }
}

async function sendSolarRequest(
  apiKey: string,
  model: string,
  options: SolarJsonOptions,
  includeResponseFormat: boolean,
  tokenMultiplier = 1,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  let bodyText = "";
  try {
    response = await fetch(UPSTAGE_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: withSchemaPrompt(options),
        temperature: options.temperature ?? 0.4,
        max_tokens: completionTokenBudget(model, options) * tokenMultiplier,
        ...(isSolarPro4(model) ? { reasoning_effort: "none" } : {}),
        stream: false,
        ...(includeResponseFormat
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: options.schemaName,
                  strict: true,
                  schema: options.schema,
                },
              },
            }
          : {}),
      }),
      signal: controller.signal,
    });
    bodyText = await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("AI 응답 시간이 길어져 중단했어요. 다시 시도해 주세요.", 504);
    }
    throw new ApiError("AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new SolarHttpError(response.status, bodyText);
  }

  return bodyText;
}

function parseSolarResponse<T>(bodyText: string): T {
  const payload = safeJsonParse<SolarPayload>(bodyText);
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new SolarResponseLengthError();
  }
  const message = choice?.message;

  const parsedMessage = asJsonObject(message?.parsed);
  if (parsedMessage) return parsedMessage as T;

  for (const text of extractContentTexts(message?.content)) {
    const parsed = parseJsonObjectFromText(text);
    if (parsed) return parsed as T;
  }

  for (const text of extractOutputEnvelopeTexts(payload)) {
    const parsed = parseJsonObjectFromText(text);
    if (parsed) return parsed as T;
  }

  throw new SolarResponseFormatError();
}

class SolarHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Upstage request failed with ${status}`);
  }
}

class SolarResponseFormatError extends ApiError {
  constructor() {
    super("AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.", 502);
  }
}

class SolarResponseLengthError extends ApiError {
  constructor() {
    super("AI 응답 길이가 제한을 넘었어요. 더 넉넉한 분량으로 다시 시도해 주세요.", 502);
  }
}

function shouldFallbackToSolarPro3(error: SolarHttpError, preferredModel: string) {
  if (preferredModel === FALLBACK_MODEL) return false;
  if (error.status !== 400 && error.status !== 404) return false;
  return /model|not found|not_exist|does not exist|모델|찾을 수/i.test(error.bodyText);
}

function shouldRetryWithoutResponseFormat(error: SolarHttpError) {
  if (error.status !== 400) return false;
  return /response_format|json_schema|json schema|structured output|unsupported|not supported|지원하지|지원되지/i.test(error.bodyText);
}

function getUpstageApiKey() {
  const key = (env as unknown as CloudflareEnv).UPSTAGE_API_KEY ?? process.env.UPSTAGE_API_KEY;
  if (!key) throw new ApiError("AI API 키가 아직 설정되지 않았어요.", 503);
  return key;
}

function getUpstageModel() {
  return (env as unknown as CloudflareEnv).UPSTAGE_MODEL ?? process.env.UPSTAGE_MODEL ?? DEFAULT_MODEL;
}

function isSolarPro4(model: string) {
  return model === DEFAULT_MODEL || model.startsWith(`${DEFAULT_MODEL}-`);
}

function completionTokenBudget(model: string, options: SolarJsonOptions) {
  const requested = options.maxTokens ?? 900;
  if (!isSolarPro4(model)) return requested;

  const minimum = options.schemaName === "writing_report"
    ? 4_000
    : options.schemaName === "story_continuation"
      ? 1_800
      : 1_600;
  return Math.max(requested, minimum);
}

function withSchemaPrompt(options: SolarJsonOptions): SolarMessage[] {
  return [
    {
      role: "system",
      content:
        `Return only one JSON object named ${options.schemaName}. Do not include markdown, prose, arrays, or primitive values. The object must follow this JSON Schema exactly:\n${JSON.stringify(options.schema)}`,
    },
    ...options.messages,
  ];
}

function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractContentTexts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];

  const texts = content.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  });
  return texts.length > 1 ? [...texts, texts.join("\n")] : texts;
}

function extractOutputEnvelopeTexts(payload: SolarPayload | null): string[] {
  if (!payload) return [];

  const texts: string[] = [];
  if (typeof payload.output_text === "string") texts.push(payload.output_text);
  texts.push(...extractKnownTextFields(payload.output));
  return texts;
}

function extractKnownTextFields(value: unknown, depth = 0): string[] {
  if (depth > 4 || !value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => extractKnownTextFields(item, depth + 1));
  if (typeof value !== "object") return [];

  const object = value as { content?: unknown; output_text?: unknown; text?: unknown };
  return [
    ...extractKnownTextFields(object.output_text, depth + 1),
    ...extractKnownTextFields(object.text, depth + 1),
    ...extractKnownTextFields(object.content, depth + 1),
  ];
}

function parseJsonObjectFromText(text: string) {
  const trimmed = text.trim();
  try {
    return asJsonObject(JSON.parse(trimmed));
  } catch {
    // Continue with tolerant extraction for fenced or prose-wrapped JSON objects.
  }

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = asJsonObject(safeJsonParse(match[1].trim()));
    if (parsed) return parsed;
  }

  for (const candidate of extractJsonObjectCandidates(trimmed)) {
    const parsed = asJsonObject(safeJsonParse(candidate));
    if (parsed) return parsed;
  }
  return null;
}

function extractJsonObjectCandidates(text: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "[") {
      arrayDepth += 1;
      continue;
    }
    if (char === "]" && arrayDepth > 0) {
      arrayDepth -= 1;
      continue;
    }
    if (char === "{") {
      if (arrayDepth > 0) continue;
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}
