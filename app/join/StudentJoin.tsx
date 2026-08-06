"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type RoomStatus = "lobby" | "active" | "complete" | "closed";
type WriterLevel = "elementary" | "middle" | "high";

type Writer = {
  id: string;
  name: string;
  displayName?: string;
  kind: "human" | "ai";
  position: number;
  level: WriterLevel;
  warningCount?: number;
  writingRestricted?: boolean;
};

type Entry = {
  id: string;
  turnNumber: number;
  writerName: string;
  writerKind?: "human" | "ai";
  text: string;
  skipped?: boolean;
};

type WriterReport = {
  participantId?: string;
  name?: string;
  writerName?: string;
  level?: WriterLevel;
  contributionShare?: number;
  paragraphs?: number;
  characters?: number;
  strengths?: string[];
  evidence?: string[];
  evidenceSnippets?: string[];
  evidenceNotes?: string[];
  nextStep?: string;
  practicePrompt?: string;
};

type AnalysisReport = {
  summary?: string;
  collaborationHighlights?: string[];
  writers?: WriterReport[];
  groupSuggestion?: string;
};

type Room = {
  id: string;
  code: string;
  title: string;
  status: RoomStatus;
  genre: string;
  writerLimit: number;
  humanWriterCount: number;
  aiWriterCount: number;
  orderMode: "sequential" | "random";
  turnLimit: number;
  turnSeconds: number;
  writerLevels: WriterLevel[];
  currentTurn: number;
  currentWriterPosition: number;
  turnExpiresAt: number | null;
  storyTitle?: string | null;
  storySetup?: string | null;
  storyOpener?: string | null;
  seedSource?: string | null;
  referenceNote?: string | null;
  material?: RoomMaterial | null;
  participants?: Writer[];
  writers?: Writer[];
  entries?: Entry[];
  participantCount?: number;
  availableHumanSlots?: number;
  analysisStatus?: string | null;
  analysisReport?: AnalysisReport | string | null;
  serverNow?: number;
  version?: number;
};

type RoomMaterial = {
  id?: string;
  name?: string;
  type?: "image" | "pdf" | "note";
  mimeType?: string;
  size?: number;
  available?: boolean;
  url?: string;
  note?: string;
};

type StudentSession = {
  participantId: string;
  token: string;
  name: string;
};

type ModerationResult = {
  applied?: boolean;
  aiRewritten?: boolean;
  categories?: string[];
  warningCount?: number;
  warningLimit?: number;
  writingRestricted?: boolean;
};

type ModerationAlert = {
  message: string;
  categories: string[];
  warningCount?: number;
  warningLimit?: number;
  writingRestricted?: boolean;
};

function roomStorageKey(code: string) {
  return `munjang-itgi:room:${code}`;
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

const LEVEL_LABEL: Record<WriterLevel, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

const MODERATION_CATEGORY_LABEL: Record<string, string> = {
  nsfw: "NSFW",
  hate: "혐오",
  threat: "위협",
  slang: "욕설·은어",
};

function normalizeWriterLevel(value: unknown): WriterLevel {
  if (value === "elementary" || value === "middle" || value === "high") return value;
  return "elementary";
}

function readWriterLevel(value: unknown): WriterLevel | null {
  if (value === "elementary" || value === "middle" || value === "high") return value;
  return null;
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeMaterial(value: unknown): RoomMaterial | null {
  if (!value || typeof value !== "object") return null;
  const material = value as Record<string, unknown>;
  const mimeType = typeof material.mimeType === "string"
    ? material.mimeType
    : typeof material.mime === "string"
      ? material.mime
      : typeof material.type === "string"
        ? material.type
        : "";
  const materialType = mimeType.includes("pdf")
    ? "pdf"
    : mimeType.startsWith("image/")
      ? "image"
      : material.kind === "pdf" || material.type === "pdf"
        ? "pdf"
        : material.kind === "image" || material.type === "image"
          ? "image"
          : "note";
  return {
    id: typeof material.id === "string" ? material.id : typeof material.materialId === "string" ? material.materialId : undefined,
    name: typeof material.name === "string" ? material.name : typeof material.filename === "string" ? material.filename : undefined,
    type: materialType,
    mimeType,
    size: typeof material.size === "number" ? material.size : undefined,
    available: material.available === true || typeof material.url === "string" || typeof material.downloadUrl === "string",
    url: typeof material.url === "string" ? material.url : typeof material.downloadUrl === "string" ? material.downloadUrl : undefined,
    note: typeof material.note === "string" ? material.note : typeof material.referenceNote === "string" ? material.referenceNote : undefined,
  };
}

function normalizeModerationCategories(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item))
    .filter(Boolean)
    .map((item) => MODERATION_CATEGORY_LABEL[item] ?? item);
}

