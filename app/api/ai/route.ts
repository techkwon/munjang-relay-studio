import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  advanceExpiredTurns,
  ApiError,
  D1Database,
  errorResponse,
  getDb,
  getParticipantWriterLevel,
  getParticipants,
  getRoomWriterLevels,
  getRoomByCode,
  getStoryTurns,
  json,
  makeId,
  normalizeRoomCode,
  readJsonObject,
  safeRoom,
  type ParticipantRow,
  type RoomRow,
  type WriterLevel,
  type StoryTurnRow,
} from "@/lib/live-story";
import { buildContinuationLevelGuidance, buildReportLevelGuidance, buildSeedLevelGuidance, WRITER_LEVEL_LABELS } from "@/lib/ai-levels";
import { generateSolarJson } from "@/lib/solar";

export const dynamic = "force-dynamic";

type SeedResult = {
  title: string;
  setup: string;
  opener: string;
};

type ContinueResult = {
  paragraph: string;
};

type WritingReport = {
  summary: string;
  collaborationHighlights: string[];
  writers: Array<{
    name: string;
    contributionShare: number;
    paragraphs: number;
    characters: number;
    strengths: string[];
    nextStep: string;
  }>;
  groupSuggestion: string;
  disclaimer: string;
};

type HumanMetric = {
  participant: ParticipantRow;
  promptName: string;
  level: WriterLevel;
  paragraphs: number;
  characters: number;
  contributionShare: number;
  texts: string[];
};

