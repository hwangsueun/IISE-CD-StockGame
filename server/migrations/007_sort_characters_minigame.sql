-- =====================================================================
-- 007: 부업 미니게임 3 교체 — passenger_tetris -> sort_characters
--
-- 미니게임 3(노원03 승객 테트리스)을 "상자에 캐릭터 분류하기"로 완전히 대체한다.
-- 테트리스는 더 이상 제공하지 않으므로 game_key CHECK 목록에서 제거한다.
--
-- 002_members_minigames.sql 의 CHECK 제약을 교체하는 것이므로,
-- 기존 DB에는 이 파일을 psql 로 직접 적용해야 한다.
-- (pgdata 볼륨은 docker-entrypoint-initdb.d 라 기존 볼륨엔 자동 적용되지 않음)
--   docker exec -i antsurvival_db psql -U postgres -d antsurvival < server/migrations/007_sort_characters_minigame.sql
-- =====================================================================

-- 0) [버그 수정] grade 컬럼이 VARCHAR(10) 인데 'great_success' 는 13자라
--    대성공 등급은 INSERT 자체가 실패한다 (미니게임 3종 전부 해당).
--    submitPlay 트랜잭션이 통째로 롤백돼 플레이어가 보상을 못 받으므로 넓힌다.
ALTER TABLE side_job_plays ALTER COLUMN grade TYPE VARCHAR(20);

-- 1) 기존 플레이 기록의 게임 키를 새 이름으로 옮긴다.
--    CHECK 제약을 먼저 떼어내야 UPDATE 가 통과한다.
ALTER TABLE side_job_plays DROP CONSTRAINT IF EXISTS side_job_plays_game_key_check;

UPDATE side_job_plays
   SET game_key = 'sort_characters'
 WHERE game_key = 'passenger_tetris';

-- 2) 새 목록으로 CHECK 제약을 다시 건다.
ALTER TABLE side_job_plays
  ADD CONSTRAINT side_job_plays_game_key_check
  CHECK (game_key IN ('avoid_professor', 'catch_waxon', 'sort_characters'));

-- 3) event_log 에 남은 부업 상세(JSONB)의 gameKey 도 함께 옮긴다.
UPDATE event_log
   SET detail = jsonb_set(detail, '{gameKey}', '"sort_characters"')
 WHERE event_type = 'side_job'
   AND detail ->> 'gameKey' = 'passenger_tetris';
