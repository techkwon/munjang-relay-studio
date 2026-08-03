import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
register(new URL("./cloudflare-loader.mjs", import.meta.url));

async function readProjectFile(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Korean story relay setup", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>문장잇기 — AI와 함께 만드는 릴레이 이야기<\/title>/i);
  assert.match(html, /한 사람이 쓰고/);
  assert.match(html, /다음 사람이 상상해요/);
  assert.match(html, /오늘의 작가들을 모아 볼까요/);
  assert.match(html, /첫 문장 뽑기/);
  assert.match(html, /로그인 없이/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the finished product free of starter preview assets", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(page, /window\.localStorage/);
  assert.match(page, /function writeLocalGame/);
  assert.match(page, /if \(!writeLocalGame\(saved\)\) markStorageUnavailable\(\)/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(page, /role="timer"/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /aria-describedby="reset-description"/);
  assert.match(layout, /lang="ko"/);
  assert.match(layout, /\/og\.png/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview/);
  assert.doesNotMatch(layout, /codex-preview|Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await assert.doesNotReject(access(new URL("../public/og.png", import.meta.url)));
  await assert.doesNotReject(access(new URL(".openai/hosting.json", projectRoot)));
});

test("keeps local single-device writing in standalone localStorage", async () => {
  const page = await readProjectFile("app/page.tsx");

  assert.match(page, /const STORAGE_KEY = "munjang-itgi:v1"/);
  assert.match(page, /function readLocalGame/);
  assert.match(page, /window\.localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(page, /function writeLocalGame/);
  assert.match(page, /window\.localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(value\)\)/);
  assert.match(page, /function removeLocalGame/);
  assert.match(page, /이름과 원고는 서버로 전송하지 않습니다\./);
});

test("keeps local finished-story copy and share controls", async () => {
  const page = await readProjectFile("app/page.tsx");

  assert.match(page, /async function copyStory/);
  assert.match(page, /async function shareStory/);
  assert.match(page, /navigator\.clipboard\.writeText\(storyText\)/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /본문 복사/);
  assert.match(page, /이야기 공유/);
});

test("requires ChatGPT auth before rendering the teacher page", async () => {
  const teacherPage = await readProjectFile("app/teacher/page.tsx");
  const auth = await readProjectFile("app/chatgpt-auth.ts");

  assert.match(teacherPage, /requireChatGPTUser\("\/teacher"\)/);
  assert.match(teacherPage, /chatGPTSignOutPath\("\/"\)/);
  assert.match(auth, /oai-authenticated-user-id/);
  assert.match(auth, /oai-authenticated-user-email/);
  assert.match(auth, /\/signin-with-chatgpt/);
});

test("allows anonymous students to find and join rooms", async () => {
  const studentJoin = await readProjectFile("app/join/StudentJoin.tsx");
  const studentRoute = await readProjectFile("app/api/rooms/route.ts");

  assert.doesNotMatch(studentJoin, /requireChatGPTUser|getChatGPTUser/);
  assert.match(studentJoin, /NO LOGIN · QUICK JOIN/);
  assert.match(studentJoin, /fetch\("\/api\/rooms"/);
  assert.match(studentJoin, /action: "join"/);
  assert.doesNotMatch(studentRoute, /requireChatGPTUser|getChatGPTUser/);
  assert.match(studentRoute, /const action = typeof body\.action === "string" \? body\.action : "join"/);
});

test("creates normalized D1 tables with room participant and story-turn relations", async () => {
  const migration = await readProjectFile("drizzle/0000_sharp_garia.sql");
  const tempDir = mkdtempSync(join(tmpdir(), "munjang-itgi-db-"));
  const dbPath = join(tempDir, "test.sqlite");
  const sqlPath = join(tempDir, "migration.sql");

  try {
    writeFileSync(sqlPath, migration);
    execFileSync("sqlite3", [dbPath, `.read ${sqlPath}`], { encoding: "utf8" });
    const tables = execFileSync(
      "sqlite3",
      [dbPath, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"],
      { encoding: "utf8" },
    );

    assert.match(tables, /^participants$/m);
    assert.match(tables, /^rooms$/m);
    assert.match(tables, /^story_turns$/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reads D1 and AI secrets from Cloudflare runtime bindings", async () => {
  const [liveStory, solar, worker] = await Promise.all([
    readProjectFile("lib/live-story.ts"),
    readProjectFile("lib/solar.ts"),
    readProjectFile("worker/index.ts"),
  ]);

  assert.match(liveStory, /import \{ env \} from "cloudflare:workers"/);
  assert.match(liveStory, /\(env as unknown as CloudflareEnv\)\.DB/);
  assert.match(solar, /\(env as unknown as CloudflareEnv\)\.UPSTAGE_API_KEY/);
  assert.match(worker, /return handler\.fetch\(request, env, ctx\)/);
  assert.doesNotMatch(`${liveStory}\n${solar}\n${worker}`, /cloudflareEnv|runWithCloudflareEnv/);
});

test("enforces D1 participant uniqueness and foreign keys", async () => {
  const migration = await readProjectFile("drizzle/0000_sharp_garia.sql");
  const tempDir = mkdtempSync(join(tmpdir(), "munjang-itgi-db-"));
  const dbPath = join(tempDir, "test.sqlite");
  const sqlPath = join(tempDir, "migration.sql");

  try {
    writeFileSync(sqlPath, migration);
    execFileSync("sqlite3", [dbPath, `.read ${sqlPath}`], { encoding: "utf8" });
    const indexes = execFileSync(
      "sqlite3",
      [dbPath, "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='participants' ORDER BY name;"],
      { encoding: "utf8" },
    );
    const foreignKeys = execFileSync("sqlite3", [dbPath, "PRAGMA foreign_key_list(participants);"], {
      encoding: "utf8",
    });

    assert.match(indexes, /uidx_participants_room_slot/);
    assert.match(indexes, /uidx_participants_room_name/);
    assert.match(indexes, /uidx_participants_token_hash/);
    assert.match(indexes, /idx_participants_room_type/);
    assert.match(foreignKeys, /rooms\|room_code\|room_code\|NO ACTION\|CASCADE/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("enforces D1 story-turn uniqueness and lookup indexes", async () => {
  const migration = await readProjectFile("drizzle/0000_sharp_garia.sql");
  const tempDir = mkdtempSync(join(tmpdir(), "munjang-itgi-db-"));
  const dbPath = join(tempDir, "test.sqlite");
  const sqlPath = join(tempDir, "migration.sql");

  try {
    writeFileSync(sqlPath, migration);
    execFileSync("sqlite3", [dbPath, `.read ${sqlPath}`], { encoding: "utf8" });
    const indexes = execFileSync(
      "sqlite3",
      [dbPath, "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='story_turns' ORDER BY name;"],
      { encoding: "utf8" },
    );
    const foreignKeys = execFileSync("sqlite3", [dbPath, "PRAGMA foreign_key_list(story_turns);"], {
      encoding: "utf8",
    });

    assert.match(indexes, /uidx_story_turns_room_turn/);
    assert.match(indexes, /idx_story_turns_participant/);
    assert.match(indexes, /idx_story_turns_room_status/);
    assert.match(foreignKeys, /participants\|participant_id\|id\|NO ACTION\|CASCADE/);
    assert.match(foreignKeys, /rooms\|room_code\|room_code\|NO ACTION\|CASCADE/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lists only the signed-in teacher owner rooms", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /const user = await requireApiUser\(\)/);
  assert.match(route, /SELECT \* FROM rooms WHERE owner_user_id = \? ORDER BY updated_at DESC/);
  assert.match(route, /\.bind\(user\.userId\)/);
  assert.match(route, /return json\(\{ rooms \}\)/);
});

test("enforces teacher ownership for room detail and control actions", async () => {
  const route = await readProjectFile("app/api/teacher/rooms/route.ts");

  assert.match(route, /await getOwnedRoom\(db, roomCode, user\.userId\)/);
  assert.match(route, /const room = await getOwnedRoom\(db, roomCode, user\.userId\)/);
  assert.match(route, /if \(room\.owner_user_id !== userId\) throw new ApiError\("이 방을 관리할 권한이 없어요\.", 403\)/);
});

test("hashes student tokens before storage and lookup", async () => {
  const route = await readProjectFile("app/api/rooms/route.ts");
  const liveStory = await readProjectFile("lib/live-story.ts");

  assert.match(route, /const token = makeParticipantToken\(\)/);
  assert.match(route, /const tokenHash = await sha256Hex\(token\)/);
  assert.match(route, /VALUES \(\?, \?, \?, 'human', NULL, \?, \?, \?\)/);
  assert.match(liveStory, /const tokenHash = await sha256Hex\(token\)/);
  assert.match(liveStory, /WHERE room_code = \? AND token_hash = \? AND writer_type = 'human'/);
});

test("keeps participant bearer tokens out of polling URLs", async () => {
  const [route, student] = await Promise.all([
    readProjectFile("app/api/rooms/route.ts"),
    readProjectFile("app/join/StudentJoin.tsx"),
  ]);

  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /scheme\?\.toLowerCase\(\) !== "bearer"/);
  assert.match(route, /submit\(body, requireBearerToken\(request\)\)/);
  assert.match(student, /headers\.authorization = `Bearer \$\{activeSession\.token\}`/);
  assert.doesNotMatch(student, /params\.set\("token"/);
  assert.doesNotMatch(student, /token: session\.token/);
  assert.doesNotMatch(route, /searchParams\.get\("token"/);
});

test("rejects student submissions outside the current human turn", async () => {
  const route = await readProjectFile("app/api/rooms/route.ts");

  assert.match(route, /currentTurn\.writer_type !== "human"/);
  assert.match(route, /currentTurn\.participant_id !== participant\.id/);
  assert.match(route, /currentTurn\.status !== "pending"/);
  assert.match(route, /WHERE room_code = \? AND turn_index = \? AND participant_id = \? AND status = 'pending'/);
});

test("keeps AI generation behind server-only teacher auth", async () => {
  const aiRoute = await readProjectFile("app/api/ai/route.ts");
  const solar = await readProjectFile("lib/solar.ts");

  assert.match(aiRoute, /const user = await getChatGPTUser\(\)/);
  assert.match(aiRoute, /if \(!user\) throw new ApiError\("AI 기능은 교사용 ChatGPT 로그인이 필요해요\.", 401\)/);
  assert.match(aiRoute, /const room = await getOwnedRoom\(db, roomCode, user\.userId\)/);
  assert.match(aiRoute, /if \(action === "seed"\) return await seedRoom\(db, room\)/);
  assert.match(aiRoute, /if \(action === "continue"\) return await continueAiTurn\(db, room\)/);
  assert.match(aiRoute, /if \(action === "report"\) return await reportRoom\(db, room\)/);
  assert.doesNotMatch(solar, /up_[A-Za-z0-9]{12,}/);
  assert.match(aiRoute, /const AI_CLAIM_TTL_MS = 120_000/);
  assert.match(aiRoute, /ai_generation_claimed_at < \?/);
  assert.match(aiRoute, /minimizeClassroomText/);
});

test("uses Solar Pro 4 by default without exposing the API key to client code", async () => {
  const [solar, page, teacher, student] = await Promise.all([
    readProjectFile("lib/solar.ts"),
    readProjectFile("app/page.tsx"),
    readProjectFile("app/teacher/TeacherDashboard.tsx"),
    readProjectFile("app/join/StudentJoin.tsx"),
  ]);

  assert.match(solar, /const DEFAULT_MODEL = "solar-pro4"/);
  assert.match(solar, /\(env as unknown as CloudflareEnv\)\.UPSTAGE_API_KEY \?\? process\.env\.UPSTAGE_API_KEY/);
  assert.match(solar, /reasoning_effort: "low"/);
  assert.match(solar, /options\.schemaName === "writing_report"[\s\S]*4_000/);
  assert.match(solar, /options\.schemaName === "story_continuation"[\s\S]*1_800/);
  assert.doesNotMatch(`${page}\n${teacher}\n${student}`, /UPSTAGE_API_KEY|generateSolarJson|up_[A-Za-z0-9]{12,}/);
});

test("applies Retro Digital Y2K styling across local teacher and student routes", async () => {
  const [page, teacher, student, css] = await Promise.all([
    readProjectFile("app/page.tsx"),
    readProjectFile("app/teacher/TeacherDashboard.tsx"),
    readProjectFile("app/join/StudentJoin.tsx"),
    readProjectFile("app/globals.css"),
  ]);

  assert.match(page, /<Link href="\/teacher">TEACHER<\/Link>/);
  assert.match(page, /<Link href="\/join">STUDENT<\/Link>/);
  assert.match(teacher, /className="retro-shell teacher-shell"/);
  assert.match(student, /className="retro-shell student-shell"/);
  assert.match(css, /--y2k-cyan/);
  assert.match(css, /\.retro-window/);
  assert.match(css, /\.window-titlebar/);
  assert.match(css, /repeating-linear-gradient/);
});