const AI_CLAIM_TTL_MS = 120_000;
const AI_RETRY_COOLDOWN_MS = 10_000;

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new ApiError("AI 기능은 교사용 ChatGPT 로그인이 필요해요.", 401);

    const body = await readJsonObject(request);
    const roomCode = normalizeRoomCode(body.roomCode ?? body.code);
    const action = typeof body.action === "string" ? body.action : "";
    const db = getDb();
    const room = await getOwnedRoom(db, roomCode, user.userId);

    if (action === "seed") return await seedRoom(db, room);
    if (action === "continue") return await continueAiTurn(db, room);
    if (action === "report") return await reportRoom(db, room);
    throw new ApiError("지원하지 않는 AI 요청이에요.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}

async function seedRoom(db: D1Database, room: RoomRow) {
  if (room.status !== "lobby") throw new ApiError("AI 첫 문장은 대기 중인 방에서만 만들 수 있어요.", 409);
  if (room.seed_source === "ai" && room.ai_generation_status === "complete") {
    return roomResponse(db, room.room_code, "이미 AI 첫 문장이 준비되어 있어요.");
  }
  enforceAiRetryCooldown(room, "seed");

  const claim = makeId("seed");
  const now = Date.now();
  const claimResult = await db
    .prepare(
      `UPDATE rooms
       SET ai_generation_status = 'running', ai_generation_claim = ?, ai_generation_claimed_at = ?, ai_generation_state = ?, updated_at = ?
       WHERE room_code = ? AND status = 'lobby'
         AND (ai_generation_claim IS NULL OR ai_generation_status IN ('idle', 'failed')
           OR ai_generation_claimed_at IS NULL OR ai_generation_claimed_at < ?)`,
    )
    .bind(claim, now, JSON.stringify({ action: "seed", claimedAt: now }), now, room.room_code, now - AI_CLAIM_TTL_MS)
    .run();
  if (claimResult.meta?.changes !== 1) throw new ApiError("이미 AI 첫 문장을 준비하고 있어요.", 409);

  try {
    const levelNotes = buildSeedLevelGuidance(getRoomWriterLevels(room));
    const seed = sanitizeSeed(
      await generateSolarJson<SeedResult>({
        schemaName: "story_seed",
        schema: seedSchema,
        maxTokens: 500,
        temperature: 0.72,
        messages: [
          {
            role: "system",
            content:
              `너는 초중고 교실용 릴레이 글쓰기 활동을 여는 한국어 작가다. 안전하고 따뜻한 모험감을 주되 폭력, 혐오, 선정성, 개인정보, 공포 과잉은 피한다. 흔한 클리셰, 메타 설명, 지시문 없이 반드시 JSON 스키마만 쓴다.\n${levelNotes}`,
          },
          {
            role: "user",
            content: `장르: ${room.genre}\n총 차례: ${room.turn_limit}\n작가 수: ${room.writer_limit}\n요청: 짧은 제목, 1-2문장 상황 설명, 30-100자 첫 문장을 한국어로 만들어 줘.\n첫 문장 조건: 구체적인 감각 단서 1개와 궁금증 1개가 있어야 한다. "빛났다", "갑자기", "모두가 기다렸다" 같은 흔한 시작을 피하고, 다음 작가가 이어 쓸 여백을 남긴다.`,
          },
        ],
      }),
    );
    await db
      .prepare(
        `UPDATE rooms
         SET story_title = ?, story_setup = ?, story_opener = ?, seed_source = 'ai',
             ai_generation_status = 'complete', ai_generation_claim = NULL, ai_generation_claimed_at = NULL,
             ai_generation_state = ?, updated_at = ?
         WHERE room_code = ? AND ai_generation_claim = ?`,
      )
      .bind(seed.title, seed.setup, seed.opener, JSON.stringify({ action: "seed", completedAt: Date.now() }), Date.now(), room.room_code, claim)
      .run();
    return roomResponse(db, room.room_code, "AI 첫 문장이 준비되었어요.");
  } catch (error) {
    await markAiFailure(db, room.room_code, claim, "seed");
    if (error instanceof ApiError) throw error;
    throw new ApiError("AI 첫 문장을 만들지 못했어요. 기본 첫 문장은 그대로 사용할 수 있어요.", 502);
  }
}

async function continueAiTurn(db: D1Database, initialRoom: RoomRow) {
  const room = await advanceExpiredTurns(db, initialRoom);
  if (room.status !== "active") throw new ApiError("진행 중인 방에서만 AI가 이어 쓸 수 있어요.", 409);

  const turn = await getCurrentTurn(db, room);
  if (turn.writer_type !== "ai") throw new ApiError("지금은 AI 작가 차례가 아니에요.", 409);
  if (turn.status !== "pending") return roomResponse(db, room.room_code, "이미 처리된 차례예요.");
  enforceAiRetryCooldown(room, "continue");

  const claim = makeId("cont");
  const now = Date.now();
  const extendedDeadline = now + Math.max(room.turn_seconds * 1000, 45_000);
  const [claimResult] = await db.batch([
    db
      .prepare(
        `UPDATE rooms
         SET ai_generation_status = 'running', ai_generation_claim = ?, ai_generation_claimed_at = ?, ai_generation_state = ?,
             current_deadline_at = ?, updated_at = ?
         WHERE room_code = ? AND status = 'active' AND current_turn_index = ?
           AND (ai_generation_claim IS NULL OR ai_generation_status IN ('idle', 'failed', 'complete')
             OR ai_generation_claimed_at IS NULL OR ai_generation_claimed_at < ?)`,
      )
      .bind(
        claim,
        now,
        JSON.stringify({ action: "continue", turnIndex: turn.turn_index, claimedAt: now }),
        extendedDeadline,
        now,
        room.room_code,
        room.current_turn_index,
        now - AI_CLAIM_TTL_MS,
      ),
    db
      .prepare("UPDATE story_turns SET deadline_at = ? WHERE room_code = ? AND turn_index = ? AND status = 'pending'")
      .bind(extendedDeadline, room.room_code, turn.turn_index),
  ]);
  if (claimResult.meta?.changes !== 1) throw new ApiError("이미 AI 작가가 이어 쓰는 중이에요.", 409);

  try {
    const [participants, turns] = await Promise.all([getParticipants(db, room.room_code), getStoryTurns(db, room.room_code)]);
    const ai = participants.find((participant) => participant.id === turn.participant_id);
    const aiLevel = ai ? getParticipantWriterLevel(room, ai) : "elementary";
    const paragraph = sanitizeParagraph(
      (
        await generateSolarJson<ContinueResult>({
          schemaName: "story_continuation",
          schema: continuationSchema,
          maxTokens: 650,
          temperature: 0.64,
          messages: [
            {
              role: "system",
              content:
                `너는 초중고 교실용 릴레이 이야기에 함께 참여하는 AI 작가다. 앞 문단의 단서를 존중하고 문장 톤을 자연스럽게 이어가며, 개인정보·과격한 폭력·차별적 표현은 피한다. 처음부터 다시 시작하거나 성급히 결말을 닫지 마라.\n${buildContinuationLevelGuidance(aiLevel)}`,
            },
            {
              role: "user",
              content: buildContinuePrompt(room, turn, participants, turns),
            },
          ],
        })
      ).paragraph,
    );
    await submitAiTurn(db, room.room_code, turn, paragraph, claim);
    return roomResponse(db, room.room_code, "AI 작가가 문장을 이어 썼어요.");
  } catch (error) {
    await markAiFailure(db, room.room_code, claim, "continue");
    if (error instanceof ApiError) throw error;
    throw new ApiError("AI 작가가 이어 쓰지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}

async function reportRoom(db: D1Database, initialRoom: RoomRow) {
  const room = await advanceExpiredTurns(db, initialRoom);
  if (room.status !== "complete" && room.status !== "closed") {
    throw new ApiError("완성되거나 마감된 방에서만 글쓰기 분석을 만들 수 있어요.", 409);
  }
  if (room.analysis_status === "complete" && room.analysis_report) {
    return roomResponse(db, room.room_code, "이미 분석 보고서가 준비되어 있어요.");
  }
  enforceAiRetryCooldown(room, "report");
  const turns = await getStoryTurns(db, room.room_code);
  if (!turns.some((turn) => turn.writer_type === "human" && turn.status === "submitted" && turn.text)) {
    throw new ApiError("분석할 사람 작가의 글이 아직 없어요.", 409);
  }

  const claim = makeId("report");
  const now = Date.now();
  const claimResult = await db
    .prepare(
      `UPDATE rooms
       SET analysis_status = 'running', ai_generation_claim = ?, ai_generation_claimed_at = ?,
           ai_generation_state = ?, updated_at = ?
       WHERE room_code = ? AND (ai_generation_claim IS NULL OR analysis_status IN ('idle', 'pending', 'failed')
         OR ai_generation_claimed_at IS NULL OR ai_generation_claimed_at < ?)`,
    )
    .bind(claim, now, JSON.stringify({ action: "report", claimedAt: now }), now, room.room_code, now - AI_CLAIM_TTL_MS)
    .run();
  if (claimResult.meta?.changes !== 1) throw new ApiError("이미 분석 보고서를 만드는 중이에요.", 409);

  try {
    const participants = await getParticipants(db, room.room_code);
    const metrics = buildHumanMetrics(room, participants, turns);
    const solarReport = await generateSolarJson<WritingReport>({
      schemaName: "writing_report",
      schema: reportSchema,
      maxTokens: 1200,
      temperature: 0.22,
      messages: [
        {
          role: "system",
          content:
            `너는 초중고 학생이 함께 쓰는 교실 글쓰기 활동을 돕는 교사 보조자다. 사람 작가의 문장 근거만 분석하고, 분량·비율·순서를 실력으로 해석하지 않는다. 순위화·점수화 없이 장점과 다음 연습으로 제안한다. 근거가 부족하면 과장 없이 제한적으로 말한다. 반드시 JSON 스키마를 지킨다.\n${buildReportLevelGuidance(metrics.map((metric) => ({ name: metric.promptName, level: metric.level })))}`,
        },
        {
          role: "user",
          content: buildReportPrompt(room, metrics, turns),
        },
      ],
    });
    const report = normalizeReport(solarReport, metrics);
    await db
      .prepare(
        `UPDATE rooms
         SET analysis_status = 'complete', analysis_report = ?, ai_generation_claim = NULL,
             ai_generation_claimed_at = NULL, ai_generation_state = ?, updated_at = ?
         WHERE room_code = ? AND ai_generation_claim = ?`,
      )
      .bind(
        JSON.stringify(report),
        JSON.stringify({ action: "report", completedAt: Date.now() }),
        Date.now(),
        room.room_code,
        claim,
      )
      .run();
    return roomResponse(db, room.room_code, "글쓰기 분석이 준비되었어요.");
  } catch (error) {
    await db
      .prepare(
        `UPDATE rooms
         SET analysis_status = 'failed', ai_generation_claim = NULL, ai_generation_claimed_at = NULL,
             ai_generation_state = ?, updated_at = ?
         WHERE room_code = ? AND ai_generation_claim = ?`,
      )
      .bind(JSON.stringify({ action: "report", failedAt: Date.now() }), Date.now(), room.room_code, claim)
      .run();
    if (error instanceof ApiError) throw error;
    throw new ApiError("글쓰기 분석을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}

async function getOwnedRoom(db: D1Database, roomCode: string, userId: string) {
  const room = await getRoomByCode(db, roomCode);
  if (room.owner_user_id !== userId) throw new ApiError("이 방을 관리할 권한이 없어요.", 403);
  return room;
}

async function getCurrentTurn(db: D1Database, room: RoomRow) {
  const turn = await db
    .prepare("SELECT * FROM story_turns WHERE room_code = ? AND turn_index = ?")
    .bind(room.room_code, room.current_turn_index)
    .first<StoryTurnRow>();
  if (!turn) throw new ApiError("현재 차례 정보를 찾을 수 없어요.", 409);
  return turn;
}

async function submitAiTurn(db: D1Database, roomCode: string, turn: StoryTurnRow, paragraph: string, claim: string) {
  const room = await getRoomByCode(db, roomCode);
  if (room.ai_generation_claim !== claim || room.current_turn_index !== turn.turn_index || room.status !== "active") {
    throw new ApiError("AI 차례가 이미 변경되었어요. 상태를 새로고침해 주세요.", 409);
  }

  const now = Date.now();
  const isLastTurn = room.current_turn_index >= room.turn_limit - 1;
  const [turnResult, roomResult] = await db.batch([
    db
      .prepare(
        `UPDATE story_turns
         SET status = 'submitted', text = ?, submitted_at = ?
         WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending'`,
      )
      .bind(paragraph, now, roomCode, turn.turn_index, turn.participant_id),
    db
      .prepare(
        isLastTurn
          ? `UPDATE rooms
             SET status = 'complete', current_deadline_at = NULL, completed_at = ?, updated_at = ?,
                 ai_generation_status = 'complete', ai_generation_claim = NULL, ai_generation_claimed_at = NULL, ai_generation_state = ?,
                 analysis_status = 'pending'
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ? AND ai_generation_claim = ?`
          : `UPDATE rooms
             SET current_turn_index = current_turn_index + 1, current_deadline_at = ?, updated_at = ?,
                 ai_generation_status = 'complete', ai_generation_claim = NULL, ai_generation_claimed_at = NULL, ai_generation_state = ?
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ? AND ai_generation_claim = ?`,
      )
      .bind(
        ...(isLastTurn
          ? [now, now, JSON.stringify({ action: "continue", turnIndex: turn.turn_index, completedAt: now }), roomCode, turn.turn_index, claim]
          : [
              now + room.turn_seconds * 1000,
              now,
              JSON.stringify({ action: "continue", turnIndex: turn.turn_index, completedAt: now }),
              roomCode,
              turn.turn_index,
              claim,
            ]),
      ),
  ]);

  if (turnResult.meta?.changes !== 1 || roomResult.meta?.changes !== 1) {
    throw new ApiError("AI 차례가 이미 처리되었어요. 상태를 새로고침해 주세요.", 409);
  }
}

async function roomResponse(db: D1Database, roomCode: string, message: string) {
  const [room, participants, turns] = await Promise.all([getRoomByCode(db, roomCode), getParticipants(db, roomCode), getStoryTurns(db, roomCode)]);
  return json({ room: safeRoom(room, participants, turns, { teacher: true }), message });
}

async function markAiFailure(db: D1Database, roomCode: string, claim: string, action: string) {
  await db
    .prepare(
      `UPDATE rooms
       SET ai_generation_status = 'failed', ai_generation_claim = NULL, ai_generation_claimed_at = NULL,
           ai_generation_state = ?, updated_at = ?
       WHERE room_code = ? AND ai_generation_claim = ?`,
    )
    .bind(JSON.stringify({ action, failedAt: Date.now() }), Date.now(), roomCode, claim)
    .run();
}

function sanitizeSeed(seed: SeedResult): SeedResult {
  const fallbackOpener = "책상 밑 종이봉투에서 바닷물 냄새가 나자, 우리는 누가 보낸 것인지 서로를 바라봤습니다.";
  const opener = limitText(seed.opener, 100, fallbackOpener);
  const firstSentenceMatch = opener.match(/[.!?](?:[”’\"])?(?=\s|$)/);
  const firstSentenceEnd = firstSentenceMatch?.index === undefined ? -1 : firstSentenceMatch.index + firstSentenceMatch[0].length;
  const singleSentence = firstSentenceEnd >= 0 ? opener.slice(0, firstSentenceEnd) : opener;
  return {
    title: limitText(seed.title, 40, "AI 이야기"),
    setup: limitText(seed.setup, 220, "함께 이어 쓰기 좋은 이야기를 시작합니다."),
    opener: singleSentence.length < 30 ? fallbackOpener : singleSentence,
  };
}

function sanitizeParagraph(value: string) {
  return limitTextAtBoundary(value, 300, "AI 작가가 앞 장면의 단서를 살려 다음 행동을 한 가지 더 이어 썼습니다.");
}

function limitText(value: unknown, max: number, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return fallback;
  return text.length > max ? text.slice(0, max) : text;
}

function limitTextAtBoundary(value: unknown, max: number, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return fallback;
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSentence = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (lastSentence >= Math.floor(max * 0.6)) return clipped.slice(0, lastSentence + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace >= Math.floor(max * 0.75) ? lastSpace : max).trim()}…`;
}

function buildContinuePrompt(room: RoomRow, turn: StoryTurnRow, participants: ParticipantRow[], turns: StoryTurnRow[]) {
  const promptNameByParticipantId = new Map(
    participants
      .filter((participant) => participant.writer_type === "human")
      .sort((a, b) => a.slot_index - b.slot_index)
      .map((participant, index) => [participant.id, `사람 작가 ${index + 1}`]),
  );
  const submitted = turns
    .filter((item) => item.status === "submitted" && item.text)
    .sort((a, b) => a.turn_index - b.turn_index)
    .slice(-6)
    .map((item) => {
      const promptName = item.writer_type === "ai" ? "AI 작가" : promptNameByParticipantId.get(item.participant_id) ?? "사람 작가";
      return `${item.turn_index + 1}. ${promptName}: ${minimizeClassroomText(item.text ?? "")}`;
    })
    .join("\n");
  const ai = participants.find((participant) => participant.id === turn.participant_id);
  const aiLevel = ai ? getParticipantWriterLevel(room, ai) : "elementary";
  const levelHint = buildContinuationLevelGuidance(aiLevel);
  return [
    `장르: ${room.genre}`,
    `제목: ${room.story_title}`,
    `상황: ${room.story_setup}`,
    `첫 문장: ${room.story_opener}`,
    `현재 차례: ${turn.turn_index + 1}/${room.turn_limit}`,
    `현재 AI 작가: ${ai?.writer_name ?? "AI 작가"} / 역할: ${ai?.ai_role ?? "이야기 조력자"} / 수준: ${WRITER_LEVEL_LABELS[aiLevel]}`,
    `수준 규칙: ${levelHint}`,
    "이미 제출된 문단:",
    submitted || "(아직 제출된 문단 없음)",
    "조건: 이전 문단의 구체적 단서나 표현 하나를 반드시 다시 사용한다. 새로운 사건/사물은 한 가지만 추가한다. 120-300자 한국어 한 문단으로 쓴다. 첫 문장을 반복하지 말고, 이야기를 다시 시작하지 말고, 마지막 차례가 아니면 결말을 확정하지 않는다. 다음 작가가 이어 쓸 행동이나 질문을 남긴다.",
  ].join("\n");
}

function buildHumanMetrics(room: RoomRow, participants: ParticipantRow[], turns: StoryTurnRow[]): HumanMetric[] {
  const humans = participants.filter((participant) => participant.writer_type === "human");
  const humanTurns = turns.filter((turn) => turn.writer_type === "human" && turn.status === "submitted" && turn.text);
  const totalCharacters = humanTurns.reduce((sum, turn) => sum + (turn.text?.length ?? 0), 0);

  return humans.map((participant, index) => {
    const ownTurns = humanTurns.filter((turn) => turn.participant_id === participant.id);
    const characters = ownTurns.reduce((sum, turn) => sum + (turn.text?.length ?? 0), 0);
    return {
      participant,
      promptName: `사람 작가 ${index + 1}`,
      level: getParticipantWriterLevel(room, participant),
      paragraphs: ownTurns.length,
      characters,
      contributionShare: totalCharacters > 0 ? Math.round((characters / totalCharacters) * 100) : 0,
      texts: ownTurns.map((turn) => turn.text ?? ""),
    };
  });
}

function buildReportPrompt(room: RoomRow, metrics: HumanMetric[], turns: StoryTurnRow[]) {
  const promptNameByParticipantId = new Map(metrics.map((metric) => [metric.participant.id, metric.promptName]));
  const story = [
    room.story_opener,
    ...turns
      .filter((turn) => turn.status === "submitted" && turn.text)
      .map((turn) => {
        const promptName = turn.writer_type === "ai" ? "AI 작가" : promptNameByParticipantId.get(turn.participant_id) ?? "사람 작가";
        return `${promptName}: ${minimizeClassroomText(turn.text ?? "")}`;
      }),
  ].join("\n\n");
  return [
    `장르: ${room.genre}`,
    `제목: ${room.story_title}`,
    buildReportLevelGuidance(metrics.map((metric) => ({ name: metric.promptName, level: metric.level }))),
    "사람 작가 기여 지표(순위가 아니라 참고용):",
    JSON.stringify(
      metrics.map((metric) => ({
        name: metric.promptName,
        contributionShare: metric.contributionShare,
        paragraphs: metric.paragraphs,
        characters: metric.characters,
        excerpts: metric.texts.map(minimizeClassroomText),
      })),
    ),
    "완성 이야기:",
    story,
    "요청: 사람 작가만 대상으로 장점 1~3개와 다음 연습 1개를 제안해 줘. 각 장점은 실제 문장 근거에 연결하되 긴 직접 인용은 피한다. AI 작가는 평가하지 마. 기여 비율과 글자 수는 참여량 참고일 뿐 실력으로 해석하지 마. 순위, 비교 비난, 점수화는 하지 마. 글이 적으면 근거가 적다고 부드럽게 말해.",
  ].join("\n");
}

function normalizeReport(report: WritingReport, metrics: HumanMetric[]): WritingReport {
  const metricByName = new Map(metrics.map((metric) => [metric.participant.writer_name, metric]));
  return {
    summary: limitText(report.summary, 300, "함께 이야기를 완성하며 장면과 문장을 이어 가는 연습을 했습니다."),
    collaborationHighlights: normalizeStringArray(report.collaborationHighlights, 3, "서로의 문장을 이어 받아 이야기를 완성했습니다."),
    writers: metrics.map((metric, index) => {
      const writer = report.writers.find((item) => [metric.promptName, metric.participant.writer_name].includes(item.name)) ?? report.writers[index];
      const sourceMetric = metricByName.get(metric.participant.writer_name) ?? metric;
      return {
        name: metric.participant.writer_name,
        contributionShare: sourceMetric.contributionShare,
        paragraphs: sourceMetric.paragraphs,
        characters: sourceMetric.characters,
        strengths: normalizeStringArray(writer?.strengths, 3, "이야기 흐름을 이어 가려는 시도가 좋았습니다."),
        nextStep: limitText(writer?.nextStep, 160, "다음에는 장면의 소리, 색, 행동을 한 가지 더 넣어 보세요."),
      };
    }),
    groupSuggestion: limitText(report.groupSuggestion, 220, "다음 활동에서는 앞 문단의 중요한 단어 하나를 골라 다음 문단에 다시 활용해 보세요."),
    disclaimer: "이 분석은 교실 피드백을 돕기 위한 참고 자료이며, 학생을 순위화하거나 평가 점수로 사용하지 않습니다.",
  };
}

function normalizeStringArray(value: unknown, maxItems: number, fallback: string) {
  if (!Array.isArray(value)) return [fallback];
  const normalized = value.map((item) => limitText(item, 120, "")).filter(Boolean).slice(0, maxItems);
  return normalized.length > 0 ? normalized : [fallback];
}

function enforceAiRetryCooldown(room: RoomRow, action: "seed" | "continue" | "report") {
  const relevantStatus = action === "report" ? room.analysis_status : room.ai_generation_status;
  if (relevantStatus !== "failed") return;
  const state = safeAiState(room.ai_generation_state);
  if (state?.action !== action || typeof state.failedAt !== "number") return;
  if (state.failedAt > Date.now() - AI_RETRY_COOLDOWN_MS) {
    throw new ApiError("AI를 다시 호출하기 전에 잠시 기다려 주세요.", 429);
  }
}

function safeAiState(value: string | null): { action?: string; failedAt?: number } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as { action?: string; failedAt?: number } : null;
  } catch {
    return null;
  }
}

function minimizeClassroomText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[개인정보 가림]")
    .replace(/https?:\/\/\S+/gi, "[링크 가림]")
    .replace(/(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[개인정보 가림]")
    .trim();
}

const seedSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 2, maxLength: 40, description: "짧고 구체적인 한국어 이야기 제목" },
    setup: { type: "string", minLength: 20, maxLength: 220, description: "이어 쓰기 방향만 제시하는 1-2문장 상황" },
    opener: { type: "string", minLength: 30, maxLength: 100, description: "감각 단서와 궁금증이 있는 한국어 첫 문장 하나" },
  },
  required: ["title", "setup", "opener"],
};

const continuationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paragraph: { type: "string", minLength: 120, maxLength: 300, description: "앞 단서를 이어 받아 다음 작가에게 여백을 남기는 한국어 한 문단" },
  },
  required: ["paragraph"],
};

const reportSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    collaborationHighlights: { type: "array", items: { type: "string" } },
    writers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          contributionShare: { type: "number" },
          paragraphs: { type: "number" },
          characters: { type: "number" },
          strengths: { type: "array", items: { type: "string" } },
          nextStep: { type: "string" },
        },
        required: ["name", "contributionShare", "paragraphs", "characters", "strengths", "nextStep"],
      },
    },
    groupSuggestion: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: ["summary", "collaborationHighlights", "writers", "groupSuggestion", "disclaimer"],
};
