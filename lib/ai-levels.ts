import type { WriterLevel } from "@/lib/live-story";

type LevelCounts = Record<WriterLevel, number>;

export type WriterLevelProfile = {
  name: string;
  level: WriterLevel;
};

export const WRITER_LEVEL_LABELS: Record<WriterLevel, string> = {
  elementary: "초등",
  middle: "중등",
  high: "고등",
};

const LEVEL_ORDER: WriterLevel[] = ["elementary", "middle", "high"];

const LEVEL_GUIDANCE: Record<WriterLevel, string> = {
  elementary: "초등 수준: 쉬운 어휘, 짧은 문장, 눈에 보이는 행동과 감각을 분명히 쓴다.",
  middle: "중등 수준: 감정 변화, 장면 전환, 가벼운 복선을 넣되 흐름을 어렵게 만들지 않는다.",
  high: "고등 수준: 문체, 서사 구조, 주제 의식을 살리되 난해함이나 과잉 현학은 피한다.",
};

export function describeWriterLevel(level: WriterLevel) {
  return `${WRITER_LEVEL_LABELS[level]} - ${LEVEL_GUIDANCE[level]}`;
}

export function buildSeedLevelGuidance(levels: WriterLevel[]) {
  const normalized = normalizeLevels(levels);
  const counts = countLevels(normalized);
  const mixed = new Set(normalized).size > 1;
  const lowest = getLowestLevel(normalized);
  const next = getNextLevel(lowest);
  const distribution = LEVEL_ORDER.filter((level) => counts[level] > 0)
    .map((level) => `${WRITER_LEVEL_LABELS[level]} ${counts[level]}명`)
    .join(", ");

  return [
    `학급 수준 분포: ${distribution || "초등 1명"}.`,
    mixed
      ? `혼합 학급이므로 ${WRITER_LEVEL_LABELS[lowest]} 학생도 바로 이해할 수 있는 문장으로 시작하고, ${WRITER_LEVEL_LABELS[next]} 수준의 서사 여지를 한 가지 남긴다.`
      : `${WRITER_LEVEL_LABELS[lowest]} 수준에 맞추어 시작하되 다음 작가가 넓힐 수 있는 여백을 남긴다.`,
    "수준별 기준:",
    ...LEVEL_ORDER.map((level) => `- ${describeWriterLevel(level)}`),
  ].join("\n");
}

export function buildContinuationLevelGuidance(level: WriterLevel) {
  return [
    `현재 AI 작가 수준: ${WRITER_LEVEL_LABELS[level]}.`,
    describeWriterLevel(level),
    "공통 조건: 120-300자 한국어 한 문단, 앞 단서 보존, 개인정보·과격한 폭력·비난·순위 표현 금지.",
  ].join("\n");
}

export function buildReportLevelGuidance(profiles: WriterLevelProfile[]) {
  const normalizedProfiles = profiles.map((profile) => ({ ...profile, level: normalizeLevel(profile.level) }));
  return [
    "사람 작가별 설정 수준:",
    ...normalizedProfiles.map((profile) => `- ${profile.name}: ${WRITER_LEVEL_LABELS[profile.level]} 수준`),
    "피드백 기준: 각 사람 작가를 같은 설정 수준의 성장 기준으로만 설명한다.",
    "초등은 구체적 행동·감각·문장 연결, 중등은 감정·장면 전환·복선, 고등은 문체·구조·주제 의식 중심으로 본다.",
    "순위, 점수, 우열 비교, 수준 간 비교 평가는 절대 하지 않는다.",
  ].join("\n");
}

function normalizeLevels(levels: WriterLevel[]) {
  return levels.length > 0 ? levels.map(normalizeLevel) : ["elementary" as const];
}

function normalizeLevel(level: WriterLevel): WriterLevel {
  return LEVEL_ORDER.includes(level) ? level : "elementary";
}

function countLevels(levels: WriterLevel[]): LevelCounts {
  return levels.reduce<LevelCounts>(
    (counts, level) => {
      counts[level] += 1;
      return counts;
    },
    { elementary: 0, middle: 0, high: 0 },
  );
}

function getLowestLevel(levels: WriterLevel[]) {
  return LEVEL_ORDER.find((level) => levels.includes(level)) ?? "elementary";
}

function getNextLevel(level: WriterLevel) {
  const index = LEVEL_ORDER.indexOf(level);
  return LEVEL_ORDER[Math.min(index + 1, LEVEL_ORDER.length - 1)];
}
