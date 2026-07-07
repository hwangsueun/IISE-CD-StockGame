-- =====================================================================
-- 002: 회원관리 + 부업 미니게임 + 급등주 이벤트 (기능명세서/미팅4·5 기획 반영)
-- 기능명세서: Drive 시트 1TAJb1DCmziqrI1oDUH4OGS9hsKqc6k-Dts1W2xiqXlE
-- =====================================================================

-- ---------------------------------------------------------------------
-- 회원 (기능명세서 §회원: 회원가입/로그인/로그아웃/프로필/저장·이어하기)
-- 게스트 플레이 허용: game_sessions.user_id는 nullable
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- scrypt: salt:hash (authService)
  nickname VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 로그인 세션 토큰 (게임 나가면 로그아웃 = 토큰 삭제)
CREATE TABLE auth_tokens (
  token VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);

ALTER TABLE game_sessions ADD COLUMN user_id UUID REFERENCES users(id);
CREATE INDEX idx_sessions_user ON game_sessions(user_id);

-- 부업 수행일 기록: 부업한 날은 투자 불가 (중간보고서 §4.5)
ALTER TABLE game_sessions ADD COLUMN side_job_turn INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 부업 미니게임 (기획 미팅5 §6, 기능명세서 §부업)
-- 게임 3종: avoid_professor(교수님 피하기), catch_waxon(왝슨을 잡아라),
--           passenger_tetris(승객 테트리스)
-- 하루 1회 제한 = UNIQUE(session_id, turn_number)
-- ---------------------------------------------------------------------
CREATE TABLE side_job_plays (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  turn_number INT NOT NULL,
  game_key VARCHAR(30) NOT NULL CHECK (game_key IN ('avoid_professor','catch_waxon','passenger_tetris')),
  raw_score NUMERIC NOT NULL,           -- 게임별 원점수 (생존시간/포획수/점수)
  grade VARCHAR(10) NOT NULL CHECK (grade IN ('great_success','success','normal','fail','great_fail')),
  cash_reward BIGINT NOT NULL,          -- 기본급 x 등급 배율
  stress_delta INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (session_id, turn_number)
);

-- ---------------------------------------------------------------------
-- 급등주 이벤트 (기획 미팅5 §4: 임시 작전주 등장 -> 매수/관망 ->
--                다음 턴 결과 공개 -> 자동 매도 후 제거)
-- ---------------------------------------------------------------------
CREATE TABLE surge_stocks (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  spawn_turn INT NOT NULL,              -- 등장 턴 (해당 턴에만 매수 가능)
  display_name VARCHAR(50) NOT NULL,    -- 가상 작전주 이름
  buy_price NUMERIC NOT NULL,           -- 등장 시 표시가
  invested_amount BIGINT NOT NULL DEFAULT 0,  -- 0이면 관망
  outcome VARCHAR(20),                  -- surge/rise/small_rise/fall/plunge/crash (다음 턴 판정)
  return_rate NUMERIC,                  -- 실현 수익률
  cash_delta BIGINT,                    -- 자동 매도 정산액 - 투자액
  stress_delta INT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_surge_session ON surge_stocks(session_id, resolved);
