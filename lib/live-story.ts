import { env } from "cloudflare:workers";

export type Genre = "all" | "adventure" | "fantasy" | "mystery" | "daily" | "space";
export type RoomStatus = "lobby" | "active" | "complete" | "closed";
export type TurnStatus = "pending" | "submitted" | "skipped";
export type WriterType = "human" | "ai";
export type OrderMode = "sequential" | "random";
export type SeedSource = "ai" | "fallback";
export type AsyncStatus = "idle" | "pending" | "running" | "complete" | "failed";

export type D1RunResult = {
  success: boolean;
  meta?: { changes?: number };
};

export type D1PreparedStatement = {
  bind(...values: Array<unknown>): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1RunResult>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = D1RunResult>(statements: D1PreparedStatement[]): Promise<T[]>;
};

export type CloudflareEnv = {
  DB?: D1Database;
  UPSTAGE_API_KEY?: string;
  UPSTAGE_MODEL?: string;
};

export type RoomRow = {
  room_code: string;
  owner_user_id: string;
  owner_email: string;
  status: RoomStatus;
  writer_limit: number;
  human_limit: number;
  ai_limit: number;
  genre: Genre;
  turn_limit: number;
  turn_seconds: number;
  order_mode: OrderMode;
  current_turn_index: number;
  current_deadline_at: number | null;
  seed_index: number;
  event_index: number;
  story_title: string;
  story_setup: string;
  story_opener: string;
  seed_source: SeedSource;
  ai_generation_status: AsyncStatus;
  ai_generation_claim: string | null;
  ai_generation_claimed_at: number | null;
  ai_generation_state: string | null;
  analysis_status: AsyncStatus;
  analysis_report: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  closed_at: number | null;
};

export type ParticipantRow = {
  id: string;
  room_code: string;
  writer_name: string;
  writer_type: WriterType;
  ai_role: string | null;
  token_hash: string | null;
  slot_index: number;
  joined_at: number;
};

export type StoryTurnRow = {
  id: string;
  room_code: string;
  turn_index: number;
  participant_id: string;
  writer_name: string;
  writer_type: WriterType;
  status: TurnStatus;
  text: string | null;
  deadline_at: number;
  submitted_at: number | null;
  created_at: number;
};

export type NewRoomSettings = {
  writerLimit: number;
  humanLimit: number;
  aiLimit: number;
  writerTypes: WriterType[];
  genre: Genre;
  turnLimit: number;
  turnSeconds: number;
  orderMode: OrderMode;
};

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GENRES: Genre[] = ["all", "adventure", "fantasy", "mystery", "daily", "space"];
const TURN_LIMITS = [6, 8, 10, 12];
const TURN_SECONDS = [45, 60, 90];
const AI_ROLES = [
  "구조 설계자",
  "묘사 확장자",
  "반전 제안자",
  "감정 조율자",
  "대화 전문가",
  "단서 수집가",
  "유머 조율자",
  "세계관 기록자",
  "긴장감 설계자",
  "결말 정리자",
];

