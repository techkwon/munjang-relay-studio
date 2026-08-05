import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let solarModule;

async function loadSolar() {
  if (solarModule) return solarModule;

  const source = await readFile(new URL("../lib/solar.ts", import.meta.url), "utf8");
  const testableSource = source
    .replace('import { env } from "cloudflare:workers";', "const env = {};")
    .replace(
      'import { ApiError, type CloudflareEnv } from "@/lib/live-story";',
      "class ApiError extends Error { constructor(message, status = 500) { super(message); this.status = status; } }",
    );
  const output = `${ts.transpileModule(testableSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText}\n//# sourceURL=solar-under-test.mjs`;

  solarModule = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  return solarModule;
}

const seedSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    setup: { type: "string" },
    opener: { type: "string" },
  },
  required: ["title", "setup", "opener"],
};

const expectedSeed = {
  title: "비밀 우산",
  setup: "비 오는 운동장에 낯선 우산이 하나 남겨져 있다.",
  opener: "우산을 펼치자 손잡이 안쪽에서 우리 반 이름표가 젖은 채 떨어졌다.",
};

async function generateSeedFromPayload(payload, onRequest = () => {}) {
  const { generateSolarJson } = await loadSolar();
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.UPSTAGE_API_KEY;
  const originalModel = process.env.UPSTAGE_MODEL;

  process.env.UPSTAGE_API_KEY = "test-upstage-key";
  process.env.UPSTAGE_MODEL = "solar-pro4";
  globalThis.fetch = async (_url, init) => {
    const requestBody = JSON.parse(String(init.body));
    assert.equal(requestBody.model, "solar-pro4");
    assert.equal(requestBody.response_format.type, "json_schema");
    assert.equal(requestBody.response_format.json_schema.name, "story_seed");
    assert.match(requestBody.messages[0].content, /Return only one JSON object named story_seed/);
    assert.match(requestBody.messages[0].content, /"required":\["title","setup","opener"\]/);
    onRequest(requestBody);

    return new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    return await generateSolarJson({
      schemaName: "story_seed",
      schema: seedSchema,
      messages: [
        { role: "system", content: "JSON only." },
        { role: "user", content: "첫 문장을 만들어 줘." },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.UPSTAGE_API_KEY;
    else process.env.UPSTAGE_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.UPSTAGE_MODEL;
    else process.env.UPSTAGE_MODEL = originalModel;
  }
}

async function generateSeedFromContent(content) {
  return generateSeedFromPayload({
    choices: [
      {
        message: { content },
      },
    ],
  });
}

test("parses a plain JSON string from Upstage message content", async () => {
  const seed = await generateSeedFromContent(JSON.stringify(expectedSeed));

  assert.deepEqual(seed, expectedSeed);
});

test("parses JSON fenced Upstage message content", async () => {
  const seed = await generateSeedFromContent(`\`\`\`json\n${JSON.stringify(expectedSeed)}\n\`\`\``);

  assert.deepEqual(seed, expectedSeed);
});

test("parses message.parsed when present", async () => {
  const seed = await generateSeedFromPayload({
    choices: [
      {
        message: {
          content: "",
          parsed: expectedSeed,
        },
      },
    ],
  });

  assert.deepEqual(seed, expectedSeed);
});

test("parses compatible output envelope text", async () => {
  const seed = await generateSeedFromPayload({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: `응답:\n${JSON.stringify(expectedSeed)}`,
          },
        ],
      },
    ],
  });

  assert.deepEqual(seed, expectedSeed);
});

test("rejects array or primitive model payloads as final parsed results", async () => {
  await assert.rejects(
    () => generateSeedFromContent(JSON.stringify([expectedSeed])),
    /AI 응답 형식이 올바르지 않아요/,
  );
  await assert.rejects(
    () => generateSeedFromContent("\"not an object\""),
    /AI 응답 형식이 올바르지 않아요/,
  );
});

test("retries the same model once without response_format when Solar rejects it", async () => {
  const { generateSolarJson } = await loadSolar();
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.UPSTAGE_API_KEY;
  const originalModel = process.env.UPSTAGE_MODEL;
  const requests = [];

  process.env.UPSTAGE_API_KEY = "test-upstage-key";
  process.env.UPSTAGE_MODEL = "solar-pro4";
  globalThis.fetch = async (_url, init) => {
    const requestBody = JSON.parse(String(init.body));
    requests.push(requestBody);
    assert.equal(requestBody.model, "solar-pro4");
    assert.match(requestBody.messages[0].content, /Return only one JSON object named story_seed/);

    if (requests.length === 1) {
      assert.equal(requestBody.response_format.type, "json_schema");
      return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(requestBody.response_format, undefined);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(expectedSeed) },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const seed = await generateSolarJson({
      schemaName: "story_seed",
      schema: seedSchema,
      messages: [
        { role: "system", content: "JSON only." },
        { role: "user", content: "첫 문장을 만들어 줘." },
      ],
    });

    assert.deepEqual(seed, expectedSeed);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.UPSTAGE_API_KEY;
    else process.env.UPSTAGE_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.UPSTAGE_MODEL;
    else process.env.UPSTAGE_MODEL = originalModel;
  }
});

test("parses Upstage message content when text surrounds the JSON object", async () => {
  const seed = await generateSeedFromContent(`좋아요. 아래 JSON으로 답합니다.\n${JSON.stringify(expectedSeed)}\n활동에 바로 사용할 수 있어요.`);

  assert.deepEqual(seed, expectedSeed);
});

test("parses the first text block when Upstage message content is an array", async () => {
  const seed = await generateSeedFromContent([
    {
      type: "text",
      text: JSON.stringify(expectedSeed),
    },
  ]);

  assert.deepEqual(seed, expectedSeed);
});
