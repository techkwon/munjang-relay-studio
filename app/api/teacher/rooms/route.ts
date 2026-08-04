import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  advanceExpiredTurns,
  ApiError,
  createFallbackSeed,
  D1Database,
  errorResponse,
  getDb,
  getParticipants,
  getRoomByCode,
  getStoryTurns,
  json,
  makeAiParticipants,
  makeEventIndex,
  makeId,
  makeRoomCode,
  makeSeedIndex,
  makeTurnParticipantOrder,
  normalizeRoomCode,
  parseRoomSettings,
  readJsonObject,
  safeRoom,
  type ParticipantRow,
  type RoomRow,
} from "@/lib/live-story";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");

    if (code) {
      const roomCode = normalizeRoomCode(code);
      const room = await advanceExpiredTurns(db, await getOwnedRoom(db, roomCode, user.userId));
      const [participants, turns] = await Promise.all([getParticipants(db, room.room_code), getStoryTurns(db, room.room_code)]);
      return json({ room: safeRoom(room, participants, turns) });
    }

    const { results } = await db
      .prepare("SELECT * FROM rooms WHERE owner_user_id = ? ORDER BY updated_at DESC")
      .bind(user.userId)
      .all<RoomRow>();
    const rooms = await Promise.all(
      results.map(async (room) => {
        const advancedRoom = await advanceExpiredTurns(db, room);
        const [participants, turns] = await Promise.all([
          getParticipants(db, advancedRoom.room_code),
          getStoryTurns(db, advancedRoom.room_code),
        ]);
        return safeRoom(advancedRoom, participants, turns);
      }),
    );
    return json({ rooms });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const body = await readJsonObject(request);
    const settings = parseRoomSettings(body);
    const now = Date.now();
    const openRoomCount = await db
      .prepare("SELECT COUNT(*) AS count FROM rooms WHERE owner_user_id = ? AND status IN ('lobby', 'active')")
      .bind(user.userId)
      .first<{ count: number }>();
    if ((openRoomCount?.count ?? 0) >= 20) {
      throw new ApiError("동시에 운영할 수 있는 방은 20개까지예요. 사용하지 않는 방을 먼저 마감해 주세요.", 429);
    }

    let roomCode: string | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = makeRoomCode();
      const existing = await db.prepare("SELECT room_code FROM rooms WHERE room_code = ?").bind(candidate).first();
      if (!existing) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) throw new ApiError("방 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.", 503);

    const seedIndex = makeSeedIndex(roomCode, settings.genre);
    const eventIndex = makeEventIndex(roomCode, settings.genre);
    const seed = createFallbackSeed(settings.genre, seedIndex);
    const aiParticipants = makeAiParticipants(roomCode, settings.writerTypes, now);

    await db.batch([
      db
        .prepare(
          `INSERT INTO rooms (
            room_code, owner_user_id, owner_email, status, writer_limit, human_limit, ai_limit,
            genre, turn_limit, turn_seconds, order_mode, current_turn_index, current_deadline_at,
            seed_index, event_index, story_title, story_setup, story_opener, seed_source,
            ai_generation_status, analysis_status, created_at, updated_at
          ) VALUES (?, ?, ?, 'lobby', ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, 'fallback', 'idle', 'idle', ?, ?)`,
        )
        .bind(
          roomCode,
          user.userId,
          user.email,
          settings.writerLimit,
          settings.humanLimit,
          settings.aiLimit,
          settings.genre,
          settings.turnLimit,
          settings.turnSeconds,
          settings.orderMode,
          seedIndex,
          eventIndex,
          seed.title,
          seed.setup,
          seed.opener,
          now,
          now,
        ),
      ...aiParticipants.map((participant) =>
        db
          .prepare(
            `INSERT INTO participants (
              id, room_code, writer_name, writer_type, ai_role, token_hash, slot_index, joined_at
            ) VALUES (?, ?, ?, 'ai', ?, NULL, ?, ?)`,
          )
          .bind(participant.id, participant.roomCode, participant.writerName, participant.aiRole, participant.slotIndex, participant.joinedAt),
      ),
    ]);

    const room = await getRoomByCode(db, roomCode);
    const participants = await getParticipants(db, roomCode);
    return json({ room: safeRoom(room, participants), message: "방이 만들어졌어요." }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const body = await readJsonObject(request);
    const roomCode = normalizeRoomCode(body.roomCode ?? body.code);
    const action = typeof body.action === "string" ? body.action : "";
    const room = await getOwnedRoom(db, roomCode, user.userId);

    if (action === "start") {
      return await startRoom(db, room);
    }
    if (action === "close") {
      return await closeRoom(db, room);
    }
    throw new ApiError("지원하지 않는 방 제어 요청이에요.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}

async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError("교사용 기능은 ChatGPT 로그인이 필요해요.", 401);
  return user;
}

async function getOwnedRoom(db: D1Database, roomCode: string, userId: string) {
  const room = await getRoomByCode(db, roomCode);
  if (room.owner_user_id !== userId) throw new ApiError("이 방을 관리할 권한이 없어요.", 403);
  return room;
}

async function startRoom(db: D1Database, room: RoomRow) {
  if (room.status !== "lobby") throw new ApiError("대기 중인 방만 시작할 수 있어요.", 409);

  const participants = await getParticipants(db, room.room_code);
  const humanCount = participants.filter((participant) => participant.writer_type === "human").length;
  if (humanCount !== room.human_limit) {
    throw new ApiError("사람 작가가 모두 입장해야 활동을 시작할 수 있어요.", 409);
  }
  if (participants.length !== room.writer_limit) {
    throw new ApiError("작가 수가 방 설정과 맞지 않아요.", 409);
  }

  const now = Date.now();
  const deadlineAt = now + room.turn_seconds * 1000;
  const orderedParticipants = makeTurnParticipantOrder(participants, room.order_mode, room.room_code);
  const turnStatements = Array.from({ length: room.turn_limit }, (_, turnIndex) => {
    const participant = orderedParticipants[turnIndex % orderedParticipants.length] as ParticipantRow;
    return db
      .prepare(
        `INSERT INTO story_turns (
          id, room_code, turn_index, participant_id, writer_name, writer_type, status, text, deadline_at, submitted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, ?)`,
      )
      .bind(
        makeId("turn"),
        room.room_code,
        turnIndex,
        participant.id,
        participant.writer_name,
        participant.writer_type,
        deadlineAt + turnIndex * room.turn_seconds * 1000,
        now,
      );
  });
  const [startResult] = await db.batch([
    db
      .prepare(
        `UPDATE rooms
         SET status = 'active', started_at = ?, updated_at = ?, current_turn_index = 0, current_deadline_at = ?
         WHERE room_code = ? AND status = 'lobby'`,
      )
      .bind(now, now, deadlineAt, room.room_code),
    ...turnStatements,
  ]);

  if (startResult.meta?.changes !== 1) throw new ApiError("방을 시작하지 못했어요. 상태를 새로고침해 주세요.", 409);

  const [nextRoom, participantsAfter, turns] = await Promise.all([
    getRoomByCode(db, room.room_code),
    getParticipants(db, room.room_code),
    getStoryTurns(db, room.room_code),
  ]);
  return json({ room: safeRoom(nextRoom, participantsAfter, turns), message: "활동이 시작되었어요." });
}

async function closeRoom(db: D1Database, room: RoomRow) {
  if (room.status === "closed") throw new ApiError("이미 마감된 방이에요.", 409);
  const now = Date.now();
  await db
    .prepare("UPDATE rooms SET status = 'closed', closed_at = ?, updated_at = ?, current_deadline_at = NULL WHERE room_code = ?")
    .bind(now, now, room.room_code)
    .run();

  const [nextRoom, participants, turns] = await Promise.all([
    getRoomByCode(db, room.room_code),
    getParticipants(db, room.room_code),
    getStoryTurns(db, room.room_code),
  ]);
  return json({ room: safeRoom(nextRoom, participants, turns), message: "활동이 마감되었어요." });
}
