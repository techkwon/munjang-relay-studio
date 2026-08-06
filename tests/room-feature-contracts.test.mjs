import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

let liveStoryModule;

async function readProjectFile(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function readExistingProjectFiles(paths) {
  const files = await Promise.all(
    paths.map(async (path) => {
      try {
        return await readProjectFile(path);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
        throw error;
      }
    }),
  );
  return files.join("\n");
}

async function loadLiveStory() {
  if (liveStoryModule) return liveStoryModule;
  const source = await readProjectFile("lib/live-story.ts");
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

function room(overrides = {}) {
  return {
    room_code: "ROOM42",
    owner_user_id: "teacher-1",
    owner_email: "teacher@example.test",
    status: "complete",
    writer_limit: 2,
    human_limit: 2,
    ai_limit: 0,
    moderation_nsfw: 1,
    moderation_hate: 1,
    moderation_threat: 1,
    moderation_slang: 1,
    moderation_warning_lock: 1,
    moderation_warning_limit: 3,
    genre: "all",
    turn_limit: 6,
    turn_seconds: 60,
    order_mode: "sequential",
    current_turn_index: 0,
    current_deadline_at: null,
    seed_index: 0,
    event_index: 0,
    story_title: "비밀 이야기",
    story_setup: "교실에서 이어 쓰는 이야기",
    story_opener: "창문 밖에서 작은 빛이 깜박였습니다.",
    seed_source: "manual",
    ai_generation_status: "complete",
    ai_generation_claim: null,
    ai_generation_claimed_at: null,
    ai_generation_state: null,
    analysis_status: "complete",
    analysis_report: null,
    writer_levels: '["elementary","middle"]',
    created_at: 1,
    updated_at: 2,
    started_at: 3,
    completed_at: 4,
    closed_at: null,
    ...overrides,
  };
}

function participant(id, writerName, slotIndex) {
  return {
    id,
    room_code: "ROOM42",
    writer_name: writerName,
    writer_type: "human",
    ai_role: null,
    token_hash: `token-${id}`,
    slot_index: slotIndex,
    warning_count: 0,
    last_warning_at: null,
    blocked_at: null,
    joined_at: 1,
  };
}

test("parseRoomSettings accepts teacher-written opening text without calling AI", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  const settings = parseRoomSettings({
    writerTypes: ["human", "ai"],
    writerLevels: ["elementary", "middle"],
    turnLimit: 6,
    seedMode: "manual",
    storyTitle: "사라진 단서",
    storySetup: "학생들이 사진 한 장을 보고 이어 쓰는 이야기",
    storyOpener: "칠판 아래에서 접힌 사진 한 장이 천천히 펼쳐졌습니다.",
  });

  assert.equal(settings.seed.source, "manual");
  assert.deepEqual(settings.seed, {
    source: "manual",
    title: "사라진 단서",
    setup: "학생들이 사진 한 장을 보고 이어 쓰는 이야기",
    opener: "칠판 아래에서 접힌 사진 한 장이 천천히 펼쳐졌습니다.",
    referenceNote: null,
  });
});

test("parseRoomSettings rejects manual opening setup without a first sentence", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  assert.throws(
    () => parseRoomSettings({
      writerTypes: ["human", "ai"],
      turnLimit: 6,
      seedMode: "manual",
      storyTitle: "제목만 있음",
      storySetup: "충분히 긴 상황 설명을 넣었지만 첫 문장은 비워 둔 상태입니다.",
    }),
    /첫 문장/,
  );
});

test("parseRoomSettings accepts AI recommended opening mode", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  const settings = parseRoomSettings({
    writerTypes: ["human", "ai"],
    turnLimit: 6,
    seedMode: "ai",
  });

  assert.equal(settings.seed.source, "ai");
  assert.equal(typeof settings.seed.title, "string");
  assert.equal(typeof settings.seed.opener, "string");
});

test("parseRoomSettings accepts free topic as distinct from random all genre", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  const randomSettings = parseRoomSettings({
    writerTypes: ["human", "ai"],
    turnLimit: 6,
    genre: "all",
  });
  const freeSettings = parseRoomSettings({
    writerTypes: ["human", "ai"],
    turnLimit: 6,
    genre: "free",
  });

  assert.equal(randomSettings.genre, "all");
  assert.equal(freeSettings.genre, "free");
  assert.notEqual(freeSettings.genre, randomSettings.genre);
});

