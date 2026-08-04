"use client";

import Link from "next/link";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type Phase = "setup" | "playing" | "complete";
type GenreId = "all" | "adventure" | "fantasy" | "mystery" | "daily" | "space";

type StoryEntry = {
  id: string;
  player: string;
  text: string;
};

type StorySeed = {
  genre: Exclude<GenreId, "all">;
  label: string;
  title: string;
  setup: string;
  opener: string;
};

type SavedGame = {
  version: 1;
  phase: Exclude<Phase, "setup">;
  participantsInput: string;
  genre: GenreId;
  turnLimit: number;
  turnSeconds: number;
  players: string[];
  turnIndex: number;
  turnNumber: number;
  seedIndex: number;
  eventIndex: number;
  entries: StoryEntry[];
  draft: string;
  secondsLeft: number;
};

const STORAGE_KEY = "munjang-itgi:v1";
const MAX_DRAFT_LENGTH = 500;

const GENRES: Array<{ id: GenreId; label: string; symbol: string }> = [
  { id: "all", label: "랜덤", symbol: "✦" },
  { id: "adventure", label: "모험", symbol: "↗" },
  { id: "fantasy", label: "판타지", symbol: "☾" },
  { id: "mystery", label: "미스터리", symbol: "?" },
  { id: "daily", label: "일상", symbol: "○" },
  { id: "space", label: "우주", symbol: "∞" },
];

const STORY_SEEDS: StorySeed[] = [
  {
    genre: "adventure",
    label: "사라진 지도",
    title: "마지막 버스가 멈춘 곳",
    setup:
      "동네의 마지막 버스가 지도에도 없는 정류장에 멈췄다. 문이 열리자 기사님은 한 사람만 내릴 수 있다고 말했다.",
    opener: "버스 창밖에는 분명 어제까지 없던 바다가 출렁이고 있었다.",
  },
  {
    genre: "adventure",
    label: "비밀 원정대",
    title: "운동장 아래의 두 번째 학교",
    setup:
      "공을 찾으러 간 세 친구가 운동장 배수구 아래에서 오래된 교문을 발견한다. 종이 울리기 전까지 돌아오지 못하면 문은 닫힌다.",
    opener: "녹슨 교문 너머에서 우리 반 담임 선생님의 목소리가 들렸다.",
  },
  {
    genre: "fantasy",
    label: "마법의 대가",
    title: "소원을 고쳐 쓰는 문구점",
    setup:
      "밤 열두 시에만 문을 여는 문구점에서는 연필로 쓴 소원이 현실이 된다. 단, 지우개를 쓰면 누군가의 기억도 함께 사라진다.",
    opener: "나는 첫 번째 소원을 쓰기도 전에 내 이름부터 지웠다.",
  },
  {
    genre: "fantasy",
    label: "말하는 그림자",
    title: "그림자가 먼저 집에 갔다",
    setup:
      "해 질 무렵, 주인공의 그림자가 발끝에서 떨어져 혼자 골목을 달려간다. 그림자는 자정 전에 꼭 보여줄 것이 있다고 한다.",
    opener: "내 그림자는 모퉁이를 돌기 전, 뒤를 돌아보며 조용히 손가락을 입에 댔다.",
  },
  {
    genre: "mystery",
    label: "사라진 7분",
    title: "모두가 기억하지 못하는 방송",
    setup:
      "점심시간 방송이 끝난 뒤 학교 시계가 정확히 7분 느려졌다. 그런데 방송 내용을 기억하는 사람은 주인공 한 명뿐이다.",
    opener: "스피커에서는 분명 내일의 날짜와 내 이름이 흘러나왔다.",
  },
  {
    genre: "mystery",
    label: "익명의 쪽지",
    title: "도서관 404번 책",
    setup:
      "대출 목록에 없는 404번 책 속에서 매일 새로운 쪽지가 발견된다. 마지막 쪽지는 오늘 밤 도서관에 오지 말라고 경고한다.",
    opener: "책을 덮는 순간, 반납함 안쪽에서 세 번의 노크 소리가 났다.",
  },
  {
    genre: "daily",
    label: "작은 용기",
    title: "비 오는 날의 분실물 센터",
    setup:
      "주인공은 버려진 우산마다 주인의 기억 한 장면이 남아 있다는 걸 알게 된다. 오늘 들어온 빨간 우산에는 가장 친한 친구가 보인다.",
    opener: "우산을 펼치자 빗방울 대신 어제의 웃음소리가 쏟아졌다.",
  },
  {
    genre: "daily",
    label: "뜻밖의 손님",
    title: "한 사람만 오는 세탁소",
    setup:
      "매일 같은 시각, 같은 옷을 맡기는 손님이 오늘은 빈 옷걸이만 두고 갔다. 주머니에는 내일 날짜가 적힌 영수증이 있다.",
    opener: "세탁기 안에서 휴대전화 진동 소리가 아주 작게 울렸다.",
  },
  {
    genre: "space",
    label: "첫 교신",
    title: "달에서 온 전학생",
    setup:
      "새 전학생은 달의 뒷면에 있는 학교에서 왔다고 말한다. 지구에 머물 수 있는 시간은 오늘 하루뿐이다.",
    opener: "전학생이 가방을 열자 교실의 중력이 반쯤 사라졌다.",
  },
  {
    genre: "space",
    label: "고장 난 시간",
    title: "3초 뒤의 목소리",
    setup:
      "우주 정거장의 통신기는 언제나 3초 뒤에 할 말을 먼저 들려준다. 어느 날, 아무도 말하지 않은 구조 요청이 도착한다.",
    opener: "수신기에서 들린 목소리는 틀림없이 미래의 나였다.",
  },
];

