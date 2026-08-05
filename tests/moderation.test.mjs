import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";

let moderationModule;
let liveStoryModule;

async function loadModeration() {
  if (moderationModule) return moderationModule;
  const source = await readFile(new URL("../lib/moderation.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  moderationModule = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  return moderationModule;
}

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

async function readProjectFile(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("respects per-room category toggles", async () => {
  const { defaultModerationSettings, moderateSubmission } = await loadModeration();

  const disabled = defaultModerationSettings({ nsfw: false });
  assert.equal(moderateSubmission("야동 같은 장면이 나왔다", disabled, "middle").flagged, false);

  const enabled = defaultModerationSettings({ nsfw: true });
  assert.deepEqual(moderateSubmission("야동 같은 장면이 나왔다", enabled, "middle").categories, ["nsfw"]);
});

test("applies grade-specific slang sensitivity", async () => {
  const { defaultModerationSettings, moderateSubmission } = await loadModeration();
  const settings = defaultModerationSettings();

  assert.deepEqual(moderateSubmission("너는 바보야", settings, "elementary").categories, ["slang"]);
  assert.equal(moderateSubmission("너는 바보야", settings, "middle").flagged, false);
  assert.deepEqual(moderateSubmission("존나 빠르게 달렸다", settings, "middle").categories, ["slang"]);
  assert.equal(moderateSubmission("존나 빠르게 달렸다", settings, "high").flagged, false);
});

test("normalizes NFKC zero-width spacing and punctuation evasions", async () => {
  const { defaultModerationSettings, moderateSubmission } = await loadModeration();
  const settings = defaultModerationSettings();

  assert.deepEqual(moderateSubmission("ｓｅｘ라는 단어", settings, "high").categories, ["nsfw"]);
  assert.deepEqual(moderateSubmission("죽여버리겠다고 말했다", settings, "middle").categories, ["threat"]);
  assert.deepEqual(moderateSubmission("ㅅ\u200b. ㅂ 하지 말자", settings, "middle").categories, ["slang"]);
});

test("builds AI rewrite prompts and rejects unsafe mock rewrites", async () => {
  const {
    buildModerationRewriteMessages,
    defaultModerationSettings,
    moderateSubmission,
    validateModerationRewrite,
  } = await loadModeration();
  const settings = defaultModerationSettings();
  const original = "주인공이 ㅅㅂ이라고 외치며 문을 열었다";
  const findings = moderateSubmission(original, settings, "middle");
  assert.deepEqual(findings.categories, ["slang"]);

  const messages = buildModerationRewriteMessages({
    text: original,
    categories: findings.categories,
    level: "middle",
    storyTitle: "비밀 문",
    storySetup: "교실 릴레이 이야기",
    storyOpener: "문고리가 차갑게 빛났다.",
  });
  assert.match(messages[0].content, /안전 편집자/);
  assert.match(messages[0].content, /신뢰할 수 없는 데이터/);
  assert.match(messages[1].content, /감지 범주: slang/);
  assert.match(messages[1].content, /<UNTRUSTED_STUDENT_TEXT>/);

  assert.equal(validateModerationRewrite("주인공이 깜짝 놀라 외치며 문을 열었다", settings, "middle"), true);
  assert.equal(validateModerationRewrite("주인공이 ㅅㅂ이라고 외치며 문을 열었다", settings, "middle"), false);
});

test("student submit route rewrites flagged text before storing or advancing", async () => {
  const route = await readProjectFile("app/api/rooms/route.ts");
  const teacherRoute = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /storedText = await rewriteFlaggedSubmission/);
  assert.match(route, /validateModerationRewrite\(storedText, moderationSettings, writerLevel\)/);
  assert.match(route, /throw new ApiError\("AI가 안전한 문장으로 순화하지 못했어요/);
  assert.match(route, /SET moderation_checked_at = \?, deadline_at = \?/);
  assert.match(route, /moderation_checked_at IS NULL/);
  assert.match(route, /이미 안전 점검 중인 문장/);
  assert.match(route, /SET moderation_checked_at = NULL, deadline_at = \?/);
  assert.match(route, /AND moderation_checked_at = \?/);
  assert.match(route, /SET status = 'submitted', text = \?, moderation_categories = \?, submitted_at = \?/);
  assert.match(route, /\.bind\(\s*storedText,/);
  assert.match(route, /warning_count = warning_count \+ 1/);
  assert.match(route, /blocked_at = \?/);
  assert.match(route, /EXISTS \(\s*SELECT 1 FROM story_turns/);
  assert.match(route, /status = 'submitted' AND submitted_at = \? AND moderation_checked_at = \?/);
  assert.match(route, /rooms\.status = 'active' AND rooms\.current_turn_index = story_turns\.turn_index/);
  assert.match(route, /story_turns\.status = 'submitted'[\s\S]*story_turns\.submitted_at = \?[\s\S]*story_turns\.moderation_checked_at = \?/);
  assert.match(route, /applied: initialModeration\.flagged/);
  assert.match(route, /aiRewritten/);
  assert.match(route, /warningLimit: moderationSettings\.warningLimit/);
  assert.match(route, /writingRestricted: nextParticipant\.blocked_at != null/);
  assert.doesNotMatch(route, /rawText|originalText|flaggedText/);
  assert.match(teacherRoute, /writer_type = 'human'/);

  const roomInsert = teacherRoute.match(/`INSERT INTO rooms \([\s\S]*?\) VALUES \([\s\S]*?\)`/)?.[0];
  assert.ok(roomInsert, "room INSERT SQL should remain present");
  assert.equal(roomInsert.match(/\?/g)?.length, 24, "room INSERT placeholders must match all bound values");
});

test("moderation migration protects legacy rooms by default", async () => {
  const migrations = [
    await readProjectFile("drizzle/0000_sharp_garia.sql"),
    await readProjectFile("drizzle/0001_furry_stingray.sql"),
    await readProjectFile("drizzle/0002_writer_levels.sql"),
    await readProjectFile("drizzle/0003_soft_fabian_cortez.sql"),
  ];
  const tempDir = mkdtempSync(join(tmpdir(), "munjang-itgi-moderation-migration-"));
  const dbPath = join(tempDir, "test.sqlite");
  try {
    writeFileSync(join(tempDir, "0000.sql"), migrations[0]);
    writeFileSync(join(tempDir, "0001.sql"), migrations[1]);
    writeFileSync(join(tempDir, "0002.sql"), migrations[2]);
    writeFileSync(join(tempDir, "0003.sql"), migrations[3]);
    execFileSync("sqlite3", [dbPath, `.read ${join(tempDir, "0000.sql")}`], { encoding: "utf8" });
    execFileSync("sqlite3", [dbPath, `.read ${join(tempDir, "0001.sql")}`], { encoding: "utf8" });
    execFileSync(
      "sqlite3",
      [
        dbPath,
        "INSERT INTO rooms (room_code, owner_user_id, owner_email, writer_limit, human_limit, ai_limit, genre, turn_limit, turn_seconds, seed_index, event_index, story_title, story_setup, story_opener, created_at, updated_at) VALUES ('LEGACY', 'owner', 'teacher@example.test', 4, 3, 1, 'all', 8, 60, 0, 0, 'title', 'setup', 'opener', 1, 1);",
      ],
      { encoding: "utf8" },
    );
    execFileSync("sqlite3", [dbPath, `.read ${join(tempDir, "0002.sql")}`], { encoding: "utf8" });
    execFileSync("sqlite3", [dbPath, `.read ${join(tempDir, "0003.sql")}`], { encoding: "utf8" });

    const legacy = execFileSync(
      "sqlite3",
      [
        dbPath,
        "SELECT moderation_nsfw || '|' || moderation_hate || '|' || moderation_threat || '|' || moderation_slang || '|' || moderation_warning_lock || '|' || moderation_warning_limit FROM rooms WHERE room_code = 'LEGACY';",
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(legacy, "1|1|1|1|1|3");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("advanceExpiredTurns skips a blocked current human without waiting for deadline", async () => {
  const { advanceExpiredTurns } = await loadLiveStory();
  const state = {
    room: {
      room_code: "ROOM42",
      status: "active",
      current_turn_index: 0,
      current_deadline_at: Date.now() + 60_000,
      turn_limit: 2,
      turn_seconds: 60,
    },
    turn: {
      status: "pending",
      blocked_at: 123,
    },
  };
  const db = {
    prepare(query) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (/SELECT story_turns\.status AS status/.test(query)) return state.turn;
          if (/SELECT \* FROM rooms WHERE room_code = \?/.test(query)) return state.room;
          return null;
        },
        async run() {
          if (/UPDATE story_turns SET status = 'skipped'/.test(query)) {
            state.turn.status = "skipped";
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE rooms SET current_turn_index = current_turn_index \+ 1/.test(query)) {
            state.room.current_turn_index += 1;
            state.room.current_deadline_at = this.values[0];
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
    async batch(statements) {
      return await Promise.all(statements.map((statement) => statement.run()));
    },
  };

  const advanced = await advanceExpiredTurns(db, state.room, Date.now());
  assert.equal(state.turn.status, "skipped");
  assert.equal(advanced.current_turn_index, 1);
});

test("student room payload hides filter settings and other writers moderation metadata", async () => {
  const { safeRoom } = await loadLiveStory();
  const room = {
    room_code: "ROOM42",
    status: "active",
    writer_limit: 1,
    human_limit: 1,
    ai_limit: 0,
    writer_levels: '["elementary"]',
    moderation_nsfw: 1,
    moderation_hate: 1,
    moderation_threat: 1,
    moderation_slang: 1,
    moderation_warning_lock: 1,
    moderation_warning_limit: 3,
    genre: "all",
    turn_limit: 1,
    turn_seconds: 60,
    order_mode: "sequential",
    current_turn_index: 0,
    current_deadline_at: 10,
    story_title: "비밀 이야기",
    story_setup: "교실",
    story_opener: "문이 열렸다.",
  };
  const turn = {
    turn_index: 0,
    participant_id: "student-1",
    writer_name: "학생 작가",
    writer_type: "human",
    status: "submitted",
    text: "안전하게 순화된 문장",
    moderation_categories: '["slang"]',
    moderation_checked_at: 5,
    deadline_at: 10,
    submitted_at: 6,
  };

  const studentPayload = safeRoom(room, [], [turn]);
  assert.equal("moderationSettings" in studentPayload, false);
  assert.equal("moderationCategories" in studentPayload.currentTurn, false);
  assert.equal("moderationCheckedAt" in studentPayload.story.entries[0], false);

  const teacherPayload = safeRoom(room, [], [turn], { teacher: true });
  assert.equal(teacherPayload.moderationSettings.warningLimit, 3);
  assert.deepEqual(teacherPayload.currentTurn.moderationCategories, ["slang"]);
  assert.equal(teacherPayload.story.entries[0].moderationCheckedAt, 5);
});
