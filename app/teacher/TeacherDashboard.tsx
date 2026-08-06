"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type RoomStatus = "lobby" | "active" | "complete" | "closed";
type WriterKind = "human" | "ai";
type WriterLevel = "elementary" | "middle" | "high";
type TeacherView = "rooms" | "create";
type RoomTab = "share" | "run" | "story" | "analysis";
type SeedMode = "ai" | "manual" | "material";
type FormMode = "create" | "copy" | "edit";

type RoomWriter = {
  id: string;
  name: string;
  displayName?: string;
  kind: WriterKind;
  position: number;
  level: WriterLevel;
  warningCount?: number;
  writingRestricted?: boolean;
};

type RoomEntry = {
  id: string;
  turnNumber: number;
  writerName: string;
  text: string;
  skipped?: boolean;
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
  disclaimer?: string;
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
  writerLevels: WriterLevel[];
  orderMode: "sequential" | "random";
  turnLimit: number;
  turnSeconds: number;
  currentTurn: number;
  currentWriterPosition: number;
  turnExpiresAt: number | null;
  storyTitle?: string | null;
  storySetup?: string | null;
  storyOpener?: string | null;
  seedSource?: string | null;
  seedMode?: SeedMode | null;
  referenceNote?: string | null;
  material?: RoomMaterial | null;
  moderationSettings?: ModerationSettings;
  aiGenerationStatus?: string | null;
  analysisStatus?: string | null;
  analysisReport?: AnalysisReport | null;
  participants?: RoomWriter[];
  writers?: RoomWriter[];
  entries?: RoomEntry[];
  participantCount?: number;
  createdAt?: number;
};

type ModerationSettings = {
  nsfw: boolean;
  hate: boolean;
  threat: boolean;
  slang: boolean;
  warningLock: boolean;
  warningLimit: number;
};

const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
  nsfw: true,
  hate: true,
  threat: true,
  slang: true,
  warningLock: true,
  warningLimit: 3,
};

const MODERATION_OPTIONS: Array<{ key: keyof Omit<ModerationSettings, "warningLimit">; label: string }> = [
  { key: "nsfw", label: "NSFW" },
  { key: "hate", label: "혐오" },
  { key: "threat", label: "위협" },
  { key: "slang", label: "욕설·은어" },
  { key: "warningLock", label: "경고 3회 작성 제한" },
];

const GENRES = [
  ["all", "랜덤"],
  ["free", "자유 주제"],
  ["adventure", "모험"],
  ["fantasy", "판타지"],
  ["mystery", "미스터리"],
  ["daily", "일상"],
  ["space", "우주"],
] as const;

const PARTICIPANT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const TURN_LIMITS = [6, 8, 10, 12] as const;
const TURN_SECONDS = [45, 60, 90] as const;
const LEVEL_OPTIONS: Array<{ value: WriterLevel; label: string }> = [
  { value: "elementary", label: "초등" },
  { value: "middle", label: "중등" },
  { value: "high", label: "고등" },
];
const LEVEL_LABEL: Record<WriterLevel, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

const STATUS_LABEL: Record<RoomStatus, string> = {
  lobby: "입장 대기",
  active: "활동 중",
  complete: "완성",
  closed: "마감",
};

const MATERIAL_MAX_BYTES = 10 * 1024 * 1024;

function normalizeSeedMode(value: unknown): SeedMode {
  if (value === "manual") return value;
  if (value === "material" || value === "reference") return "material";
  return "ai";
}

function normalizeWriterLevel(value: unknown): WriterLevel {
  if (value === "elementary" || value === "middle" || value === "high") return value;
  return "elementary";
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return fallback;
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

function parseAnalysisReport(value: unknown): AnalysisReport | null {
  if (!value) return null;
  let report: AnalysisReport;
  try {
    report = typeof value === "object" ? value as AnalysisReport : JSON.parse(String(value)) as AnalysisReport;
  } catch {
    return null;
  }
  return {
    ...report,
    writers: (report.writers ?? []).map((writer) => ({
      ...writer,
      evidence: writer.evidenceSnippets ?? writer.evidence ?? [],
    })),
  };
}

function normalizeModerationSettings(value: unknown): ModerationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_MODERATION_SETTINGS;
  const settings = value as Record<string, unknown>;
  const warningLimit = Number(settings.warningLimit);
  return {
    nsfw: typeof settings.nsfw === "boolean" ? settings.nsfw : DEFAULT_MODERATION_SETTINGS.nsfw,
    hate: typeof settings.hate === "boolean" ? settings.hate : DEFAULT_MODERATION_SETTINGS.hate,
    threat: typeof settings.threat === "boolean" ? settings.threat : DEFAULT_MODERATION_SETTINGS.threat,
    slang: typeof settings.slang === "boolean" ? settings.slang : DEFAULT_MODERATION_SETTINGS.slang,
    warningLock: typeof settings.warningLock === "boolean" ? settings.warningLock : DEFAULT_MODERATION_SETTINGS.warningLock,
    warningLimit: Number.isInteger(warningLimit) && warningLimit >= 2 && warningLimit <= 5
      ? warningLimit
      : DEFAULT_MODERATION_SETTINGS.warningLimit,
  };
}

