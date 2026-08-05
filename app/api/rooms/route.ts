import {
  advanceExpiredTurns,
  ApiError,
  errorResponse,
  getDb,
  getParticipantByToken,
  getParticipantWriterLevel,
  getParticipants,
  getRoomByCode,
  getRoomModerationSettings,
  getStoryTurns,
  json,
  makeId,
  makeParticipantToken,
  nextHumanSlot,
  normalizeRoomCode,
  normalizeSubmissionText,
  normalizeToken,
  normalizeWriterName,
  readJsonObject,
  safeParticipant,
  safeRoom,
  safeRoomPreview,
  sha256Hex,
  type D1Database,
  type ModerationCategory,
  type RoomRow,
  type WriterLevel,
} from "@/lib/live-story";
import { buildModerationRewriteMessages, moderateSubmission, validateModerationRewrite } from "@/lib/moderation";
import { generateSolarJson } from "@/lib/solar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const roomCode = normalizeRoomCode(url.searchParams.get("code"));
    const token = getBearerToken(request);
    const room = await advanceExpiredTurns(db, await getRoomByCode(db, roomCode));
    const [participants, turns] = await Promise.all([getParticipants(db, roomCode), getStoryTurns(db, roomCode)]);

    if (token) {
      const participant = await getParticipantByToken(db, roomCode, token);
      return json({ room: safeRoom(room, participants, turns), participant: safeParticipant(participant, room, { includeModeration: true }) });
    }

    return json({ room: safeRoomPreview(room, participants) });
  } catch (error) {
    return errorResponse(error);
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError("참여 인증 형식이 올바르지 않아요.", 401);
  }
  return normalizeToken(token);
}

function requireBearerToken(request: Request) {
  const token = getBearerToken(request);
  if (!token) throw new ApiError("참여 인증이 필요해요. 다시 입장해 주세요.", 401);
  return token;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const action = typeof body.action === "string" ? body.action : "join";
    if (action === "submit") return await submit(body, requireBearerToken(request));
    return await join(body);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return await submit(await readJsonObject(request), requireBearerToken(request));
  } catch (error) {
    return errorResponse(error);
  }
}

