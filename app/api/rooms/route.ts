import {
  advanceExpiredTurns,
  ApiError,
  errorResponse,
  getDb,
  getParticipantByToken,
  getParticipants,
  getRoomByCode,
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
} from "@/lib/live-story";

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
      return json({ room: safeRoom(room, participants, turns), participant: safeParticipant(participant) });
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
      participant: participant ? safeParticipant(participant) : null,
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
  const isLastTurn = room.current_turn_index >= room.turn_limit - 1;
  const [submitResult, roomResult] = await db.batch([
    db
      .prepare(
        `UPDATE story_turns
         SET status = 'submitted', text = ?, submitted_at = ?
         WHERE room_code = ? AND turn_index = ? AND participant_id = ? AND status = 'pending'`,
      )
      .bind(text, now, roomCode, room.current_turn_index, participant.id),
    db
      .prepare(
        isLastTurn
          ? `UPDATE rooms
             SET status = 'complete', current_deadline_at = NULL, completed_at = ?, updated_at = ?
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ?`
          : `UPDATE rooms
             SET current_turn_index = current_turn_index + 1, current_deadline_at = ?, updated_at = ?
             WHERE room_code = ? AND status = 'active' AND current_turn_index = ?`,
      )
      .bind(
        ...(isLastTurn
          ? [now, now, roomCode, room.current_turn_index]
          : [now + room.turn_seconds * 1000, now, roomCode, room.current_turn_index]),
      ),
  ]);
  if (submitResult.meta?.changes !== 1 || roomResult.meta?.changes !== 1) {
    throw new ApiError("이미 제출된 차례예요. 상태를 새로고침해 주세요.", 409);
  }

  room = await advanceExpiredTurns(db, await getRoomByCode(db, roomCode));
  const [participants, turns] = await Promise.all([getParticipants(db, roomCode), getStoryTurns(db, roomCode)]);
  return json({ room: safeRoom(room, participants, turns), participant: safeParticipant(participant), message: "문장이 이어졌어요." });
}