function normalizeRoom(payload: unknown): Room | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = (record.room ?? record) as Record<string, unknown>;
  const code = typeof value.roomCode === "string" ? value.roomCode : typeof value.code === "string" ? value.code : "";
  if (!code) return null;
  const roomWriterLevels = Array.isArray(value.writerLevels)
    ? value.writerLevels.map((item) => normalizeWriterLevel(item))
    : undefined;
  const rawParticipants = Array.isArray(value.participants) ? value.participants as Array<Record<string, unknown>> : [];
  const participants: RoomWriter[] = rawParticipants.map((writer, index): RoomWriter => ({
    id: String(writer.id ?? `writer-${index}`),
    name: String(writer.writerName ?? writer.name ?? `작가 ${index + 1}`),
    kind: writer.writerType === "ai" || writer.kind === "ai" ? "ai" : "human",
    position: Number(writer.orderPosition ?? writer.slotIndex ?? writer.position ?? index),
    level: normalizeWriterLevel(writer.writerLevel ?? writer.level ?? roomWriterLevels?.[Number(writer.slotIndex ?? writer.position ?? index)]),
    warningCount: typeof writer.warningCount === "number" ? writer.warningCount : undefined,
    writingRestricted: writer.writingRestricted === true,
  })).sort((a, b) => a.position - b.position);
  const current = value.currentTurn && typeof value.currentTurn === "object"
    ? value.currentTurn as Record<string, unknown>
    : null;
  const currentParticipantId = typeof current?.participantId === "string" ? current.participantId : "";
  const currentPosition = participants.find((writer) => writer.id === currentParticipantId)?.position ?? 0;
  const story = value.story && typeof value.story === "object" ? value.story as Record<string, unknown> : {};
  const material = normalizeMaterial(value.material ?? value.referenceMaterial ?? value.writingMaterial);
  const rawEntries = Array.isArray(story.entries) ? story.entries as Array<Record<string, unknown>> : [];
  const entries: RoomEntry[] = rawEntries.map((entry, index) => ({
    id: `${code}-${entry.turnIndex ?? index}`,
    turnNumber: Number(entry.turnIndex ?? index) + 1,
    writerName: String(entry.writerName ?? "작가"),
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
    writerLevels: Array.from(
      { length: Number(value.writerLimit ?? participants.length) },
      (_, index) => roomWriterLevels?.[index] ?? "elementary",
    ),
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
    seedMode: normalizeSeedMode(value.seedMode ?? value.seedSource),
    referenceNote: typeof value.referenceNote === "string" ? value.referenceNote : material?.note ?? null,
    material,
    moderationSettings: normalizeModerationSettings(value.moderationSettings),
    aiGenerationStatus: typeof value.aiGenerationStatus === "string" ? value.aiGenerationStatus : null,
    analysisStatus: typeof value.analysisStatus === "string" ? value.analysisStatus : null,
    analysisReport: parseAnalysisReport(value.analysisReport),
    participants,
    entries,
    participantCount: participants.filter((writer) => writer.kind === "human").length,
    createdAt: Number(value.createdAt ?? 0),
  };
}

function formatCountdown(deadline: number | null, now: number) {
  if (!deadline) return "--:--";
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function getActionLabel(action: "seed" | "continue" | "report") {
  if (action === "seed") return "AI 첫 문장";
  if (action === "continue") return "AI 이어쓰기";
  return "AI 분석 보고서";
}

function getDefaultRoomTab(room: Room): RoomTab {
  if (room.status === "lobby") return "share";
  if (room.status === "active") return "run";
  return "analysis";
}

function getFinalStoryText(room: Room) {
  const lines = [
    room.storyTitle ?? room.title,
    "",
    room.storySetup ? `설정: ${room.storySetup}` : "",
    room.storyOpener ? `첫 문장: ${room.storyOpener}` : "",
    "",
    ...(room.entries ?? []).map((entry) => `${entry.turnNumber}. ${entry.writerName}\n${entry.text}`),
  ].filter(Boolean);
  return lines.join("\n\n");
}

function getWriterReportText(writer: WriterReport) {
  const strengths = Array.isArray(writer.strengths) ? writer.strengths.join(", ") : "";
  const evidence = Array.isArray(writer.evidence) ? writer.evidence.join(" / ") : "";
  const evidenceNotes = Array.isArray(writer.evidenceNotes) ? writer.evidenceNotes.join(" / ") : "";
  return [
    `${writer.name ?? writer.writerName ?? "작가"} 세부 분석`,
    `기여: ${writer.contributionShare ?? 0}% · ${writer.paragraphs ?? 0}문단 · ${writer.characters ?? 0}자`,
    strengths ? `장점: ${strengths}` : "",
    evidence ? `근거 문장: ${evidence}` : "",
    evidenceNotes ? `관찰: ${evidenceNotes}` : "",
    writer.nextStep ? `다음 연습: ${writer.nextStep}` : "",
    writer.practicePrompt ? `연습 문장: ${writer.practicePrompt}` : "",
  ].filter(Boolean).join("\n");
}

function getAnalysisReportText(report: AnalysisReport | null | undefined) {
  if (!report) return "";
  const writerLines = Array.isArray(report.writers)
    ? report.writers.map((writer) => {
        return [
          `- ${writer.name ?? writer.writerName ?? "작가"}`,
          `  기여: ${writer.contributionShare ?? 0}% · ${writer.paragraphs ?? 0}문단 · ${writer.characters ?? 0}자`,
          Array.isArray(writer.strengths) && writer.strengths.length > 0 ? `  장점: ${writer.strengths.join(", ")}` : "",
          Array.isArray(writer.evidence) && writer.evidence.length > 0 ? `  근거: ${writer.evidence.join(" / ")}` : "",
          Array.isArray(writer.evidenceNotes) && writer.evidenceNotes.length > 0 ? `  관찰: ${writer.evidenceNotes.join(" / ")}` : "",
          writer.nextStep ? `  다음 연습: ${writer.nextStep}` : "",
          writer.practicePrompt ? `  연습 문장: ${writer.practicePrompt}` : "",
        ].filter(Boolean).join("\n");
      })
    : [];
  const highlights = Array.isArray(report.collaborationHighlights)
    ? report.collaborationHighlights.map((item) => `- ${String(item)}`)
    : [];
  return [
    "AI 글쓰기 분석 보고서",
    "",
    report.summary ? String(report.summary) : "",
    highlights.length > 0 ? `협업 하이라이트\n${highlights.join("\n")}` : "",
    writerLines.length > 0 ? `작가별 피드백\n${writerLines.join("\n")}` : "",
    report.groupSuggestion ? `함께 해 볼 연습\n${String(report.groupSuggestion)}` : "",
    report.disclaimer ? String(report.disclaimer) : "",
  ].filter(Boolean).join("\n\n");
}

function makeDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function TeacherDashboard({
  user,
  signOutPath,
}: {
  user: { displayName: string; email: string };
  signOutPath: string;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [writerTypes, setWriterTypes] = useState<WriterKind[]>(["human", "human", "human", "ai"]);
  const [writerLevels, setWriterLevels] = useState<WriterLevel[]>(["elementary", "elementary", "elementary", "elementary"]);
  const [moderationSettings, setModerationSettings] = useState<ModerationSettings>(DEFAULT_MODERATION_SETTINGS);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editRoomCode, setEditRoomCode] = useState<string | null>(null);
  const [seedMode, setSeedMode] = useState<SeedMode>("ai");
  const [manualTitle, setManualTitle] = useState("");
  const [manualSetup, setManualSetup] = useState("");
  const [manualOpener, setManualOpener] = useState("");
  const [referenceNote, setReferenceNote] = useState("");
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [genre, setGenre] = useState("all");
  const [turnLimit, setTurnLimit] = useState(8);
  const [turnSeconds, setTurnSeconds] = useState(60);
  const [orderMode, setOrderMode] = useState<"sequential" | "random">("sequential");
  const [teacherView, setTeacherView] = useState<TeacherView>("rooms");
  const [roomTab, setRoomTab] = useState<RoomTab | null>(null);
  const [status, setStatus] = useState("교실 서버에 연결하는 중입니다.");
  const [busy, setBusy] = useState(false);
  const [aiBusyAction, setAiBusyAction] = useState<"seed" | "continue" | "report" | null>(null);
  const [exportBusy, setExportBusy] = useState<"copy-story" | "download-story" | "copy-report" | "download-report" | "print" | null>(null);
  const [aiFailure, setAiFailure] = useState<{ roomId: string; action: "seed" | "continue" | "report"; message: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const aiBusyRef = useRef<"seed" | "continue" | "report" | null>(null);

  const writers = selectedRoom?.participants ?? selectedRoom?.writers ?? [];
  const currentWriter = writers.find(
    (writer) => writer.position === selectedRoom?.currentWriterPosition,
  );
  const humanJoined = writers.filter((writer) => writer.kind === "human").length;
  const occupiedWriterPositions = new Set(writers.map((writer) => writer.position));
  const emptyHumanPositions = selectedRoom
    ? Array.from({ length: selectedRoom.writerLimit }, (_, position) => position)
      .filter((position) => !occupiedWriterPositions.has(position))
      .slice(0, Math.max(0, selectedRoom.humanWriterCount - humanJoined))
    : [];
  const orderedWriterSlots = [
    ...writers.map((writer) => ({ type: "writer" as const, position: writer.position, writer })),
    ...emptyHumanPositions.map((position) => ({ type: "empty" as const, position })),
  ].sort((a, b) => a.position - b.position);
  const currentAiTurn = Boolean(selectedRoom?.status === "active" && currentWriter?.kind === "ai");
  const selectedRoomCanEditSettings = Boolean(selectedRoom?.status === "lobby");
  const participantControlsLocked = Boolean(formMode === "edit" && selectedRoom && humanJoined > 0);
  const selectedAiFailure = selectedRoom && aiFailure?.roomId === selectedRoom.id ? aiFailure : null;
  const statusFailureAction =
    selectedRoom?.analysisStatus === "failed"
      ? "report"
      : selectedRoom?.aiGenerationStatus === "failed" && currentAiTurn
        ? "continue"
        : selectedRoom?.aiGenerationStatus === "failed" && selectedRoom?.status === "lobby"
          ? "seed"
          : null;
  const retryAction = selectedAiFailure?.action ?? statusFailureAction;
  const canExportStory = Boolean(selectedRoom && (selectedRoom.status === "complete" || selectedRoom.status === "closed") && getFinalStoryText(selectedRoom).trim());
  const analysisText = selectedRoom ? getAnalysisReportText(selectedRoom.analysisReport) : "";
  const canExportReport = Boolean(selectedRoom?.analysisStatus === "complete" && analysisText.trim());
  const hasStoryEntries = Boolean(selectedRoom && (selectedRoom.entries ?? []).length > 0);
  const participantCount = writerTypes.length;
  const activeWriterTypes = writerTypes;
  const humanWriterCount = activeWriterTypes.filter((kind) => kind === "human").length;
  const aiWriterCount = participantCount - humanWriterCount;
  const totalWriters = participantCount;
  const hasValidManualSeed = seedMode === "ai" || (
    manualTitle.trim().length >= 2
    && manualSetup.trim().length >= 10
    && manualOpener.trim().length >= 10
  );
  const hasReferenceMaterial = seedMode !== "material" || Boolean(materialFile || (formMode === "edit" && selectedRoom?.material));
  const canSubmitRoomForm = totalWriters >= 2
    && totalWriters <= 10
    && humanWriterCount >= 1
    && turnLimit >= totalWriters
    && hasValidManualSeed
    && hasReferenceMaterial;
  const effectiveTeacherView = rooms.length === 0 ? "create" : teacherView;
  const defaultRoomTab: RoomTab = selectedRoom?.status === "lobby" ? "share" : selectedRoom?.status === "active" ? "run" : "analysis";
  const activeRoomTab = roomTab ?? defaultRoomTab;
  const formWriterLevels = activeWriterTypes.map((_, index) => writerLevels[index] ?? "elementary");
  const levelSummary = LEVEL_OPTIONS
    .map((option) => `${option.label} ${formWriterLevels.filter((level) => level === option.value).length}`)
    .join(" · ");

  const formTitle = formMode === "edit"
    ? "대기방 설정 편집"
    : formMode === "copy"
      ? "기존 방 설정 복사"
      : "새 이야기 방 만들기";
  const formSubmitLabel = formMode === "edit"
    ? "설정 저장"
    : seedMode === "ai"
      ? "방 개설 + AI 첫 문장"
      : "방 개설";

  const loadRooms = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/teacher/rooms", { cache: "no-store" });
      const payload = (await response.json()) as { rooms?: unknown[]; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(payload, "방 목록을 불러오지 못했습니다."));
      const nextRooms = Array.isArray(payload.rooms)
        ? payload.rooms.map((room) => normalizeRoom(room)).filter((room): room is Room => Boolean(room))
        : [];
      setRooms(nextRooms);
      setSelectedRoomId((current) => current ?? nextRooms[0]?.id ?? null);
      if (nextRooms.length === 0) setTeacherView("create");
      if (!quiet) setStatus(`${nextRooms.length}개의 방을 불러왔습니다.`);
    } catch (error) {
      if (!quiet) setStatus(error instanceof Error ? error.message : "방 목록을 불러오지 못했습니다.");
    }
  }, []);

  const loadRoom = useCallback(async (roomId: string, quiet = false) => {
    try {
      const response = await fetch(`/api/teacher/rooms?code=${encodeURIComponent(roomId)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "방 상태를 불러오지 못했습니다."));
      const room = normalizeRoom(payload);
      if (room) {
        setSelectedRoom(room);
      }
      if (!quiet) setStatus("방 상태를 새로 확인했습니다.");
      return room;
    } catch (error) {
      if (!quiet) setStatus(error instanceof Error ? error.message : "방 상태를 불러오지 못했습니다.");
      return null;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRooms(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoomId) {
      return;
    }
    const timer = window.setTimeout(() => void loadRoom(selectedRoomId), 0);
    return () => window.clearTimeout(timer);
  }, [loadRoom, selectedRoomId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void loadRooms(true);
      if (selectedRoomId) void loadRoom(selectedRoomId, true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadRoom, loadRooms, selectedRoomId]);

  useEffect(() => {
    if (!selectedRoom) return;
    const url = `${window.location.origin}/join?room=${encodeURIComponent(selectedRoom.code)}`;
    const joinTimer = window.setTimeout(() => setJoinUrl(url), 0);
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 280,
      margin: 2,
      color: { dark: "#101426", light: "#f4f7ff" },
      errorCorrectionLevel: "M",
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(joinTimer);
    };
  }, [selectedRoom]);

  useEffect(() => {
    if (busy || aiBusyAction) return;

    const nextAiRoom = rooms.find((room) => {
      if (room.status !== "active" || room.aiGenerationStatus === "failed" || aiFailure?.roomId === room.id) return false;
      const roomWriters = room.participants ?? room.writers ?? [];
      return roomWriters.find((writer) => writer.position === room.currentWriterPosition)?.kind === "ai";
    });
    if (nextAiRoom) {
      void runAi("continue", nextAiRoom.id, true);
      return;
    }

    const nextReportRoom = rooms.find((room) =>
      (room.status === "complete" || room.status === "closed") &&
      (room.entries?.length ?? 0) > 0 &&
      room.analysisStatus !== "complete" &&
      room.analysisStatus !== "failed" &&
      aiFailure?.roomId !== room.id,
    );
    if (nextReportRoom) void runAi("report", nextReportRoom.id, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiBusyAction, aiFailure?.roomId, busy, rooms]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 5000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function runAi(action: "seed" | "continue" | "report", roomId: string, quiet = false): Promise<boolean> {
    if (aiBusyRef.current) return false;
    aiBusyRef.current = action;
    setAiBusyAction(action);
    if (!quiet) setStatus(action === "report" ? "AI 협업 리포트를 작성하고 있습니다." : "SOLAR 작가가 문장을 준비하고 있습니다.");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, roomCode: roomId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "AI 요청을 처리하지 못했습니다."));
      if (selectedRoomId === roomId) await loadRoom(roomId, true);
      await loadRooms(true);
      setAiFailure(null);
      if (!quiet) setStatus("AI 작업이 완료되었습니다.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 요청을 처리하지 못했습니다.";
      setAiFailure({ roomId, action, message });
      if (!quiet) setStatus(message);
      return false;
    } finally {
      aiBusyRef.current = null;
      setAiBusyAction(null);
    }
  }

  async function copyText(kind: "story" | "report") {
    if (!selectedRoom) return;
    const text = kind === "story" ? getFinalStoryText(selectedRoom) : analysisText;
    const label = kind === "story" ? "완성 작품" : "분석 보고서";
    setExportBusy(kind === "story" ? "copy-story" : "copy-report");
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label}을 복사했습니다.`);
    } catch {
      setStatus(`${label}을 복사하지 못했습니다.`);
    } finally {
      setExportBusy(null);
    }
  }

  function downloadText(kind: "story" | "report") {
    if (!selectedRoom) return;
    const text = kind === "story" ? getFinalStoryText(selectedRoom) : analysisText;
    const label = kind === "story" ? "완성 작품" : "분석 보고서";
    setExportBusy(kind === "story" ? "download-story" : "download-report");
    try {
      makeDownload(`${selectedRoom.code}-${kind === "story" ? "story" : "report"}.txt`, text);
      setStatus(`${label} 파일을 내려받았습니다.`);
    } catch {
      setStatus(`${label} 파일을 만들지 못했습니다.`);
    } finally {
      setExportBusy(null);
    }
  }

  function printExports() {
    if (!selectedRoom) return;
    setExportBusy("print");
    const story = getFinalStoryText(selectedRoom);
    const report = analysisText;
    const printable = document.createElement("iframe");
    printable.title = `${selectedRoom.code} 작품과 분석 보고서 인쇄`;
    printable.style.position = "fixed";
    printable.style.width = "0";
    printable.style.height = "0";
    printable.style.border = "0";
    printable.style.right = "0";
    printable.style.bottom = "0";

    try {
      document.body.appendChild(printable);
      const printDocument = printable.contentDocument;
      if (!printDocument) throw new Error("print document unavailable");
      printDocument.open();
      printDocument.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(selectedRoom.code)} 출력</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#101426}pre{font:16px/1.8 serif;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><pre>${escapeHtml([story, report].filter(Boolean).join("\n\n---\n\n"))}</pre></body></html>`);
      printDocument.close();

      window.setTimeout(() => {
        try {
          const printWindow = printable.contentWindow;
          if (!printWindow) throw new Error("print window unavailable");
          printWindow.focus();
          printWindow.print();
          setStatus("작품과 분석 보고서 인쇄를 열었습니다.");
        } catch {
          setStatus("인쇄를 열지 못했습니다. 다운로드한 파일을 인쇄해 주세요.");
        } finally {
          setExportBusy(null);
          window.setTimeout(() => printable.remove(), 500);
        }
      }, 100);
    } catch {
      printable.remove();
      setStatus("인쇄를 준비하지 못했습니다. 다운로드한 파일을 인쇄해 주세요.");
      setExportBusy(null);
    }
  }

  function setParticipantCount(nextCount: number) {
    if (participantControlsLocked) {
      setStatus("학생이 입장한 뒤에는 참여자 숫자와 좌석 구성을 바꿀 수 없습니다.");
      return;
    }
    setWriterTypes((current) => {
      const next = current.slice(0, nextCount);
      while (next.length < nextCount) next.push(next.length === 0 ? "human" : "ai");
      if (!next.includes("human")) next[0] = "human";
      return next;
    });
    setWriterLevels((current) => {
      const next = current.slice(0, nextCount);
      while (next.length < nextCount) next.push("elementary");
      return next;
    });
    setTurnLimit((current) => Math.max(current, nextCount <= 6 ? 6 : nextCount <= 8 ? 8 : nextCount <= 10 ? 10 : 12));
  }

  function setWriterKind(index: number, kind: WriterKind) {
    if (participantControlsLocked) {
      setStatus("학생이 입장한 뒤에는 사람/AI 좌석 구성을 바꿀 수 없습니다.");
      return;
    }
    const wouldRemoveLastHuman =
      kind === "ai" &&
      activeWriterTypes[index] === "human" &&
      activeWriterTypes.filter((writerKind) => writerKind === "human").length === 1;
    if (wouldRemoveLastHuman) {
      setStatus("학생 참여를 위해 사람 작가가 최소 1명 필요합니다.");
      return;
    }
    setWriterTypes((current) => {
      const next = [...current];
      next[index] = kind;
      return next;
    });
  }

  function setWriterLevel(index: number, level: WriterLevel) {
    if (participantControlsLocked) {
      setStatus("학생이 입장한 뒤에는 참가자 수준을 바꿀 수 없습니다.");
      return;
    }
    setWriterLevels((current) => {
      const next = [...current];
      next[index] = level;
      return next;
    });
  }

  function setModerationOption(key: keyof Omit<ModerationSettings, "warningLimit">, checked: boolean) {
    setModerationSettings((current) => ({ ...current, [key]: checked }));
  }

  function resetRoomForm() {
    setFormMode("create");
    setEditRoomCode(null);
    setSeedMode("ai");
    setManualTitle("");
    setManualSetup("");
    setManualOpener("");
    setReferenceNote("");
    setMaterialFile(null);
    setGenre("all");
    setTurnLimit(8);
    setTurnSeconds(60);
    setOrderMode("sequential");
    setWriterTypes(["human", "human", "human", "ai"]);
    setWriterLevels(["elementary", "elementary", "elementary", "elementary"]);
    setModerationSettings(DEFAULT_MODERATION_SETTINGS);
    setTeacherView("create");
  }

  function prefillRoomForm(room: Room, mode: Exclude<FormMode, "create">) {
    const roomWriters = room.participants ?? room.writers ?? [];
    const seatKinds = Array.from({ length: room.writerLimit }, (_, index): WriterKind => {
      const writer = roomWriters.find((item) => item.position === index);
      if (writer) return writer.kind;
      return index < room.humanWriterCount ? "human" : "ai";
    });
    setFormMode(mode);
    setEditRoomCode(mode === "edit" ? room.code : null);
    setSeedMode(room.seedMode ?? (room.seedSource === "ai" ? "ai" : "manual"));
    setManualTitle(room.storyTitle ?? room.title ?? "");
    setManualSetup(room.storySetup ?? "");
    setManualOpener(room.storyOpener ?? "");
    setReferenceNote(room.referenceNote ?? room.material?.note ?? "");
    setMaterialFile(null);
    setGenre(room.genre);
    setTurnLimit(room.turnLimit);
    setTurnSeconds(room.turnSeconds);
    setOrderMode(room.orderMode);
    setWriterTypes(seatKinds);
    setWriterLevels(Array.from({ length: room.writerLimit }, (_, index) => room.writerLevels[index] ?? "elementary"));
    setModerationSettings(room.moderationSettings ?? DEFAULT_MODERATION_SETTINGS);
    setTeacherView("create");
    setStatus(mode === "copy" ? "설정을 복사했습니다. 자료 파일은 다시 첨부해 주세요." : "대기방 설정을 편집합니다.");
  }

  function onMaterialFileChange(file: File | null) {
    if (!file) {
      setMaterialFile(null);
      return;
    }
    const supported = ["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type);
    if (!supported) {
      setStatus("이미지 또는 PDF 파일만 첨부할 수 있습니다.");
      return;
    }
    if (file.size > MATERIAL_MAX_BYTES) {
      setStatus("자료 파일은 10MiB 이하만 첨부할 수 있습니다.");
      return;
    }
    setMaterialFile(file);
    setSeedMode("material");
  }

  async function uploadMaterial(roomCode: string) {
    if (!materialFile && !referenceNote.trim()) return;
    const formData = new FormData();
    formData.append("roomCode", roomCode);
    formData.append("referenceNote", referenceNote.trim());
    if (materialFile) formData.append("file", materialFile);
    const response = await fetch("/api/teacher/rooms/material", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(getErrorMessage(payload, "참고 자료를 저장하지 못했습니다."));
  }

  async function removeMaterial(roomCode: string) {
    setBusy(true);
    setStatus("참고 자료를 삭제하고 있습니다.");
    try {
      const response = await fetch("/api/teacher/rooms/material", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(payload, "참고 자료를 삭제하지 못했습니다."));
      setMaterialFile(null);
      setReferenceNote("");
      await loadRoom(roomCode, true);
      setStatus("참고 자료를 삭제했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "참고 자료를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRoomForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitRoomForm) {
      setStatus("작가 수는 2명에서 10명, 사람 작가는 최소 1명, 총 차례는 전체 작가 수 이상이어야 합니다.");
      return;
    }
    setBusy(true);
    setStatus(formMode === "edit" ? "방 설정을 저장하고 있습니다." : "새 방을 만들고 있습니다.");
    const payloadBody = {
      humanLimit: humanWriterCount,
      aiLimit: aiWriterCount,
      writerLimit: totalWriters,
      writerTypes: activeWriterTypes,
      writerLevels: formWriterLevels,
      moderationSettings,
      genre,
      turnLimit,
      turnSeconds,
      orderMode,
      seedMode,
      storyTitle: manualTitle.trim(),
      storySetup: manualSetup.trim(),
      storyOpener: manualOpener.trim(),
      referenceNote: referenceNote.trim(),
    };
    try {
      const isEdit = formMode === "edit" && editRoomCode;
      const response = await fetch("/api/teacher/rooms", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isEdit ? { ...payloadBody, action: "update_settings", roomCode: editRoomCode } : payloadBody),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, isEdit ? "방 설정을 저장하지 못했습니다." : "방을 만들지 못했습니다."));
      const room = normalizeRoom(payload);
      if (!room) throw new Error(isEdit ? "저장한 방 정보를 확인하지 못했습니다." : "만든 방 정보를 확인하지 못했습니다.");
      try {
        await uploadMaterial(room.code);
      } catch (materialError) {
        setStatus(materialError instanceof Error ? `${materialError.message} 방은 유지됩니다.` : "참고 자료를 저장하지 못했습니다. 방은 유지됩니다.");
      }
      setSelectedRoomId(room.id);
      setSelectedRoom(room);
      setTeacherView("rooms");
      setRoomTab("share");
      await loadRooms(true);
      if (seedMode === "ai") {
        setStatus(`${isEdit ? "방 설정을 저장했습니다" : `ROOM ${room.code}를 만들었습니다`}. AI가 첫 문장을 준비합니다.`);
        const aiSucceeded = await runAi("seed", room.id, true);
        await loadRoom(room.id, true);
        setStatus(aiSucceeded ? "AI 첫 문장을 준비했습니다." : "방은 저장했지만 AI 첫 문장을 만들지 못했습니다. 다시 시도해 주세요.");
      } else {
        setStatus(isEdit ? "방 설정을 저장했습니다." : `ROOM ${room.code}를 만들었습니다.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "방 설정을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function controlRoom(action: "start" | "close") {
    if (!selectedRoom) return;
    setBusy(true);
    setStatus(action === "start" ? "활동을 시작합니다." : "활동을 마감합니다.");
    try {
      const response = await fetch("/api/teacher/rooms", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: selectedRoom.code, action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "방 상태를 바꾸지 못했습니다."));
      const room = normalizeRoom(payload);
      if (room) {
        setSelectedRoom(room);
        setRoomTab(getDefaultRoomTab(room));
      }
      await loadRooms(true);
      setStatus(action === "start" ? "활동이 시작되었습니다." : "활동을 마감했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "방 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resetWarnings(participantId: string) {
    if (!selectedRoom) return;
    setBusy(true);
    setStatus("경고 기록을 초기화하고 있습니다.");
    try {
      const response = await fetch("/api/teacher/rooms", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode: selectedRoom.code, action: "reset_warnings", participantId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(getErrorMessage(payload, "경고를 초기화하지 못했습니다."));
      const room = normalizeRoom(payload);
      if (room) setSelectedRoom(room);
      await loadRooms(true);
      setStatus("경고를 초기화했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "경고를 초기화하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setStatus("학생 참여 링크를 복사했습니다.");
    } catch {
      setStatus("링크를 복사하지 못했습니다. 주소를 직접 선택해 주세요.");
    }
  }

  const canStart = Boolean(
    selectedRoom &&
    selectedRoom.status === "lobby" &&
    humanJoined >= selectedRoom.humanWriterCount,
  );
  const roomPrimaryTitle = selectedRoom?.status === "lobby"
    ? "학생 입장을 받은 뒤 활동을 시작하세요."
    : selectedRoom?.status === "active"
      ? currentAiTurn
        ? "현재 차례는 SOLAR AI입니다."
        : `${currentWriter?.name ?? "학생 작가"} 차례입니다.`
      : selectedRoom?.analysisStatus === "complete"
        ? "완성 작품과 분석 보고서를 확인하세요."
        : "AI 분석 보고서를 준비하세요.";
  const roomPrimaryBody = selectedRoom?.status === "lobby"
    ? `사람 작가 ${humanJoined}/${selectedRoom.humanWriterCount}명 입장`
    : selectedRoom?.status === "active"
      ? `${selectedRoom.currentTurn}/${selectedRoom.turnLimit}차례 · 남은 시간 ${formatCountdown(selectedRoom.turnExpiresAt, now)}`
      : canExportReport
        ? "학생별 작성 분량과 글쓰기 피드백을 내보낼 수 있습니다."
        : "완성 원고가 있으면 분석 보고서를 생성할 수 있습니다.";

  return (
    <main className="retro-shell teacher-shell">
      <a className="skip-link" href="#teacher-main">본문으로 바로 가기</a>
      <header className="retro-topbar">
        <Link className="retro-brand" href="/">
          <span aria-hidden="true">잇</span>
          <strong>문장잇기</strong>
          <small>교사용</small>
        </Link>
        <nav className="mode-switcher" aria-label="문장잇기 모드">
          <Link href="/">한 화면</Link>
          <Link href="/teacher" aria-current="page">교사용</Link>
          <Link href="/join">학생용</Link>
        </nav>
        <div className="teacher-account">
          <span className="teacher-account-name">{user.displayName}</span>
          <span className="teacher-account-actions">
            <ThemeToggle />
            <a href={signOutPath}>로그아웃</a>
          </span>
        </div>
      </header>

      <section className="teacher-focus-bar" aria-label="교사용 작업 선택">
        <button
          type="button"
          className={effectiveTeacherView === "rooms" ? "is-selected" : ""}
          onClick={() => setTeacherView("rooms")}
          disabled={rooms.length === 0}
        >
          운영 중인 방 <strong>{rooms.length}</strong>
        </button>
        <button
          type="button"
          className={effectiveTeacherView === "create" ? "is-selected" : ""}
          onClick={resetRoomForm}
        >
          새 방 만들기
        </button>
      </section>

      <div id="teacher-main" className="teacher-console">
        {effectiveTeacherView === "create" && (
        <section className="retro-window room-create-window" aria-labelledby="create-title">
          <div className="window-titlebar">
            <span>NEW_ROOM.EXE</span>
            <i aria-hidden="true">● ● ●</i>
          </div>
          <form onSubmit={submitRoomForm} className="room-create-form">
            <div>
              <p className="terminal-kicker">{formMode === "edit" ? `EDIT ${editRoomCode}` : "ROOM SETUP / SOLAR PRO 4"}</p>
              <h1 id="create-title">{formTitle}</h1>
              <p>{formMode === "copy" ? "기존 설정을 가져왔습니다. 자료 파일은 새 방에 다시 첨부하세요." : "첫 문장 방식과 작가 좌석만 먼저 정하면 바로 시작할 수 있습니다."}</p>
            </div>

            <fieldset className="seed-mode-panel">
              <legend>처음 시작하는 문장</legend>
              <div className="seed-mode-options" role="group" aria-label="첫 문장 방식">
                {[
                  ["ai", "AI 추천"],
                  ["manual", "직접 입력"],
                  ["material", "자료 보고 쓰기"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={seedMode === value ? "is-selected" : ""}
                    onClick={() => setSeedMode(value as SeedMode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {seedMode === "ai" ? (
                <p className="seed-helper">장르와 수준에 맞춰 AI가 제목, 상황, 첫 문장을 추천합니다.</p>
              ) : (
                <div className="seed-manual-grid">
                  <label className="retro-field">
                    <span>작품 제목</span>
                    <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="예: 비밀 급식실 지도" maxLength={40} />
                  </label>
                  <label className="retro-field">
                    <span>상황 설정</span>
                    <textarea value={manualSetup} onChange={(event) => setManualSetup(event.target.value)} placeholder="학생들이 참고할 배경이나 조건을 짧게 적어 주세요." maxLength={220} rows={3} />
                  </label>
                  <label className="retro-field seed-opener-field">
                    <span>첫 문장</span>
                    <textarea value={manualOpener} onChange={(event) => setManualOpener(event.target.value)} placeholder="이 문장 뒤에 학생과 AI가 이어 씁니다." maxLength={160} rows={3} />
                  </label>
                </div>
              )}
              {(seedMode === "material" || referenceNote || materialFile || (formMode === "edit" && selectedRoom?.material)) && (
                <div className="material-panel">
                  <label className="retro-field">
                    <span>참고 메모</span>
                    <textarea value={referenceNote} onChange={(event) => setReferenceNote(event.target.value)} placeholder="이미지나 PDF를 보며 쓰게 할 관찰 포인트를 적어 주세요." maxLength={320} rows={3} />
                  </label>
                  <label className="file-drop-control">
                    <span>이미지/PDF 첨부</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(event) => onMaterialFileChange(event.target.files?.[0] ?? null)}
                    />
                    <strong>{materialFile ? materialFile.name : selectedRoom?.material?.name ?? "10MiB 이하 파일 선택"}</strong>
                  </label>
                  <div className="material-actions">
                    {materialFile && <button type="button" onClick={() => setMaterialFile(null)}>선택 취소</button>}
                    {formMode === "edit" && selectedRoom?.material && (
                      <button type="button" disabled={busy} onClick={() => void removeMaterial(selectedRoom.code)}>기존 자료 제거</button>
                    )}
                  </div>
                </div>
              )}
            </fieldset>

            <label className="retro-field">
              <span>참여자 숫자</span>
              <select value={participantCount} onChange={(event) => setParticipantCount(Number(event.target.value))} disabled={participantControlsLocked}>
                {PARTICIPANT_COUNTS.map((value) => <option key={value} value={value}>{value}명</option>)}
              </select>
            </label>

            <div className="writer-seat-list" aria-label="참여자별 작가 유형">
              {activeWriterTypes.map((kind, index) => (
                <div className="writer-seat-row" key={`writer-seat-${index}`}>
                  <span>#{index + 1}</span>
                  <strong>{kind === "human" ? "학생" : "AI"}</strong>
                  <div className="segmented-mini" role="group" aria-label={`${index + 1}번 참여자 유형`}>
                    <button
                      type="button"
                      className={kind === "human" ? "is-selected" : ""}
                      onClick={() => setWriterKind(index, "human")}
                      disabled={participantControlsLocked}
                    >
                      인간
                    </button>
                    <button
                      type="button"
                      className={kind === "ai" ? "is-selected" : ""}
                      onClick={() => setWriterKind(index, "ai")}
                      disabled={participantControlsLocked}
                    >
                      AI
                    </button>
                  </div>
                  <label className="writer-level-select">
                    <span>{kind === "human" ? "학생 수준" : "AI 글 수준"}</span>
                    <select
                      value={formWriterLevels[index]}
                      onChange={(event) => setWriterLevel(index, event.target.value as WriterLevel)}
                      aria-label={`${index + 1}번 ${kind === "human" ? "학생 수준" : "AI 글 수준"}`}
                      disabled={participantControlsLocked}
                    >
                      {LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>

            <div className="writer-level-summary" aria-label={`참가자 수준 요약 ${levelSummary}`}>{levelSummary}</div>
            <p className="writer-seat-note">사람 좌석이 여러 수준이면 학생은 입장 순서대로 비어 있는 사람 좌석에 배정됩니다.</p>

            <fieldset className="moderation-settings" aria-describedby="moderation-helper">
              <legend>학생 문장 안전 필터</legend>
              <div className="moderation-switch-grid">
                {MODERATION_OPTIONS.map((option) => (
                  <label className="moderation-switch" key={option.key}>
                    <input
                      type="checkbox"
                      checked={moderationSettings[option.key]}
                      onChange={(event) => setModerationOption(option.key, event.target.checked)}
                    />
                    <span aria-hidden="true" />
                    <strong>{option.label}</strong>
                  </label>
                ))}
              </div>
              <p id="moderation-helper">AI 순화 1차 안전장치·의미가 달라질 수 있음</p>
            </fieldset>

            <p className={`writer-total ${!canSubmitRoomForm ? "is-error" : ""}`}>
              TOTAL · {totalWriters}명 · HUMAN {humanWriterCount} · AI {aiWriterCount}
              {turnLimit < totalWriters ? " · 총 차례를 늘려 주세요" : ""}
              {seedMode !== "ai" && !hasValidManualSeed ? " · 제목·상황·첫 문장을 충분히 입력해 주세요" : ""}
              {seedMode === "material" && !hasReferenceMaterial ? " · 이미지 또는 PDF가 필요합니다" : ""}
            </p>

            <details className="setup-detail">
              <summary>장르와 진행 규칙</summary>
              <label className="retro-field">
                <span>장르</span>
                <select value={genre} onChange={(event) => setGenre(event.target.value)}>
                  {GENRES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>

              <div className="compact-field-grid">
                <label className="retro-field">
                  <span>총 차례</span>
                  <select value={turnLimit} onChange={(event) => setTurnLimit(Number(event.target.value))}>
                    {TURN_LIMITS.map((value) => <option key={value} value={value} disabled={value < totalWriters}>{value}차례</option>)}
                  </select>
                </label>
                <label className="retro-field">
                  <span>차례당 시간</span>
                  <select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))}>
                    {TURN_SECONDS.map((value) => <option key={value} value={value}>{value}초</option>)}
                  </select>
                </label>
              </div>

              <fieldset className="order-mode">
                <legend>집필 순서</legend>
                <label>
                  <input type="radio" name="order" checked={orderMode === "sequential"} onChange={() => setOrderMode("sequential")} />
                  <span><strong>차례대로</strong><small>등록된 순서로 반복</small></span>
                </label>
                <label>
                  <input type="radio" name="order" checked={orderMode === "random"} onChange={() => setOrderMode("random")} />
                  <span><strong>랜덤 셔플</strong><small>시작할 때 순서 확정</small></span>
                </label>
              </fieldset>
            </details>

            {formMode !== "create" && (
              <button className="link-button" type="button" onClick={resetRoomForm}>
                새 방 만들기로 돌아가기
              </button>
            )}
            <button className="retro-primary" type="submit" disabled={busy || !canSubmitRoomForm}>
              {busy ? "처리 중…" : formSubmitLabel}
            </button>
          </form>
        </section>
        )}

        {effectiveTeacherView === "rooms" && (
        <section className="room-board" aria-labelledby="rooms-title">
          <div className="room-board-heading">
            <div>
              <p className="terminal-kicker">MULTI ROOM CONTROL</p>
              <h2 id="rooms-title">동시 운영 방</h2>
            </div>
            <span className="online-chip"><i aria-hidden="true" /> DB ONLINE · {rooms.length}</span>
          </div>

          {rooms.length === 0 ? (
            <div className="empty-room-state">
              <span aria-hidden="true">[ + ]</span>
              <strong>아직 만든 방이 없습니다.</strong>
              <p>왼쪽 설정을 마치면 첫 방이 여기에 나타납니다.</p>
            </div>
          ) : (
            <div className="room-card-grid">
              {rooms.map((room) => {
                const roomWriters = room.participants ?? room.writers ?? [];
                const joinedHumans = roomWriters.filter((writer) => writer.kind === "human").length;
                const roomCurrentWriter = roomWriters.find((writer) => writer.position === room.currentWriterPosition);
                return (
                  <button
                    type="button"
                    key={room.id}
                    className={`room-card status-${room.status} ${room.id === selectedRoomId ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedRoomId(room.id);
                      setRoomTab(getDefaultRoomTab(room));
                    }}
                  >
                    <span className="room-card-bar">ROOM {room.code}</span>
                    <div className="room-card-top">
                      <span className={`status-chip status-${room.status}`}>{STATUS_LABEL[room.status]}</span>
                      <small>{room.orderMode === "random" ? "SHUFFLE" : "SEQUENCE"}</small>
                    </div>
                    <strong>{room.title}</strong>
                    <div className="room-card-metrics">
                      <span><b>{joinedHumans}</b> / {room.humanWriterCount} HUMAN</span>
                      <span><b>{room.aiWriterCount}</b> AI</span>
                    </div>
                    {room.status === "active" && (
                      <p>{roomCurrentWriter?.name ?? roomCurrentWriter?.displayName ?? "다음 작가"} · {room.currentTurn}/{room.turnLimit}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selectedRoom && (
            <article className="retro-window room-detail">
              <div className="window-titlebar">
                <span>ROOM_{selectedRoom.code}.LIVE</span>
                <i aria-hidden="true">● ● ●</i>
              </div>
              <div className="room-live-panel">
                  <div className="room-live-head">
                    <div>
                      <p className="terminal-kicker">{selectedRoom.genre.toUpperCase()} · {selectedRoom.seedSource === "ai" ? "AI SEED" : "SAFE SEED"}</p>
                      <h3>{selectedRoom.storyTitle || selectedRoom.title}</h3>
                    </div>
                    <div className="room-head-actions">
                      <span className={`status-chip status-${selectedRoom.status}`}>{STATUS_LABEL[selectedRoom.status]}</span>
                      <button type="button" onClick={() => prefillRoomForm(selectedRoom, "copy")}>설정 복사</button>
                      <button type="button" disabled={!selectedRoomCanEditSettings} onClick={() => prefillRoomForm(selectedRoom, "edit")}>설정 편집</button>
                    </div>
                  </div>

                  {(selectedRoom.referenceNote || selectedRoom.material) && (
                    <section className="reference-summary" aria-label="학생 참고 자료">
                      <strong>참고 자료</strong>
                      {selectedRoom.material?.name && <span>{selectedRoom.material.name}</span>}
                      {selectedRoom.referenceNote && <p>{selectedRoom.referenceNote}</p>}
                    </section>
                  )}

                  <section className="teacher-next-action" aria-live="polite">
                    <div>
                      <p className="terminal-kicker">NEXT ACTION</p>
                      <strong>{roomPrimaryTitle}</strong>
                      <span>{roomPrimaryBody}</span>
                    </div>
                    {selectedRoom.status === "lobby" && (
                      <button className="retro-primary" type="button" disabled={busy || !canStart} onClick={() => void controlRoom("start")}>
                        {canStart ? "활동 시작" : `${selectedRoom.humanWriterCount - humanJoined}명 대기`}
                      </button>
                    )}
                    {selectedRoom.status === "active" && currentAiTurn && (
                      <button className="retro-primary" type="button" disabled={Boolean(aiBusyAction)} onClick={() => void runAi("continue", selectedRoom.id)}>
                        {aiBusyAction === "continue" ? "AI 이어쓰기 중…" : "AI 이어쓰기"}
                      </button>
                    )}
                    {(selectedRoom.status === "complete" || selectedRoom.status === "closed") && selectedRoom.analysisStatus !== "complete" && hasStoryEntries && (
                      <button className="retro-primary" type="button" disabled={Boolean(aiBusyAction)} onClick={() => void runAi("report", selectedRoom.id)}>
                        {aiBusyAction === "report" ? "분석 중…" : "AI 분석 만들기"}
                      </button>
                    )}
                  </section>

                  <div className="teacher-room-tabs" role="tablist" aria-label="방 상세 보기">
                    {[
                      ["share", "공유"],
                      ["run", "진행"],
                      ["story", "원고"],
                      ["analysis", "분석"],
                    ].map(([value, label]) => (
                      <button
                        type="button"
                        role="tab"
                        key={value}
                        aria-selected={activeRoomTab === value}
                        className={activeRoomTab === value ? "is-selected" : ""}
                        onClick={() => setRoomTab(value as RoomTab)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeRoomTab === "share" && (
                    <section className="room-tab-panel room-share-panel" role="tabpanel">
                      <p className="room-code-label">JOIN CODE</p>
                      <strong className="room-code-display">{selectedRoom.code}</strong>
                      {qrDataUrl && <Image unoptimized src={qrDataUrl} alt={`방 코드 ${selectedRoom.code} 참여 QR 코드`} width={190} height={190} />}
                      <div className="share-actions">
                        <button type="button" onClick={copyJoinLink}>참여 링크 복사</button>
                        <a href={joinUrl} target="_blank" rel="noreferrer">학생 화면 열기</a>
                      </div>
                    </section>
                  )}

                  {activeRoomTab === "run" && (
                    <section className="room-tab-panel" role="tabpanel">
                      {selectedRoom.storyOpener ? <blockquote>“{selectedRoom.storyOpener}”</blockquote> : <div className="ai-loading-copy"><span aria-hidden="true" />AI가 첫 문장을 준비하고 있습니다…</div>}
                      <div className="writer-slot-grid" aria-label="작가 순서">
                        {orderedWriterSlots.map((slot) => slot.type === "writer" ? (
                          <div
                            key={slot.writer.id}
                            className={`writer-slot ${slot.writer.kind} ${slot.position === selectedRoom.currentWriterPosition && selectedRoom.status === "active" ? "is-current" : ""}`}
                          >
                            <span>{slot.position + 1}</span>
                            <strong>{slot.writer.name ?? slot.writer.displayName}</strong>
                            <small>{slot.writer.kind === "ai" ? `AI · ${LEVEL_LABEL[slot.writer.level]}` : `학생 · ${LEVEL_LABEL[slot.writer.level]}`}</small>
                            {slot.writer.kind === "human" && (
                              <div className="writer-safety-row" aria-label={`${slot.writer.name} 안전 상태`}>
                                <em>경고 {slot.writer.warningCount ?? 0}회</em>
                                {slot.writer.writingRestricted && <em className="is-restricted">작성 제한</em>}
                                <button
                                  type="button"
                                  disabled={busy || (slot.writer.warningCount ?? 0) === 0}
                                  onClick={() => void resetWarnings(slot.writer.id)}
                                  aria-label={`${slot.writer.name} 경고 초기화`}
                                >
                                  경고 초기화
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="writer-slot empty" key={`empty-${slot.position}`}>
                            <span>{slot.position + 1}</span><strong>입장 대기</strong><small>HUMAN · {LEVEL_LABEL[selectedRoom.writerLevels[slot.position] ?? "elementary"]}</small>
                          </div>
                        ))}
                      </div>
                      <div className="room-control-row">
                        {(selectedRoom.status === "active" || selectedRoom.status === "lobby") && (
                          <button className="retro-danger" type="button" disabled={busy} onClick={() => void controlRoom("close")}>활동 마감</button>
                        )}
                        {!selectedRoom.storyOpener && <button type="button" onClick={() => void runAi("seed", selectedRoom.id)}>AI 첫 문장 다시 요청</button>}
                      </div>
                    </section>
                  )}

                  {activeRoomTab === "story" && (
                    <section className="room-tab-panel" role="tabpanel">
                      {hasStoryEntries ? (
                        <div className="live-story-mini">
                          {(selectedRoom.entries ?? []).map((entry) => (
                            <p key={entry.id}><span>{entry.writerName}</span>{entry.skipped ? "이번 차례를 쉬었습니다." : entry.text}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="empty-manuscript">아직 완성된 문단이 없습니다.</p>
                      )}
                    </section>
                  )}

                  {activeRoomTab === "analysis" && (
                    <section className="room-tab-panel" role="tabpanel">
                    <div className="room-control-row">
                      <button type="button" disabled={!canExportStory || exportBusy === "copy-story"} onClick={() => void copyText("story")}>
                        {exportBusy === "copy-story" ? "복사 중…" : "완성 작품 복사"}
                      </button>
                      <button type="button" disabled={!canExportStory || exportBusy === "download-story"} onClick={() => downloadText("story")}>
                        {exportBusy === "download-story" ? "저장 중…" : "완성 작품 다운로드"}
                      </button>
                      <button type="button" disabled={!canExportReport || exportBusy === "copy-report"} onClick={() => void copyText("report")}>
                        {exportBusy === "copy-report" ? "복사 중…" : "분석 보고서 복사"}
                      </button>
                      <button type="button" disabled={!canExportReport || exportBusy === "download-report"} onClick={() => downloadText("report")}>
                        {exportBusy === "download-report" ? "저장 중…" : "분석 보고서 다운로드"}
                      </button>
                      <button type="button" disabled={(!canExportStory && !canExportReport) || exportBusy === "print"} onClick={printExports}>
                        {exportBusy === "print" ? "인쇄 준비 중…" : "인쇄"}
                      </button>
                    </div>
                    {selectedRoom.analysisStatus === "complete" && analysisText ? (
                      <>
                        <pre className="analysis-preview">{analysisText}</pre>
                        <div className="teacher-writer-report-grid">
                          {(selectedRoom.analysisReport?.writers ?? []).map((writer, index) => {
                            const writerName = writer.name ?? writer.writerName ?? `작가 ${index + 1}`;
                            return (
                              <article key={`${writerName}-${index}`} className="teacher-writer-report-card">
                                <div>
                                  <strong>{writerName}</strong>
                                  <span>{writer.contributionShare ?? 0}% · {writer.paragraphs ?? 0}문단 · {writer.characters ?? 0}자</span>
                                </div>
                                {(writer.strengths ?? []).length > 0 && <ul>{writer.strengths?.map((strength) => <li key={strength}>{strength}</li>)}</ul>}
                                {(writer.evidence ?? []).length > 0 && <p><b>근거</b> {writer.evidence?.join(" / ")}</p>}
                                {(writer.evidenceNotes ?? []).length > 0 && <p><b>관찰</b> {writer.evidenceNotes?.join(" / ")}</p>}
                                {writer.nextStep && <p><b>다음 연습</b> {writer.nextStep}</p>}
                                {writer.practicePrompt && <p><b>연습 문장</b> {writer.practicePrompt}</p>}
                                <div className="writer-report-actions">
                                  <button type="button" onClick={() => void navigator.clipboard.writeText(getWriterReportText(writer)).then(() => setStatus(`${writerName} 리포트를 복사했습니다.`)).catch(() => setStatus("리포트를 복사하지 못했습니다."))}>개별 복사</button>
                                  <button type="button" onClick={() => makeDownload(`${selectedRoom.code}-${writerName}-report.txt`, getWriterReportText(writer))}>개별 다운로드</button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="empty-manuscript">완성 후 AI 분석 보고서가 여기에 표시됩니다.</p>
                    )}
                    </section>
                  )}

                    {(selectedAiFailure || statusFailureAction) && retryAction && (
                      <div className="retro-window teacher-alert" role="alert">
                        <div className="window-titlebar">
                          <span>AI_ERROR.LOG</span>
                          <i aria-hidden="true">● ● ●</i>
                        </div>
                        <strong>{getActionLabel(retryAction)} 작업을 완료하지 못했습니다.</strong>
                        <p>{selectedAiFailure?.message ?? "AI 작업이 실패 상태입니다. 다시 시도해 주세요."}</p>
                        <button type="button" disabled={Boolean(aiBusyAction)} onClick={() => void runAi(retryAction, selectedRoom.id)}>
                          {aiBusyAction === retryAction ? "다시 시도 중…" : `${getActionLabel(retryAction)} 다시 시도`}
                        </button>
                      </div>
                    )}
              </div>
            </article>
          )}
        </section>
        )}
      </div>

      <p className="retro-status" aria-live="polite">{status}</p>
    </main>
  );
}
