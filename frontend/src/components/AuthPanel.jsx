// 로그인/회원가입/이어하기 패널 (기능명세서 §회원, §시작화면)
// 게스트로도 게임 시작 가능 — 로그인하면 세션이 계정에 저장되어 이어하기 가능
import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { won } from '../utils/format';

export default function AuthPanel() {
  const { user, savedSessions, login, registerAndLogin, logout, continueSession } = useGameStore();
  const [mode, setMode] = useState('login'); // login | register
  const [form, setForm] = useState({ username: '', password: '', nickname: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await registerAndLogin(form.username, form.password, form.nickname);
      else await login(form.username, form.password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    const resumable = savedSessions.filter((s) => s.status === 'active');
    return (
      <div className="auth-panel">
        <p>👤 <b>{user.nickname}</b>님 <button className="btn-link" onClick={logout}>로그아웃</button></p>
        {resumable.length > 0 && (
          <>
            <h4>이어하기</h4>
            <ul className="resume-list">
              {resumable.map((s) => (
                <li key={s.id}>
                  <button onClick={() => continueSession(s.id)}>
                    {s.difficulty} · {s.current_turn}/240턴 · 현금 {won(Number(s.cash))} · 부채 {won(Number(s.debt))}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <div className="filter-bar">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>로그인</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>회원가입</button>
      </div>
      <input placeholder="아이디 (영문/숫자 4~20자)" value={form.username}
             onChange={(e) => setForm({ ...form, username: e.target.value })} />
      <input type="password" placeholder="비밀번호 (8자 이상)" value={form.password}
             onChange={(e) => setForm({ ...form, password: e.target.value })} />
      {mode === 'register' && (
        <input placeholder="닉네임" value={form.nickname}
               onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
      )}
      <button className="btn-primary" disabled={busy} onClick={submit}>
        {mode === 'register' ? '가입하고 시작' : '로그인'}
      </button>
      <p className="minigame-help">로그인 없이 게스트로 시작할 수도 있다 (저장/이어하기 불가).</p>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