function normalizeRoom(payload: unknown): Room | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = (record.room ?? record) as Record<string, unknown>;
  const code = typeof value.roomCode === "string" ? value.roomCode : typeof value.code === "string" ? value.code : "";
  if (!code) return null;
  const roomWriterLevels = Array.isArray(value.writerLevels)
    ? value.writerLevels.map((item) => normalizeWriterLevel(item))
    : Array.from({ length: Number(value.writerLimit ?? 0) }, () => "elementary" as WriterLevel);
  const privateParticipant = record.participant && typeof record.participant === "object"
    ? record.participant as Record<string, unknown>
    : null;
  const privateParticipantId = String(privateParticipant?.id ?? privateParticipant?.participantId ?? "");
  const rawParticipants = Array.isArray(value.participants) ? value.participants as Array<Record<string, unknown>> : [];
  const participants: Writer[] = rawParticipants.map((writer, index): Writer => ({
    id: String(writer.id ?? `writer-${index}`),
    name: String(writer.writerName ?? writer.name ?? `작가 ${index + 1}`),
    kind: writer.writerType === "ai" || writer.kind === "ai" ? "ai" : "human",
    position: Number(writer.orderPosition ?? writer.slotIndex ?? writer.position ?? index),
    level: readWriterLevel(writer.writerLevel ?? writer.level) ?? roomWriterLevels[Number(writer.slotIndex ?? writer.position ?? index)] ?? "elementary",
    warningCount: String(writer.id ?? "") === privateParticipantId ? readOptionalNumber(privateParticipant?.warningCount) : undefined,
    writingRestricted: String(writer.id ?? "") === privateParticipantId ? privateParticipant?.writingRestricted === true : undefined,
  })).sort((a, b) => a.position - b.position);
  const current = value.currentTurn && typeof value.currentTurn === "object"
    ? value.currentTurn as Record<string, unknown>
    : null;
  const currentParticipantId = typeof current?.participantId === "string" ? current.participantId : "";
  const currentPosition = participants.find((writer) => writer.id === currentParticipantId)?.position ?? 0;
  const story = value.story && typeof value.story === "object" ? value.story as Record<string, unknown> : {};
  const material = normalizeMaterial(value.material ?? value.referenceMaterial ?? value.writingMaterial);
  const rawEntries = Array.isArray(story.entries) ? story.entries as Array<Record<string, unknown>> : [];
  const entries: Entry[] = rawEntries.map((entry, index) => ({
    id: `${code}-${entry.turnIndex ?? index}`,
    turnNumber: Number(entry.turnIndex ?? index) + 1,
    writerName: String(entry.writerName ?? "작가"),
    writerKind: entry.writerType === "ai" ? "ai" : "human",
    text: String(entry.text ?? ""),
  }));
  const status = (value.status ?? "lobby") as RoomStatus;
  return {
    id: code,
    code,
    title: String(value.title ?? value.storyTitle ?? `ROOM ${code}`),
    status,
    genre: String(value.genre ?? "all"),
    writerLimit: Number(value.writerLimit ?? participants.length),
    humanWriterCount: Number(value.humanLimit ?? value.humanWriterCount ?? 1),
    aiWriterCount: Number(value.aiLimit ?? value.aiWriterCount ?? 0),
    writerLevels: roomWriterLevels,
    orderMode: value.orderMode === "random" ? "random" : "sequential",
    turnLimit: Number(value.turnLimit ?? 8),
    turnSeconds: Number(value.turnSeconds ?? 60),
    currentTurn: Number(value.currentTurnIndex ?? 0) + 1,
    currentWriterPosition: currentPosition,
    turnExpiresAt: status === "active" ? Number(value.currentDeadlineAt ?? current?.deadlineAt ?? 0) || null : null,
    storyTitle: typeof value.storyTitle === "string" ? value.storyTitle : null,
    storySetup: typeof value.storySetup === "string" ? value.storySetup : null,
    storyOpener: typeof value.storyOpener === "string" ? value.storyOpener : null,
    seedSource: typeof value.seedSource === "string" ? value.seedSource : null,
    referenceNote: typeof value.referenceNote === "string" ? value.referenceNote : material?.note ?? null,
    material,
    participants,
    entries,
    participantCount: Number(value.participantCount ?? participants.filter((writer) => writer.kind === "human").length),
    availableHumanSlots: Number(value.availableHumanSlots ?? Math.max(0, Number(value.humanLimit ?? 1) - participants.filter((writer) => writer.kind === "human").length)),
    analysisStatus: typeof value.analysisStatus === "string" ? value.analysisStatus : null,
    analysisReport: value.analysisReport as Room["analysisReport"],
    serverNow: Number(value.serverNow ?? Date.now()),
    version: Number(value.version ?? value.updatedAt ?? 0),
  };
}