const FALLBACK_SEEDS: Record<Genre, Array<{ title: string; setup: string; opener: string }>> = {
  all: [
    {
      title: "깜박이는 첫 문장",
      setup: "서로 다른 작가의 문장이 하나의 이야기로 이어지는 릴레이입니다.",
      opener: "창문 너머에서 파란 불빛이 세 번 깜박이자, 모두가 첫 문장을 기다렸습니다.",
    },
  ],
  adventure: [
    {
      title: "지도 밖 계단",
      setup: "낡은 지도에 없는 계단을 발견한 모험대가 차례로 단서를 더합니다.",
      opener: "우리가 마지막 표시를 지우는 순간, 모래 밑에서 돌계단 하나가 모습을 드러냈습니다.",
    },
  ],
  fantasy: [
    {
      title: "잉크 마법사의 약속",
      setup: "문장을 쓰면 작은 마법이 깨어나는 도서관에서 벌어지는 이야기입니다.",
      opener: "책상 위 잉크병이 스스로 열리더니, 아직 아무도 쓰지 않은 이름을 불렀습니다.",
    },
  ],
  mystery: [
    {
      title: "사라진 마지막 쉼표",
      setup: "완성 직전의 원고에서 쉼표 하나가 사라지며 단서가 시작됩니다.",
      opener: "교실 시계가 멈춘 3시 17분, 원고의 마지막 쉼표만 감쪽같이 사라졌습니다.",
    },
  ],
  daily: [
    {
      title: "평범한 급식의 비밀",
      setup: "익숙한 하루 속 작은 이상함을 이어 쓰며 발견하는 생활 이야기입니다.",
      opener: "오늘 급식 카레에는 평소와 다른 작은 별 모양 당근이 딱 하나 들어 있었습니다.",
    },
  ],
  space: [
    {
      title: "달 뒷면 우체통",
      setup: "우주 정거장에 도착한 알 수 없는 편지를 여러 작가가 해석합니다.",
      opener: "달 뒷면의 낡은 우체통에서 지구 주소가 적힌 편지가 천천히 떠올랐습니다.",
    },
  ],
};

export function getDb(): D1Database {
  const db = (env as unknown as CloudflareEnv).DB;
  if (!db) throw new ApiError("데이터베이스가 아직 연결되지 않았어요.", 503);
  return db;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function json(payload: unknown, init: ResponseInit = {}) {
  return Response.json(payload, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message }, { status: error.status });
  }
  return json({ error: "요청을 처리하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Fall through to a friendly validation error.
  }
  throw new ApiError("요청 내용을 읽을 수 없어요.", 400);
}

export function parseRoomSettings(body: Record<string, unknown>): NewRoomSettings {
  const genre = parseGenre(body.genre);
  const writerTypes = parseWriterTypes(body);
  const writerLimit = writerTypes.length;
  const humanLimit = writerTypes.filter((type) => type === "human").length;
  const aiLimit = writerTypes.length - humanLimit;

  const turnLimit = parseAllowedNumber(body.turnLimit, TURN_LIMITS, 8);
  if (turnLimit < writerLimit) {
    throw new ApiError("모든 작가에게 차례가 오도록 총 차례를 전체 작가 수 이상으로 설정해 주세요.", 400);
  }

  return {
    writerLimit,
    humanLimit,
    aiLimit,
    writerTypes,
    genre,
    turnLimit,
    turnSeconds: parseAllowedNumber(body.turnSeconds, TURN_SECONDS, 60),
    orderMode: body.orderMode === "random" ? "random" : "sequential",
  };
}

export function createFallbackSeed(genre: Genre, seedIndex: number) {
  const choices = genre === "all" ? Object.values(FALLBACK_SEEDS).flat() : FALLBACK_SEEDS[genre];
  return choices[seedIndex % choices.length];
}

export function makeSeedIndex(roomCode: string, genre: Genre) {
  return deterministicNumber(`${roomCode}:${genre}:seed`, 997);
}

export function makeEventIndex(roomCode: string, genre: Genre) {
  return deterministicNumber(`${roomCode}:${genre}:event`, 997);
}

export function makeTurnParticipantOrder(participants: ParticipantRow[], orderMode: OrderMode, roomCode: string) {
  const sorted = [...participants].sort((a, b) => a.slot_index - b.slot_index);
  if (orderMode === "sequential") return sorted;

  return sorted
    .map((participant) => ({
      participant,
      rank: deterministicNumber(`${roomCode}:order:${participant.id}:${participant.slot_index}`, 1_000_000),
    }))
    .sort((a, b) => a.rank - b.rank || a.participant.slot_index - b.participant.slot_index)
    .map(({ participant }, slotIndex) => ({ ...participant, slot_index: slotIndex }));
}