async function join(body: Record<string, unknown>) {
  const db = getDb();
  const roomCode = normalizeRoomCode(body.roomCode ?? body.code);
  const writerName = normalizeWriterName(body.writerName ?? body.name);
  const room = await getRoomByCode(db, roomCode);
  if (room.status !== "lobby") throw new ApiError("대기 중인 방에만 입장할 수 있어요.", 409);

  const participants = await getParticipants(db, roomCode);
  const slotIndex = nextHumanSlot(participants, room.human_limit, room.writer_limit);
  if (slotIndex === null) throw new ApiError("이 방의 사람 작가 자리가 모두 찼어요.", 409);
  if (participants.some((participant) => participant.writer_name === writerName)) {
    throw new ApiError("이미 사용 중인 작가명이에요. 다른 이름을 입력해 주세요.", 409);
  }
  const now = Date.now();
  const token = makeParticipantToken();
  const tokenHash = await sha256Hex(token);
  const participantId = makeId("pt");
  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO participants (
          id, room_code, writer_name, writer_type, ai_role, token_hash, slot_index, joined_at
        ) VALUES (?, ?, ?, 'human', NULL, ?, ?, ?)`,
      )
      .bind(participantId, roomCode, writerName, tokenHash, slotIndex, now)
      .run();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const latestParticipants = await getParticipants(db, roomCode);
    if (latestParticipants.some((participant) => participant.writer_name === writerName)) {
      throw new ApiError("이미 사용 중인 작가명이에요. 다른 이름을 입력해 주세요.", 409);
    }
    throw new ApiError("다른 작가가 먼저 입장했어요. 남은 자리를 다시 확인해 주세요.", 409);
  }
  if (result.meta?.changes !== 1) throw new ApiError("입장 처리 중 충돌이 있었어요. 다시 시도해 주세요.", 409);

  const [nextRoom, nextParticipants] = await Promise.all([getRoomByCode(db, roomCode), getParticipants(db, roomCode)]);
  const participant = nextParticipants.find((item) => item.id === participantId);
  return json(
    {
      room: safeRoom(nextRoom, nextParticipants),
      participant: participant ? safeParticipant(participant, nextRoom, { includeModeration: true }) : null,
      writerLevel: participant ? getParticipantWriterLevel(nextRoom, participant) : "elementary",
      token,
      message: "방에 입장했어요.",
    },
    { status: 201 },
  );
}

function isUniqueConstraintError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error && /unique constraint|constraint failed/i.test(current.message)) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

async function submit(body: Record<string, unknown>, token: string) {
  const db = getDb();
  const roomCode = normalizeRoomCode(body.roomCode ?? body.code);
  const text = normalizeSubmissionText(body.text);
  const participant = await getParticipantByToken(db, roomCode, token);
  let room = await advanceExpiredTurns(db, await getRoomByCode(db, roomCode));
  if (participant.blocked_at != null) throw new ApiError("경고 제한으로 이 방에서는 더 이상 제출할 수 없어요. 선생님께 도움을 요청해 주세요.", 403);

  if (room.status === "closed") throw new ApiError("마감된 방에는 더 이상 제출할 수 없어요.", 409);
  if (room.status !== "active") throw new ApiError("아직 작성할 수 있는 차례가 아니에요.", 409);

  const currentTurn = await db
    .prepare("SELECT * FROM story_turns WHERE room_code = ? AND turn_index = ?")
    .bind(roomCode, room.current_turn_index)
    .first<{ participant_id: string; writer_type: string; status: string }>();
  if (!currentTurn) throw new ApiError("현재 차례 정보를 찾을 수 없어요.", 409);
  if (currentTurn.writer_type !== "human") throw new ApiError("지금은 AI 작가 차례예요.", 409);
  if (currentTurn.participant_id !== participant.id) throw new ApiError("아직 내 차례가 아니에요.", 409);
  if (currentTurn.status !== "pending") throw new ApiError("이미 처리된 차례예요.", 409);

  const now = Date.now();
  const moderationSettings = getRoomModerationSettings(room);
  const writerLevel = getParticipantWriterLevel(room, participant);
  const initialModeration = moderateSubmission(text, moderationSettings, writerLevel);
  const moderationCategories = initialModeration.categories;
  let storedText = text;
  let aiRewritten = false;
  let moderationCheckedAt: number | null = null;

  if (initialModeration.flagged) {
    moderationCheckedAt = now;
    await claimModerationRewrite(db, room, participant.id, moderationCheckedAt);
    try {
      storedText = await rewriteFlaggedSubmission({
        text,
        categories: moderationCategories,
        level: writerLevel,
        room,
      });
      if (!validateModerationRewrite(storedText, moderationSettings, writerLevel)) {
        throw new ApiError("AI가 안전한 문장으로 순화하지 못했어요. 잠시 후 다시 제출해 주세요.", 502);
      }
    } catch (error) {
      await clearModerationRewriteClaim(db, room, participant.id, moderationCheckedAt);
      throw error;
    }
    aiRewritten = true;
  }

  const submitAt = Date.now();
  moderationCheckedAt ??= submitAt;
  const nextWarningCount = (participant.warning_count ?? 0) + (initialModeration.flagged ? 1 : 0);
  const blockedAt =
    initialModeration.flagged && moderationSettings.warningLock && nextWarningCount >= moderationSettings.warningLimit
      ? submitAt
      : (participant.blocked_at ?? null);
  const isLastTurn = room.current_turn_index >= room.turn_limit - 1;
  const submitStatement = initialModeration.flagged
    ? db
        .prepare(
          `UPDATE story_turns
           SET status = 'submitted', text = ?, moderation_categories = ?, submitted_at = ?
           WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending' AND moderation_checked_at = ?
             AND EXISTS (
               SELECT 1 FROM rooms
               WHERE rooms.room_code = story_turns.room_code
                 AND rooms.status = 'active' AND rooms.current_turn_index = story_turns.turn_index
             )`,
        )
        .bind(
          storedText,
          JSON.stringify(moderationCategories),
          submitAt,
          roomCode,
          room.current_turn_index,
          participant.id,
          moderationCheckedAt,
        )
    : db
        .prepare(
          `UPDATE story_turns
           SET status = 'submitted', text = ?, moderation_categories = ?, moderation_checked_at = ?, submitted_at = ?
           WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending' AND moderation_checked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM rooms
               WHERE rooms.room_code = story_turns.room_code
                 AND rooms.status = 'active' AND rooms.current_turn_index = story_turns.turn_index
             )`,
        )
        .bind(
          storedText,
          JSON.stringify(moderationCategories),
          moderationCheckedAt,
          submitAt,
          roomCode,
          room.current_turn_index,
          participant.id,
        );
  const statements = [
    submitStatement,
    db
      .prepare(
        isLastTurn
          ? `UPDATE rooms
             SET status = 'complete', current_deadline_at = NULL, completed_at = ?, updated_at = ?
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ?
               AND EXISTS (
                 SELECT 1 FROM story_turns
                 WHERE story_turns.room_code = rooms.room_code
                   AND story_turns.turn_index = rooms.current_turn_index
                   AND story_turns.participant_id = ? AND story_turns.status = 'submitted'
                   AND story_turns.submitted_at = ? AND story_turns.moderation_checked_at = ?
               )`
          : `UPDATE rooms
             SET current_turn_index = current_turn_index + 1, current_deadline_at = ?, updated_at = ?
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ?
               AND EXISTS (
                 SELECT 1 FROM story_turns
                 WHERE story_turns.room_code = rooms.room_code
                   AND story_turns.turn_index = rooms.current_turn_index
                   AND story_turns.participant_id = ? AND story_turns.status = 'submitted'
                   AND story_turns.submitted_at = ? AND story_turns.moderation_checked_at = ?
               )`,
      )
      .bind(
        ...(isLastTurn
          ? [submitAt, submitAt, roomCode, room.current_turn_index, participant.id, submitAt, moderationCheckedAt]
          : [
              submitAt + room.turn_seconds * 1000,
              submitAt,
              roomCode,
              room.current_turn_index,
              participant.id,
              submitAt,
              moderationCheckedAt,
            ]),
      ),
  ];
  if (initialModeration.flagged) {
    statements.push(
      db
        .prepare(
          `UPDATE participants
           SET warning_count = warning_count + 1, last_warning_at = ?, blocked_at = ?
           WHERE room_code = ? AND id = ? AND blocked_at IS NULL
             AND EXISTS (
               SELECT 1 FROM story_turns
               WHERE room_code = ? AND turn_index = ? AND participant_id = ?
                 AND status = 'submitted' AND submitted_at = ? AND moderation_checked_at = ?
             )`,
        )
        .bind(
          submitAt,
          blockedAt,
          roomCode,
          participant.id,
          roomCode,
          room.current_turn_index,
          participant.id,
          submitAt,
          moderationCheckedAt,
        ),
    );
  }
  const [submitResult, roomResult, warningResult] = await db.batch(statements);
  if (submitResult.meta?.changes !== 1 || roomResult.meta?.changes !== 1 || (initialModeration.flagged && warningResult?.meta?.changes !== 1)) {
    throw new ApiError("이미 제출된 차례예요. 상태를 새로고침해 주세요.", 409);
  }

  room = await advanceExpiredTurns(db, await getRoomByCode(db, roomCode));
  const [participants, turns] = await Promise.all([getParticipants(db, roomCode), getStoryTurns(db, roomCode)]);
  const nextParticipant = participants.find((item) => item.id === participant.id) ?? participant;
  return json({
    room: safeRoom(room, participants, turns),
    participant: safeParticipant(nextParticipant, room, { includeModeration: true }),
    moderation: {
      checked: true,
      applied: initialModeration.flagged,
      categories: moderationCategories,
      aiRewritten,
      warningCount: nextParticipant.warning_count,
      warningLimit: moderationSettings.warningLimit,
      writingRestricted: nextParticipant.blocked_at != null,
    },
    message: aiRewritten ? "위험 요소가 있어 AI가 안전한 표현으로 순화해 작품에 반영했습니다." : "문장이 이어졌어요.",
  });
}

type RewriteOptions = {
  text: string;
  categories: ModerationCategory[];
  level: WriterLevel;
  room: RoomRow;
  generate?: typeof generateSolarJson;
};

type RewriteResult = {
  rewrittenText: string;
};

const rewriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rewrittenText"],
  properties: {
    rewrittenText: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
  },
};

async function claimModerationRewrite(db: D1Database, room: RoomRow, participantId: string, claimAt: number) {
  const rewriteDeadlineAt = claimAt + Math.max(room.turn_seconds * 1000, 60_000);
  const [turnResult, roomResult] = await db.batch([
    db
      .prepare(
        `UPDATE story_turns
         SET moderation_checked_at = ?, deadline_at = ?
         WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending' AND moderation_checked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM rooms
             WHERE rooms.room_code = story_turns.room_code
               AND rooms.status = 'active' AND rooms.current_turn_index = story_turns.turn_index
           )`,
      )
      .bind(claimAt, rewriteDeadlineAt, room.room_code, room.current_turn_index, participantId),
    db
      .prepare(
        `UPDATE rooms
         SET current_deadline_at = ?, updated_at = ?
         WHERE room_code = ? AND status = 'active' AND current_turn_index = ?
           AND EXISTS (
             SELECT 1 FROM story_turns
             WHERE story_turns.room_code = rooms.room_code
               AND story_turns.turn_index = rooms.current_turn_index
               AND story_turns.participant_id = ? AND story_turns.status = 'pending'
               AND story_turns.moderation_checked_at = ?
           )`,
      )
      .bind(rewriteDeadlineAt, claimAt, room.room_code, room.current_turn_index, participantId, claimAt),
  ]);
  if (turnResult.meta?.changes !== 1 || roomResult.meta?.changes !== 1) {
    throw new ApiError("이미 안전 점검 중인 문장이 있어요. 잠시 후 다시 시도해 주세요.", 409);
  }
}

async function clearModerationRewriteClaim(db: D1Database, room: RoomRow, participantId: string, claimAt: number) {
  const now = Date.now();
  const retryDeadlineAt = now + Math.max(room.turn_seconds * 1000, 60_000);
  await db.batch([
    db
      .prepare(
        `UPDATE story_turns
         SET moderation_checked_at = NULL, deadline_at = ?
         WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending' AND moderation_checked_at = ?`,
      )
      .bind(retryDeadlineAt, room.room_code, room.current_turn_index, participantId, claimAt),
    db
      .prepare(
        `UPDATE rooms
         SET current_deadline_at = ?, updated_at = ?
         WHERE room_code = ? AND status = 'active' AND current_turn_index = ?
           AND EXISTS (
             SELECT 1 FROM story_turns
             WHERE story_turns.room_code = rooms.room_code
               AND story_turns.turn_index = rooms.current_turn_index
               AND story_turns.participant_id = ? AND story_turns.status = 'pending'
               AND story_turns.moderation_checked_at IS NULL AND story_turns.deadline_at = ?
           )`,
      )
      .bind(retryDeadlineAt, now, room.room_code, room.current_turn_index, participantId, retryDeadlineAt),
  ]);
}

export async function rewriteFlaggedSubmission(options: RewriteOptions) {
  const generate = options.generate ?? generateSolarJson;
  try {
    const result = await generate<RewriteResult>({
      schemaName: "moderation_rewrite",
      schema: rewriteSchema,
      maxTokens: 700,
      temperature: 0.25,
      messages: buildModerationRewriteMessages({
        text: options.text,
        categories: options.categories,
        level: options.level,
        storyTitle: options.room.story_title,
        storySetup: options.room.story_setup,
        storyOpener: options.room.story_opener,
      }),
    });
    return normalizeSubmissionText(result.rewrittenText);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError("AI가 안전한 문장으로 순화하지 못했어요. 잠시 후 다시 제출해 주세요.", error.status === 504 ? 503 : error.status);
    }
    throw new ApiError("AI가 안전한 문장으로 순화하지 못했어요. 잠시 후 다시 제출해 주세요.", 502);
  }
}