const EVENT_CARDS = [
  { tag: "반전", text: "가장 믿었던 사람이 정반대의 부탁을 합니다." },
  { tag: "소리", text: "멀리서 들려오는 낯선 소리를 장면에 넣어 보세요." },
  { tag: "선택", text: "두 가지 선택지 중 하나를 지금 결정하게 하세요." },
  { tag: "기억", text: "지금과 정반대였던 과거의 기억을 짧게 끼워 넣으세요." },
  { tag: "물건", text: "평범한 물건 하나가 결정적인 단서가 됩니다." },
  { tag: "시간", text: "남은 시간이 갑자기 절반으로 줄어듭니다." },
  { tag: "등장", text: "기다리지 않았던 인물이 문을 열고 들어옵니다." },
  { tag: "비밀", text: "주인공만 알고 있던 사실을 한 가지 밝히세요." },
  { tag: "오해", text: "누군가의 말이 완전히 다르게 전달됩니다." },
  { tag: "약속", text: "지키기 어려운 약속을 하나 만들게 하세요." },
];

const DEFAULT_NAMES = "민지\n서준\n지우";

function parsePlayers(value: string) {
  const names = value
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 8);

  if (names.length === 0) return ["첫 번째 작가", "두 번째 작가"];
  if (names.length === 1) return [names[0], "두 번째 작가"];
  return names;
}

