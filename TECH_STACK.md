# 동학개미 서바이벌 — 기술 스택 가이드라인

## 전체 아키텍처

```
React + Vite  →  Express (Node.js)  →  Docker (PostgreSQL)
```

---

## 프론트엔드

| 항목 | 기술 |
|---|---|
| 프레임워크 | React 19 |
| 빌드 도구 | Vite |
| 언어 | JavaScript (JSX) |
| 스타일 | CSS |

- 레포: `stock-game-origin`
- 게임 구성: 5턴, 4개 종목 (삼성전자 / SK하이닉스 / NAVER / 현대차)
- 초기 자금: 1,000,000원
- 뉴스: 턴당 최대 5건 (거시뉴스 + 개별주식뉴스)

---

## 백엔드

| 항목 | 기술 |
|---|---|
| 서버 | Express (Node.js) |
| API 방식 | REST |

- 턴별 게임 데이터, 뉴스, 주가를 DB에서 조회해 프론트에 전달
- Supabase 미사용 — 자체 호스팅

---

## 데이터베이스

| 항목 | 기술 |
|---|---|
| DB | PostgreSQL |
| 인프라 | Docker 컨테이너 |

---

## 데이터 파이프라인

| 항목 | 기술 |
|---|---|
| 언어 | Python |
| LLM | GPT-4o (OpenAI Batch API) |
| 데이터 소스 | DART, GDELT, 디시인사이드 종토방 |
| 저장소 | Google Drive (영문 `Data/` 폴더 기준) |

### 파이프라인 단계

```
pr05d → pr05e → pr05f → pr06a   # 개별주식뉴스 (Batch API)
pr05                             # 거시뉴스 (Realtime API)
pr_dci06                         # 종토방 NPC 반응 (Batch API)
```

---

## 회사명 마스킹 전략

실제 기업명이 뉴스에 노출되지 않도록 2단계 마스킹 적용:

1. **별칭 → 정식명** (매핑 테이블 + LLM fallback)
2. **정식명 → 가상명** (같은 받침 규칙 + 조사 자동 보정)

---

## 개발 규칙

- 데이터는 항상 Google Drive 영문 `Data/` 폴더 기준 (한글 `데이터/` 폴더 사용 금지)
- 뉴스 데이터 미완성 시 stub JSON으로 프론트 개발 진행
- 모든 설계 변경사항은 이 문서에 반영
