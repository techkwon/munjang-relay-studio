# 문장잇기 · AI 릴레이 스튜디오

사람 작가와 Upstage Solar AI 작가가 한 문단씩 이어 쓰는 한국어 교실용 릴레이 소설 서비스입니다. 한 대의 PC로 사용하는 독립 모드와, 교사가 여러 방을 동시에 운영하는 온라인 교실 모드를 함께 제공합니다.

공개 서비스: [munjang-relay-studio.techkwon.chatgpt.site](https://munjang-relay-studio.techkwon.chatgpt.site/)

## 이용 흐름

### 한 화면 모드

- 로그인과 서버 전송 없이 2~8명이 기기 한 대를 돌려 사용합니다.
- 장르, 작가, 총 차례, 차례당 시간을 정하면 첫 문장과 이야기 장치가 나타납니다.
- 작성 중인 원고는 브라우저에만 임시 저장되며 새로고침 뒤 복원됩니다.
- 모든 작가가 최소 한 번 쓰도록 총 차례가 자동 보정됩니다.

### 교사용

- ChatGPT 계정으로 로그인해 여러 활동 방을 동시에 만들고 운영합니다.
- 사람/AI 작가 수, 장르, 총 차례, 차례당 시간, 차례대로/랜덤 순서를 설정합니다.
- Solar AI로 첫 문장을 만들고, AI 작가 차례를 자동 진행합니다.
- 활동 마감 뒤 사람 작가의 기여도와 글쓰기 강점을 비순위 성장 리포트로 확인합니다.
- 작품과 리포트를 복사, 다운로드, 인쇄할 수 있습니다.

### 학생용

- 계정이나 이메일 없이 QR 링크 또는 6자리 방 코드와 작가명만으로 입장합니다.
- 자기 차례가 되면 작성 화면이 열리고, 완성 뒤 전체 작품과 성장 리포트를 확인합니다.
- 320px 모바일 화면, 키보드, 터치 사용을 지원하며 주요 조작 영역은 44px 이상입니다.

## 기술 구성

- Next.js 16, React 19, TypeScript
- Cloudflare Workers, D1, OpenAI Sites 배포 어댑터
- Upstage Chat Completions API (`solar-pro4`, 필요 시 서버에서 `solar-pro3` 호환 폴백)
- 서버 전용 JSON Schema 출력으로 첫 문장, AI 이어쓰기, 성장 분석 생성
- Retro Digital/Y2K 반응형 UI

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에는 서버에서만 읽는 Upstage 키를 넣습니다. 실제 키를 소스나 클라이언트 코드에 넣지 마세요.

```dotenv
UPSTAGE_API_KEY=your_server_secret
UPSTAGE_MODEL=solar-pro4
```

D1 마이그레이션은 `db/schema.ts`에서 생성한 `drizzle/0000_sharp_garia.sql`을 사용합니다. 런타임에서는 테이블을 자동 생성하지 않습니다.

## API 개요

교사용 API는 ChatGPT 인증 사용자와 방 소유권을 확인합니다. 학생은 로그인하지 않으며, 참여 시 발급받은 토큰을 `Authorization: Bearer` 헤더로 보냅니다. 서버에는 토큰 원문 대신 SHA-256 해시만 저장합니다.

- `GET /api/teacher/rooms` — 내 방 목록 또는 상세 조회
- `POST /api/teacher/rooms` — 방 생성
- `PATCH /api/teacher/rooms` — 활동 시작/마감
- `GET /api/rooms?code=ROOM` — 최소 정보만 포함한 공개 방 미리보기
- `POST /api/rooms` — 익명 입장 또는 현재 차례 문단 제출
- `POST /api/ai` — 소유 교사의 첫 문장·AI 차례·분석 생성

## 품질 검증

```bash
npm run typecheck
npm run lint
npm test
npm audit --audit-level=moderate --omit=dev
```

`npm test`는 배포 빌드와 25개 서버·인증·AI·접근성·복구 계약을 함께 검사합니다. 배포 전에는 320px/390px 실제 브라우저에서 가로 넘침, 첫 화면 CTA, 오류 안내 겹침, 만료 세션 복구를 추가로 확인합니다.

## 개인정보와 안전

- 학생 가입, 이메일, 실명 수집이 필요하지 않습니다.
- 공개 방 조회에는 원고와 참여 토큰을 노출하지 않습니다.
- AI 리포트는 사람 작가만 대상으로 하며 순위나 성적이 아닌 성장 참고 자료로 표시합니다.
- 운영 환경의 `UPSTAGE_API_KEY`는 호스팅 비밀 값으로만 관리합니다.