test("parseRoomSettings accepts reference opening text and a teacher note", async () => {
  const { parseRoomSettings } = await loadLiveStory();

  const settings = parseRoomSettings({
    writerTypes: ["human", "ai"],
    turnLimit: 6,
    seedMode: "reference",
    storyTitle: "사진 속 계단",
    storySetup: "학생들이 첨부 자료를 보며 이어 쓰는 이야기입니다.",
    storyOpener: "사진 속 계단 끝에서 빨간 우산 하나가 거꾸로 매달려 있었습니다.",
    referenceNote: "첨부 사진의 계단과 우산을 보며 장면을 이어 쓰기",
  });

  assert.equal(settings.seed.source, "reference");
  assert.equal(settings.seed.referenceNote, "첨부 사진의 계단과 우산을 보며 장면을 이어 쓰기");
});

test("teacher room PATCH supports lobby-only settings updates", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /action === "update_settings"/);
  assert.match(route, /async function updateSettings/);
  assert.match(route, /room\.status !== "lobby"/);
  assert.match(route, /대기 중인 방만 설정을 바꿀 수 있어요/);
  assert.match(route, /parseRoomSettings\(body\)/);
});

test("lobby settings updates preserve already joined human writers by slot", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /const participants = await getParticipants\(db, room\.room_code\)/);
  assert.match(route, /const humanCount = participants\.filter/);
  assert.match(route, /getConfiguredWriterTypes\(room, participants\)/);
  assert.match(route, /학생이 입장한 뒤에는 작가 구성과 참가자 수준을 바꿀 수 없어요/);
  assert.match(route, /DELETE FROM participants[\s\S]*writer_type = 'ai'/);
  assert.match(route, /makeAiParticipants\(room\.room_code, settings\.writerTypes/);
});

test("teacher can copy an existing room into the create form without reusing the room code", async () => {
  const teacher = await readProjectFile("app/teacher/TeacherDashboard.tsx");

  assert.match(teacher, /prefillRoomForm/);
  assert.match(teacher, /설정 복사/);
  assert.match(teacher, /설정 편집/);
  assert.match(teacher, /setTeacherView\("create"\)/);
  assert.match(teacher, /setWriterTypes/);
  assert.match(teacher, /setWriterLevels/);
  assert.match(teacher, /setModerationSettings/);
  assert.match(teacher, /setEditRoomCode\(mode === "edit" \? room\.code : null\)/);
});

test("teacher create flow exposes AI manual and reference opening modes", async () => {
  const teacher = await readProjectFile("app/teacher/TeacherDashboard.tsx");

  assert.match(teacher, /seedMode/);
  assert.match(teacher, /AI 추천 문장|AI 추천|seedMode === "ai"/);
  assert.match(teacher, /직접 입력|선생님 입력/);
  assert.match(teacher, /이미지|PDF/);
  assert.match(teacher, /storyOpener|첫 문장/);
  assert.match(teacher, /materialFile|referenceNote|첨부 자료/);
});

test("teacher create and edit forms expose free topic separately from random genre", async () => {
  const teacher = await readProjectFile("app/teacher/TeacherDashboard.tsx");

  assert.match(teacher, /\["all",\s*"랜덤"\]/);
  assert.match(teacher, /\["free",\s*"자유 주제"\]|\["free",\s*"자유"\]/);
  assert.match(teacher, /value=\{genre\}/);
  assert.match(teacher, /setGenre\(room\.genre\)/);
  assert.match(teacher, /genre,/);
});

test("teacher create form posts the selected opening mode and material note through the active submit handler", async () => {
  const teacher = await readProjectFile("app/teacher/TeacherDashboard.tsx");

  assert.match(teacher, /<form onSubmit=\{submitRoomForm\}/);
  assert.match(teacher, /disabled=\{busy \|\| !canSubmitRoomForm\}/);
  assert.match(teacher, /seedMode,/);
  assert.match(teacher, /storyTitle: manualTitle\.trim\(\)/);
  assert.match(teacher, /referenceNote: referenceNote\.trim\(\)/);
  assert.doesNotMatch(teacher, /<form onSubmit=\{createRoom\}/);
  assert.doesNotMatch(teacher, /!canCreateRoom/);
});