function parseAnalysis(value: Room["analysisReport"]): AnalysisReport | null {
  if (!value) return null;
  let parsed: AnalysisReport;
  try {
    parsed = typeof value === "object" ? value : JSON.parse(value) as AnalysisReport;
  } catch {
    return null;
  }
  return {
    ...parsed,
    writers: (parsed.writers ?? []).map((writer) => ({
      ...writer,
      evidence: writer.evidenceSnippets ?? writer.evidence ?? [],
    })),
  };
}

function formatCountdown(deadline: number | null, now: number) {
  if (!deadline) return "--:--";
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function StudentJoin() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<StudentSession | null>(null);
  const [step, setStep] = useState<"code" | "name" | "room">("code");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [statusPersistent, setStatusPersistent] = useState(false);
  const [moderationAlert, setModerationAlert] = useState<ModerationAlert | null>(null);
  const [material, setMaterial] = useState<RoomMaterial | null>(null);
  const [materialStatus, setMaterialStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const materialObjectUrlRef = useRef<string | null>(null);
  const materialRequestKeyRef = useRef("");

  const writers = room?.participants ?? room?.writers ?? [];
  const me = session ? writers.find((writer) => writer.id === session.participantId) : null;
  const isWritingRestricted = me?.writingRestricted === true;
  const currentWriter = writers.find((writer) => writer.position === room?.currentWriterPosition);
  const isMyTurn = Boolean(
    room?.status === "active" &&
    me &&
    currentWriter &&
    me.id === currentWriter.id,
  );
  const report = useMemo(() => parseAnalysis(room?.analysisReport), [room?.analysisReport]);
  const myReport = useMemo(() => {
    if (!report || !me) return null;
    return (report.writers ?? []).find((writer) => {
      const writerName = writer.name ?? writer.writerName ?? "";
      return writer.participantId === me.id || writerName === me.name || writerName === me.displayName;
    }) ?? null;
  }, [me, report]);
  const canJoinRoom = Boolean(
    room?.status === "lobby" && (room.availableHumanSlots ?? 0) > 0,
  );
  const joinBlockReason = !room
    ? "방 정보를 다시 확인해 주세요."
    : room.status !== "lobby"
      ? room.status === "closed" || room.status === "complete"
        ? "이 방의 활동은 이미 마감되었습니다. 다른 방 코드를 입력해 주세요."
        : "이 방은 이미 활동을 시작했습니다. 다른 방 코드를 입력해 주세요."
      : (room.availableHumanSlots ?? 0) <= 0
        ? "사람 작가 자리가 모두 찼습니다. 다른 방 코드를 입력해 주세요."
        : "";

  const showStatus = useCallback((message: string, persistent = false) => {
    setStatus(message);
    setStatusPersistent(persistent);
  }, []);

  const showModerationNotice = useCallback((payload: Record<string, unknown>) => {
    const moderation = payload.moderation && typeof payload.moderation === "object"
      ? payload.moderation as ModerationResult
      : null;
    if (!moderation?.applied && !moderation?.writingRestricted) return;
    const categories = normalizeModerationCategories(moderation.categories);
    setModerationAlert({
      message: moderation.aiRewritten
        ? "위험 요소가 있어 AI가 안전한 표현으로 순화해 작품에 반영했습니다."
        : typeof payload.message === "string"
          ? payload.message
          : "문장을 제출하지 못했습니다.",
      categories,
      warningCount: moderation.warningCount,
      warningLimit: moderation.warningLimit,
      writingRestricted: moderation.writingRestricted,
    });
  }, []);

  const fetchRoom = useCallback(async (
    roomCode: string,
    activeSession?: StudentSession | null,
    quiet = false,
  ) => {
    try {
      const headers: Record<string, string> = {};
      if (activeSession?.token) {
        headers.authorization = `Bearer ${activeSession.token}`;
      }
      const params = new URLSearchParams({ code: roomCode });
      const response = await fetch(`/api/rooms?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "방을 찾지 못했습니다."));
      const nextRoom = normalizeRoom(payload);
      if (!nextRoom) throw new Error("방 정보를 확인하지 못했습니다.");
      setRoom(nextRoom);
      const nextMe = activeSession ? (nextRoom.participants ?? nextRoom.writers ?? []).find((writer) => writer.id === activeSession.participantId) : null;
      if (nextMe?.writingRestricted) {
        setDraft("");
      }
      if (!quiet) showStatus(`${nextRoom.code} 방을 찾았습니다.`);
      return nextRoom;
    } catch (error) {
      if (!quiet) showStatus(error instanceof Error ? error.message : "방을 찾지 못했습니다.", true);
      return null;
    }
  }, [showStatus]);

  const fetchMaterial = useCallback(async (nextRoom: Room, activeSession: StudentSession) => {
    const requestKey = `${nextRoom.code}:${nextRoom.material?.name ?? ""}:${nextRoom.material?.size ?? 0}:${nextRoom.version ?? 0}:${activeSession.token}`;
    if (materialRequestKeyRef.current === requestKey) return;
    materialRequestKeyRef.current = requestKey;
    if (nextRoom.seedSource !== "reference" || (!nextRoom.material?.available && !nextRoom.referenceNote)) {
      if (materialObjectUrlRef.current) URL.revokeObjectURL(materialObjectUrlRef.current);
      materialObjectUrlRef.current = null;
      setMaterial(null);
      setMaterialStatus("");
      return;
    }
    setMaterial(nextRoom.material ?? { type: "note", note: nextRoom.referenceNote ?? undefined });
    if (!nextRoom.material?.available) return;
    try {
      const params = new URLSearchParams({ code: nextRoom.code });
      const response = await fetch(`/api/rooms/material?${params.toString()}`, {
        headers: { authorization: `Bearer ${activeSession.token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(payload, "참고 자료를 불러오지 못했습니다."));
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (materialObjectUrlRef.current) URL.revokeObjectURL(materialObjectUrlRef.current);
      materialObjectUrlRef.current = objectUrl;
      setMaterial({
        ...nextRoom.material,
        mimeType: response.headers.get("content-type") ?? nextRoom.material?.mimeType,
        url: objectUrl,
      });
      setMaterialStatus("");
    } catch (error) {
      materialRequestKeyRef.current = "";
      setMaterialStatus(error instanceof Error ? error.message : "참고 자료를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => () => {
    if (materialObjectUrlRef.current) URL.revokeObjectURL(materialObjectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!room || !session || step !== "room") return;
    const timer = window.setTimeout(() => void fetchMaterial(room, session), 0);
    return () => window.clearTimeout(timer);
  }, [fetchMaterial, room?.code, room?.material?.id, room?.referenceNote, room?.version, room, session, step]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams(window.location.search);
      const initialCode = normalizeCode(search.get("room") ?? "");
      if (!initialCode) return;
      setCode(initialCode);
      let restored: StudentSession | null = null;
      try {
        const raw = window.localStorage.getItem(roomStorageKey(initialCode));
        restored = raw ? JSON.parse(raw) as StudentSession : null;
      } catch {
        restored = null;
      }
      if (restored?.participantId && restored.token) {
        setSession(restored);
        setName(restored.name);
        setStep("room");
        void fetchRoom(initialCode, restored).then((found) => {
          if (found) return;
          try {
            window.localStorage.removeItem(roomStorageKey(initialCode));
          } catch {
            // The student can still rejoin even when storage is unavailable.
          }
          setSession(null);
          setRoom(null);
          setStep("code");
          showStatus("참여 정보가 만료되었어요. 방 코드를 다시 입력해 주세요.", true);
        });
      } else {
        void fetchRoom(initialCode).then((found) => {
          if (found) setStep("name");
        });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchRoom, showStatus]);

  useEffect(() => {
    if (step !== "room" || !session || !code) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void fetchRoom(code, session, true);
    }, room?.status === "complete" || room?.status === "closed" ? 5000 : 2000);
    return () => window.clearInterval(timer);
  }, [code, fetchRoom, room?.status, session, step]);

  useEffect(() => {
    if (!isMyTurn) return;
    const timer = window.setTimeout(() => {
      showStatus("지금 내 차례예요. 이어질 문단을 써 주세요.");
      draftRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [isMyTurn, room?.currentTurn, showStatus]);

  useEffect(() => {
    if (!status || statusPersistent) return;
    const timer = window.setTimeout(() => setStatus(""), 7000);
    return () => window.clearTimeout(timer);
  }, [status, statusPersistent]);

  async function checkCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roomCode = normalizeCode(code);
    if (roomCode.length !== 6) {
      showStatus("6자리 방 코드를 확인해 주세요.", true);
      return;
    }
    setBusy(true);
    showStatus("방을 찾고 있어요.");
    const found = await fetchRoom(roomCode);
    setBusy(false);
    if (found) {
      setCode(roomCode);
      setStep("name");
      window.history.replaceState(null, "", `/join?room=${encodeURIComponent(roomCode)}`);
    }
  }

  async function joinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!canJoinRoom) {
      showStatus(joinBlockReason, true);
      return;
    }
    if (!cleanName) {
      showStatus("활동에서 사용할 작가명을 입력해 주세요.", true);
      return;
    }
    setBusy(true);
    showStatus("작가 자리를 준비하고 있어요.");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", code, name: cleanName }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(getErrorMessage(payload, "방에 참여하지 못했습니다."));
      const participant = (payload.participant ?? {}) as Record<string, unknown>;
      const nextSession: StudentSession = {
        participantId: String(participant.id ?? payload.participantId ?? ""),
        token: String(participant.token ?? payload.token ?? ""),
        name: cleanName,
      };
      if (!nextSession.participantId || !nextSession.token) throw new Error("참여 정보를 받지 못했습니다.");
      window.localStorage.setItem(roomStorageKey(code), JSON.stringify(nextSession));
      setSession(nextSession);
      setStep("room");
      await fetchRoom(code, nextSession, true);
      showStatus(`${cleanName} 작가로 참여했습니다.`);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "방에 참여하지 못했습니다.", true);
    } finally {
      setBusy(false);
    }
  }

  async function submitDraft() {
    const cleanText = draft.trim();
    if (isWritingRestricted) {
      showStatus("작성 제한 상태입니다. 교사에게 경고 초기화를 요청해 주세요.", true);
      return;
    }
    if (!session || !room || !isMyTurn || !cleanText) {
      showStatus(cleanText ? "현재 차례를 다시 확인해 주세요." : "한 문장 이상 적어 주세요.", true);
      return;
    }
    setBusy(true);
    showStatus("문단을 이야기 뒤에 붙이고 있어요.");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          action: "submit",
          code,
          text: cleanText,
        }),
      });
      const payload = await response.json();
      const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      showModerationNotice(payloadRecord);
      if (!response.ok) throw new Error(getErrorMessage(payload, "문단을 제출하지 못했습니다."));
      setDraft("");
      await fetchRoom(code, session, true);
      showStatus(typeof payloadRecord.message === "string" ? payloadRecord.message : "문단을 붙였습니다. 다음 작가에게 차례가 넘어갔어요.");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "문단을 제출하지 못했습니다.", true);
      await fetchRoom(code, session, true);
    } finally {
      setBusy(false);
    }
  }

  async function copyStory() {
    if (!room) return;
    const body = [room.storyTitle ?? room.title, room.storyOpener, ...(room.entries ?? []).filter((entry) => !entry.skipped).map((entry) => entry.text)]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(body);
      showStatus("완성 작품을 복사했습니다.");
    } catch {
      showStatus("복사하지 못했습니다. 원고를 길게 눌러 선택해 주세요.", true);
    }
  }

  function resetJoin() {
    setSession(null);
    setRoom(null);
    setName("");
    setStep("code");
    showStatus("새 방 코드를 입력해 주세요.");
  }

  const roomDone = room?.status === "complete" || room?.status === "closed";
  const progress = room ? (roomDone ? 100 : Math.min(100, (room.currentTurn / room.turnLimit) * 100)) : 0;
  const currentWriterLabel = currentWriter?.name ?? currentWriter?.displayName ?? "다음 작가";
  const activeStageLabel = roomDone
    ? "작품 완성"
    : room?.status === "active"
      ? isMyTurn
        ? "내 차례"
        : currentWriter?.kind === "ai"
          ? "AI 작성 중"
          : "기다리는 중"
      : "입장 대기";
  const meLevelLabel = me ? LEVEL_LABEL[me.level] : null;
  const restrictedNotice = isWritingRestricted ? "작성 제한 상태입니다. 교사에게 경고 초기화를 요청해 주세요." : "";
  const queueLabel = writers
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((writer) => writer.id === me?.id ? `${writer.name}(나)` : writer.name)
    .join(" → ");

  return (
    <main className="retro-shell student-shell">
      <a className="skip-link" href="#student-main">본문으로 바로 가기</a>
      <header className="retro-topbar compact">
        <Link className="retro-brand" href="/">
          <span aria-hidden="true">잇</span><strong>문장잇기</strong><small>학생용</small>
        </Link>
        <div className="student-top-actions">
          <nav className="mode-switcher" aria-label="문장잇기 모드">
            <Link href="/">한 화면</Link>
            <a href="/teacher">교사용</a>
            <Link href="/join" aria-current="page">학생용</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <div id="student-main" className="student-stage">
        <p className="retro-status student-status" data-persistent={statusPersistent || undefined} aria-live="polite" aria-atomic="true">{status}</p>
        {step === "code" && (
          <section className="retro-window student-gate" aria-labelledby="join-title">
            <div className="window-titlebar"><span>방 연결</span><i aria-hidden="true">● ● ●</i></div>
            <form onSubmit={checkCode}>
              <p className="terminal-kicker">로그인 없이 바로 참여</p>
              <h1 id="join-title">방 코드를 입력하세요.</h1>
              <p>교사 화면의 6자리 코드나 QR 링크로 바로 참여할 수 있어요.</p>
              <label className="retro-field room-code-field">
                <span>6자리 방 코드</span>
                <input
                  value={code}
                  onChange={(event) => setCode(normalizeCode(event.target.value))}
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoComplete="off"
                  inputMode="text"
                  maxLength={6}
                  autoFocus
                />
              </label>
              <button className="retro-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? "연결 중…" : "방 찾기"}</button>
            </form>
          </section>
        )}

        {step === "name" && room && (
          <section className="retro-window student-gate" aria-labelledby="name-title">
            <div className="window-titlebar"><span>작가 입장</span><i aria-hidden="true">● ● ●</i></div>
            <form onSubmit={joinRoom}>
              <span className={`status-chip status-${room.status}`}>방 {room.code}</span>
              <p className="terminal-kicker">로그인 없이 작가명만 입력</p>
              <h1 id="name-title">작가명을 정해 주세요.</h1>
              <p><strong>{room.code} 방</strong>에서 사용할 이름입니다. 계정이나 이메일은 필요하지 않아요.</p>
              {!canJoinRoom && <p className="join-blocked" role="alert">{joinBlockReason}</p>}
              {canJoinRoom ? (
                <>
                  <label className="retro-field">
                    <span>나의 작가명</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 반짝연필" maxLength={20} autoFocus disabled={!canJoinRoom} />
                  </label>
                  <div className="join-room-summary" aria-label="방 참여 상태">
                    <span>남은 사람 자리 {room.availableHumanSlots ?? room.humanWriterCount}개</span>
                    <span>AI 작가 {room.aiWriterCount}명</span>
                  </div>
                  <button className="retro-primary" type="submit" disabled={busy || !name.trim() || !canJoinRoom}>{busy ? "입장 중…" : "작가로 입장"}</button>
                  <button className="link-button" type="button" onClick={resetJoin}>다른 방 코드 입력</button>
                </>
              ) : (
                <button className="retro-primary" type="button" onClick={resetJoin}>다른 방 코드 입력</button>
              )}
            </form>
          </section>
        )}

        {step === "room" && room && session && (
          <section className={`student-room status-${room.status}`} aria-labelledby="room-title">
            <div className="student-room-head">
              <div>
                <span className={`status-chip status-${room.status}`}>{activeStageLabel}</span>
                {meLevelLabel && <span className="student-level-chip">나의 수준 · {meLevelLabel} 수준</span>}
                {typeof me?.warningCount === "number" && <span className="student-level-chip safety">나의 경고 · {me.warningCount}회</span>}
                <p className="terminal-kicker">방 {room.code} · {room.orderMode === "random" ? "랜덤 순서" : "차례대로"}</p>
                <h1 id="room-title">{room.storyTitle || room.title}</h1>
              </div>
              {roomDone ? (
                <div className="student-timer is-finished" aria-label="작품 완성">
                  <span>작품</span>
                  <strong>완성</strong>
                </div>
              ) : (
                <div className="student-timer" role="timer" aria-label={`남은 시간 ${formatCountdown(room.turnExpiresAt, now)}`}>
                  <span>{Math.min(room.currentTurn, room.turnLimit)} / {room.turnLimit} 차례</span>
                  <strong>{formatCountdown(room.turnExpiresAt, now)}</strong>
                </div>
              )}
            </div>

            <div className="student-progress" aria-label={roomDone ? "전체 작품 완성" : `전체 ${room.turnLimit}차례 중 ${room.currentTurn}번째`}>
              <span style={{ width: `${progress}%` }} />
            </div>

            <div className="student-game-hud" aria-live="polite" aria-atomic="true">
              <span>현재 {currentWriterLabel}</span>
              <span>나 {me?.name ?? session.name}</span>
              <span>{Math.round(progress)}%</span>
            </div>

            <details className="student-roster">
              <summary>작가 순서 보기</summary>
              <div className="student-writer-rail" aria-label="작가 순서">
                {writers.map((writer) => (
                  <div key={writer.id} className={`${writer.kind} ${writer.id === currentWriter?.id && room.status === "active" ? "is-current" : ""} ${writer.id === me?.id ? "is-me" : ""}`}>
                    <span>{writer.position + 1}</span>
                    <strong>{writer.name ?? writer.displayName}</strong>
                    <small>{writer.id === me?.id
                      ? `나 · ${LEVEL_LABEL[writer.level]}`
                      : writer.kind === "ai"
                        ? `AI · ${LEVEL_LABEL[writer.level]}`
                        : `학생 · ${LEVEL_LABEL[writer.level]}`}</small>
                  </div>
                ))}
              </div>
            </details>

            {moderationAlert && (
              <div className="student-safety-alert" role="alert" aria-live="assertive" aria-atomic="true">
                <strong>{moderationAlert.message}</strong>
                {moderationAlert.categories.length > 0 && <p>분류: {moderationAlert.categories.join(", ")}</p>}
                {typeof moderationAlert.warningCount === "number" && (
                  <p>누적 경고 {moderationAlert.warningCount}회{typeof moderationAlert.warningLimit === "number" ? ` / ${moderationAlert.warningLimit}회` : ""}</p>
                )}
              </div>
            )}

            {isWritingRestricted && (
              <div className="student-restricted-notice" role="alert" aria-live="polite">
                <strong>작성 제한</strong>
                <p>{restrictedNotice}</p>
              </div>
            )}

            {room.status === "lobby" && (
              <div className="retro-window waiting-window">
                <div className="window-titlebar"><span>입장 대기</span><i aria-hidden="true">● ● ●</i></div>
                <div>
                  <span className="waiting-pulse" aria-hidden="true" />
                  <p className="terminal-kicker loading-game">게임 로비 동기화 중</p>
                  <h2>교사가 활동을 시작하면 자동으로 넘어가요.</h2>
                  <p>작가 대기열 · {queueLabel}</p>
                </div>
              </div>
            )}

            {room.status === "active" && !isMyTurn && (
              <div className="retro-window waiting-window">
                <div className="window-titlebar"><span>{currentWriter?.kind === "ai" ? "AI 작가가 쓰는 중" : "다음 작가 차례"}</span><i aria-hidden="true">● ● ●</i></div>
                <div>
                  <span className="waiting-pulse" aria-hidden="true" />
                  <p className="terminal-kicker">지금 쓰는 작가</p>
                  <h2>{currentWriterLabel}의 차례입니다.</h2>
                  <p>{currentWriter?.kind === "ai" ? "AI 작가가 앞 문단을 읽고 다음 장면을 쓰고 있어요." : "내 차례가 오면 작성 화면이 자동으로 열립니다."}</p>
                </div>
              </div>
            )}

            {(room.status === "lobby" || (room.status === "active" && !isMyTurn)) && (
              <ReferenceMaterial material={material} note={room.referenceNote} status={materialStatus} />
            )}

            {room.status === "active" && isMyTurn && (
              <div className="student-writing-grid">
                <article className="retro-window student-writing-window">
                  <div className="window-titlebar"><span>내 차례</span><i aria-hidden="true">● ● ●</i></div>
                  <div className="student-writing-body">
                    <p className="my-turn-badge">지금 쓰기 · {session.name}</p>
                    {room.storySetup && <p className="story-setup">{room.storySetup}</p>}
                    <ReferenceMaterial material={material} note={room.referenceNote} status={materialStatus} compact />
                    <label htmlFor="student-draft">이어질 문단</label>
                    <textarea
                      ref={draftRef}
                      id="student-draft"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={500}
                      rows={8}
                      disabled={isWritingRestricted}
                      aria-describedby="student-draft-help"
                      placeholder="앞 문장을 읽고, 다음 장면을 한 문단으로 이어 보세요."
                    />
                    <div id="student-draft-help" className="student-draft-meta">
                      <span>{isWritingRestricted ? restrictedNotice : "내 생각을 자유롭게 써도 좋아요."}</span>
                      <span>{draft.length} / 500자</span>
                    </div>
                    <button className="retro-primary sticky-submit" type="button" disabled={busy || isWritingRestricted || !draft.trim()} onClick={() => void submitDraft()}>{busy ? "붙이는 중…" : "문단 붙이고 다음 작가에게 →"}</button>
                  </div>
                </article>
                <LiveStory room={room} />
              </div>
            )}

            {roomDone && (
              <div className="final-room-grid">
                <LiveStory room={room} final />
                <article className="retro-window report-window">
                  <div className="window-titlebar"><span>사람 작가 성장 리포트</span><i aria-hidden="true">● ● ●</i></div>
                  <div className="report-body">
                    <p className="terminal-kicker">AI 협업 분석</p>
                    <h2>글쓰기 성장 리포트</h2>
                    <p className="report-note">AI가 작품 속 문장을 바탕으로 찾은 성장 참고 자료입니다. 순위나 성적이 아닙니다.</p>
                    {report ? (
                      <>
                        {report.summary && <p className="report-summary">{report.summary}</p>}
                        {myReport ? (
                          <div className="writer-report-grid">
                            <article className="writer-report-item">
                              <div>
                                <strong>{myReport.name ?? myReport.writerName ?? session.name}</strong>
                                <span>{myReport.paragraphs ?? 0}문단</span>
                              </div>
                              <p className="writer-metric">{myReport.paragraphs ?? 0}문단을 이어 썼어요.</p>
                              {(myReport.strengths ?? []).length > 0 && <ul>{myReport.strengths?.map((strength) => <li key={strength}>{strength}</li>)}</ul>}
                              {(myReport.evidence ?? []).length > 0 && <p><b>근거</b> {myReport.evidence?.join(" / ")}</p>}
                              {(myReport.evidenceNotes ?? []).length > 0 && <p><b>관찰</b> {myReport.evidenceNotes?.join(" / ")}</p>}
                              {myReport.nextStep && <p><b>다음 연습</b> {myReport.nextStep}</p>}
                              {myReport.practicePrompt && <p><b>연습 문장</b> {myReport.practicePrompt}</p>}
                            </article>
                          </div>
                        ) : (
                          <p className="report-note">내 작가명과 연결된 개인 리포트를 기다리고 있어요.</p>
                        )}
                        {report.groupSuggestion && (
                          <details className="report-collapse">
                            <summary>다음 작품 제안</summary>
                            <p className="group-suggestion">{report.groupSuggestion}</p>
                          </details>
                        )}
                      </>
                    ) : (
                      <div className="report-loading"><span aria-hidden="true">AI</span><p>{room.analysisStatus === "failed" ? "분석 보고서를 만들지 못했습니다. 교사 화면에서 다시 요청할 수 있어요." : "완성 작품을 읽고 협업 리포트를 작성하고 있습니다."}</p></div>
                    )}
                    <button className="retro-primary" type="button" onClick={() => void copyStory()}>완성 작품 복사</button>
                  </div>
                </article>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function LiveStory({ room, final = false }: { room: Room; final?: boolean }) {
  return (
    <aside className={`retro-window live-story-window ${final ? "is-final" : ""}`} aria-labelledby={final ? "final-story-title" : "live-story-title"}>
      <div className="window-titlebar"><span>{final ? "완성 작품" : "이어 쓰는 원고"}</span><i aria-hidden="true">● ● ●</i></div>
      <div className="live-story-body">
        <p className="terminal-kicker">{room.genre.toUpperCase()} · 사람 + AI 협업</p>
        <h2 id={final ? "final-story-title" : "live-story-title"}>{room.storyTitle || room.title}</h2>
        {room.storyOpener && <p className="story-opener">{room.storyOpener}</p>}
        {(room.entries ?? []).map((entry) => (
          <article key={entry.id} className={entry.skipped ? "is-skipped" : ""}>
            <span>{String(entry.turnNumber).padStart(2, "0")} · {entry.writerName}{entry.writerKind === "ai" ? " · AI" : ""}</span>
            <p>{entry.skipped ? "이번 차례는 다음 작가에게 넘겼습니다." : entry.text}</p>
          </article>
        ))}
        {(room.entries ?? []).length === 0 && <p className="empty-manuscript">첫 문단을 기다리고 있어요…</p>}
      </div>
    </aside>
  );
}

function ReferenceMaterial({
  material,
  note,
  status,
  compact = false,
}: {
  material: RoomMaterial | null;
  note?: string | null;
  status?: string;
  compact?: boolean;
}) {
  if (!material && !note && !status) return null;
  const materialUrl = material?.url;
  return (
    <aside className={`retro-window reference-material ${compact ? "is-compact" : ""}`} aria-label="참고 자료">
      <div className="window-titlebar"><span>참고 자료</span><i aria-hidden="true">● ● ●</i></div>
      <div className="reference-material-body">
        {materialUrl && material?.type === "image" && <object data={materialUrl} type={material.mimeType || "image/png"} aria-label={material.name ?? "이야기 참고 이미지"} />}
        {materialUrl && material?.type === "pdf" && (
          <object data={materialUrl} type="application/pdf" aria-label={material.name ?? "이야기 참고 PDF"}>
            <a href={materialUrl} target="_blank" rel="noreferrer">PDF 열기</a>
          </object>
        )}
        {material?.name && <strong>{material.name}</strong>}
        {(material?.note || note) && <p>{material?.note ?? note}</p>}
        {status && <p className="material-status">{status}</p>}
      </div>
    </aside>
  );
}
