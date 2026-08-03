# 문장잇기

이름과 이야기 분위기를 고르고 한 문단씩 넘겨 쓰는 한국어 릴레이 이야기 게임입니다.
가입 없이 한 화면에서 플레이하며, 작성 중인 원고는 사용 중인 브라우저에만 임시 저장됩니다.
기존 단일 PC용 화면은 그대로 두고, 교사-학생 동시 접속 흐름은 D1 기반 API로 분리했습니다.

## 주요 기능

- 2~8명 작가 순환
- 장르별 첫 문장과 이야기 장치
- 45초, 60초, 90초 타이머
- 자동 임시 저장과 새로고침 복원
- 교사 로그인 기반 다중 방 운영 API
- QR/링크 접속 학생용 익명 참여 API
- 사람+AI 작가 수, 순서 모드, AI 생성/분석 상태 저장 필드
- 키보드 단축키(`Ctrl/Command + Enter`), 복사, 공유
- 데스크톱과 모바일 반응형 화면

## D1 API

교사용 API는 ChatGPT 로그인 헤더(`oai-authenticated-user-id`, `oai-authenticated-user-email`)가 필요합니다.
학생 API는 로그인 없이 방 코드와 참여 토큰으로만 동작하며, 토큰은 SHA-256 해시로 DB에 저장됩니다.

- `GET /api/teacher/rooms` : 로그인한 교사의 방 목록
- `GET /api/teacher/rooms?code=ROOM` : 교사 소유 방 상세
- `POST /api/teacher/rooms` : `{ writerLimit, humanLimit, aiLimit, genre, turnLimit, turnSeconds, orderMode }`로 방 생성
- `PATCH /api/teacher/rooms` : `{ roomCode, action: "start" | "close" }`로 시작/마감
- `GET /api/rooms?code=ROOM` : 학생용 방 미리보기
- `POST /api/rooms` : `{ roomCode, writerName }`으로 익명 입장, 응답 토큰은 클라이언트에만 보관
- `GET /api/rooms?code=ROOM` + `Authorization: Bearer TOKEN` : 참여자 폴링과 최종 작품 확인
- `PATCH /api/rooms` + `Authorization: Bearer TOKEN` : `{ roomCode, text }`로 현재 차례 제출

마이그레이션은 `db/schema.ts`에서 생성한 `drizzle/0000_sharp_garia.sql`을 사용합니다.
런타임에서 테이블을 자동 생성하지 않습니다.

## 실행과 검증

```bash
npm install
npm run dev
npm run db:generate
npm run lint
npm run typecheck
npm test
```

`npm test`는 Sites 배포 빌드와 서버 렌더링 결과를 함께 검증합니다.
