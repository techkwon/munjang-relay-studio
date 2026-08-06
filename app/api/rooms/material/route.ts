import {
  ApiError,
  errorResponse,
  getDb,
  getParticipantByToken,
  getRoomAssets,
  getRoomByCode,
  normalizeRoomCode,
  normalizeToken,
  type RoomRow,
} from "@/lib/live-story";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const url = new URL(request.url);
    const roomCode = normalizeRoomCode(url.searchParams.get("code"));
    await getParticipantByToken(db, roomCode, requireBearerToken(request));
    const room = await getRoomByCode(db, roomCode);
    if (room.seed_source !== "reference") throw new ApiError("이 방에서는 참고 자료를 사용하지 않아요.", 404);
    return await materialResponse(room);
  } catch (error) {
    return errorResponse(error);
  }
}

function requireBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new ApiError("참여 인증이 필요해요. 다시 입장해 주세요.", 401);
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiError("참여 인증 형식이 올바르지 않아요.", 401);
  }
  return normalizeToken(token);
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
