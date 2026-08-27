// 부업 미니게임 3: 상자에 캐릭터 분류하기 (초안)
// 시작하면 캐릭터 50개가 화면 오른쪽에서 인형처럼 쏟아져 들어와 튕기며 가운데에 산더미로 쌓인다.
// 플레이어는 마우스로 끌어 같은 색 상자에 분류해 넣는다. (중간에 새로 등장하지 않음)
// 종료 시 원점수(점수)를 postMessage로 부모(React 앱)에 전달 -> SIDE_JOB.SCORE_CUTS 로 등급 산정.
(function () {
  'use strict';

  // --- 부업 임베드 연동 (React 앱이 iframe으로 열었을 때만 동작) ---
  var EMBEDDED = (function () { try { return window.parent && window.parent !== window; } catch (_) { return false; } })();
  if (EMBEDDED) { var _bb = document.getElementById('backBtn'); if (_bb) _bb.style.display = 'none'; }
  function postScore(rawScore) {
    if (!EMBEDDED) return;
    // game 키는 서버 SIDE_JOB.SCORE_CUTS 의 키와 반드시 일치해야 한다 (constants.js).
    try { window.parent.postMessage({ source: 'antsurvival-minigame', game: 'sort_characters', rawScore: rawScore }, '*'); } catch (_) {}
  }

  // ===== 규칙 설정 =====
  var GAME_SECONDS = 60;
  var START_LIVES = 3;
  var INIT_PILE = 50;      // 총 캐릭터 수 (중간 리필 없음 -> 이게 전부)
  var CLEAR_BONUS = 500;   // 시간 내 전부 치웠을 때 보너스

  // 더미가 눕는 바닥선 (바닥 높이 비율). CSS #boxes 상단이 76% 라 그보다 위에 둔다.
  // 상자와 너무 붙지 않도록 여유를 둔 값.
  var PILE_BOTTOM = 0.70;
  var CHAR_H = 0.25;       // 캐릭터 높이 비율 (CSS .char { height } 과 맞출 것)

  // ===== 쏟아짐 / 물리 =====
  // 시작하면 화면 '위'에서 한꺼번에 쏟아진다. 각자 화면 밖 높이가 달라서
  // 한 덩어리로 뭉치지 않고 폭포처럼 차례로 떨어져 내린다.
  var DROP_SPREAD_X = 0.14;  // 낙하 시작 x 퍼짐 (중앙 기준, 바닥 너비 비율)
  var DROP_STACK_Y = 1.9;    // 화면 위로 얼마나 높이까지 쌓아두고 떨어뜨릴지 (바닥 높이 배수)
  var GRAV = 2100;         // px/s^2 중력
  var BOUNCE = 0.40;       // 지면 반발 계수 (인형처럼 통통)
  var WALL_BOUNCE = 0.52;  // 벽 반발 계수
  var GROUND_FRICTION = 0.82;
  var LEFT_WALL = 0.04;    // 캐릭터가 나갈 수 없는 좌우 경계 (바닥 너비 비율)
  var RIGHT_WALL = 0.96;
  // 회전 공기저항 (1초당 남는 비율). 회전이 서서히 잦아들어 자연스럽게 눕는다.
  // 이게 없으면 계속 같은 속도로 돌다가 멈추는 순간 각도가 홱 정해진 것처럼 보인다.
  var ROT_DRAG = 0.25;
  var SETTLE_VY = 70;      // 이보다 느리게 착지하면 튕기지 않고 눕기 시작
  var SETTLE_VX = 26;      // 수평 속도가 이보다 작아지면 완전히 정지
  var MAX_FLIGHT = 5;      // s, 이 시간이 지나도 안 멈추면 강제로 눕힘 (안전장치)

  // ===== 모래성(더미) 형태 =====
  // 지면을 평평한 선이 아니라 '쌓인 만큼 자라나는 삼각 단면의 모래언덕'으로 둔다.
  // 캐릭터는 그 경사면 위에 내려앉으므로 언제나 자연스러운 모래성 실루엣이 된다.
  var REPOSE = 0.62;       // 안식각 = 높이/반지름. 작을수록 완만하게 퍼진다
  var PACK = 0.12;         // 캐릭터 하나가 더미 부피에 기여하는 비율 (겹쳐 파묻히는 정도)
  var MAX_PILE_H = 0.36;   // 더미 최대 높이 (바닥 높이 비율) — 화면 위로 넘치지 않게

  // 캐릭터 -> 색 그룹 (상자 4색). assets/mini3/ 하위 파일명.
  var CHARS = {
    blue:   ['blue_dra1.png', 'blue_dra2.png', 'blue_dra3.png'],
    green:  ['green_boy.png', 'green_dragon.png', 'green_girl.png'],
    purple: ['purple_professor.png', 'purple_sueun.png', 'purple_taeun.png'],
    red:    ['red_man.png', 'red_woman.png', 'red_rain_man.png', 'red_rain_woman.png'],
  };
  var GROUPS = Object.keys(CHARS);
  var ASSET = 'assets/mini3/';

  // 그룹별 기본 점수: 보라 > 초록 > 파랑 > 빨강.
  // 보라는 스프라이트도 작아 집기 가장 어렵다 (크기는 CSS .char.g-purple { height }).
  var GROUP_POINTS = { purple: 220, green: 170, blue: 130, red: 100 };
  // 그룹별 높이 비율 (CSS 와 일치시켜 물리/더미 계산에 사용)
  var GROUP_H = { blue: CHAR_H, green: CHAR_H, red: CHAR_H, purple: 0.15 };

  // ===== DOM =====
  var stage = document.getElementById('stage');
  var yard = document.getElementById('floor');
  var hudScore = document.getElementById('hudScore');
  var hudCombo = document.getElementById('hudCombo');
  var hudLives = document.getElementById('hudLives');
  var timerFill = document.getElementById('timerFill');
  var vignette = document.getElementById('vignette');
  var pileCountEl = document.getElementById('pileCount');
  var boxEls = Array.prototype.slice.call(document.querySelectorAll('.box'));

  // ===== 상태 =====
  var chars = [];   // { el, group, x, y, vx, vy, rot, vrot, w, age, settled, dragging, alive }
  var score = 0, combo = 0, bestCombo = 0;
  var sorted = 0, wrong = 0;
  var lives = START_LIVES;
  var timeLeft = GAME_SECONDS;
  var playing = false;
  var loopId = null, lastTs = 0, startTs = 0;
  var drag = null, dragDX = 0, dragDY = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function yardRect() { return yard.getBoundingClientRect(); }
  // 더미가 눕는 지면(바닥선)의 y. 상자 위쪽에 오도록 잡는다.
  // 캐릭터마다 키가 다르므로(보라가 작음) 항상 '발끝'이 이 선에 닿게 계산한다.
  function groundLine(r) { return r.height * PILE_BOTTOM; }

  // ===== 모래성 지면 =====
  // 지면을 평평한 선이 아니라 '가운데가 솟은 삼각 단면의 모래언덕'으로 둔다.
  // 캐릭터가 하나 눕을 때마다 더미 부피(pileVol)가 늘고, 언덕이 그만큼 자란다.
  // 캐릭터는 이 경사면 위에 내려앉으므로 결과가 항상 모래성 실루엣이 된다.
  // pileTarget = 실제로 쌓인 부피, pileVol = 화면에 반영 중인 부피.
  // 캐릭터가 눕는 순간 언덕이 계단처럼 확 자라면 공중의 캐릭터가 위로 순간이동해
  // 튕기는 것처럼 보인다. 그래서 pileVol 이 target 을 부드럽게 따라가게 한다.
  var pileVol = 0, pileTarget = 0;
  var PILE_EASE = 5;   // 클수록 빨리 따라붙음 (1/s)

  function easePile(dt) {
    var k = Math.min(1, PILE_EASE * dt);
    pileVol += (pileTarget - pileVol) * k;
  }

  // 삼각형 단면적 A = H * R = H^2 / REPOSE  ->  H = sqrt(A * REPOSE)
  function pileH(r) { return Math.min(Math.sqrt(pileVol * REPOSE), r.height * MAX_PILE_H); }
  // 언덕 표면의 y (해당 x 에서). 언덕 밖은 그냥 바닥선.
  function surfaceY(x, r) {
    var h = pileH(r);
    if (h <= 0) return groundLine(r);
    var R = h / REPOSE;                       // 언덕 반지름
    var d = Math.abs(x - r.width / 2);
    return groundLine(r) - (d < R ? h * (1 - d / R) : 0);
  }
  // 이 캐릭터가 놓일 y (top 좌표) = 발끝이 언덕 표면에 닿는 위치
  function groundFor(p, r) { return surfaceY(p.x + p.w / 2, r) - p.h; }
  // 캐릭터 하나가 더미에 보태는 부피
  function volOf(p) { return p.w * p.h * PACK; }
  // 더미가 낮아졌을 때 공중에 뜬 캐릭터를 다시 떨어뜨린다
  function relax(r) {
    for (var i = 0; i < chars.length; i++) {
      var p = chars[i];
      if (!p.alive || p.dragging || !p.settled) continue;
      if (p.y < groundFor(p, r) - 1) { p.settled = false; p.age = 0; p.vy = 0; }
    }
  }

  // ===== 캐릭터 =====
  function place(p, r) {
    p.el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) rotate(' + p.rot + 'deg)';
    // 깊이 = y (아래에 있는 캐릭터가 앞에 그려짐). 100~195 라 상자(z 200)를 덮지 않는다.
    p.el.style.zIndex = 100 + Math.round(clamp(p.y / Math.max(1, r.height), 0, 1) * 95);
  }

  function spawnFalling(r) {
    var group = GROUPS[Math.floor(Math.random() * GROUPS.length)];
    var list = CHARS[group];
    var file = list[Math.floor(Math.random() * list.length)];

    var el = document.createElement('div');
    el.className = 'char g-' + group;
    el.innerHTML = '<img src="' + ASSET + file + '" alt="' + group + ' 캐릭터" draggable="false" />';

    var cw = r.height * GROUP_H[group] * 0.62;
    var p = {
      el: el, group: group,
      // 화면 '위'에서 가운데를 향해 한꺼번에 쏟아진다.
      // y를 화면 밖 넓은 범위에 흩어두면 우르르 차례로 떨어져 내린다.
      x: r.width / 2 - cw / 2 + (Math.random() - Math.random()) * r.width * DROP_SPREAD_X,
      y: -rand(r.height * 0.1, r.height * DROP_STACK_Y),
      vx: rand(-90, 90),
      vy: rand(0, 200),
      rot: rand(-30, 30),
      // 너무 빠르게 돌면 여러 바퀴를 돌다 멈춰서 홱 도는 것처럼 보인다
      vrot: rand(-110, 110),
      // 이미지 로드 전 근사치. 로드되면 실제 크기로 교체된다.
      w: cw,
      h: r.height * GROUP_H[group],
      age: 0, settled: false, inPile: false, dragging: false, alive: true,
    };

    var img = el.querySelector('img');
    img.addEventListener('load', function () {
      if (el.offsetWidth) p.w = el.offsetWidth;
      if (el.offsetHeight) p.h = el.offsetHeight;
    });

    el.addEventListener('pointerdown', function (e) {
      if (!playing || !p.alive) return;
      e.preventDefault();
      startDrag(p, e);
    });

    yard.appendChild(el);
    chars.push(p);
    place(p, r);
    return p;
  }

  function removeChar(p) {
    p.alive = false;
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    var i = chars.indexOf(p);
    if (i >= 0) chars.splice(i, 1);
    if (drag === p) drag = null;
    // 빠져나간 만큼 언덕이 낮아지고, 그 위에 떠 있게 된 캐릭터는 다시 굴러내린다
    if (p.inPile) { pileTarget = Math.max(0, pileTarget - volOf(p)); p.inPile = false; }
    relax(yardRect());
    updatePile();
  }

  function updatePile() {
    pileCountEl.textContent = '남은 캐릭터 ' + String(chars.length).padStart(2, '0');
  }

  // 캐릭터를 그 자리에 눕혀 더미의 일부로 만든다
  function settle(p, r) {
    p.settled = true;
    p.vx = 0; p.vy = 0; p.vrot = 0;
    // 각도는 굴러온 그대로 둔다. 여기서 특정 범위로 끌어당기면
    // 멈추는 순간 홱 돌아가서(스냅) 부자연스럽다.
    // 360도 정규화는 화면상 결과가 같으므로 안전하다.
    p.rot = ((p.rot % 360) + 540) % 360 - 180;
    if (!p.inPile) { p.inPile = true; pileTarget += volOf(p); }  // 언덕이 그만큼 자란다
    place(p, r);
  }

  // 물리를 다시 켠다 (오분류로 튕겨나오거나, 상자 밖에 내려놨을 때)
  function toss(p, vx, vy, r) {
    p.settled = false;
    p.age = 0;
    p.vx = vx; p.vy = vy;
    p.vrot = rand(-280, 280);
    place(p, r);
  }

  // ===== 물리 스텝 =====
  function physics(dt, r) {
    easePile(dt);   // 언덕이 부드럽게 자란다 (계단식으로 밀어올리지 않도록)
    var lw = r.width * LEFT_WALL;
    var rw = r.width * RIGHT_WALL;

    for (var i = 0; i < chars.length; i++) {
      var p = chars[i];
      if (!p.alive || p.dragging || p.settled) continue;

      p.age += dt;
      p.vy += GRAV * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.vrot *= Math.pow(ROT_DRAG, dt);   // 회전이 서서히 잦아든다

      // 좌우 벽에 튕김 -> 가운데 영역 안에 모인다
      if (p.x < lw) { p.x = lw; p.vx = Math.abs(p.vx) * WALL_BOUNCE; p.vrot *= -0.6; }
      else if (p.x + p.w > rw && p.vx > 0) { p.x = rw - p.w; p.vx = -Math.abs(p.vx) * WALL_BOUNCE; p.vrot *= -0.6; }

      // 모래언덕 경사면에 착지
      var g = groundFor(p, r);
      if (p.y >= g) {
        // 언덕이 자라 표면 아래로 파묻힌 경우, 한 번에 끌어올리면 순간이동처럼 보인다.
        // 낙하로 생긴 얕은 겹침은 그대로 해소하고, 깊이 묻힌 경우만 서서히 떠오르게 한다.
        var lift = 1200 * dt;
        if (p.y - g > lift) {
          p.y -= lift;
          if (p.vy > 0) p.vy = 0;
          place(p, r);
          continue;
        }
        p.y = g;
        if (Math.abs(p.vy) > SETTLE_VY) {
          p.vy = -Math.abs(p.vy) * BOUNCE;   // 인형처럼 통통 튕김
          p.vx *= GROUND_FRICTION;
          p.vrot *= 0.55;
        } else {
          // 언덕 표면이 이미 경사를 이루고 있으므로 따로 미끄러뜨리지 않는다.
          // (밀어내면 캐릭터가 언덕 밖으로 다 빠져나가 평평해진다)
          p.vy = 0;
          p.vx *= GROUND_FRICTION;
          p.vrot *= 0.7;
          if (Math.abs(p.vx) < SETTLE_VX) { settle(p, r); continue; }
        }
      }

      // 안전장치: 오래 굴러도 안 멈추면 그 자리에 눕힌다
      if (p.age > MAX_FLIGHT) { p.y = Math.min(p.y, groundFor(p, r)); settle(p, r); continue; }
      place(p, r);
    }
  }

  // ===== 드래그 =====
  function startDrag(p, e) {
    if (drag) return;
    drag = p;
    p.dragging = true;
    p.settled = false;
    p.vx = 0; p.vy = 0; p.vrot = 0;
    p.el.classList.add('dragging');
    p.rot = 0;
    try { p.el.setPointerCapture(e.pointerId); } catch (_) {}
    var b = p.el.getBoundingClientRect();
    p.w = b.width;
    dragDX = e.clientX - b.left - b.width / 2;
    dragDY = e.clientY - b.top - b.height / 2;
    // 집어든 만큼 언덕이 낮아진다
    if (p.inPile) { pileTarget = Math.max(0, pileTarget - volOf(p)); p.inPile = false; }
    relax(yardRect());
    moveDragTo(e.clientX, e.clientY);
  }
  function moveDragTo(clientX, clientY) {
    if (!drag) return;
    var r = yardRect();
    var w = drag.el.offsetWidth || 60, h = drag.el.offsetHeight || 90;
    drag.x = clientX - r.left - w / 2 - dragDX;
    drag.y = clientY - r.top - h / 2 - dragDY;
    place(drag, r);
    highlightBoxUnder(clientX, clientY);
  }
  function endDrag(clientX, clientY) {
    if (!drag) return;
    var p = drag;
    p.dragging = false;
    p.el.classList.remove('dragging');
    drag = null;
    clearBoxHot();

    var idx = boxIndexUnder(clientX, clientY);
    if (idx >= 0) { resolve(p, boxEls[idx]); return; }
    // 상자 밖에 놓으면 그 자리에서 다시 떨어져 더미로 굴러든다
    var r = yardRect();
    p.x = clamp(p.x, r.width * LEFT_WALL, r.width * RIGHT_WALL - p.w);
    toss(p, rand(-60, 60), 40, r);
  }

  stage.addEventListener('pointermove', function (e) { if (drag) moveDragTo(e.clientX, e.clientY); });
  stage.addEventListener('pointerup', function (e) { if (drag) endDrag(e.clientX, e.clientY); });
  stage.addEventListener('pointercancel', function (e) { if (drag) endDrag(e.clientX, e.clientY); });

  function boxIndexUnder(x, y) {
    for (var i = 0; i < boxEls.length; i++) {
      var b = boxEls[i].getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return i;
    }
    return -1;
  }
  function highlightBoxUnder(x, y) {
    var idx = boxIndexUnder(x, y);
    boxEls.forEach(function (b, i) { b.classList.toggle('hot', i === idx); });
  }
  function clearBoxHot() { boxEls.forEach(function (b) { b.classList.remove('hot'); }); }

  // ===== 판정 =====
  function resolve(p, boxEl) {
    var correct = (boxEl.dataset.group === p.group);
    var b = boxEl.getBoundingClientRect();
    var s = stage.getBoundingClientRect();
    var r = yardRect();
    var fx = b.left - s.left + b.width / 2;
    var fy = b.top - s.top + b.height * 0.3;

    if (correct) {
      sorted++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      var gain = (GROUP_POINTS[p.group] || 100) + Math.min(combo - 1, 10) * 20;
      score += gain;
      boxEl.classList.remove('good'); void boxEl.offsetWidth; boxEl.classList.add('good');
      floater('+' + gain, fx, fy, true);

      p.alive = false;
      p.el.style.transform = 'translate(' + (b.left - r.left + b.width / 2 - 24) + 'px,' + (r.height + 20) + 'px) scale(0.2)';
      p.el.classList.add('flyoff');
      setTimeout(function () { removeChar(p); }, 200);
    } else {
      wrong++;
      combo = 0;
      score = Math.max(0, score - 40);
      boxEl.classList.remove('bad'); void boxEl.offsetWidth; boxEl.classList.add('bad');
      floater('-1 ❤', fx, fy, false);
      // 상자가 뱉어내듯 위로 튕겨 더미로 되돌아감
      p.el.classList.remove('reject'); void p.el.offsetWidth; p.el.classList.add('reject');
      p.x = clamp(b.left - r.left + b.width / 2 - p.w / 2, r.width * LEFT_WALL, r.width * RIGHT_WALL - p.w);
      p.y = Math.min(p.y, groundLine(r) - p.h - r.height * 0.10);
      toss(p, rand(-180, 180), -rand(420, 640), r);
      loseLife();
    }
    updateHud();
  }

  function loseLife() {
    lives = Math.max(0, lives - 1);
    vignette.classList.remove('flash'); void vignette.offsetWidth; vignette.classList.add('flash');
    updateHud();
    if (lives <= 0) end('LIVES OUT', '해고당했다…');
  }

  function floater(text, x, y, plus) {
    var f = document.createElement('div');
    f.className = 'floater ' + (plus ? 'plus' : 'minus');
    f.textContent = text;
    f.style.left = (x - 18) + 'px';
    f.style.top = (y - 10) + 'px';
    stage.appendChild(f);
    setTimeout(function () { f.remove(); }, 700);
  }

  // ===== 메인 루프 (물리 + 타이머) =====
  // rAF 대신 setInterval 을 쓴다: iframe이 가려지면 rAF가 아예 멈춰서
  // 더미가 공중에 얼어붙는다. (다른 미니게임들도 setInterval 방식)
  function step() {
    if (!playing) return;
    var ts = performance.now();
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    var r = yardRect();

    physics(dt, r);

    timeLeft = Math.max(0, GAME_SECONDS - (ts - startTs) / 1000);
    updateHud();

    if (timeLeft <= 0) { end('TIME OVER', null); return; }
    if (chars.length === 0) { end('ALL CLEAR', '전부 분류 완료!'); return; }
  }

  function updateHud() {
    hudScore.textContent = String(score).padStart(4, '0');
    hudCombo.textContent = 'COMBO x' + (combo > 1 ? combo : 1);
    hudLives.textContent = '❤'.repeat(lives) + '·'.repeat(START_LIVES - lives);
    var pct = clamp(timeLeft / GAME_SECONDS, 0, 1) * 100;
    timerFill.style.width = pct + '%';
    timerFill.classList.toggle('danger', pct <= 25);
  }

  // ===== 시작 / 종료 =====
  function start() {
    chars.slice().forEach(function (p) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); });
    chars = [];
    pileVol = 0; pileTarget = 0;
    score = 0; combo = 0; bestCombo = 0;
    sorted = 0; wrong = 0;
    lives = START_LIVES; timeLeft = GAME_SECONDS;
    drag = null;
    clearBoxHot();
    updateHud();

    // 50개를 한꺼번에 화면 위에 쏟아붓는다 (각자 높이가 달라 우르르 쏟아져 내림)
    var r0 = yardRect();
    for (var i = 0; i < INIT_PILE; i++) spawnFalling(r0);
    updatePile();

    document.getElementById('startOverlay').hidden = true;
    document.getElementById('endOverlay').hidden = true;

    playing = true;
    startTs = performance.now();
    lastTs = startTs;
    clearInterval(loopId);
    loopId = setInterval(step, 1000 / 60);
  }

  function end(tag, titleOverride) {
    if (!playing) return;
    playing = false;
    clearInterval(loopId);
    timeLeft = Math.max(0, timeLeft);

    var cleared = (chars.length === 0);
    if (cleared) score += CLEAR_BONUS;
    updateHud();

    var attempts = sorted + wrong;
    var acc = attempts ? Math.round(sorted / attempts * 100) : 0;
    document.getElementById('endTag').textContent = cleared ? 'ALL CLEAR' : (tag || 'SHIFT OVER');
    document.getElementById('endTitle').textContent = titleOverride || (cleared ? '전부 분류 완료!' : '근무 종료!');
    document.getElementById('rSorted').textContent = sorted + '명';
    document.getElementById('rScore').textContent = String(score).padStart(4, '0');
    document.getElementById('rAcc').textContent = acc + '%';

    var msg = score >= 3000 ? '분류 반장! 손이 안 보인다.'
            : score >= 2000 ? '숙련된 분류원이군요.'
            : score >= 1000 ? '그럭저럭 하루 벌이는 됩니다.'
            : score >= 400  ? '초보 딱지를 못 뗐습니다.'
            : '반장이 한숨을 쉽니다…';
    document.getElementById('rankMsg').textContent = msg + (cleared ? ' (+보너스 ' + CLEAR_BONUS + ')' : '') + ' · 최고 콤보 x' + Math.max(1, bestCombo);
    document.getElementById('endOverlay').hidden = false;

    postScore(score); // 원점수 = 점수
  }

  document.getElementById('startBtn').addEventListener('click', start);
  document.getElementById('retryBtn').addEventListener('click', start);
})();