export function safeRoom(room: RoomRow, participants: ParticipantRow[] = [], turns: StoryTurnRow[] = []) {
  const currentTurn = turns.find((turn) => turn.turn_index === room.current_turn_index) ?? null;
  const resolvedOrder = turns
    .slice()
    .sort((a, b) => a.turn_index - b.turn_index)
    .reduce<string[]>((order, turn) => (order.includes(turn.participant_id) ? order : [...order, turn.participant_id]), []);
  const orderPosition = new Map(resolvedOrder.map((participantId, index) => [participantId, index]));
  return {
    roomCode: room.room_code,
    status: room.status,
    writerLimit: room.writer_limit,
    humanLimit: room.human_limit,
    aiLimit: room.ai_limit,
    genre: room.genre,
    turnLimit: room.turn_limit,
    turnSeconds: room.turn_seconds,
    orderMode: room.order_mode,
    currentTurnIndex: room.current_turn_index,
    currentDeadlineAt: room.current_deadline_at,
    seedIndex: room.seed_index,
    eventIndex: room.event_index,
    storyTitle: room.story_title,
    storySetup: room.story_setup,
    storyOpener: room.story_opener,
    seedSource: room.seed_source,
    aiGenerationStatus: room.ai_generation_status,
    aiGenerationState: safeJsonParse(room.ai_generation_state),
    analysisStatus: room.analysis_status,
    analysisReport: safeJsonParse(room.analysis_report),
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    startedAt: room.started_at,
    completedAt: room.completed_at,
    closedAt: room.closed_at,
    participants: participants.map((participant) => ({
      ...safeParticipant(participant),
      orderPosition: orderPosition.get(participant.id) ?? participant.slot_index,
    })),
    currentTurn: currentTurn ? safeTurn(currentTurn) : null,
    story: safeStory(room, turns),
  };
}

export function safeRoomPreview(room: RoomRow, participants: ParticipantRow[] = []) {
  const participantCount = participants.filter((participant) => participant.writer_type === "human").length;
  return {
    roomCode: room.room_code,
    status: room.status,
    writerLimit: room.writer_limit,
    humanLimit: room.human_limit,
    aiLimit: room.ai_limit,
    participantCount,
    availableHumanSlots: Math.max(0, room.human_limit - participantCount),
  };
}

export function safeParticipant(participant: ParticipantRow) {
  return {
    id: participant.id,
    writerName: participant.writer_name,
    writerType: participant.writer_type,
    aiRole: participant.ai_role,
    slotIndex: participant.slot_index,
    joinedAt: participant.joined_at,
  };
}

export function safeTurn(turn: StoryTurnRow) {
  return {
    turnIndex: turn.turn_index,
    participantId: turn.participant_id,
    writerName: turn.writer_name,
    writerType: turn.writer_type,
    status: turn.status,
    text: turn.status === "submitted" ? turn.text : null,
    deadlineAt: turn.deadline_at,
    submittedAt: turn.submitted_at,
  };
}

export function safeStory(room: RoomRow, turns: StoryTurnRow[]) {
  const submittedTurns = turns
    .filter((turn) => turn.status === "submitted" && turn.text)
    .sort((a, b) => a.turn_index - b.turn_index);
  return {
    title: room.story_title,
    opener: room.story_opener,
    entries: submittedTurns.map((turn) => ({
      turnIndex: turn.turn_index,
      writerName: turn.writer_name,
      writerType: turn.writer_type,
      text: turn.text,
      submittedAt: turn.submitted_at,
    })),
    text: [room.story_opener, ...submittedTurns.map((turn) => turn.text)].filter(Boolean).join("\n\n"),
  };
}

export function normalizeRoomCode(value: unknown) {
  if (typeof value !== "string") throw new ApiError("방 코드를 입력해 주세요.", 400);
  const code = value.toUpperCase().trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError("방 코드를 다시 확인해 주세요.", 400);
  return code;
}

export function normalizeWriterName(value: unknown) {
  if (typeof value !== "string") throw new ApiError("작가명을 입력해 주세요.", 400);
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 24) throw new ApiError("작가명은 1~24자로 입력해 주세요.", 400);
  return name;
}