test("reference upload route authenticates teachers before storing files in R2", async () => {
  const uploadRoute = await readExistingProjectFiles([
    "app/api/teacher/rooms/material/route.ts",
    "app/api/teacher/references/route.ts",
    "app/api/teacher/uploads/route.ts",
    "app/api/uploads/route.ts",
  ]);

  assert.match(uploadRoute, /getChatGPTUser|requireApiUser/);
  assert.match(uploadRoute, /if \(!user\)|로그인이 필요/);
  assert.match(uploadRoute, /getRoomAssets|ROOM_ASSETS|REFERENCE_BUCKET|ATTACHMENTS/);
  assert.match(uploadRoute, /\.put\(/);
  assert.doesNotMatch(uploadRoute, /up_[A-Za-z0-9]{12,}|UPSTAGE_API_KEY/);
});

test("reference upload route accepts only images and PDFs up to 10MiB", async () => {
  const uploadRoute = await readExistingProjectFiles([
    "app/api/teacher/rooms/material/route.ts",
    "app/api/teacher/references/route.ts",
    "app/api/teacher/uploads/route.ts",
    "app/api/uploads/route.ts",
  ]);

  assert.match(uploadRoute, /image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf/);
  assert.match(uploadRoute, /10\s*\*\s*1024\s*\*\s*1024|10_485_760|10MiB|10MB/);
  assert.match(uploadRoute, /content-type|file\.type|mime/i);
  assert.match(uploadRoute, /지원하지 않는 파일|이미지 또는 PDF/);
});

test("reference upload preserves the teacher note field used by the room form", async () => {
  const [teacher, uploadRoute] = await Promise.all([
    readProjectFile("app/teacher/TeacherDashboard.tsx"),
    readProjectFile("app/api/teacher/rooms/material/route.ts"),
  ]);

  assert.match(teacher, /formData\.append\("referenceNote", referenceNote\.trim\(\)\)/);
  assert.match(uploadRoute, /form\.get\("referenceNote"\)/);
  assert.match(uploadRoute, /material_note = \?, reference_note = \?/);
});

test("student material loading reads authenticated binary responses as blobs", async () => {
  const [student, materialRoute] = await Promise.all([
    readProjectFile("app/join/StudentJoin.tsx"),
    readProjectFile("app/api/rooms/material/route.ts"),
  ]);

  assert.match(student, /authorization: `Bearer \$\{activeSession\.token\}`/);
  assert.match(student, /const blob = await response\.blob\(\)/);
  assert.match(student, /URL\.createObjectURL\(blob\)/);
  assert.match(materialRoute, /getParticipantByToken/);
  assert.match(materialRoute, /room\.seed_source !== "reference"/);
});

test("teacher room creation keeps the documented twenty simultaneous open-room limit", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /status IN \('lobby', 'active'\)/);
  assert.match(route, />= 20/);
  assert.match(route, /동시에 운영할 수 있는 방은 20개까지/);
  assert.match(route, /SELECT \* FROM rooms WHERE owner_user_id = \? ORDER BY updated_at DESC/);
});

