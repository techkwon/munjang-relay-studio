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

const UPSTAGE_ENDPOINT = "https://api.upstage.ai/v1/chat/completions";
const DEFAULT_MODEL = "solar-pro4";
const FALLBACK_MODEL = "solar-pro3";
const TIMEOUT_MS = 25_000;

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
        messages: options.messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 900,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: options.schemaName,
            strict: true,
            schema: options.schema,
          },
        },
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

  const payload = safeJsonParse<{ choices?: Array<{ message?: { content?: unknown } }> }>(bodyText);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const parsed = safeJsonParse<T>(content);
    if (parsed) return parsed;
  }
  if (content && typeof content === "object") return content as T;

  throw new ApiError("AI 응답 형식이 올바르지 않아요. 다시 시도해 주세요.", 502);
}

class SolarHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Upstage request failed with ${status}`);
  }
}

function shouldFallbackToSolarPro3(error: SolarHttpError, preferredModel: string) {
  if (preferredModel === FALLBACK_MODEL) return false;
  if (error.status !== 400 && error.status !== 404) return false;
  return /model|not found|not_exist|does not exist|모델|찾을 수/i.test(error.bodyText);
}

function getUpstageApiKey() {
  const key = (env as unknown as CloudflareEnv).UPSTAGE_API_KEY ?? process.env.UPSTAGE_API_KEY;
  if (!key) throw new ApiError("AI API 키가 아직 설정되지 않았어요.", 503);
  return key;
}

function getUpstageModel() {
  return (env as unknown as CloudflareEnv).UPSTAGE_MODEL ?? process.env.UPSTAGE_MODEL ?? DEFAULT_MODEL;
}

function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
