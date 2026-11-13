(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const fmt = n => Number(n).toLocaleString('vi-VN');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const IMG_DIR = '/static/img_char/';
  const MAX_MOVES = 4;
  const RK = { SSR: 3, SR: 2, R: 1 };
  const ELEMENTS = {
    fire: ['Hỏa', '#ff6b3d', 'fa-fire'], water: ['Thủy', '#3d9bff', 'fa-droplet'], wind: ['Phong', '#5fe0b0', 'fa-wind'], earth: ['Thổ', '#c49a5a', 'fa-mountain'],
    thunder: ['Lôi', '#ffd93d', 'fa-bolt'], light: ['Quang', '#fff2b8', 'fa-sun'], dark: ['Ám', '#9d6bff', 'fa-moon'],
  };
  const STATS = [['hp', 'HP', 'fa-heart', '#34d399'], ['atk', 'Công', 'fa-khanda', '#fb7185'],
                 ['def', 'Thủ', 'fa-shield-halved', '#60a5fa'], ['spd', 'Tốc độ', 'fa-wind', '#fbbf24']];

  const S = {
    chars: [], byId: new Map(), team: [], max: 6, ref: {}, cap: 1,
    q: '', el: '', rar: '', sort: 'level', hideTeam: false,
    open: null, edit: false, draft: [], sel: null, replace: false, drag: null,
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
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Helpers hiển thị ---------- */
  const fallback = c => `<i class="fa-solid ${ELEMENTS[c.element][2]}" style="color:${ELEMENTS[c.element][1]}"></i>`;
  const sprite = c => c.image
    ? `<img class="char-img" src="${IMG_DIR}${esc(c.image)}" alt="" draggable="false" data-fb="${esc(fallback(c))}" onerror="this.outerHTML=this.dataset.fb">`
    : fallback(c);
  const elChip = el => {
    if (!el) return '<span class="tm-chip" style="--c:#94a3b8">Vô hệ</span>';
    const [n, col, ic] = ELEMENTS[el];
    return `<span class="tm-chip" style="--c:${col}"><i class="fa-solid ${ic}"></i>${n}</span>`;
  };
  const expPct = c => c.level >= S.cap ? 100 : Math.min(100, c.exp / c.exp_need * 100);

  /* ---------- Dữ liệu ---------- */
  async function load() {
    const r = await api('/api/roster');
    S.chars = r.characters; S.byId = new Map(S.chars.map(c => [c.uid, c]));
    S.max = r.max_team; S.ref = r.ref; S.cap = r.cap;
    S.team = S.chars.filter(c => c.slot !== null).sort((a, b) => a.slot - b.slot).map(c => c.uid);
  }
  function applyTeam(t) {
    S.team = t;
    S.chars.forEach(c => { const i = t.indexOf(c.uid); c.slot = i >= 0 ? i : null; });
  }
  async function commitTeam(t) {
    if (!t.length) return toast('Đội hình cần ít nhất 1 tướng.');
    const prev = S.team.slice();
    applyTeam(t); renderAll();
    try { await api('/api/team', { team: t }); toast('Đã cập nhật đội hình.'); }
    catch (e) { applyTeam(prev); renderAll(); toast(e.message); }
  }
  // Đặt tướng vào ô i: ô trống -> thêm cuối; ô có người -> hoán đổi (nếu đã trong đội) hoặc thay thế
  function placeAt(uid, i) {
    const t = S.team.slice(), from = t.indexOf(uid);
    if (i >= t.length) { if (from >= 0) t.splice(from, 1); t.push(uid); }
    else if (from >= 0) { [t[from], t[i]] = [t[i], t[from]]; }
    else t[i] = uid;
    return commitTeam(t);
  }
  function removeFromTeam(uid) {
    if (S.team.length <= 1) return toast('Đội hình cần ít nhất 1 tướng.');
    return commitTeam(S.team.filter(x => x !== uid));
  }
  async function saveMoves(ids) {
    const c = S.byId.get(S.open);
    try {
      const r = await api(`/api/character/${c.uid}/moves`, { moves: ids });
      Object.assign(c, r.character);
      S.edit = false; S.sel = null;
      toast(ids.length ? 'Đã lưu chiêu thức.' : 'Đã chuyển về chiêu tự động.');
      renderAll();
    } catch (e) { toast(e.message); }
  }

  /* ---------- Render: đội hình ---------- */
  function slotHTML(c, i) {
    const col = ELEMENTS[c.element][1];
    return `<div class="tm-slot-top">
        <div class="tm-slot-l"><span class="tm-no-b">#${i + 1}</span>${i === 0 ? '<span class="tm-lead"><i class="fa-solid fa-flag"></i> Tiên phong</span>' : ''}</div>
        <span class="tm-rar ${c.rarity}">${c.rarity}</span>
      </div>
      ${elChip(c.element)}
      <div class="tm-orb" style="--c:${col}">${sprite(c)}</div>
      <div class="tm-name">${esc(c.name)}</div>
      <div class="tm-sub2">Lv.${c.level} • ${esc(c.moves[0] ? c.moves[0].name : 'Đánh thường')}</div>
      <div class="tm-bar-h"><span>EXP</span><b>${Math.round(expPct(c))}%</b></div>
      <div class="tm-mini-bar"><i style="width:${expPct(c)}%"></i></div>`;
  }
  function renderTeam() {
    const box = $('#tm-slots'); box.innerHTML = '';
    box.classList.toggle('no-anim', !!S.animated);
    for (let i = 0; i < S.max; i++) {
      const c = S.byId.get(S.team[i]), d = document.createElement('div');
      d.dataset.i = i; d.style.setProperty('--i', i);
      if (c) {
        d.className = 'tm-slot r-' + c.rarity + (i === 0 ? ' lead' : '');
        d.dataset.uid = c.uid; d.draggable = true; d.innerHTML = slotHTML(c, i);
      } else {
        d.className = 'tm-slot empty';
        d.innerHTML = `<span class="tm-slot-no pixel">#${i + 1}</span><i class="fa-solid fa-plus"></i><span>Ô trống</span>`;
      }
      box.appendChild(d);
    }
    $('#tm-count').textContent = `${S.team.length} / ${S.max}`;
    const lv = S.team.map(u => S.byId.get(u).level);
    $('#tm-avg').textContent = lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length) : 0;
  }

  /* ---------- Render: kho ---------- */
  function viewList() {
    let l = S.chars.filter(c =>
      (!S.q || norm(c.name + ' ' + c.universe).includes(S.q)) &&
      (!S.el || c.element === S.el) && (!S.rar || c.rarity === S.rar) &&
      (!S.hideTeam || c.slot === null));
    const by = {
      level: (a, b) => b.level - a.level || RK[b.rarity] - RK[a.rarity],
      rarity: (a, b) => RK[b.rarity] - RK[a.rarity] || b.level - a.level,
      atk: (a, b) => b.atk - a.atk, hp: (a, b) => b.hp - a.hp, spd: (a, b) => b.spd - a.spd,
      name: (a, b) => a.name.localeCompare(b.name, 'vi'),
    };
    return l.sort(by[S.sort]);
  }
  function cardHTML(c, i) {
    return `<div class="tm-card r-${c.rarity} ${c.slot !== null ? 'in-team' : ''}" data-uid="${c.uid}" draggable="true" style="--c:${ELEMENTS[c.element][1]};--i:${Math.min(i, 24)}" title="${esc(c.name)}">
      <div class="tm-card-top"><span class="tm-rar ${c.rarity}">${c.rarity}</span>${c.slot !== null ? `<span class="tm-pos">#${c.slot + 1}</span>` : ''}</div>
      <div class="tm-card-sp">${sprite(c)}</div>
      <div class="tm-card-n">${esc(c.name)}</div>
      <div class="tm-card-lv pixel">Lv.${c.level}</div></div>`;
  }
  function renderGrid() {
    const l = viewList();
    $('#tm-grid').classList.toggle('no-anim', !!S.animated);
    $('#tm-grid').innerHTML = l.length ? l.map(cardHTML).join('') : '<div class="tm-empty">Không có tướng nào phù hợp bộ lọc.</div>';
    $('#tm-total').textContent = `${l.length} / ${S.chars.length}`;
  }
  function renderAll() { renderTeam(); renderGrid(); if (S.open != null) renderModal(); }

  /* ---------- Pop-up ---------- */
  function moveBody(m, i) {
    const pw = m.kind === 'heal' ? `Hồi ${Math.round(m.value * 100)}%` : Math.round(m.power * 100);
    return `<div class="mv-top"><span class="mv-no">#${i + 1}</span><b class="mv-name">${esc(m.name)}</b><span class="mv-pw">${pw}</span></div>
      <div class="mv-bot">${elChip(m.element)}<span class="mv-meta">${m.kind === 'heal' ? 'Hồi máu' : 'Sát thương'} · Hồi chiêu ${m.cooldown}</span></div>`;
  }
  function movesHTML(c) {
    const ids = S.edit ? S.draft : c.equipped, find = id => c.learnset.find(m => m.id === id);
    let slots = '';
    for (let i = 0; i < MAX_MOVES; i++) {
      const m = ids[i] != null ? find(ids[i]) : null;
      if (!m) { slots += '<div class="mv-slot empty">Ô trống</div>'; continue; }
      const col = m.element ? ELEMENTS[m.element][1] : '#94a3b8';
      slots += `<div class="mv-slot ${S.edit ? 'editing' : ''} ${S.edit && S.sel === i ? 'sel' : ''}" style="--c:${col}" ${S.edit ? `data-act="slot" data-i="${i}"` : ''} title="${esc(m.desc)}">
        ${moveBody(m, i)}${S.edit ? `<button class="mv-x" data-act="rm" data-i="${i}" title="Gỡ chiêu"><i class="fa-solid fa-xmark"></i></button>` : ''}</div>`;
    }
    let pick = '';
    if (S.edit) {
      const opts = c.learnset.slice().sort((a, b) => a.learn_level - b.learn_level).map(m => {
        const col = m.element ? ELEMENTS[m.element][1] : '#94a3b8', on = S.draft.includes(m.id);
        const tail = !m.learned ? `<span class="mv-lock"><i class="fa-solid fa-lock"></i> Lv.${m.learn_level}</span>`
          : on ? '<span class="mv-chk"><i class="fa-solid fa-check"></i> Đang dùng</span>' : '';
        return `<button class="mv-opt ${on ? 'on' : ''} ${m.learned ? '' : 'locked'}" style="--c:${col}" data-act="opt" data-id="${m.id}">
          <div class="mv-top"><b class="mv-name">${esc(m.name)}</b>
            <span class="mv-pw">${m.kind === 'heal' ? 'Hồi ' + Math.round(m.value * 100) + '%' : Math.round(m.power * 100)}</span></div>
          <div class="mv-bot">${elChip(m.element)}<span class="mv-meta">Hồi chiêu ${m.cooldown}</span>${tail}</div>
          <div class="mv-desc">${esc(m.desc)}</div></button>`;
      }).join('');
      pick = `<div class="mv-pick"><div class="mv-pick-h">Bấm chiêu để trang bị / gỡ. Khi đã đủ ${MAX_MOVES} chiêu: chọn ô cần thay ở trên rồi bấm chiêu mới.</div><div class="mv-grid">${opts}</div></div>`;
    }
    const n = ids.length;
    const head = S.edit
      ? `<button class="tm-btn" data-act="auto"><i class="fa-solid fa-rotate"></i> Tự động</button>
         <button class="tm-btn" data-act="cancel">Hủy</button><button class="tm-btn primary" data-act="save"><i class="fa-solid fa-floppy-disk"></i> Lưu chiêu</button>`
      : `<span class="tm-tag">${c.auto ? 'Tự động' : 'Đã chỉnh'}</span><button class="tm-btn" data-act="edit"><i class="fa-solid fa-pen"></i> Đổi chiêu</button>`;
    return `<div class="tm-sec-h"><span class="l"><i class="fa-solid fa-khanda"></i>CHIÊU THỨC (${n}/${MAX_MOVES})</span><span class="r">${head}</span></div>
      <div class="mv-grid">${slots}</div>${pick}`;
  }
  function dialogHTML(c) {
    const [en, col, eic] = ELEMENTS[c.element], inTeam = c.slot !== null, capped = c.level >= S.cap;
    const stats = STATS.map(([k, label, ic, sc]) => {
      const pct = Math.max(4, Math.min(100, c[k] / S.ref[k] * 100));
      return `<div class="stat" style="--c:${sc}"><span class="stat-l"><i class="fa-solid ${ic}"></i>${label}</span>
        <div class="stat-bar"><i style="width:${pct}%"></i></div><span class="stat-v">${fmt(c[k])}</span></div>`;
    }).join('');
    let foot = '';
    if (inTeam) {
      foot = `${c.slot > 0 ? '<button class="tm-btn big" data-act="lead"><i class="fa-solid fa-flag"></i> Đặt làm tiên phong</button>' : ''}
        <button class="tm-btn big danger" data-act="toggle"><i class="fa-solid fa-arrow-right-from-bracket"></i> Rút khỏi đội</button>`;
    } else if (S.replace) {
      foot = `<div class="tm-replace">Thay cho: ${S.team.map((uid, i) => {
        const t = S.byId.get(uid);
        return `<button class="tm-mini" data-act="pick" data-i="${i}" title="${esc(t.name)}"><small>#${i + 1}</small>${sprite(t)}</button>`;
      }).join('')}<button class="tm-btn" data-act="toggle">Hủy</button></div>`;
    } else {
      foot = `<button class="tm-btn big primary" data-act="toggle"><i class="fa-solid fa-plus"></i> ${S.team.length < S.max ? 'Đưa vào đội' : 'Thay thế một tướng...'}</button>`;
    }
    return `<header class="tm-dh"><div class="tm-dh-ico" style="color:${col}"><i class="fa-solid ${eic}"></i></div>
        <h2>${esc(c.name)}</h2><span class="tm-no">No. ${c.tid}</span>
        <button class="tm-x" data-act="close" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button></header>
      <div class="tm-dbody">
        <div class="tm-top">
          <div class="tm-portrait" style="--c:${col}">${sprite(c)}<span class="tm-state ${inTeam ? 'on' : ''}">${inTeam ? 'Đội hình #' + (c.slot + 1) : 'Trong kho'}</span></div>
          <div class="tm-info">
            <div class="tm-sub">${esc(c.universe)}</div>
            <div class="tm-chips">${elChip(c.element)}<span class="tm-rar ${c.rarity}">${c.rarity}</span></div>
            <div class="tm-lvbox"><span>Cấp độ</span><b class="pixel">Lv.${c.level}</b></div>
            <div><div class="tm-exp"><i style="width:${expPct(c)}%"></i></div>
              <div class="tm-exp-t"><span>EXP</span><span>${capped ? 'MAX (cap Lv.' + S.cap + ')' : fmt(c.exp) + ' / ' + fmt(c.exp_need)}</span></div></div>
          </div>
        </div>
        <section class="tm-sec"><div class="tm-sec-h"><span class="l"><i class="fa-solid fa-chart-simple"></i>CHỈ SỐ</span></div><div class="tm-stats">${stats}</div></section>
        <section class="tm-sec">${movesHTML(c)}</section>
      </div>
      <footer class="tm-df">${foot}</footer>`;
  }
  function renderModal() {
    const c = S.byId.get(S.open); if (!c) return closeModal();
    const dlg = $('#tm-dialog'), body = dlg.querySelector('.tm-dbody'), top = body ? body.scrollTop : 0;
    dlg.innerHTML = dialogHTML(c);
    const nb = dlg.querySelector('.tm-dbody'); if (nb) nb.scrollTop = top;
  }
  function openChar(uid) { S.open = uid; S.edit = false; S.sel = null; S.replace = false; $('#tm-modal').hidden = false; renderModal(); }
  function closeModal() { S.open = null; S.edit = false; $('#tm-modal').hidden = true; }
  function step(d) {
    const l = viewList(), i = l.findIndex(c => c.uid === S.open);
    if (!l.length) return;
    openChar(l[(i + d + l.length) % l.length].uid);
  }

  /* ---------- Sự kiện ---------- */
  function onDialogClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = S.byId.get(S.open), a = b.dataset.act, i = +b.dataset.i;
    switch (a) {
      case 'close': return closeModal();
      case 'edit': S.edit = true; S.draft = c.equipped.slice(); S.sel = null; break;
      case 'cancel': S.edit = false; S.sel = null; break;
      case 'auto': return saveMoves([]);
      case 'save': if (!S.draft.length) return toast('Cần ít nhất 1 chiêu (hoặc chọn Tự động).'); return saveMoves(S.draft);
      case 'slot': S.sel = S.sel === i ? null : i; break;
      case 'rm':
        if (S.draft.length <= 1) return toast('Cần ít nhất 1 chiêu.');
        S.draft.splice(i, 1); S.sel = null; break;
      case 'opt': {
        const id = +b.dataset.id, m = c.learnset.find(x => x.id === id), at = S.draft.indexOf(id);
        if (!m.learned) return toast(`Học chiêu này ở Lv.${m.learn_level}.`);
        if (at >= 0) { if (S.draft.length <= 1) return toast('Cần ít nhất 1 chiêu.'); S.draft.splice(at, 1); }
        else if (S.draft.length < MAX_MOVES) S.draft.push(id);
        else if (S.sel != null) S.draft[S.sel] = id;
        else return toast('Đã đủ 4 chiêu: hãy chọn ô chiêu cần thay trước.');
        S.sel = null; break;
      }
      case 'toggle':
        if (c.slot !== null) return removeFromTeam(c.uid);
        if (S.team.length < S.max) return commitTeam([...S.team, c.uid]);
        S.replace = !S.replace; break;
      case 'pick': S.replace = false; return placeAt(c.uid, i);
      case 'lead': return placeAt(c.uid, 0);
    }
    renderModal();
  }

  function bind() {
    $('#tm-dialog').addEventListener('click', onDialogClick);
    $('#tm-modal').addEventListener('mousedown', e => { if (e.target.id === 'tm-modal') closeModal(); });
    $('#tm-prev').onclick = () => step(-1); $('#tm-next').onclick = () => step(1);
    document.addEventListener('keydown', e => {
      if (S.open == null || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Escape') closeModal();
      else if (!S.edit && e.key === 'ArrowLeft') step(-1);
      else if (!S.edit && e.key === 'ArrowRight') step(1);
    });

    // mở pop-up
    document.addEventListener('click', e => {
      const el = e.target.closest('.tm-card[data-uid], .tm-slot[data-uid]');
      if (el) openChar(+el.dataset.uid);
    });

    // lọc
    $('#tm-q').oninput = e => { S.q = norm(e.target.value.trim()); renderGrid(); };
    $('#tm-el').onchange = e => { S.el = e.target.value; renderGrid(); };
    $('#tm-rar').onchange = e => { S.rar = e.target.value; renderGrid(); };
    $('#tm-sort').onchange = e => { S.sort = e.target.value; renderGrid(); };
    $('#tm-hide').onchange = e => { S.hideTeam = e.target.checked; renderGrid(); };

    // kéo thả
    const clearOver = () => document.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
    document.addEventListener('dragstart', e => {
      const el = e.target.closest && e.target.closest('[data-uid]'); if (!el) return;
      S.drag = +el.dataset.uid; el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(S.drag));
    });
    document.addEventListener('dragend', () => { S.drag = null; document.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); clearOver(); });
    $('#tm-slots').addEventListener('dragover', e => {
      const s = e.target.closest('.tm-slot'); if (!s || S.drag == null) return;
      e.preventDefault(); clearOver(); s.classList.add('over');
    });
    $('#tm-slots').addEventListener('drop', e => {
      const s = e.target.closest('.tm-slot'); if (!s || S.drag == null) return;
      e.preventDefault(); const uid = S.drag; clearOver(); placeAt(uid, +s.dataset.i);
    });
    // kéo ô đội hình ra kho = rút khỏi đội
    $('#tm-grid').addEventListener('dragover', e => {
      if (S.drag == null || !S.team.includes(S.drag)) return;
      e.preventDefault(); $('#tm-grid').classList.add('over');
    });
    $('#tm-grid').addEventListener('dragleave', e => { if (!$('#tm-grid').contains(e.relatedTarget)) $('#tm-grid').classList.remove('over'); });
    $('#tm-grid').addEventListener('drop', e => {
      if (S.drag == null || !S.team.includes(S.drag)) return;
      e.preventDefault(); const uid = S.drag; clearOver(); removeFromTeam(uid);
    });
  }

  (async function boot() {
    bind();
    try { await load(); renderAll(); S.animated = true; }
    catch (e) { toast(e.message); $('#tm-grid').innerHTML = `<div class="tm-empty">Không tải được kho tướng: ${esc(e.message)}</div>`; }
  })();
})();