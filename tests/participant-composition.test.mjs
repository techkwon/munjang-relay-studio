import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import test from "node:test";
import ts from "typescript";

let liveStoryModule;

async function loadLiveStory() {
  if (liveStoryModule) return liveStoryModule;
  const source = await readFile(new URL("../lib/live-story.ts", import.meta.url), "utf8");
  const testableSource = source.replace('import { env } from "cloudflare:workers";', "const env = {};");
  const output = ts.transpileModule(testableSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  liveStoryModule = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  return liveStoryModule;
}

function participant(id, writerType, slotIndex) {
  return {
    id,
    room_code: "ROOM42",
    writer_name: writerType === "ai" ? `AI ${slotIndex}` : `학생 ${slotIndex}`,
    writer_type: writerType,
    ai_role: writerType === "ai" ? "테스트 AI" : null,
    token_hash: writerType === "human" ? `token-${slotIndex}` : null,
    slot_index: slotIndex,
    joined_at: 1,
  };
}

test("accepts one human writer with nine AI writers in exact configured slots", async () => {
  const { makeAiParticipants, parseRoomSettings } = await loadLiveStory();
  const writerTypes = ["human", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai"];
  const settings = parseRoomSettings({ writerTypes, writerLimit: 10, turnLimit: 10 });

  assert.equal(settings.writerLimit, 10);
  assert.equal(settings.humanLimit, 1);
  assert.equal(settings.aiLimit, 9);
  assert.deepEqual(settings.writerTypes, writerTypes);

  const aiParticipants = makeAiParticipants("ABC234", settings.writerTypes, 123);
  assert.equal(aiParticipants.length, 9);
  assert.deepEqual(
    aiParticipants.map((item) => item.slotIndex),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    aiParticipants.map((item) => item.writerName),
    ["AI 작가 1", "AI 작가 2", "AI 작가 3", "AI 작가 4", "AI 작가 5", "AI 작가 6", "AI 작가 7", "AI 작가 8", "AI 작가 9"],
  );
  assert.equal(new Set(aiParticipants.map((item) => item.aiRole)).size, 9);
});

test("preserves backward compatible count payloads up to ten total writers", async () => {
  const { parseRoomSettings } = await loadLiveStory();
  const settings = parseRoomSettings({ writerLimit: 10, humanLimit: 1, aiLimit: 9, turnLimit: 10 });

  assert.equal(settings.writerLimit, 10);
  assert.equal(settings.humanLimit, 1);
  assert.equal(settings.aiLimit, 9);
  assert.deepEqual(settings.writerTypes, ["human", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai"]);
});

test("keeps anonymous room previews accurate without exposing room internals", async () => {
  const { safeRoomPreview } = await loadLiveStory();
  const preview = safeRoomPreview(
    {
      room_code: "ABC234",
      status: "lobby",
      writer_limit: 10,
      human_limit: 1,
      ai_limit: 9,
      teacher_id: "private-teacher-id",
      story_setup: "private setup",
      story_opener: "private opener",
    },
    [],
  );

  assert.deepEqual(preview, {
    roomCode: "ABC234",
    status: "lobby",
    writerLimit: 10,
    humanLimit: 1,
    aiLimit: 9,
    participantCount: 0,
    availableHumanSlots: 1,
  });
  assert.equal("teacherId" in preview, false);
  assert.equal("storySetup" in preview, false);
  assert.equal("storyOpener" in preview, false);
});

test("fills human joins into vacant human slots between configured AI seats", async () => {
  const { makeAiParticipants, nextHumanSlot, parseRoomSettings } = await loadLiveStory();
  const settings = parseRoomSettings({ writerTypes: ["ai", "human", "ai", "human", "ai"], turnLimit: 6 });
  const aiParticipants = makeAiParticipants("ROOM42", settings.writerTypes, 123).map((item) =>
    participant(item.id, item.writerType, item.slotIndex),
  );

  const firstHumanSlot = nextHumanSlot(aiParticipants, settings.humanLimit, settings.writerLimit);
  assert.equal(firstHumanSlot, 1);

  const withFirstHuman = [...aiParticipants, participant("pt_1", "human", firstHumanSlot)];
  const secondHumanSlot = nextHumanSlot(withFirstHuman, settings.humanLimit, settings.writerLimit);
  assert.equal(secondHumanSlot, 3);

  const fullRoom = [...withFirstHuman, participant("pt_2", "human", secondHumanSlot)];
  assert.equal(nextHumanSlot(fullRoom, settings.humanLimit, settings.writerLimit), null);
});

test("turn ordering uses configured sequential seats and stable random mode", async () => {
  const { makeTurnParticipantOrder } = await loadLiveStory();
  const participants = [
    participant("ai_0", "ai", 0),
    participant("pt_1", "human", 1),
    participant("ai_2", "ai", 2),
    participant("pt_3", "human", 3),
  ];

  assert.deepEqual(
    makeTurnParticipantOrder([...participants].reverse(), "sequential", "ROOM42").map((item) => item.id),
    ["ai_0", "pt_1", "ai_2", "pt_3"],
  );

  const firstRandom = makeTurnParticipantOrder(participants, "random", "ROOM42").map((item) => item.id);
  const secondRandom = makeTurnParticipantOrder(participants, "random", "ROOM42").map((item) => item.id);
  assert.deepEqual(firstRandom, secondRandom);
  assert.deepEqual([...firstRandom].sort(), ["ai_0", "ai_2", "pt_1", "pt_3"]);
});

test("rejects impossible writer role compositions", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  assert.throws(() => parseRoomSettings({ writerTypes: ["ai", "ai"], turnLimit: 6 }), /사람 작가가 최소 1명/);
  assert.throws(
    () => parseRoomSettings({ writerTypes: ["human", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai", "ai"], turnLimit: 10 }),
    /2명에서 10명/,
  );
  assert.throws(() => parseRoomSettings({ writerTypes: ["human", "bot"], turnLimit: 6 }), /사람 또는 AI/);
});
