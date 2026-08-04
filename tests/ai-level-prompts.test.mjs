import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let aiLevelsModule;

async function loadAiLevels() {
  if (aiLevelsModule) return aiLevelsModule;
  const source = await readFile(new URL("../lib/ai-levels.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  aiLevelsModule = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  return aiLevelsModule;
}

test("builds distinct continuation guidance for elementary middle and high AI seats", async () => {
  const { buildContinuationLevelGuidance } = await loadAiLevels();

  const elementary = buildContinuationLevelGuidance("elementary");
  const middle = buildContinuationLevelGuidance("middle");
  const high = buildContinuationLevelGuidance("high");

  assert.match(elementary, /쉬운 어휘/);
  assert.match(elementary, /짧은 문장/);
  assert.match(elementary, /명확한 행동|행동/);
  assert.match(middle, /감정/);
  assert.match(middle, /장면 전환/);
  assert.match(middle, /복선/);
  assert.match(high, /문체/);
  assert.match(high, /서사 구조/);
  assert.match(high, /주제 의식/);
  assert.match(high, /난해함/);
  assert.match(high, /과잉 현학/);
});

test("mixed-level seed guidance remains readable to the lowest level with next-level room", async () => {
  const { buildSeedLevelGuidance } = await loadAiLevels();
  const guidance = buildSeedLevelGuidance(["high", "elementary", "middle"]);

  assert.match(guidance, /혼합 학급/);
  assert.match(guidance, /초등 학생도 바로 이해/);
  assert.match(guidance, /중등 수준의 서사 여지/);
  assert.match(guidance, /초등 1명/);
  assert.match(guidance, /중등 1명/);
  assert.match(guidance, /고등 1명/);
});

test("report guidance includes each human level and bans rank score comparisons", async () => {
  const { buildReportLevelGuidance } = await loadAiLevels();
  const guidance = buildReportLevelGuidance([
    { name: "사람 작가 1", level: "elementary" },
    { name: "사람 작가 2", level: "high" },
  ]);

  assert.match(guidance, /사람 작가 1: 초등 수준/);
  assert.match(guidance, /사람 작가 2: 고등 수준/);
  assert.match(guidance, /같은 설정 수준의 성장 기준/);
  assert.match(guidance, /순위/);
  assert.match(guidance, /점수/);
  assert.match(guidance, /수준 간 비교/);
});