function pickSeedIndex(genre: GenreId) {
  const candidates = STORY_SEEDS.map((seed, index) => ({ seed, index })).filter(
    ({ seed }) => genre === "all" || seed.genre === genre,
  );
  return candidates[Math.floor(Math.random() * candidates.length)]?.index ?? 0;
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function makeEntryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLocalGame() {
  try {
    return { available: true, value: window.localStorage.getItem(STORAGE_KEY) };
  } catch {
    return { available: false, value: null };
  }
}

function writeLocalGame(value: SavedGame) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeLocalGame() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [participantsInput, setParticipantsInput] = useState(DEFAULT_NAMES);
  const [genre, setGenre] = useState<GenreId>("all");
  const [turnLimit, setTurnLimit] = useState(8);
  const [turnSeconds, setTurnSeconds] = useState(60);
  const [players, setPlayers] = useState<string[]>(parsePlayers(DEFAULT_NAMES));
  const [turnIndex, setTurnIndex] = useState(0);
  const [turnNumber, setTurnNumber] = useState(1);
  const [seedIndex, setSeedIndex] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showLocalSetup, setShowLocalSetup] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const resetOpenerRef = useRef<HTMLElement | null>(null);
  const resetDialogRef = useRef<HTMLDivElement>(null);
  const continueWritingRef = useRef<HTMLButtonElement>(null);
  const storageFailureNotifiedRef = useRef(false);

  const seed = STORY_SEEDS[seedIndex] ?? STORY_SEEDS[0];
  const eventCard = EVENT_CARDS[eventIndex] ?? EVENT_CARDS[0];
  const currentPlayer = players[turnIndex] ?? "다음 작가";
  const genreInfo = GENRES.find((item) => item.id === genre) ?? GENRES[0];
  const seedGenreInfo = GENRES.find((item) => item.id === seed.genre) ?? GENRES[0];
  const setupPlayers = useMemo(() => parsePlayers(participantsInput), [participantsInput]);
  const minimumTurnLimit = setupPlayers.length > 6 ? 8 : 6;
  const progress = phase === "complete" ? 100 : (turnNumber / turnLimit) * 100;

  const storyText = useMemo(() => {
    const paragraphs = [seed.opener, ...entries.map((entry) => entry.text)];
    return `${seed.title}\n\n${paragraphs.join("\n\n")}`;
  }, [entries, seed]);

  const markStorageUnavailable = useCallback(() => {
    if (storageFailureNotifiedRef.current) return;
    storageFailureNotifiedRef.current = true;
    window.setTimeout(() => {
      setStorageAvailable(false);
      setStatus("자동 저장을 사용할 수 없지만, 이야기는 계속 만들 수 있어요.");
    }, 0);
  }, []);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const stored = readLocalGame();
        if (!stored.available) markStorageUnavailable();
        const raw = stored.value;
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<SavedGame>;
        if (
          saved.version !== 1 ||
          (saved.phase !== "playing" && saved.phase !== "complete") ||
          !Array.isArray(saved.players) ||
          saved.players.length < 2 ||
          !Array.isArray(saved.entries)
        ) {
          if (!removeLocalGame()) markStorageUnavailable();
          return;
        }

        setPhase(saved.phase);
        setParticipantsInput(saved.participantsInput ?? DEFAULT_NAMES);
        setGenre(saved.genre ?? "all");
        setTurnLimit(saved.turnLimit ?? 8);
        setTurnSeconds(saved.turnSeconds ?? 60);
        setPlayers(saved.players.slice(0, 8));
        setTurnIndex(saved.turnIndex ?? 0);
        setTurnNumber(saved.turnNumber ?? 1);
        setSeedIndex(saved.seedIndex ?? 0);
        setEventIndex(saved.eventIndex ?? 0);
        setEntries(saved.entries);
        setDraft(saved.draft ?? "");
        setSecondsLeft(saved.secondsLeft ?? saved.turnSeconds ?? 60);
        setStatus("저장해 둔 원고를 다시 열었어요.");
      } catch {
        if (!removeLocalGame()) markStorageUnavailable();
      } finally {
        setStorageReady(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [markStorageUnavailable]);

  useEffect(() => {
    if (!storageReady) return;
    if (phase === "setup") {
      if (!removeLocalGame()) markStorageUnavailable();
      return;
    }

    const saved: SavedGame = {
      version: 1,
      phase,
      participantsInput,
      genre,
      turnLimit,
      turnSeconds,
      players,
      turnIndex,
      turnNumber,
      seedIndex,
      eventIndex,
      entries,
      draft,
      secondsLeft,
    };
    if (!writeLocalGame(saved)) markStorageUnavailable();
  }, [
    draft,
    entries,
    eventIndex,
    genre,
    markStorageUnavailable,
    participantsInput,
    phase,
    players,
    secondsLeft,
    seedIndex,
    storageReady,
    turnIndex,
    turnLimit,
    turnNumber,
    turnSeconds,
  ]);

  useEffect(() => {
    if (phase !== "playing" || !timerRunning) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          setTimerRunning(false);
          setStatus("시간이 끝났어요. 괜찮아요, 문장은 계속 쓸 수 있어요.");
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, timerRunning]);

  const closeResetDialog = useCallback(() => {
    setShowResetConfirm(false);
    window.setTimeout(() => resetOpenerRef.current?.focus(), 0);
  }, []);

  const openResetDialog = useCallback(() => {
    resetOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowResetConfirm(true);
  }, []);

  useEffect(() => {
    if (!showResetConfirm) return;
    const focusTimer = window.setTimeout(() => continueWritingRef.current?.focus(), 0);

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeResetDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        resetDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleDialogKeyDown);
    };
  }, [closeResetDialog, showResetConfirm]);

  function scrollToTop() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function startGame() {
    const nextPlayers = parsePlayers(participantsInput);
    const safeTurnLimit = nextPlayers.length > turnLimit ? (nextPlayers.length > 6 ? 8 : 6) : turnLimit;
    if (safeTurnLimit !== turnLimit) setTurnLimit(safeTurnLimit);
    setPlayers(nextPlayers);
    setTurnIndex(0);
    setTurnNumber(1);
    setSeedIndex(pickSeedIndex(genre));
    setEventIndex(Math.floor(Math.random() * EVENT_CARDS.length));
    setEntries([]);
    setDraft("");
    setSecondsLeft(turnSeconds);
    setTimerRunning(true);
    setPhase("playing");
    setStatus(`${nextPlayers[0]} 작가의 첫 차례예요.`);
    window.setTimeout(() => {
      scrollToTop();
      draftRef.current?.focus({ preventScroll: true });
    }, 80);
  }

  function revealLocalSetup() {
    setShowLocalSetup(true);
    setStatus("PC 1대로 진행할 작가와 규칙을 정해 주세요.");
    window.setTimeout(() => {
      document.getElementById("setup-card")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      document.getElementById("participants")?.focus({ preventScroll: true });
    }, 60);
  }

  function updateParticipants(value: string) {
    const nextPlayers = parsePlayers(value);
    const nextMinimum = nextPlayers.length > 6 ? 8 : 6;
    setParticipantsInput(value);
    if (turnLimit < nextMinimum) {
      setTurnLimit(nextMinimum);
      setStatus(`${nextPlayers.length}명 모두 한 번씩 쓸 수 있도록 ${nextMinimum}차례로 맞췄어요.`);
    }
  }

  function moveToNextTurn(text?: string) {
    const cleanText = text?.trim();
    if (cleanText) {
      setEntries((current) => [
        ...current,
        { id: makeEntryId(), player: currentPlayer, text: cleanText },
      ]);
    }

    if (turnNumber >= turnLimit) {
      setDraft("");
      setTimerRunning(false);
      setPhase("complete");
      setStatus("마지막 문단까지 이어졌어요. 우리 이야기가 완성됐습니다!");
      window.setTimeout(scrollToTop, 60);
      return;
    }

    const nextIndex = (turnIndex + 1) % players.length;
    setTurnIndex(nextIndex);
    setTurnNumber((current) => current + 1);
    setEventIndex((current) => (current + 1) % EVENT_CARDS.length);
    setDraft("");
    setSecondsLeft(turnSeconds);
    setTimerRunning(true);
    setStatus(`${players[nextIndex]} 작가에게 원고를 넘겼어요.`);
    window.setTimeout(() => draftRef.current?.focus({ preventScroll: true }), 80);
  }

  function submitDraft() {
    if (!draft.trim()) {
      setStatus("한 문장만 적어도 좋아요. 떠오른 장면을 짧게 써 보세요.");
      draftRef.current?.focus();
      return;
    }
    moveToNextTurn(draft);
  }

  function handleDraftKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submitDraft();
    }
  }

  function drawAnotherEvent() {
    setEventIndex((current) => (current + 1) % EVENT_CARDS.length);
    setStatus("새로운 이야기 장치를 뽑았어요. 현재 차례는 그대로예요.");
  }

  function toggleTimer() {
    if (secondsLeft === 0) setSecondsLeft(turnSeconds);
    setTimerRunning((current) => !current);
    setStatus(timerRunning ? "타이머를 잠깐 멈췄어요." : "타이머를 시작했어요.");
  }

  async function copyStory() {
    try {
      await navigator.clipboard.writeText(storyText);
      setStatus("완성된 원고를 클립보드에 복사했어요.");
    } catch {
      setStatus("복사하지 못했어요. 원고를 길게 눌러 직접 선택해 주세요.");
    }
  }

  async function shareStory() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `문장잇기 · ${seed.title}`,
          text: storyText,
        });
        setStatus("이야기 공유 창을 열었어요.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyStory();
  }

  function returnToSetup() {
    setTimerRunning(false);
    setPhase("setup");
    setEntries([]);
    setDraft("");
    setTurnNumber(1);
    setTurnIndex(0);
    setShowResetConfirm(false);
    setShowLocalSetup(false);
    setStatus("새 이야기를 준비할 수 있어요.");
    window.setTimeout(scrollToTop, 60);
  }

  return (
    <main className={`site-shell phase-${phase}`}>
      <a className="skip-link" href="#main-content">
        본문으로 바로 가기
      </a>

      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => (phase === "playing" ? openResetDialog() : returnToSetup())}
          aria-label="문장잇기 처음 화면"
        >
          <span className="brand-mark" aria-hidden="true">잇</span>
          <span>문장잇기</span>
        </button>
        <div className="topbar-actions">
          <ThemeToggle />
          <div className={`privacy-note ${storageAvailable ? "" : "is-warning"}`}>
            <span className="status-dot" aria-hidden="true" />
            <span className="privacy-prefix">로그인 없이 · </span>
            <span>{storageAvailable ? "이 기기에만 저장" : "자동 저장 꺼짐"}</span>
          </div>
        </div>
      </header>

      <div id="main-content">
        {phase === "setup" && (
          <section className={`setup-view ${showLocalSetup ? "has-local-setup" : "is-choice-only"}`} aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow">RETRO RELAY STUDIO</p>
              <h1 id="hero-title">
                교실에서 바로 여는
                <span>릴레이 소설방</span>
              </h1>
              <p className="hero-description">
                선생님은 방을 열고, 학생은 코드로 들어옵니다.
                사람과 AI 작가를 섞어 한 문단씩 이어 쓰세요.
              </p>
              <div className="hero-mode-links" aria-label="시작 방식 선택">
                <Link href="/teacher">교사용 방 만들기 <span aria-hidden="true">↗</span></Link>
                <Link href="/join">학생용 참여하기 <span aria-hidden="true">→</span></Link>
              </div>
              <button className="mobile-jump" type="button" onClick={revealLocalSetup}>
                PC 1대로 시작 <span aria-hidden="true">↓</span>
              </button>
            </div>

            {showLocalSetup && (
              <form
                id="setup-card"
                className="setup-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  startGame();
                }}
              >
                <div className="card-heading">
                  <div>
                    <p>LOCAL_SETUP.EXE</p>
                    <h2>오늘의 작가들을 모아 볼까요?</h2>
                  </div>
                  <span className="setup-badge">약 10초</span>
                </div>

                <label className="field-label" htmlFor="participants">
                  <span>작가 이름</span>
                  <small>줄바꿈 또는 쉼표로 구분 · 최대 8명</small>
                </label>
                <textarea
                  id="participants"
                  className="name-input"
                  value={participantsInput}
                  onChange={(event) => updateParticipants(event.target.value)}
                  placeholder={"민지\n서준\n지우"}
                  rows={3}
                  maxLength={120}
                />
                <p className="field-hint">비워 두면 익명 작가 2명으로 바로 시작합니다.</p>

                <fieldset className="genre-fieldset">
                  <legend>오늘의 분위기</legend>
                  <div className="genre-grid">
                    {GENRES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`genre-button ${genre === item.id ? "is-selected" : ""}`}
                        aria-pressed={genre === item.id}
                        onClick={() => setGenre(item.id)}
                      >
                        <span aria-hidden="true">{item.symbol}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <details className="setup-detail" aria-label="고급 게임 규칙">
                  <summary>게임 규칙 설정</summary>
                  <div className="rule-grid">
                    <label>
                      <span>총 차례</span>
                      <select value={turnLimit} onChange={(event) => setTurnLimit(Number(event.target.value))}>
                        <option value={6} disabled={setupPlayers.length > 6}>6차례 · 짧게</option>
                        <option value={8}>8차례 · 알맞게</option>
                        <option value={10}>10차례 · 길게</option>
                      </select>
                    </label>
                    <label>
                      <span>한 차례 시간</span>
                      <select value={turnSeconds} onChange={(event) => setTurnSeconds(Number(event.target.value))}>
                        <option value={45}>45초 · 빠르게</option>
                        <option value={60}>60초 · 알맞게</option>
                        <option value={90}>90초 · 여유롭게</option>
                      </select>
                    </label>
                  </div>
                  <p className="field-hint" role="status">
                    {setupPlayers.length}명의 작가가 모두 한 번 이상 쓸 수 있도록 최소 {minimumTurnLimit}차례가 필요해요.
                  </p>
                </details>

                <button className="primary-button start-button" type="submit">
                  <span>첫 문장 뽑기</span>
                  <span aria-hidden="true">→</span>
                </button>
                <p className="privacy-copy">이름과 원고는 서버로 전송하지 않습니다.</p>
              </form>
            )}
          </section>
        )}

        {phase === "playing" && (
          <section className="play-view" aria-labelledby="game-title">
            <div className="game-topline">
              <div>
                <p className="eyebrow">{genreInfo.symbol} {seed.label}</p>
                <h1 id="game-title">{seed.title}</h1>
              </div>
              <div className="game-actions">
                <span>{storageAvailable ? "자동 저장 중" : "이 화면에만 유지"}</span>
                <button type="button" className="text-button" onClick={openResetDialog}>
                  처음부터
                </button>
              </div>
            </div>

            <div className="progress-block" aria-label={`전체 ${turnLimit}차례 중 ${turnNumber}번째`}>
              <div className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
              <strong>{turnNumber} / {turnLimit} 차례</strong>
            </div>

            <div className="writer-rail" aria-label="작가 순서">
              {players.map((player, index) => (
                <div key={`${player}-${index}`} className={`writer-chip ${index === turnIndex ? "is-active" : ""}`}>
                  <span>{index + 1}</span>
                  <strong>{player}</strong>
                  {index === turnIndex && <small>지금 차례</small>}
                </div>
              ))}
            </div>

            <div className="game-grid">
              <div className="writing-column">
                <article className="brief-card">
                  <div className="brief-label">이야기의 시작</div>
                  <p>{seed.setup}</p>
                  <blockquote>“{seed.opener}”</blockquote>
                </article>

                <article className="mission-card">
                  <div className="mission-card-top">
                    <div>
                      <span>이번 문단의 장치</span>
                      <strong>{eventCard.tag}</strong>
                    </div>
                    <button type="button" onClick={drawAnotherEvent} aria-label="다른 이야기 장치 뽑기">
                      다시 뽑기
                    </button>
                  </div>
                  <p>{eventCard.text}</p>
                  <small>장치를 그대로 쓰지 않아도 괜찮아요. 힌트처럼 활용해 보세요.</small>
                </article>

                <div className="writing-card">
                  <div className="writing-card-head">
                    <div>
                      <span>NOW WRITING</span>
                      <h2>{currentPlayer} 작가의 문단</h2>
                    </div>
                    <div className={`timer ${secondsLeft === 0 ? "is-finished" : ""}`} role="timer" aria-label={`남은 시간 ${formatTime(secondsLeft)}`}>
                      <strong>{formatTime(secondsLeft)}</strong>
                      <button type="button" onClick={toggleTimer}>
                        {timerRunning ? "잠깐 멈춤" : secondsLeft === 0 ? "다시 재기" : "계속하기"}
                      </button>
                    </div>
                  </div>

                  <label className="sr-only" htmlFor="story-draft">이번 문단</label>
                  <textarea
                    ref={draftRef}
                    id="story-draft"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    maxLength={MAX_DRAFT_LENGTH}
                    aria-describedby="draft-help draft-count"
                    placeholder="이전 문장을 이어 받아 한 문단만 써 주세요."
                    rows={7}
                  />
                  <div className="draft-meta">
                    <span id="draft-help">⌘/Ctrl + Enter로 바로 넘기기</span>
                    <span id="draft-count">{draft.length} / {MAX_DRAFT_LENGTH}자</span>
                  </div>

                  <div className="writing-actions">
                    <button type="button" className="secondary-button" onClick={() => moveToNextTurn()}>
                      이번 차례 쉬기
                    </button>
                    <button type="button" className="primary-button" onClick={submitDraft}>
                      붙이고 다음 작가에게 <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              </div>

              <aside className="story-panel" aria-labelledby="story-panel-title">
                <div className="story-panel-head">
                  <div>
                    <span>LIVE MANUSCRIPT</span>
                    <h2 id="story-panel-title">완성 중인 원고</h2>
                  </div>
                  <span>{entries.length + 1}문단</span>
                </div>
                <div className="story-scroll">
                  <article className="story-paragraph opener-paragraph">
                    <span>첫 문장</span>
                    <p>{seed.opener}</p>
                  </article>
                  {entries.map((entry, index) => (
                    <article className="story-paragraph" key={entry.id}>
                      <span>{String(index + 2).padStart(2, "0")} · {entry.player}</span>
                      <p>{entry.text}</p>
                    </article>
                  ))}
                  {entries.length === 0 && (
                    <div className="empty-story">
                      <span aria-hidden="true">···</span>
                      첫 문단을 기다리고 있어요.
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </section>
        )}

        {phase === "complete" && (
          <section className="complete-view" aria-labelledby="complete-title">
            <div className="completion-banner">
              <span className="completion-mark" aria-hidden="true">끝</span>
              <p className="eyebrow">{players.length}명의 작가 · {turnLimit}번의 차례</p>
              <h1 id="complete-title">마지막 문단까지 이어졌어요.</h1>
              <p>서로 다른 상상이 만나 세상에 하나뿐인 이야기가 완성됐습니다.</p>
              <div className="completion-actions">
                <button type="button" className="primary-button" onClick={shareStory}>이야기 공유</button>
                <button type="button" className="secondary-button" onClick={copyStory}>본문 복사</button>
                <button type="button" className="text-button" onClick={returnToSetup}>새 이야기 만들기</button>
              </div>
            </div>

            <article className="final-manuscript">
              <div className="final-title-block">
                <span>THE END · {seedGenreInfo.label}</span>
                <h2>{seed.title}</h2>
                <p>{players.join(" · ")} 공동 집필</p>
              </div>
              <div className="final-story">
                <p>{seed.opener}</p>
                {entries.map((entry) => <p key={entry.id}>{entry.text}</p>)}
              </div>
            </article>
          </section>
        )}
      </div>

      {showResetConfirm && (
        <div className="dialog-backdrop" role="presentation">
          <div
            ref={resetDialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            aria-describedby="reset-description"
          >
            <span aria-hidden="true">↺</span>
            <h2 id="reset-title">지금 원고를 닫을까요?</h2>
            <p id="reset-description">작성 중인 이야기는 이 기기에서 지워집니다.</p>
            <div>
              <button ref={continueWritingRef} type="button" className="secondary-button" onClick={closeResetDialog}>계속 쓰기</button>
              <button type="button" className="danger-button" onClick={returnToSetup}>원고 닫기</button>
            </div>
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">{status}</p>

      <footer className="footer">
        <span>문장잇기</span>
        <p>상상은 함께할수록 멀리 갑니다.</p>
      </footer>
    </main>
  );
}
