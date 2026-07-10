// 타이핑 효과: HTML 태그는 한 번에, 글자는 한 자씩 공개한다 (22ms/타). Phase D 컷신 공용.
import { useEffect, useRef, useState } from 'react';

export function useTypewriter(fullHtml, active) {
  const [html, setHtml] = useState('');
  const [done, setDone] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    cancelledRef.current = false;
    setHtml('');
    setDone(false);
    let i = 0;
    let buf = '';
    const src = fullHtml;
    function tick() {
      if (cancelledRef.current) return;
      if (i >= src.length) {
        setDone(true);
        return;
      }
      if (src[i] === '<') {
        const close = src.indexOf('>', i);
        buf += src.slice(i, close + 1);
        i = close + 1;
      } else {
        buf += src[i++];
      }
      setHtml(buf);
      setTimeout(tick, 22);
    }
    tick();
    return () => { cancelledRef.current = true; };
  }, [fullHtml, active]);

  const skip = () => {
    cancelledRef.current = true;
    setHtml(fullHtml);
    setDone(true);
  };

  return { html, done, skip };
}