export function normalizeToken(value: unknown) {
  if (typeof value !== "string" || value.length < 32) {
    throw new ApiError("참여 토큰을 확인할 수 없어요. 다시 입장해 주세요.", 401);
  }
  return value;
}

export function normalizeSubmissionText(value: unknown) {
  if (typeof value !== "string") throw new ApiError("이어 쓸 문장을 입력해 주세요.", 400);
  const text = value.trim();
  if (text.length < 1) throw new ApiError("이어 쓸 문장을 입력해 주세요.", 400);
  if (text.length > 500) throw new ApiError("한 차례에는 500자까지만 쓸 수 있어요.", 400);
  return text;
}

export function makeRoomCode(length = 6) {
  const random = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += ROOM_CODE_CHARACTERS[random[i] % ROOM_CODE_CHARACTERS.length];
  }
  return result;
}

export function makeId(prefix: string) {
  return `${prefix}_${base64Url(randomBytes(16))}`;
}

export function makeParticipantToken() {
  return `pt_${base64Url(randomBytes(32))}`;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getRoomByCode(db: D1Database, roomCode: string) {
  const room = await db.prepare("SELECT * FROM rooms WHERE room_code = ?").bind(roomCode).first<RoomRow>();
  if (!room) throw new ApiError("방을 찾을 수 없어요.", 404);
  return room;
}

export async function getParticipants(db: D1Database, roomCode: string) {
  const { results } = await db
    .prepare("SELECT * FROM participants WHERE room_code = ? ORDER BY slot_index ASC")
    .bind(roomCode)
    .all<ParticipantRow>();
  return results;
}

export async function getStoryTurns(db: D1Database, roomCode: string) {
  const { results } = await db
    .prepare("SELECT * FROM story_turns WHERE room_code = ? ORDER BY turn_index ASC")
    .bind(roomCode)
    .all<StoryTurnRow>();
  return results;
}

export async function getParticipantByToken(db: D1Database, roomCode: string, token: string) {
  const tokenHash = await sha256Hex(token);
  const participant = await db
    .prepare("SELECT * FROM participants WHERE room_code = ? AND token_hash = ? AND writer_type = 'human'")
    .bind(roomCode, tokenHash)
    .first<ParticipantRow>();
  if (!participant) throw new ApiError("참여 정보를 확인할 수 없어요. 다시 입장해 주세요.", 401);
  return participant;
}

export async function advanceExpiredTurns(db: D1Database, initialRoom: RoomRow, now = Date.now()) {
  let room = initialRoom;
  for (let guard = 0; guard < 20; guard += 1) {
    if (room.status !== "active" || !room.current_deadline_at || room.current_deadline_at > now) break;

    const isLastTurn = room.current_turn_index >= room.turn_limit - 1;
    await db.batch([
      db
        .prepare("UPDATE story_turns SET status = 'skipped' WHERE room_code = ? AND turn_index = ? AND status = 'pending'")
        .bind(room.room_code, room.current_turn_index),
      db
        .prepare(
          isLastTurn
            ? "UPDATE rooms SET status = 'complete', current_deadline_at = NULL, completed_at = ?, updated_at = ? WHERE room_code = ? AND status = 'active' AND current_turn_index = ?"
            : "UPDATE rooms SET current_turn_index = current_turn_index + 1, current_deadline_at = ?, updated_at = ? WHERE room_code = ? AND status = 'active' AND current_turn_index = ?",
        )
        .bind(
          ...(isLastTurn
            ? [now, now, room.room_code, room.current_turn_index]
            : [now + room.turn_seconds * 1000, now, room.room_code, room.current_turn_index]),
        ),
    ]);
    room = await getRoomByCode(db, room.room_code);
  }
  return room;
}

export function nextHumanSlot(participants: ParticipantRow[], humanLimit: number, writerLimit = humanLimit) {
  const humanCount = participants.filter((participant) => participant.writer_type === "human").length;
  if (humanCount >= humanLimit) return null;

  const used = new Set(participants.map((participant) => participant.slot_index));
  for (let slot = 0; slot < writerLimit; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

export function makeAiParticipants(roomCode: string, writerTypes: WriterType[], now: number) {
  let aiIndex = 0;
  return writerTypes.flatMap((writerType, slotIndex) => {
    if (writerType !== "ai") return [];
    aiIndex += 1;
    return [
      {
        id: makeId("ai"),
        roomCode,
        writerName: `AI 작가 ${aiIndex}`,
        writerType: "ai" as const,
        aiRole: AI_ROLES[(aiIndex - 1) % AI_ROLES.length],
        tokenHash: null,
        slotIndex,
        joinedAt: now,
      },
    ];
  });
}

function parseGenre(value: unknown): Genre {
  if (typeof value === "string" && GENRES.includes(value as Genre)) return value as Genre;
  return "all";
}

function parseAllowedNumber(value: unknown, allowed: number[], fallback: number) {
  const numeric = Number(value ?? fallback);
  if (!Number.isInteger(numeric) || !allowed.includes(numeric)) {
    throw new ApiError("방 설정 값이 허용 범위를 벗어났어요.", 400);
  }
  return numeric;
}

function parseWriterTypes(body: Record<string, unknown>): WriterType[] {
  if (Array.isArray(body.writerTypes)) {
    const writerTypes = body.writerTypes.map((value) => {
      if (value === "human" || value === "ai") return value;
      throw new ApiError("참여자 역할은 사람 또는 AI로만 설정할 수 있어요.", 400);
    });
    const requestedLimit = body.writerLimit ?? body.writerCount;
    if (requestedLimit !== undefined && Number(requestedLimit) !== writerTypes.length) {
      throw new ApiError("전체 작가 수는 참여자 역할 설정과 같아야 해요.", 400);
    }
    validateWriterComposition(writerTypes);
    return writerTypes;
  }

  const requestedWriterLimit = body.writerLimit ?? body.writerCount;
  const requestedAiLimit = body.aiLimit ?? body.aiCount;
  const requestedHumanLimit = body.humanLimit ?? body.humanCount;
  const aiLimit = parseAllowedNumber(requestedAiLimit, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0);
  let writerLimitFallback = 4;
  if (requestedWriterLimit === undefined && requestedHumanLimit !== undefined) {
    writerLimitFallback = parseAllowedNumber(requestedHumanLimit, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4) + aiLimit;
  } else if (requestedWriterLimit === undefined && requestedAiLimit !== undefined) {
    writerLimitFallback = Math.max(4, aiLimit + 1);
  }
  const writerLimit = parseAllowedNumber(requestedWriterLimit, [2, 3, 4, 5, 6, 7, 8, 9, 10], writerLimitFallback);
  const humanLimit = parseAllowedNumber(requestedHumanLimit, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], writerLimit - aiLimit);
  const writerTypes = [...Array<WriterType>(humanLimit).fill("human"), ...Array<WriterType>(aiLimit).fill("ai")];
  if (writerTypes.length !== writerLimit) {
    throw new ApiError("전체 작가 수는 사람 작가 수와 AI 작가 수의 합과 같아야 해요.", 400);
  }
  validateWriterComposition(writerTypes);
  return writerTypes;
}

function validateWriterComposition(writerTypes: WriterType[]) {
  const humanLimit = writerTypes.filter((type) => type === "human").length;
  const aiLimit = writerTypes.length - humanLimit;
  if (writerTypes.length < 2 || writerTypes.length > 10) {
    throw new ApiError("작가 수는 사람과 AI를 합쳐 2명에서 10명까지 가능해요.", 400);
  }
  if (humanLimit < 1) {
    throw new ApiError("학생이 참여하려면 사람 작가가 최소 1명 필요해요.", 400);
  }
  if (aiLimit > 9) {
    throw new ApiError("AI 작가는 한 방에 최대 9명까지 설정할 수 있어요.", 400);
  }
}

function deterministicNumber(value: string, modulo: number) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % modulo;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
