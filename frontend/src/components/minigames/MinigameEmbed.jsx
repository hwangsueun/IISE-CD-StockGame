import { useEffect, useRef } from 'react';

export const normalizeDifficulty = difficulty => ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
export const difficultyLabel = difficulty => ({ easy: '쉬움', normal: '보통', hard: '어려움' })[normalizeDifficulty(difficulty)];

// Only the currently mounted game frame can submit one actual round result.
export default function MinigameEmbed({ game, file, title, tall = false, onFinish, howtoOnly = false, difficulty = 'normal' }) {
  const frame = useRef(null);
  const submitted = useRef(false);
  const query = new URLSearchParams({ difficulty: normalizeDifficulty(difficulty) });
  if (howtoOnly) query.set('howto', 'only');

  useEffect(() => {
    const onMessage = event => {
      const data = event.data;
      if (howtoOnly || submitted.current || event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (!data || data.source !== 'antsurvival-minigame' || data.game !== game ||
          !Number.isFinite(data.rawScore) || !Number.isInteger(data.rawScore) || data.rawScore < 0) return;
      submitted.current = true;
      onFinish(data.rawScore);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [game, howtoOnly, onFinish]);

  return <div className="minigame-board">
    <iframe ref={frame} className={`minigame-iframe${tall ? ' tall' : ''}`} title={title} src={`/game/${file}?${query}`} />
  </div>;
}
