import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  ApiError,
  errorResponse,
  getDb,
  getRoomAssets,
  getRoomByCode,
  getParticipants,
  getStoryTurns,
  json,
  makeId,
  normalizeOptionalText,
  normalizeRoomCode,
  readJsonObject,
  safeRoom,
  type D1Database,
  type MaterialKind,
  type RoomRow,
} from "@/lib/live-story";

export const dynamic = "force-dynamic";

const MAX_MATERIAL_BYTES = 10 * 1024 * 1024;
const ALLOWED_MATERIALS: Record<string, { kind: MaterialKind; extension: string }> = {
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "application/pdf": { kind: "pdf", extension: "pdf" },
};

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const form = await request.formData();
    const roomCode = normalizeRoomCode(form.get("roomCode") ?? form.get("code"));
    const db = getDb();
    const room = await getOwnedLobbyRoom(db, roomCode, user.userId);
    const file = form.get("file");
    const note = normalizeOptionalText(form.get("referenceNote") ?? form.get("note") ?? form.get("materialNote"), 800);
    if (!(file instanceof File)) {
      if (!room.material_key) throw new ApiError("첨부할 이미지 또는 PDF 파일을 선택해 주세요.", 400);
      const noteResult = await db
        .prepare(
          `UPDATE rooms
           SET material_note = ?, reference_note = ?, updated_at = ?
           WHERE room_code = ? AND owner_user_id = ? AND status = 'lobby'`,
        )
        .bind(note, note, Date.now(), room.room_code, user.userId)
        .run();
      if (noteResult.meta?.changes !== 1) throw new ApiError("참고 자료 메모를 저장하지 못했어요. 상태를 새로고침해 주세요.", 409);
      return await roomResponse(db, room.room_code, "참고 자료 메모를 저장했어요.");
    }

    const material = validateMaterialMetadata(file);
    const bytes = await file.arrayBuffer();
    validateMaterialSignature(file.type, new Uint8Array(bytes));
    const key = `rooms/${room.owner_user_id}/${room.room_code}/${makeId("mat")}.${material.extension}`;
    const assets = getRoomAssets();
    await assets.put(key, bytes, { httpMetadata: { contentType: file.type } });

    const now = Date.now();
    try {
      const updateResult = await db
        .prepare(
          `UPDATE rooms
           SET material_kind = ?, material_name = ?, material_mime = ?, material_size = ?, material_key = ?,
               material_note = ?, reference_note = ?, updated_at = ?
           WHERE room_code = ? AND owner_user_id = ? AND status = 'lobby'`,
        )
        .bind(material.kind, safeFileName(file.name), file.type, file.size, key, note, note, now, room.room_code, user.userId)
        .run();
      if (updateResult.meta?.changes !== 1) throw new ApiError("참고 자료를 연결하지 못했어요. 상태를 새로고침해 주세요.", 409);
    } catch (error) {
      await deleteAssetOrWarn(assets, key, "upload rollback");
      throw error;
    }

    if (room.material_key && room.material_key !== key) {
      await deleteAssetOrWarn(assets, room.material_key, "replacement cleanup");
    }

    return await roomResponse(db, room.room_code, "참고 자료를 연결했어요.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await readJsonObject(request);
    const roomCode = normalizeRoomCode(body.roomCode ?? body.code);
    const db = getDb();
    const room = await getOwnedLobbyRoom(db, roomCode, user.userId);
    const deleteResult = await db
      .prepare(
        `UPDATE rooms
         SET material_kind = NULL, material_name = NULL, material_mime = NULL, material_size = NULL,
             material_key = NULL, material_note = NULL, reference_note = NULL, updated_at = ?
         WHERE room_code = ? AND owner_user_id = ? AND status = 'lobby'`,
      )
      .bind(Date.now(), room.room_code, user.userId)
      .run();
    if (deleteResult.meta?.changes !== 1) throw new ApiError("참고 자료를 삭제하지 못했어요. 상태를 새로고침해 주세요.", 409);
    if (room.material_key) await deleteAssetOrWarn(getRoomAssets(), room.material_key, "teacher deletion");
    return await roomResponse(db, room.room_code, "참고 자료를 삭제했어요.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const roomCode = normalizeRoomCode(new URL(request.url).searchParams.get("code"));
    const room = await getOwnedRoom(db, roomCode, user.userId);
    return await materialResponse(room);
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

async function getOwnedLobbyRoom(db: D1Database, roomCode: string, userId: string) {
  const room = await getOwnedRoom(db, roomCode, userId);
  if (room.status !== "lobby") throw new ApiError("참고 자료는 활동 시작 전 대기 중인 방에서만 바꿀 수 있어요.", 409);
  return room;
}

async function roomResponse(db: D1Database, roomCode: string, message: string) {
  const [room, participants, turns] = await Promise.all([getRoomByCode(db, roomCode), getParticipants(db, roomCode), getStoryTurns(db, roomCode)]);
  return json({ room: safeRoom(room, participants, turns, { teacher: true }), message });
}

function validateMaterialMetadata(file: File) {
  const material = ALLOWED_MATERIALS[file.type];
  if (!material) throw new ApiError("PNG, JPG, WEBP 이미지 또는 PDF만 첨부할 수 있어요.", 400);
  if (file.size < 1) throw new ApiError("빈 파일은 첨부할 수 없어요.", 400);
  if (file.size > MAX_MATERIAL_BYTES) throw new ApiError("첨부 파일은 10MB까지만 가능해요.", 413);
  return material;
}

function validateMaterialSignature(mime: string, bytes: Uint8Array) {
  const matchesSignature =
    (mime === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mime === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    (mime === "image/webp" && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") ||
    (mime === "application/pdf" && ascii(bytes, 0, 5) === "%PDF-");
  if (!matchesSignature) throw new ApiError("파일 내용과 형식이 일치하지 않아요. 올바른 이미지 또는 PDF를 선택해 주세요.", 400);
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function deleteAssetOrWarn(assets: ReturnType<typeof getRoomAssets>, key: string, context: string) {
  try {
    await assets.delete(key);
  } catch (error) {
    console.error("Room material cleanup failed", { context, key, error });
  }
}

function safeFileName(value: string) {
  const name = value.trim().replace(/[^\p{L}\p{N}._ -]+/gu, "_").replace(/\s+/g, " ");
  return name.slice(0, 120) || "class-material";
}

async function materialResponse(room: RoomRow) {
  if (!room.material_key || !room.material_mime || !room.material_name) throw new ApiError("연결된 참고 자료가 없어요.", 404);
  const object = await getRoomAssets().get(room.material_key);
  if (!object) throw new ApiError("참고 자료 파일을 찾을 수 없어요.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", room.material_mime);
  headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(room.material_name)}`);
  headers.set("cache-control", "private, max-age=60");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (room.material_size) headers.set("content-length", String(room.material_size));
  return new Response(object.body, { headers });
}
