(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = n => Number(n).toLocaleString('vi-VN');
  const rand = (a, b) => a + Math.random() * (b - a);
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NODES = 30;
  const REST_EVERY = 5;   // cứ qua n ải thì có 1 trạm hồi phục
  const SWITCH_COOLDOWN = 2;  // sau khi đổi người, phải chờ 1 lượt mới được đổi tiếp (chống đổi qua đổi lại)

  // ===== Chỉnh độ khó ở đây =====
  const FOE = { hp: 800, atk: 96, def: 47, spd: 100 };
  const DIFF = { hp: 1.0, atk: 1.0, bossHp: 4, bossAtk: 1.3 };
  const capAt = (un, node) => Math.round(un.lv_min + (un.lv_max - un.lv_min) * (node - 1) / (NODES - 1));
  const ELEMENTS = {
    fire: ['Hỏa', '#ff6b3d', 'fa-fire'], water: ['Thủy', '#3d9bff', 'fa-droplet'], wind: ['Phong', '#5fe0b0', 'fa-wind'], earth: ['Thổ', '#c49a5a', 'fa-mountain'],
    thunder: ['Lôi', '#ffd93d', 'fa-bolt'], light: ['Quang', '#fff2b8', 'fa-sun'], dark: ['Ám', '#9d6bff', 'fa-moon'],
  };
  const ico = (cls, color) => `<i class="fa-solid ${cls}"${color ? ` style="color:${color}"` : ''}></i>`;
  const eIco = el => ico(ELEMENTS[el][2], ELEMENTS[el][1]);
  const ITEM_ICON = { flask: 'fa-flask', bolt: 'fa-bolt', heart: 'fa-heart', sword: 'fa-khanda', shield: 'fa-shield-halved' };
  const itemIcon = n => ico(ITEM_ICON[n] || 'fa-gift');
  const BEATS = { fire: 'wind', wind: 'earth', earth: 'thunder', thunder: 'water', water: 'fire', light: 'dark', dark: 'light' };
  const elemMult = (a, d) => !a ? 1 : BEATS[a] === d ? 1.5 : BEATS[d] === a ? 0.75 : 1;
  const BASIC = { id: 'basic', name: 'Đánh thường', kind: 'damage', element: null, power: 1, cooldown: 0, target: 'single', desc: '' };
  const nodeType = n => n === NODES ? 'boss' : n % 10 === 0 ? 'chest' : 'normal';

  const S = {
    user: null, universe: null, consumables: [], allies: [], enemies: [],
    focus: null,            // nhân vật phe ta đang ra sân
    foe: null,              // kẻ địch đang ra sân
    pending: null,          // vật phẩm đang chờ dùng (tốn 1 lượt)
    swCd: { ally: 0, enemy: 0 },
    speed: 1, buff: { turns: 0, mult: 1 }, uid: 0
  };

  async function api(url, body) {
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Cần đăng nhập'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Lỗi máy chủ');
    return j;
  }

  /* ---------- UI helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function log(html, cls = '') {
    const l = $('#log'), p = document.createElement('p');
    p.className = cls; p.innerHTML = html; l.appendChild(p);
    while (l.children.length > 80) l.firstChild.remove();
    l.scrollTop = l.scrollHeight;
    $('#dialog').innerHTML = html;
  }
  const nameTag = f => `<span class="${f.side === 'ally' ? 'n-a' : 'n-e'}">${f.name}</span>`;
  const hpClass = pct => pct < 30 ? 'low' : pct < 60 ? 'mid' : '';
  const enemyIcon = f => f.boss ? ico('fa-dragon') : f.name.startsWith('Rương') ? ico('fa-box-open') : ico('fa-ghost');
  const IMG_DIR = '/static/img_char/';
  const sprite = (img, fallback) => img
    ? `<img class="char-img" src="${IMG_DIR}${img}" alt="" draggable="false" data-fb="${fallback.replace(/"/g, '&quot;')}" onerror="this.outerHTML=this.dataset.fb">`
    : fallback;
  const alive = a => a.filter(f => f.hp > 0);
  const bodyEl = f => f.side === 'ally' ? $('#ally-stage') : f.el.querySelector('.ev');
  // chạy animation Web Animations, trả về Promise (bỏ qua nếu người dùng tắt hiệu ứng)
  const play = (el, kf, o) => REDUCED ? Promise.resolve() : el.animate(kf, o).finished.catch(() => { });

  /* ---------- Thanh máu có "vệt máu" trắng chạy theo ---------- */
  function setBar(fill, pct, instant) {
    const g = fill.parentElement.querySelector('.ghost');
    if (instant) { fill.style.transition = 'none'; if (g) g.style.transition = 'none'; }
    fill.style.width = pct + '%'; fill.classList.toggle('low', pct < 30);
    if (g) g.style.width = pct + '%';
    if (instant) { void fill.offsetWidth; fill.style.transition = ''; if (g) g.style.transition = ''; }
  }

  /* ---------- Render ---------- */
  function renderHeader() {
    const u = S.user;
    $('#pf-name').textContent = u.name; $('#pf-tag').textContent = u.tag;
    $('#cur-coins').textContent = fmt(u.coins); $('#cur-tickets').textContent = fmt(u.tickets); $('#cur-crystals').textContent = fmt(u.crystals);
    $('#collect-text').innerHTML = `Sưu tập: <b>${u.owned} / ${u.total_chars}</b>`;
  }
  function renderTimeline(node) {
    const track = $('#stage-track'); track.innerHTML = '';
    const add = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; track.appendChild(d); return d; };
    for (let i = 1; i <= NODES; i++) {
      const t = nodeType(i), done = i < node;
      if (i > 1) add(`tl-line ${i <= node ? 'done' : ''}`);
      if (i === node) add('tl-cur', '<i class="fa-solid fa-khanda"></i>').title = `Ải ${i}`;
      else if (t === 'boss') add('tl-ico boss', '<i class="fa-solid fa-crown"></i>').title = 'Boss thế giới';
      else if (t === 'chest') add('tl-ico chest', '<i class="fa-solid fa-gift"></i>').title = 'Rương báu';
      else add(`tl-dot ${done ? 'done' : ''}`).title = `Ải ${i}`;
    }
    $('#stage-count').textContent = `${node} / ${NODES}`;
  }
  function renderUniverse() {
    const un = S.universe, node = S.user.node, pct = Math.round((node - 1) / NODES * 100);
    $('#uc-name').textContent = un.name; $('#uc-chapter').textContent = un.chapter;
    $('#uc-fill').style.width = pct + '%'; $('#uc-pct').textContent = pct + '%';
    $('#uc-step').textContent = `Tiến độ: Ải ${node} / ${NODES}`;
    $('#uc-lv').textContent = `Cap Lv. ${un.lv_max}`;
    $('#stage-name').textContent = un.name; $('#stage-sub').textContent = '| ' + un.chapter;
    $('#zone').textContent = un.name; $('#zone').title = un.name;
    $('#stage-label').textContent = un.chapter;
    renderTimeline(node);
    const row = (e, boss = false) => `<div class="spawn ${boss ? 'boss' : ''}"><div class="spawn-l"><span class="e">${sprite(e.image, ELEMENTS[e.element][2])}</span>
      <div><div class="spawn-n"><span>${e.name}</span>${boss ? '<span class="badge-boss">BOSS</span>' : ''}</div><div class="spawn-s">Hệ ${ELEMENTS[e.element][0]}</div></div></div>
      <div class="spawn-r">${boss ? 'Ải 30' : 'Thường'}<small>${boss ? 'Cực hiếm' : 'Xuất hiện'}</small></div></div>`;
    $('#uni-info').innerHTML = `<div class="sub-note">Khu vực chiến đấu tự động theo ải.</div>${un.enemies.map(e => row(e)).join('')}${row(un.boss, true)}
    <div class="tip"><span class="e"><i class="fa-solid fa-lightbulb"></i></span><span>Vật phẩm rơi: <strong>${un.drops.join(', ')}</strong></span></div>`;
  }
  function renderConsumables() {
    const box = $('#consumables'); box.innerHTML = '';
    S.consumables.forEach(c => {
      const b = document.createElement('div');
      b.className = 'item'; b.title = `${c.name}: ${c.desc} (dùng sẽ tốn 1 lượt)`;
      b.innerHTML = `<span class="e">${itemIcon(c.icon)}</span><span class="qty">x${c.quantity}</span>`;
      b.onclick = () => useItem(c); box.appendChild(b);
    });
    for (let i = S.consumables.length; i < 8; i++) box.insertAdjacentHTML('beforeend', '<div class="item empty">+</div>');
  }

  /* Đội hình + thẻ nhân vật đang ra sân */
  function mountAlly(f) {
    const b = document.createElement('button');
    b.className = 'slot';
    b.innerHTML = `<span class="slot-tag ${f.rarity === 'SSR' ? 'ssr' : ''}">${f.rarity === 'SSR' ? 'SSR' : 'Lv.' + f.level}</span>
    <span class="slot-ico">${sprite(f.image, eIco(f.element))}</span><div class="slot-hp"><i></i></div>`;
    b.title = `${f.name} (${ELEMENTS[f.element][0]})`;
    f.slot = b; f.el = $('#ally-stage'); $('#party').appendChild(b); bar(f);
  }
  function setFocus(f) {
    S.focus = f;
    S.allies.forEach(a => a.slot && a.slot.classList.toggle('active', a === f));
    $('#ally-name').textContent = f.name; $('#ally-lv').textContent = 'Lv.' + f.level;
    $('#ally-tag').textContent = f.rarity || ''; $('#ally-tag').className = 'mc-tag' + (f.rarity === 'SSR' ? ' ssr' : '');
    $('#ally-emoji').innerHTML = sprite(f.image, eIco(f.element));
    $('#ally-wrap').style.setProperty('--c', ELEMENTS[f.element][1]);
    renderFocus(true);
  }
  function renderFocus(instant = false) {
    const f = S.focus; if (!f) return;
    setBar($('#ally-hp'), Math.max(0, f.hp / f.maxhp * 100), instant);
    $('#ally-hptext').textContent = `${fmt(Math.ceil(f.hp))} / ${fmt(f.maxhp)} HP`;
    $('#ally-stage').classList.toggle('dead', f.hp <= 0);
    const capped = f.level >= S.universe.lv_max;
    $('#ally-exp').style.width = (capped ? 100 : Math.min(100, f.exp / f.exp_need * 100)) + '%';
    $('#ally-exptext').textContent = capped ? 'MAX (cap)' : `${fmt(f.exp)} / ${fmt(f.exp_need)}`;
    $('#ally-moves').innerHTML = f.moves.map(m => {
      const cd = f.cds[m.id] || 0;
      return `<span class="mv ${cd ? 'cd' : ''}" title="${m.name}: ${m.desc}">${m.element ? eIco(m.element) : ico('fa-wand-magic-sparkles')}${cd || ''}</span>`;
    }).join('');
  }

  /* Kẻ địch: chỉ dựng DOM cho con đang ra sân */
  function mountEnemy(f) {
    const d = document.createElement('div');
    d.className = `foe ${f.boss ? 'boss' : ''}`;
    d.innerHTML = `<div class="mon-card enemy ${f.boss ? 'boss' : ''}">
      <div class="mc-row"><span class="mc-name">${eIco(f.element)} ${f.name}</span><span class="pixel mc-lv">Lv.${f.level}</span></div>
      <div class="mc-hp"><b class="ghost"></b><div></div></div>
      <div class="mc-row mono"><span class="mc-tag">${f.boss ? 'BOSS' : ELEMENTS[f.element][0]}</span><span class="hp-text"></span></div></div>
    <div class="ev"><div class="mon">${sprite(f.image, enemyIcon(f))}</div><div class="shadow"></div></div>`;
    const box = $('#enemies'); box.innerHTML = ''; box.appendChild(d);
    f.el = d; bar(f, true);
  }
  function bar(f, instant = false) {
    const pct = Math.max(0, f.hp / f.maxhp * 100);
    if (f.side === 'ally') {
      const i = f.slot.querySelector('.slot-hp i');
      i.style.width = pct + '%'; i.className = hpClass(pct);
      f.slot.classList.toggle('dead', f.hp <= 0);
      if (f.hp <= 0) f.slot.querySelector('.slot-tag').textContent = 'KO';
      if (S.focus === f) renderFocus(instant);
    } else {
      if (!f.el) return;
      setBar(f.el.querySelector('.mc-hp div'), pct, instant);
      f.el.querySelector('.hp-text').textContent = `${fmt(Math.ceil(f.hp))} / ${fmt(f.maxhp)} HP`;
      renderFoeDots();
    }
  }
  function renderFoeDots() {
    $('#foe-dots').innerHTML = S.enemies.map(e => `<i class="${e.hp > 0 ? 'on' : ''} ${e === S.foe ? 'cur' : ''}"></i>`).join('');
  }
  function popup(f, text, cls = '', top = '0') {
    const p = document.createElement('div'); p.className = `dmg ${cls}`; p.textContent = text; p.style.top = top;
    f.el.appendChild(p); p.addEventListener('animationend', () => p.remove());
  }
  function updateBuff() {
    const c = $('#buff-chip'); c.hidden = S.buff.turns <= 0;
    c.querySelector('span').textContent = `+${Math.round((S.buff.mult - 1) * 100)}% công (${S.buff.turns} lượt)`;
  }

  /* ---------- State ---------- */
  function applyState(st, keepHp = false) {
    const old = Object.fromEntries(S.allies.map(a => [a.uid, a])), prevFocus = S.focus && S.focus.uid;
    S.user = st.user; S.universe = st.universe; S.consumables = st.consumables;
    S.allies = st.team.map(c => {
      const prev = old[c.uid], maxhp = c.hp;
      const hp = keepHp && prev
        ? (prev.hp <= 0 ? 0 : Math.min(maxhp, prev.hp + Math.max(0, maxhp - prev.maxhp)))
        : maxhp;
      return { ...c, id: 'a' + c.uid, side: 'ally', maxhp, hp, cds: {} };
    });
    $('#party').innerHTML = ''; S.allies.forEach(mountAlly);
    if (S.allies.length) setFocus(S.allies.find(a => a.uid === prevFocus) || S.allies[0]);
    renderHeader(); renderUniverse(); renderConsumables();
  }

  function spawnEnemies() {
    const un = S.universe, node = S.user.node, type = nodeType(node);
    const lvl = capAt(un, node);
    const f = 1 + 0.1 * (lvl - 1);
    const mk = (e, hpK = 1, atkK = 1, boss = false, tag = '') => ({
      id: 'e' + (++S.uid), side: 'enemy', name: e.name + tag, element: e.element,
      level: boss ? lvl + 2 : lvl, boss,
      maxhp: Math.round(FOE.hp * f * DIFF.hp * hpK),
      atk: Math.round(FOE.atk * f * DIFF.atk * atkK),
      def: Math.round(FOE.def * f * (boss ? 1.2 : 1)),
      spd: Math.round(FOE.spd * (boss ? 1.05 : 0.95)), cds: {}, image: e.image || null,
      moves: [{
        id: 'foe', name: boss ? 'Tuyệt Kỹ Hủy Diệt' : 'Đòn Hiểm', kind: 'damage', element: e.element,
        power: boss ? 1.9 : 1.6, cooldown: 3, target: 'single', desc: ''
      }],
    });
    const pick = i => un.enemies[i % un.enemies.length];
    let list;
    // Thứ tự ra sân: Boss luôn đứng cuối như trùm cuối
    if (type === 'boss') list = [mk(pick(0), 0.8), mk(pick(1), 0.8), mk(un.boss, DIFF.bossHp, DIFF.bossAtk, true)];
    else if (type === 'chest') list = [mk({ name: 'Rương Quỷ Dị', element: 'dark' }, 1.6, 1.2), mk(pick(0), 1)];
    else list = Array.from({ length: node < 5 ? 2 : 3 }, (_, i) => mk(pick(i + node), 1));
    list.forEach(f => f.hp = f.maxhp);
    S.enemies = list; S.foe = null;
    const label = type === 'boss' ? `Boss thế giới xuất hiện: ${un.boss.name}!` : type === 'chest' ? 'Một Rương Quỷ Dị chặn đường!' : `Ải ${node}: ${list.length} kẻ địch lần lượt ra trận.`;
    log(label, type === 'boss' ? 'big' : 'sys');
    if (type === 'boss') { shake(2.5); flash('#f43f5e', .3); }
    $('#stage-label').textContent = `${un.chapter} - Ải ${node}`;
  }

  /* =====================================================
     HIỆU ỨNG (FX)
     ===================================================== */
  const arenaEl = () => $('.arena');
  const fxLayer = () => {
    let l = arenaEl().querySelector('.fx-layer');
    if (!l) { l = document.createElement('div'); l.className = 'fx-layer'; arenaEl().appendChild(l); }
    return l;
  };
  function center(f) {
    const r = bodyEl(f).getBoundingClientRect(), a = arenaEl().getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
  }
  const fxColor = (mv, u) => ELEMENTS[mv.element || u.element][1];
  const fxIcon = (mv, u) => ELEMENTS[mv.element || u.element][2];

  function shake(power = 1) {
    if (REDUCED) return;
    const p = 5 * power, z = 1 + .012 * power;
    arenaEl().animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${-p}px,${p * .6}px) scale(${z})` },
      { transform: `translate(${p}px,${-p * .6}px) scale(${z})` },
      { transform: `translate(${-p * .6}px,${p * .4}px) scale(${1 + (z - 1) / 2})` },
      { transform: `translate(${p * .4}px,${-p * .2}px) scale(1)` },
      { transform: 'translate(0,0) scale(1)' }
    ], { duration: Math.max(160, 340 / S.speed), easing: 'ease-out' });
  }
  function flash(col, a = .3) {
    if (REDUCED) return;
    const f = document.createElement('div'); f.className = 'fx-flash'; f.style.setProperty('--c', col);
    fxLayer().appendChild(f);
    f.animate([{ opacity: a }, { opacity: 0 }], { duration: 380 / S.speed + 80 }).onfinish = () => f.remove();
  }
  function ring(t, col, big) {
    if (REDUCED) return;
    const c = center(t), r = document.createElement('div');
    r.className = 'fx-ring'; r.style.cssText = `--c:${col};--s:${big ? 9 : 6};left:${c.x}px;top:${c.y}px;animation-duration:${.5 / S.speed}s`;
    fxLayer().appendChild(r); r.addEventListener('animationend', () => r.remove());
  }
  function burst(t, col, n) {
    if (REDUCED) return;
    const c = center(t), layer = fxLayer();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div'); s.className = 'fx-spark';
      s.style.cssText = `--c:${col};left:${c.x}px;top:${c.y}px`;
      layer.appendChild(s);
      const ang = rand(0, Math.PI * 2), d = rand(35, 95);
      s.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 },
                 { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(.2)`, opacity: 0 }],
                { duration: rand(350, 600) / S.speed, easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => s.remove();
    }
  }
  function impact(t, mv, u, big) {
    const col = fxColor(mv, u);
    ring(t, col, big); burst(t, col, big ? 14 : 7);
  }
  // Vệt chém cho đòn đánh thường (chí mạng chém chữ X)
  function slash(t, col, cross) {
    if (REDUCED) return;
    const c = center(t), layer = fxLayer();
    (cross ? [-35, 35] : [-35]).forEach((deg, i) => {
      const s = document.createElement('div'); s.className = 'fx-slash';
      s.style.cssText = `--c:${col};left:${c.x}px;top:${c.y}px`;
      layer.appendChild(s);
      s.animate([
        { transform: `rotate(${deg}deg) scaleX(0)`, opacity: 1 },
        { transform: `rotate(${deg}deg) scaleX(1.3)`, opacity: 1, offset: .45 },
        { transform: `rotate(${deg}deg) scaleX(1.3)`, opacity: 0 }
      ], { duration: 300 / S.speed, delay: i * 70 / S.speed, fill: 'backwards' }).onfinish = () => s.remove();
    });
  }
  // Banner tên chiêu
  function banner(u, mv, col) {
    if (REDUCED) return;
    const b = document.createElement('div'); b.className = 'fx-banner ' + u.side; b.style.setProperty('--c', col);
    b.innerHTML = `<i class="fa-solid ${fxIcon(mv, u)}"></i>${mv.name}`;
    fxLayer().appendChild(b);
    b.animate([
      { opacity: 0, transform: 'translateY(12px) scale(.9)' },
      { opacity: 1, transform: 'none', offset: .2 },
      { opacity: 1, transform: 'none', offset: .8 },
      { opacity: 0, transform: 'translateY(-8px)' }
    ], { duration: 950 / S.speed }).onfinish = () => b.remove();
  }
  function trail(layer, x, y, col, dur) {
    const d = document.createElement('div'); d.className = 'fx-trail';
    d.style.cssText = `--c:${col};left:${x}px;top:${y}px;animation-duration:${Math.max(.15, dur / 1000 * .9)}s`;
    layer.appendChild(d); d.addEventListener('animationend', () => d.remove());
  }
  async function fireProjectile(from, to, o = {}) {
    if (o.delay) await sleep(o.delay / S.speed);
    const layer = fxLayer(), a = center(from), b = center(to), col = o.color;
    const el = document.createElement('div');
    el.className = 'fx-proj ' + (o.size || ''); el.style.setProperty('--c', col);
    el.innerHTML = `<i class="fa-solid ${o.icon}"></i>`;
    layer.appendChild(el);
    const dist = Math.hypot(b.x - a.x, b.y - a.y), arc = Math.min(90, dist * .22);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - arc;
    const dur = (o.dur || 380) / S.speed, t0 = performance.now();
    let last = 0;
    await new Promise(res => {
      const step = now => {
        const p = Math.min(1, (now - t0) / dur), e = Math.pow(p, 1.6), q = 1 - e;
        const x = q * q * a.x + 2 * q * e * cx + e * e * b.x, y = q * q * a.y + 2 * q * e * cy + e * e * b.y;
        el.style.transform = `translate(${x}px,${y}px) rotate(${o.spin ? p * 720 : 0}deg) scale(${.5 + .5 * Math.min(1, p * 6)})`;
        if (now - last > 28) { last = now; trail(layer, x, y, col, dur); }
        p < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
    el.remove();
  }
  async function bolt(from, to, col) {
    const a = center(from), b = center(to), n = 8, pts = [[a.x, a.y]];
    for (let i = 1; i < n; i++) { const k = i / n; pts.push([a.x + (b.x - a.x) * k + rand(-22, 22), a.y + (b.y - a.y) * k + rand(-22, 22)]); }
    pts.push([b.x, b.y]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fx-bolt'); svg.style.setProperty('--c', col);
    svg.innerHTML = `<polyline points="${pts.map(p => p.join(',')).join(' ')}"/>`;
    fxLayer().appendChild(svg);
    svg.animate([{ opacity: 1 }, { opacity: .25 }, { opacity: 1 }, { opacity: 0 }], { duration: 220 / S.speed });
    await sleep(220 / S.speed);
    svg.remove();
  }
  function volley(u, mv, t) {
    if (REDUCED) return Promise.resolve();
    if (mv.element === 'thunder') return bolt(u, t, fxColor(mv, u));
    return fireProjectile(u, t, {
      color: fxColor(mv, u), icon: fxIcon(mv, u), spin: mv.element === 'wind',
      size: mv.power >= 1.6 ? 'big' : '', dur: 380
    });
  }

  /* ---- Animation thân nhân vật ---- */
  // Lao vào đối thủ rồi lùi về (đòn cận chiến). Trả về Promise kết thúc cả chuyển động.
  function lunge(u, t, dur) {
    const a = center(u), b = center(t), dx = (b.x - a.x) * .68, dy = (b.y - a.y) * .68;
    return play(bodyEl(u), [
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${-dx * .12}px,${-dy * .12}px) scale(.94)`, offset: .25 },
      { transform: `translate(${dx}px,${dy}px) scale(1.1)`, offset: .5 },
      { transform: 'translate(0,0) scale(1)' }
    ], { duration: dur, easing: 'ease-in-out' });
  }
  // Tụ lực trước khi bắn chiêu
  function castPose(u, col) {
    ring(u, col);
    return play(bodyEl(u), [
      { transform: 'scale(1) translateY(0)', filter: 'brightness(1)' },
      { transform: 'scale(1.12) translateY(-10px)', filter: `brightness(1.6) drop-shadow(0 0 18px ${col})` },
      { transform: 'scale(1) translateY(0)', filter: 'brightness(1)' }
    ], { duration: 380 / S.speed, easing: 'ease-out' });
  }
  // Bị đánh: nháy trắng + văng ra sau
  function hitReact(t, strong) {
    const k = (t.side === 'ally' ? -1 : 1) * (strong ? 20 : 12);
    return play(bodyEl(t), [
      { transform: 'translateX(0)', filter: 'brightness(1)' },
      { transform: `translateX(${k}px)`, filter: 'brightness(3) saturate(0)', offset: .2 },
      { transform: `translateX(${-k * .3}px)`, filter: 'brightness(1.4)', offset: .55 },
      { transform: 'translateX(0)', filter: 'brightness(1)' }
    ], { duration: 420 / S.speed, easing: 'ease-out' });
  }
  // Ra sân: phát sáng, phóng to từ điểm nhỏ
  async function summon(f) {
    const b = bodyEl(f), col = ELEMENTS[f.element][1];
    b.getAnimations().forEach(a => a.cancel()); b.style.visibility = '';
    ring(f, col, true); burst(f, col, 10);
    const card = f.side === 'ally' ? $('#ally-card') : f.el.querySelector('.mon-card');
    play(card, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400 / S.speed });
    await play(b, [
      { transform: 'scale(.1)', opacity: 0, filter: 'brightness(4)' },
      { transform: 'scale(1.2)', opacity: 1, filter: `brightness(2) drop-shadow(0 0 22px ${col})`, offset: .6 },
      { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }
    ], { duration: 560 / S.speed, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  // Rút về: thu nhỏ thành tia sáng
  async function recall(f) {
    const b = bodyEl(f), col = ELEMENTS[f.element][1];
    ring(f, col);
    await play(b, [
      { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' },
      { transform: 'scale(.1)', opacity: 0, filter: `brightness(4) drop-shadow(0 0 20px ${col})` }
    ], { duration: 400 / S.speed, easing: 'ease-in', fill: 'forwards' });
    b.style.visibility = 'hidden';
  }
  // Gục ngã: rơi xuống, xám dần, tan biến
  async function faint(f) {
    const b = bodyEl(f);
    burst(f, '#94a3b8', 12);
    await play(b, [
      { transform: 'translateY(0) scaleY(1)', opacity: 1, filter: 'grayscale(0) brightness(1)' },
      { transform: 'translateY(34px) scaleY(.55)', opacity: 0, filter: 'grayscale(1) brightness(.5)' }
    ], { duration: 650 / S.speed, easing: 'ease-in', fill: 'forwards' });
    b.style.visibility = 'hidden';
  }

  /* =====================================================
     LUẬT CHIẾN ĐẤU: 1v1 theo lượt, tự động
     =====================================================
     - Mỗi lượt cả hai bên chọn 1 hành động: Dùng chiêu / Đổi người / Dùng vật phẩm.
     - Đổi người & vật phẩm luôn ra tay trước đòn tấn công; còn lại ai SPD cao hơn đánh trước.
     - Đổi người tốn 1 lượt (người mới sẽ hứng đòn của đối thủ).
     - Ai gục thì bên đó tự chọn người thay thế vào cuối lượt (không tốn lượt).
     ===================================================== */
  function calc(u, t, mv, expected) {
    const atk = u.atk * (u.side === 'ally' ? S.buff.mult : 1);
    const em = elemMult(mv.element, t.element);
    let d = atk * mv.power * 100 / (100 + t.def) * em, crit = false;
    if (!expected) { d *= rand(.9, 1.1); if (Math.random() < .15) { d *= 1.5; crit = true; } }
    return { dmg: Math.max(1, Math.round(d)), crit, em };
  }
  // Điểm tương quan: >1 nghĩa là u thắng thế trước foe (số lượt u trụ được / số lượt u hạ foe)
  function matchup(u, foe) {
    const dmgMoves = a => [BASIC, ...a.moves.filter(m => m.kind !== 'heal')];
    const out = Math.max(...dmgMoves(u).map(m => calc(u, foe, m, true).dmg));
    const inn = Math.max(...dmgMoves(foe).map(m => calc(foe, u, m, true).dmg));
    return (u.hp / inn) / (foe.hp / out) * (u.spd >= foe.spd ? 1.1 : 1);
  }
  function pickMove(u, foe, team) {
    let best = null;
    for (const mv of [BASIC, ...u.moves.filter(m => !(u.cds[m.id] > 0))]) {
      let score;
      if (mv.kind === 'heal') {
        const ts = mv.target === 'ally_all' ? alive(team) : [u];
        if (!ts.some(a => a.hp < a.maxhp * .6)) continue;
        score = ts.reduce((s, a) => s + Math.min(a.maxhp - a.hp, a.maxhp * mv.value), 0) * 1.2;
      } else {
        const d = calc(u, foe, mv, true).dmg;
        score = (d + (d >= foe.hp ? foe.maxhp * .5 : 0)) * (mv === BASIC ? 1 : 1.05);
      }
      if (!best || score > best.score) best = { mv, score };
    }
    return best.mv;
  }
  function bestReplacement(team, opp) {
    return alive(team).reduce((a, b) => matchup(a, opp) >= matchup(b, opp) ? a : b);
  }
  // AI chọn hành động cho 1 bên
  function decide(u, foe, team, side) {
    const bench = alive(team).filter(x => x !== u);
    if (bench.length && S.swCd[side] <= 0) {
      const cur = matchup(u, foe), cand = bestReplacement(bench, foe), m = matchup(cand, foe);
      // Đổi khi đang yếu thế rõ rệt và người thay thế tốt hơn hẳn
      if (cur < .75 && m > 1 && m > cur * 1.6 && cand.hp / cand.maxhp > .4) return { type: 'switch', to: cand };
    }
    return { type: 'move', mv: pickMove(u, foe, team) };
  }

  async function sendOut(f) {
    if (f.side === 'ally') setFocus(f);
    else { S.foe = f; mountEnemy(f); $('#foe-name').textContent = f.name; }
    renderFoeDots();
    log(f.side === 'ally' ? `Xuất trận: ${nameTag(f)}!` : `Địch tung ra ${nameTag(f)}!`, 'sys');
    await summon(f);
  }
  async function doSwitch(side, to) {
    const cur = side === 'ally' ? S.focus : S.foe;
    log(side === 'ally' ? `Đổi người! ${nameTag(cur)}, quay về!` : `Địch triệu hồi ${nameTag(cur)} về!`, 'sys');
    S.swCd[side] = SWITCH_COOLDOWN;
    await recall(cur);
    await sendOut(to);
  }

  async function resolveHit(u, t, mv, heavy, melee) {
    const col = fxColor(mv, u), r = calc(u, t, mv, false);
    t.hp = Math.max(0, t.hp - r.dmg); bar(t);
    hitReact(t, r.crit || heavy);
    popup(t, '-' + fmt(r.dmg) + (r.crit ? ' CRIT!' : ''), r.crit ? 'crit' : r.em < 1 ? 'weak' : '');
    if (r.em > 1) popup(t, 'Khắc hệ!', 'crit', '-26px');
    else if (r.em < 1) popup(t, 'Bị kháng', 'weak', '-26px');
    if (melee) slash(t, col, r.crit);
    impact(t, mv, u, r.crit || t.hp <= 0);
    shake(t.hp <= 0 ? 2.2 : r.crit ? 2 : heavy ? 1.4 : .6);
    if (r.crit || heavy) flash(col, .26);
    const em = r.em > 1 ? ' (khắc hệ)' : r.em < 1 ? ' (bị kháng)' : '';
    log(`${nameTag(u)} ${mv !== BASIC ? `sử dụng <b>${mv.name}</b>!` : 'tấn công'} ${nameTag(t)} nhận <b>${fmt(r.dmg)}</b> sát thương${r.crit ? ' chí mạng' : ''}${em}.`, r.crit ? 'crit' : '');
    await sleep(300 / S.speed);
    if (t.hp <= 0) { log(`${nameTag(t)} đã bị đánh bại.`, 'sys'); await faint(t); }
  }

  async function execMove(u, mv) {
    const t = u.side === 'ally' ? S.foe : S.focus;
    if (mv.cooldown) u.cds[mv.id] = mv.cooldown;
    if (u.side === 'ally') renderFocus();
    const col = fxColor(mv, u);
    if (mv !== BASIC) banner(u, mv, col);

    if (mv.kind === 'heal') {
      await castPose(u, '#34d399');
      const team = u.side === 'ally' ? S.allies : S.enemies;
      const ts = mv.target === 'ally_all' ? alive(team) : [u];
      for (const x of ts) {
        const h = Math.min(x.maxhp - x.hp, Math.round(x.maxhp * mv.value));
        x.hp += h; bar(x);
        if (x === u) { popup(x, '+' + fmt(h), 'heal'); ring(x, '#34d399'); }
        log(`${nameTag(u)} dùng <b>${mv.name}</b>, ${nameTag(x)} hồi <b>${fmt(h)}</b> HP.`, 'reward');
      }
      await sleep(250 / S.speed);
      return;
    }
    const heavy = mv.power >= 1.6 || mv.element === 'earth';
    if (mv === BASIC) {
      const dur = 540 / S.speed, p = lunge(u, t, dur);
      await sleep(dur * .5);               // chạm đối thủ ở giữa chuyển động
      await resolveHit(u, t, mv, heavy, true);
      await p;
    } else {
      await castPose(u, col);
      await volley(u, mv, t);
      await resolveHit(u, t, mv, heavy, false);
    }
  }

  /* ---------- Vật phẩm: tốn 1 lượt ---------- */
  async function useQueuedItem() {
    const c = S.pending; S.pending = null;
    try {
      const r = await api('/api/item/use', { item_id: c.item_id });
      c.quantity = r.quantity; S.consumables = S.consumables.filter(x => x.quantity > 0); renderConsumables();
      if (r.effect_type === 'heal_pct') alive(S.allies).forEach(f => { const h = Math.min(f.maxhp - f.hp, Math.round(f.maxhp * r.effect_value)); f.hp += h; bar(f); if (f === S.focus) popup(f, '+' + h, 'heal'); });
      else if (r.effect_type === 'revive') S.allies.filter(f => f.hp <= 0).forEach(f => { f.hp = Math.round(f.maxhp * r.effect_value); f.slot.querySelector('.slot-tag').textContent = f.rarity === 'SSR' ? 'SSR' : 'Lv.' + f.level; bar(f); });
      else if (r.effect_type === 'buff_atk') { S.buff = { turns: 5, mult: 1 + r.effect_value }; updateBuff(); }
      log(`Bạn dùng <b>${r.name}</b>.`, 'reward');
      await castPose(S.focus, r.effect_type === 'buff_atk' ? '#fbbf24' : '#34d399');
    } catch (e) { toast(e.message); }
  }
  function useItem(c) {
    if (S.pending) return toast('Đã có vật phẩm đang chờ dùng.');
    if (c.effect_type === 'revive' && !S.allies.some(f => f.hp <= 0)) return toast('Không có ai cần hồi sinh.');
    S.pending = c;
    toast(`Sẽ dùng ${c.name} ở lượt tới (tốn 1 lượt).`);
    log(`Chuẩn bị dùng <b>${c.name}</b> ở lượt tới.`, 'sys');
  }

  /* ---------- Vòng lặp trận ---------- */
  async function fight() {
    spawnEnemies();
    S.swCd = { ally: 0, enemy: 0 };
    await sleep(400 / S.speed);
    await Promise.all([sendOut(S.allies.find(a => a.hp > 0)), sendOut(S.enemies[0])]);
    let round = 0;
    for (; ;) {
      if (++round > 80) return 'lose';
      $('#turn-chip').textContent = `Lượt ${round}`;
      [S.focus, S.foe].forEach(u => { for (const k in u.cds) if (u.cds[k] > 0) u.cds[k]--; });
      renderFocus();

      const A = S.focus, E = S.foe;
      const plan = [
        S.pending ? { side: 'ally', type: 'item' } : { side: 'ally', ...decide(A, E, S.allies, 'ally') },
        { side: 'enemy', ...decide(E, A, S.enemies, 'enemy') },
      ];
      const prio = p => p.type === 'move' ? 0 : 1;
      const spdOf = p => p.side === 'ally' ? A.spd : E.spd;
      plan.sort((x, y) => prio(y) - prio(x) || spdOf(y) - spdOf(x) || Math.random() - .5);

      for (const p of plan) {
        if (!alive(S.allies).length || !alive(S.enemies).length) break;
        const u = p.side === 'ally' ? S.focus : S.foe;
        if (u.hp <= 0) continue;                  // đã gục trước khi kịp ra đòn
        if (p.type === 'switch') await doSwitch(p.side, p.to);
        else if (p.type === 'item') await useQueuedItem();
        else await execMove(u, p.mv);
        await sleep(250 / S.speed);
      }

      if (!alive(S.enemies).length) return 'win';
      if (!alive(S.allies).length) return 'lose';

      // Cuối lượt: bên nào gục thì chọn người thay (không tốn lượt)
      if (S.focus.hp <= 0) await sendOut(bestReplacement(S.allies, S.foe));
      if (S.foe.hp <= 0) await sendOut(bestReplacement(S.enemies, S.focus));
      for (const k of ['ally', 'enemy']) if (S.swCd[k] > 0) S.swCd[k]--;
      if (S.buff.turns > 0 && --S.buff.turns === 0) { S.buff.mult = 1; log('Hiệu ứng cuồng nộ đã hết.', 'sys'); }
      updateBuff();
      await sleep(200 / S.speed);
    }
  }

  /* ---------- Rewards & main loop ---------- */
  async function claim() {
    try {
      const r = await api('/api/battle/reward', {
        universe_id: S.user.universe_id, node: S.user.node, victory: true,
        alive: alive(S.allies).map(a => a.uid)
      });
      const w = r.rewards, parts = [`+${fmt(w.coins)} Vàng`, `+${w.exp} EXP`];
      if (w.crystals) parts.push(`+${w.crystals} Tinh thể`);
      if (w.tickets) parts.push(`+${w.tickets} Vé triệu hồi`);
      if (w.drops.length) parts.push(`Nhận: ${w.drops.join(', ')}`);
      log(`Chiến thắng! ${parts.join(' | ')}`, 'reward');
      $('#ticker').textContent = `Chiến thắng ải ${S.user.node}! ${parts.join(' | ')}`;
      w.level_ups.forEach(n => log(`${n} đã lên cấp!`, 'big'));
      if (w.capped) log(`Đội đã đạt giới hạn cấp ${S.universe.lv_max}. Hãy hạ Boss ải 30 để mở rộng giới hạn!`, 'big');
      if (w.unlocked) { log('Cổng không gian mới đã mở: bạn bước sang vũ trụ tiếp theo!', 'big'); toast('Mở khóa vũ trụ mới'); }
      applyState(r.state, true);
      flash('#fbbf24', .22);
      if (w.level_ups.length && S.focus) popup(S.focus, 'LEVEL UP!', 'crit');
      return true;
    } catch (e) {
      toast(e.message); log(`Không nhận được thưởng: ${e.message}`, 'sys');
      applyState(await api('/api/state'), true);
      return false;
    }
  }
  async function defeat() {
    const from = S.user.node;
    try {
      const r = await api('/api/battle/defeat', { universe_id: S.user.universe_id, node: from });
      log(from > 1
        ? `Đội hình bị đánh bại ở ải ${from}. Cổng không gian đưa cả đội về đầu chương để cày thêm.`
        : 'Đội hình bị đánh bại. Cổng không gian hồi sinh toàn đội, thử lại.', 'sys');
      if (from > 1) toast('Quay về ải 1 để cày level');
      applyState(r.state);
      flash('#f43f5e', .3); shake(1.6);
    } catch (e) {
      toast(e.message);
      applyState(await api('/api/state'));
    }
  }
  async function restStop(cleared) {
    if (cleared % REST_EVERY !== 0) return;
    log(`<i class="fa-solid fa-campground"></i> Trạm hồi phục: cả đội được hồi đầy máu và hồi sinh sau ải ${cleared}.`, 'reward');
    toast('Trạm hồi phục');
    await sleep(700 / S.speed);
    S.allies.forEach(f => {
      f.hp = f.maxhp; f.cds = {};
      f.slot.querySelector('.slot-tag').textContent = f.rarity === 'SSR' ? 'SSR' : 'Lv.' + f.level;
      bar(f);
    });
    if (S.focus) popup(S.focus, 'Hồi phục', 'heal');
  }
  async function mainLoop() {
    for (; ;) {
      const cleared = S.user.node;
      const res = await fight();
      if (res === 'win') { if (await claim()) await restStop(cleared); }
      else await defeat();
      await sleep(900 / S.speed);
    }
  }

  /* ---------- Init ---------- */
  function setSpeed(n) {
    S.speed = n; document.documentElement.style.setProperty('--spd', n);
    document.querySelectorAll('.speed button').forEach(b => b.classList.toggle('active', +b.dataset.speed === n));
    try { localStorage.setItem('am_speed', n); } catch (_) { }
  }
  function tickClock() { const d = new Date(); $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function bindUI() {
    document.querySelectorAll('.speed button').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
    document.querySelectorAll('[data-phase]').forEach(b => b.onclick = e => { e.preventDefault(); toast(`"${b.dataset.label}" sẽ mở ở Giai đoạn ${b.dataset.phase}.`); });
    document.querySelectorAll('.nav-item:not([data-phase])').forEach(a => a.onclick = e => e.preventDefault());
    $('#btn-save').onclick = async () => { try { await api('/api/save', {}); toast('Đã lưu game.'); } catch (e) { toast(e.message); } };
    $('#btn-settings').onclick = () => toast('Cài đặt đang được phát triển.');
    $('#btn-donate').onclick = () => toast('Cảm ơn bạn đã ủng hộ!');
    $('#btn-time').onclick = e => {
      const night = !e.currentTarget.querySelector('.fa-moon');
      const cls = night ? 'fa-moon' : 'fa-sun';
      e.currentTarget.innerHTML = `<i class="fa-solid ${cls}"></i>`;
      const c = $('#clock-ic'); if (c) c.className = `fa-solid ${cls} amber-l`;
    };
    tickClock(); setInterval(tickClock, 30000);
    setInterval(() => { $('#online-count').textContent = fmt(1193 + Math.round(rand(-40, 40))); }, 8000);
  }
  (async function boot() {
    bindUI();
    $('#ally-hp').insertAdjacentHTML('beforebegin', '<b class="ghost"></b>');   // vệt máu cho thẻ phe ta
    let sp = 1; try { sp = +localStorage.getItem('am_speed') || 1; } catch (_) { }
    setSpeed(sp);
    applyState(await api('/api/state'));
    log('Cổng không gian đã mở. Đội hình tự động chiến đấu theo lượt.', 'sys');
    mainLoop();
  })();
})();