test("room edit and copy preserve moderation choices and lock level controls after students join", async () => {
  const teacher = await readProjectFile("app/teacher/TeacherDashboard.tsx");

  assert.match(teacher, /moderationSettings: normalizeModerationSettings\(value\.moderationSettings\)/);
  assert.match(teacher, /setModerationSettings\(room\.moderationSettings \?\? DEFAULT_MODERATION_SETTINGS\)/);
  assert.match(teacher, /function setWriterLevel[\s\S]*participantControlsLocked/);
  assert.match(teacher, /aria-label=\{`\$\{index \+ 1\}번[\s\S]*disabled=\{participantControlsLocked\}/);
});

test("room composition edits recheck for a concurrent student join inside the update batch", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /NOT EXISTS \([\s\S]*writer_type = 'human'/);
  assert.match(route, /\? > 0 OR NOT EXISTS/);
  assert.match(route, /INSERT INTO participants[\s\S]*SELECT \?, \?, \?, 'ai'[\s\S]*WHERE NOT EXISTS/);
});

test("backend and schema contracts keep free topic available wherever room genre is typed", async () => {
  const [liveStory, schema, aiRoute] = await Promise.all([
    readProjectFile("lib/live-story.ts"),
    readProjectFile("db/schema.ts"),
    readProjectFile("app/api/ai/route.ts"),
  ]);

  assert.match(liveStory, /export type Genre = [^;]*"free"/);
  assert.match(liveStory, /const GENRES:[\s\S]*"free"/);
  assert.match(liveStory, /FALLBACK_SEEDS:[\s\S]*free:/);
  assert.match(schema, /enum: \[[^\]]*"free"/);
  assert.match(aiRoute, /장르: \$\{room\.genre\}/);
});

test("student waiting state uses a game-like loading screen without hiding progress from reduced-motion users", async () => {
  const [student, css] = await Promise.all([
    readProjectFile("app/join/StudentJoin.tsx"),
    readProjectFile("app/globals.css"),
  ]);

  assert.ok(/waiting-window/.test(student), "student waiting state should render a waiting window");
  assert.ok(/loading-game|loadingStage|게임|스테이지|퀘스트/.test(student), "waiting state should feel like a game loading screen");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), "CSS should include a reduced-motion media query");
  assert.ok(/\.waiting-pulse[\s\S]*animation/.test(css), "waiting pulse should have a deliberate animation");
  assert.ok(
    /prefers-reduced-motion: reduce[\s\S]*\.waiting-pulse[\s\S]*animation:\s*none/.test(css),
    "waiting pulse animation should be disabled for reduced-motion users",
  );
});

test("student payload can scope analysis report details to the signed-in participant only", async () => {
  const { safeRoom } = await loadLiveStory();
  const testRoom = room({
    analysis_report: JSON.stringify({
      summary: "함께 완성했습니다.",
      writers: [
        { participantId: "pt_a", name: "가람", evidence: ["색깔 단서를 다시 사용함"], practiceSteps: ["감각 표현 한 가지 더하기"] },
        { participantId: "pt_b", name: "나래", evidence: ["대화를 자연스럽게 이음"], practiceSteps: ["행동 묘사 늘리기"] },
      ],
      groupSuggestion: "다음에는 단서를 표시해 보세요.",
    }),
  });

  const scoped = safeRoom(
    testRoom,
    [participant("pt_a", "가람", 0), participant("pt_b", "나래", 1)],
    [],
    { participantId: "pt_a" },
  );

  assert.deepEqual(scoped.analysisReport.writers.map((writer) => writer.name), ["가람"]);
  assert.equal(scoped.analysisReport.summary, "함께 완성했습니다.");
  assert.equal(scoped.analysisReport.groupSuggestion, "다음에는 단서를 표시해 보세요.");
});

test("teacher payload still includes the full class report for classroom review", async () => {
  const { safeRoom } = await loadLiveStory();
  const testRoom = room({
    analysis_report: JSON.stringify({
      summary: "함께 완성했습니다.",
      writers: [
        { participantId: "pt_a", name: "가람", evidence: ["색깔 단서를 다시 사용함"], practiceSteps: ["감각 표현 한 가지 더하기"] },
        { participantId: "pt_b", name: "나래", evidence: ["대화를 자연스럽게 이음"], practiceSteps: ["행동 묘사 늘리기"] },
      ],
    }),
  });

  const scoped = safeRoom(testRoom, [participant("pt_a", "가람", 0), participant("pt_b", "나래", 1)], [], { teacher: true });

  assert.deepEqual(scoped.analysisReport.writers.map((writer) => writer.name), ["가람", "나래"]);
});

test("public room previews do not expose completed student reports before participant authentication", async () => {
  const { safeRoom } = await loadLiveStory();
  const testRoom = room({
    analysis_report: JSON.stringify({
      summary: "함께 완성했습니다.",
      writers: [{ participantId: "pt_a", name: "가람", strengths: ["장면 묘사"] }],
    }),
  });

  const preview = safeRoom(testRoom, [participant("pt_a", "가람", 0)], []);

  assert.equal(preview.analysisReport, null);
});

test("detailed writer report schema requires evidence strengths practice steps and safe disclaimers", async () => {
  const aiRoute = await readProjectFile("app/api/ai/route.ts");

  assert.match(aiRoute, /evidence|evidenceExcerpts|문장 근거/);
  assert.match(aiRoute, /practiceSteps|practiceSuggestion|다음 연습/);
  assert.match(aiRoute, /strengths/);
  assert.match(aiRoute, /순위화하거나 평가 점수로 사용하지 않습니다/);
  assert.match(aiRoute, /AI 작가는 평가하지 마/);
});

test("teacher and student reports render per-student evidence and practice fields", async () => {
  const [teacher, student] = await Promise.all([
    readProjectFile("app/teacher/TeacherDashboard.tsx"),
    readProjectFile("app/join/StudentJoin.tsx"),
  ]);

  assert.match(`${teacher}\n${student}`, /근거|evidence|evidenceExcerpts/);
  assert.match(`${teacher}\n${student}`, /다음 연습|practiceSteps|practiceSuggestion|nextStep/);
  assert.match(student, /myReport/);
  assert.match(student, /writer-report-item/);
  assert.doesNotMatch(student, /% 기여|기여도 순위|점수/);
});
