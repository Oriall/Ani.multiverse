(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CSRF = $('meta[name="csrf"]').content;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString('vi-VN');
const ELS = { fire: 'Hỏa 🔥', water: 'Thủy 🌊', wind: 'Phong 🌪️', earth: 'Thổ 🪨', thunder: 'Lôi ⚡', light: 'Quang 🌟', dark: 'Ám 🌑' };
const elOpts = Object.entries(ELS);
const D = { chars: [], stages: [], moves: [], users: [] };

/* ---------- helpers ---------- */
let toastT;
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
async function api(url, opt = {}) {
  const o = { method: opt.method || (opt.body !== undefined ? 'POST' : 'GET'), headers: { 'X-CSRF-Token': CSRF } };
  if (opt.body instanceof FormData) o.body = opt.body;
  else if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
  const r = await fetch('/admin/api' + url, o);
  if (r.status === 401) { location.href = '/login'; throw new Error('Hết phiên đăng nhập'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || (j.errors || []).join('\n') || 'Lỗi máy chủ'); e.data = j; e.status = r.status; throw e; }
  return j;
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
const thumb = img => img ? `<img class="thumb" src="/static/img_char/${encodeURIComponent(img)}" alt="" onerror="this.replaceWith('—')">` : '—';
const elName = e => ELS[e] || 'Vô hệ';
const blk = (title, pairs) => `[${title}]\n` + pairs.filter(([, v]) => v != null)
  .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `${k} = ${x}`)).join('\n') + '\n';
const importText = (text, dry = false) => api('/import', { body: { text, dry_run: dry } });

/* ---------- modal form ---------- */
function fieldHtml(f) {
  const v = f.value ?? '', id = 'f_' + f.k;
  let ctl;
  if (f.type === 'select') ctl = `<select name="${f.k}" id="${id}">${f.options.map(([val, lb]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lb)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') ctl = `<textarea name="${f.k}" id="${id}" rows="${f.rows || 3}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else ctl = `<input name="${f.k}" id="${id}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${f.list ? ` list="${f.list}"` : ''}${f.ro ? ' readonly' : ''}>`;
  return `<label class="fld${f.wide ? ' wide' : ''}"><span>${esc(f.label)}</span>${ctl}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
}
function openForm(title, fields, onSubmit) {
  const dlg = $('#modal'); dlg.onclick = null;
  dlg.innerHTML = `<form class="mform"><h3>${esc(title)}</h3><div class="mbody">${fields.map(fieldHtml).join('')}</div>
    <pre class="merr" hidden></pre><div class="mfoot"><button type="button" class="btn ghost" data-close>Hủy</button><button class="btn primary">Lưu</button></div></form>`;
  const fm = $('form', dlg), er = $('.merr', dlg);
  $('[data-close]', dlg).onclick = () => dlg.close();
  fm.onsubmit = async e => {
    e.preventDefault();
    try { await onSubmit(Object.fromEntries(new FormData(fm))); dlg.close(); }
    catch (x) { er.hidden = false; er.textContent = x.data && x.data.errors ? x.data.errors.join('\n') : x.message; }
  };
  dlg.showModal();
}
function rows(sel, html, actions) {
  const tb = $(sel); tb.innerHTML = html;
  tb.onclick = guard(async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    await actions[b.dataset.act](+b.dataset.id);
  });
}
const actBtns = (id, ...a) => a.map(([act, label, cls]) => `<button class="btn sm ${cls || ''}" data-act="${act}" data-id="${id}">${label}</button>`).join(' ');

/* ---------- tabs ---------- */
const LOAD = { overview: loadStats, chars: loadChars, stages: loadStages, moves: loadMoves, users: loadUsers, images: loadImages };
$('#tabs').onclick = e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
  if (LOAD[b.dataset.tab]) guard(LOAD[b.dataset.tab])();
};

/* ---------- tổng quan ---------- */
async function loadStats() {
  const s = await api('/stats');
  const cards = [['Tài khoản', s.users], ['Nhân vật (mẫu)', s.characters], ['Bản nhân vật của người chơi', s.owned],
                 ['Màn chơi', s.stages], ['Chiêu thức', s.moves], ['Ảnh trong static/img_char', s.images]];
  $('#stats').innerHTML = cards.map(([l, v]) => `<div class="stat"><span>${l}</span><b>${fmt(v)}</b></div>`).join('');
}

/* ---------- nạp dữ liệu ---------- */
function renderReport(r) {
  const errs = (r.errors || []).map(e => `<li class="bad">✖ ${esc(e)}</li>`);
  const items = (r.items || []).map(i => `<li class="ok">✔ <b>${esc(i.action)}</b> ${esc(i.kind)} <b>${esc(i.name)}</b> <small>(dòng ${i.line})</small>${(i.warnings || []).map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}</li>`);
  const head = errs.length ? `Có ${errs.length} lỗi, chưa có gì được ghi.` : r.dry_run ? 'Hợp lệ. Chưa ghi gì, bấm "Nạp vào game" để áp dụng.' : 'Đã nạp thành công.';
  $('#imp-report').innerHTML = `<h4>${head}</h4><ul>${errs.join('')}${items.join('')}</ul>`;
}
async function runImport(dry) {
  const text = $('#imp-text').value;
  if (!text.trim()) return toast('Chưa có nội dung.');
  if (!dry && !confirm('Nạp dữ liệu này vào game?')) return;
  try { renderReport(await importText(text, dry)); if (!dry) await loadStats(); }
  catch (e) { if (e.data && e.data.errors) renderReport(e.data); else toast(e.message); }
}
$('#imp-check').onclick = () => runImport(true);
$('#imp-apply').onclick = () => runImport(false);
$('#imp-file').onchange = guard(async e => {
  const f = e.target.files[0]; if (!f) return;
  const t = await f.text();
  $('#imp-text').value = t; e.target.value = '';
  if (t.includes('\uFFFD')) toast('File có ký tự lỗi: hãy lưu lại ở dạng UTF-8.');
});
$('#imp-sample').onclick = guard(async () => { $('#imp-text').value = (await api('/sample')).text; });
$('#imp-export').onclick = guard(async () => { $('#imp-text').value = (await api('/export?kind=' + $('#imp-kind').value)).text; });
$('#imp-save').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + $('#imp-text').value], { type: 'text/plain;charset=utf-8' }));
  a.download = 'du_lieu_game.txt'; a.click(); URL.revokeObjectURL(a.href);
};

/* ---------- nhân vật ---------- */
async function loadChars() {
  D.chars = await api('/characters');
  rows('#chars-body', D.chars.map(c => `<tr><td>${thumb(c.image)}</td><td>${c.id}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.universe)}</td>
    <td>${elName(c.element)}</td><td><span class="tag ${c.rarity}">${c.rarity}</span></td><td>${c.spd}</td><td>${esc(c.skill)}</td><td>${c.owners}</td>
    <td>${actBtns(c.id, ['edit', 'Sửa'], ['del', 'Xóa', 'danger'])}</td></tr>`).join(''), {
    edit: id => charForm(D.chars.find(c => c.id === id)),
    del: async id => { if (confirm('Xóa nhân vật này?')) { await api('/characters/' + id, { method: 'DELETE' }); toast('Đã xóa.'); loadChars(); } },
  });
}
function charForm(c) {
  const ph = x => c ? 'hiện: ' + x : 'tự theo độ hiếm';
  openForm(c ? 'Sửa nhân vật' : 'Thêm nhân vật', [
    { k: 'ten', label: 'Tên', value: c?.name },
    { k: 'the_gioi', label: 'Thế giới', value: c?.universe },
    { k: 'he', label: 'Hệ', type: 'select', options: elOpts, value: c?.element },
    { k: 'do_hiem', label: 'Độ hiếm', type: 'select', options: [['SSR', 'SSR'], ['SR', 'SR'], ['R', 'R']], value: c?.rarity || 'R' },
    { k: 'toc_do', label: 'Tốc độ', type: 'number', value: c?.spd ?? 100 },
    { k: 'anh', label: 'Ảnh (tên file)', list: 'imgs', value: c?.image, ph: 'naruto.png' },
    { k: 'chieu_dac_trung', label: 'Tên tuyệt chiêu', value: c?.skill, wide: true },
    { k: 'chieu_hoc', label: 'Chiêu học thêm', type: 'textarea', rows: 2, wide: true, ph: 'fire_strike@3, fire_wave@8',
      value: c ? c.learn.map(l => `${l.key}@${l.level}`).join(', ') : '', hint: 'Dạng key@level, cách nhau dấu phẩy. Xem key ở tab Chiêu thức. Bỏ trống = tự gán chiêu hệ.' },
    { k: 'hp', label: 'HP gốc', type: 'number', ph: ph(c?.hp) },
    { k: 'atk', label: 'ATK gốc', type: 'number', ph: ph(c?.atk) },
    { k: 'def', label: 'DEF gốc', type: 'number', ph: ph(c?.def) },
  ], async v => {
    await importText(blk('NHAN_VAT', [['id', c?.id ?? null], ...['ten', 'the_gioi', 'he', 'do_hiem', 'toc_do', 'chieu_dac_trung', 'anh', 'chieu_hoc', 'hp', 'atk', 'def'].map(k => [k, v[k]])]));
    toast('Đã lưu nhân vật.'); loadChars();
  });
}
$('#chars-add').onclick = () => charForm(null);

/* ---------- màn chơi ---------- */
async function loadStages() {
  D.stages = await api('/stages');
  rows('#stages-body', D.stages.map(u => `<tr><td>${u.id}</td><td><b>${esc(u.name)}</b></td><td>${esc(u.chapter)}</td><td>${u.lv_min}–${u.lv_max}</td>
    <td>${thumb(u.boss.image)} ${esc(u.boss.name)} <small>${elName(u.boss.element)}</small></td>
    <td>${u.enemies.map(e => esc(e.name)).join(', ')}</td><td>${esc(u.drops.join(', '))}</td><td>${u.players}</td>
    <td>${actBtns(u.id, ['edit', 'Sửa'], ['del', 'Xóa', 'danger'])}</td></tr>`).join(''), {
    edit: id => stageForm(D.stages.find(u => u.id === id)),
    del: async id => { if (confirm('Xóa màn này?')) { await api('/stages/' + id, { method: 'DELETE' }); toast('Đã xóa.'); loadStages(); } },
  });
}
const entLine = e => `${e.name} | ${e.element} | ${e.image || ''}`.replace(/ \| $/, '');
function stageForm(u) {
  const nextId = Math.max(0, ...D.stages.map(s => s.id)) + 1;
  openForm(u ? `Sửa màn ${u.id}` : 'Thêm màn', [
    { k: 'id', label: 'ID', type: 'number', ro: true, value: u?.id ?? nextId },
    { k: 'ten', label: 'Tên vũ trụ', value: u?.name },
    { k: 'chuong', label: 'Chương', value: u?.chapter, wide: true },
    { k: 'lv_min', label: 'Level thấp nhất', type: 'number', value: u?.lv_min },
    { k: 'lv_max', label: 'Level cao nhất (cap)', type: 'number', value: u?.lv_max },
    { k: 'boss', label: 'Boss', wide: true, value: u ? entLine(u.boss) : '', ph: 'Tên | hệ | ảnh.png', hint: 'Hệ: ' + Object.keys(ELS).join(', ') },
    { k: 'dich', label: 'Quái thường (mỗi dòng một loại)', type: 'textarea', rows: 4, wide: true, value: u ? u.enemies.map(entLine).join('\n') : '', ph: 'Tên | hệ | ảnh.png' },
    { k: 'roi', label: 'Vật phẩm rơi', wide: true, value: u?.drops.join(', '), ph: 'Bình Hồi Máu, Đại Hồi Máu' },
  ], async v => {
    await importText(blk('MAN_CHOI', [['id', v.id], ['ten', v.ten], ['chuong', v.chuong], ['lv_min', v.lv_min], ['lv_max', v.lv_max],
      ['boss', v.boss], ['dich', v.dich.split('\n').map(s => s.trim()).filter(Boolean)], ['roi', v.roi]]));
    toast('Đã lưu màn chơi.'); loadStages();
  });
}
$('#stages-add').onclick = guard(async () => { if (!D.stages.length) await loadStages(); stageForm(null); });

/* ---------- chiêu ---------- */
async function loadMoves() {
  D.moves = await api('/moves');
  rows('#moves-body', D.moves.map(m => `<tr><td><code>${esc(m.key)}</code></td><td><b>${esc(m.name)}</b></td><td>${elName(m.element)}</td>
    <td><span class="tag ${m.kind}">${m.kind === 'heal' ? 'Hồi máu' : 'Sát thương'}</span></td>
    <td>${m.kind === 'heal' ? Math.round(m.value * 100) + '% HP' : '×' + m.power}</td><td>${m.cooldown}</td><td>${esc(m.target)}</td><td>${m.used}</td>
    <td>${actBtns(m.id, ['edit', 'Sửa'], ['del', 'Xóa', 'danger'])}</td></tr>`).join(''), {
    edit: id => moveForm(D.moves.find(m => m.id === id)),
    del: async id => { if (confirm('Xóa chiêu này?')) { await api('/moves/' + id, { method: 'DELETE' }); toast('Đã xóa.'); loadMoves(); } },
  });
}
function moveForm(m) {
  openForm(m ? 'Sửa chiêu' : 'Thêm chiêu', [
    { k: 'key', label: 'Key (a-z, 0-9, _)', value: m?.key, ro: !!m, ph: 'fire_blast' },
    { k: 'ten', label: 'Tên chiêu', value: m?.name },
    { k: 'he', label: 'Hệ', type: 'select', options: [['none', 'Vô hệ'], ...elOpts], value: m?.element || 'none' },
    { k: 'loai', label: 'Loại', type: 'select', options: [['damage', 'Sát thương'], ['heal', 'Hồi máu']], value: m?.kind || 'damage' },
    { k: 'suc_manh', label: 'Sức mạnh (hệ số sát thương)', type: 'number', value: m?.power ?? 1.2, hint: 'Chỉ dùng cho chiêu sát thương.' },
    { k: 'gia_tri', label: 'Hồi máu (0.3 = 30% HP)', type: 'number', value: m?.value ?? 0, hint: 'Chỉ dùng cho chiêu hồi máu.' },
    { k: 'hoi_chieu', label: 'Hồi chiêu (lượt)', type: 'number', value: m?.cooldown ?? 3 },
    { k: 'muc_tieu', label: 'Mục tiêu', type: 'select', value: m?.target || 'single',
      options: [['single', 'Một địch'], ['all', 'Toàn bộ địch'], ['ally_lowest', 'Đồng đội yếu nhất'], ['ally_all', 'Cả đội']] },
    { k: 'mo_ta', label: 'Mô tả', wide: true, value: m?.desc },
  ], async v => {
    await importText(blk('CHIEU', ['key', 'ten', 'he', 'loai', 'suc_manh', 'gia_tri', 'hoi_chieu', 'muc_tieu', 'mo_ta'].map(k => [k, v[k]])));
    toast('Đã lưu chiêu.'); loadMoves();
  });
}
$('#moves-add').onclick = () => moveForm(null);

/* ---------- tài khoản ---------- */
async function loadUsers() {
  D.users = await api('/users');
  rows('#users-body', D.users.map(u => `<tr><td>${u.id}</td><td><b>${esc(u.name)}</b> <small>${esc(u.tag)}</small>${u.me ? ' <small>(bạn)</small>' : ''}${u.has_password ? '' : ' <small title="Chưa có mật khẩu, không đăng nhập được">⚠️</small>'}</td>
    <td><span class="tag ${u.role}">${u.role === 'admin' ? 'Admin' : 'Người chơi'}</span></td><td>${fmt(u.coins)}</td><td>${fmt(u.tickets)}</td>
    <td>${fmt(u.crystals)}</td><td>Vũ trụ ${u.universe_id} · Ải ${u.node}</td><td>${u.chars}</td><td>${esc(u.last_online)}</td>
    <td>${actBtns(u.id, ['edit', 'Sửa'], ['chars', 'Nhân vật'], ['reset', 'Reset'], ['del', 'Xóa', 'danger'])}</td></tr>`).join(''), {
    edit: id => userForm(D.users.find(u => u.id === id)),
    chars: id => userChars(D.users.find(u => u.id === id)),
    reset: async id => {
      if (!confirm('Đưa tiến độ về Vũ trụ 1 - Ải 1?')) return;
      const full = confirm('Đồng thời reset level toàn bộ nhân vật về 1?\n(OK = có, Hủy = chỉ reset tiến độ)');
      await api(`/users/${id}/reset`, { body: { full } }); toast('Đã reset.'); loadUsers();
    },
    del: async id => { if (confirm('Xóa tài khoản và toàn bộ nhân vật/kho đồ của họ?')) { await api('/users/' + id, { method: 'DELETE' }); toast('Đã xóa.'); loadUsers(); } },
  });
}
function userForm(u) {
  openForm('Sửa tài khoản #' + u.id, [
    { k: 'name', label: 'Tên đăng nhập', value: u.name }, { k: 'tag', label: 'Tag', value: u.tag },
    { k: 'role', label: 'Vai trò', type: 'select', options: [['player', 'Người chơi'], ['admin', 'Admin']], value: u.role },
    { k: 'password', label: 'Mật khẩu mới', type: 'password', hint: 'Để trống = giữ nguyên. Tối thiểu 6 ký tự.' },
    { k: 'coins', label: 'Vàng', type: 'number', value: u.coins }, { k: 'tickets', label: 'Vé triệu hồi', type: 'number', value: u.tickets },
    { k: 'crystals', label: 'Tinh thể', type: 'number', value: u.crystals }, { k: 'universe_id', label: 'Vũ trụ hiện tại', type: 'number', value: u.universe_id },
    { k: 'node', label: 'Ải hiện tại (1–30)', type: 'number', value: u.node },
  ], async v => { await api('/users/' + u.id, { method: 'PUT', body: v }); toast('Đã lưu.'); loadUsers(); });
}
$('#users-add').onclick = () => openForm('Tạo tài khoản', [
  { k: 'name', label: 'Tên đăng nhập' },
  { k: 'role', label: 'Vai trò', type: 'select', options: [['player', 'Người chơi'], ['admin', 'Admin']], value: 'player' },
  { k: 'password', label: 'Mật khẩu (≥ 6 ký tự)', type: 'password', wide: true }],
  async v => { await api('/users', { body: v }); toast('Đã tạo.'); loadUsers(); });

async function userChars(u) {
  const dlg = $('#modal');
  const [list, all] = await Promise.all([api(`/users/${u.id}/characters`), api('/characters')]);
  D.chars = all;
  dlg.innerHTML = `<div class="mform wide"><h3>Nhân vật của ${esc(u.name)}</h3>
    <div class="tablewrap"><table><thead><tr><th></th><th>Tên</th><th>Level</th><th>Ô đội (0–5, trống = kho)</th><th></th></tr></thead><tbody>
    ${list.map(c => `<tr data-id="${c.id}"><td>${thumb(c.image)}</td><td>${esc(c.name)} <span class="tag ${c.rarity}">${c.rarity}</span></td>
      <td><input type="number" min="1" max="200" value="${c.level}" data-k="level"></td>
      <td><input type="number" min="0" max="5" value="${c.slot ?? ''}" data-k="slot"></td>
      <td><button class="btn sm" data-save>Lưu</button> <button class="btn sm danger" data-rm>Xóa</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="bar"><select id="uc-tpl">${all.map(c => `<option value="${c.id}">${esc(c.name)} (${c.rarity})</option>`).join('')}</select>
      <input type="number" id="uc-lv" value="1" min="1" max="200"><button class="btn primary" id="uc-add">+ Tặng nhân vật</button></div>
    <div class="mfoot"><button class="btn ghost" data-close>Đóng</button></div></div>`;
  dlg.onclick = guard(async e => {
    const tr = e.target.closest('tr[data-id]');
    if (e.target.closest('[data-close]')) return dlg.close();
    if (e.target.id === 'uc-add') await api(`/users/${u.id}/characters`, { body: { template_id: +$('#uc-tpl').value, level: +$('#uc-lv').value } });
    else if (tr && e.target.closest('[data-save]')) {
      const s = $('[data-k=slot]', tr).value;
      await api('/ucharacters/' + tr.dataset.id, { method: 'PUT', body: { level: +$('[data-k=level]', tr).value, slot: s === '' ? null : +s } });
    } else if (tr && e.target.closest('[data-rm]')) { if (!confirm('Xóa nhân vật này khỏi tài khoản?')) return; await api('/ucharacters/' + tr.dataset.id, { method: 'DELETE' }); }
    else return;
    toast('Đã cập nhật.'); await userChars(u); loadUsers();
  });
  if (!dlg.open) dlg.showModal();
}

/* ---------- ảnh ---------- */
async function loadImages() {
  const list = await api('/images');
  $('#imgs').innerHTML = list.map(n => `<option value="${esc(n)}">`).join('');
  $('#img-grid').innerHTML = list.map(n => `<figure data-n="${esc(n)}" title="Bấm để sao chép tên"><img src="/static/img_char/${encodeURIComponent(n)}" alt=""><figcaption>${esc(n)}</figcaption></figure>`).join('')
    || '<p class="muted">Chưa có ảnh nào.</p>';
}
$('#img-grid').onclick = e => {
  const f = e.target.closest('figure'); if (!f) return;
  navigator.clipboard?.writeText(f.dataset.n).then(() => toast('Đã sao chép: ' + f.dataset.n));
};
$('#img-file').onchange = guard(async e => {
  for (const file of e.target.files) {
    const send = overwrite => { const fd = new FormData(); fd.append('file', file); if (overwrite) fd.append('overwrite', '1'); return api('/images', { body: fd }); };
    try { await send(false); }
    catch (x) { if (x.status === 409 && confirm(x.message + ' Ghi đè?')) await send(true); else if (x.status !== 409) throw x; }
  }
  e.target.value = ''; toast('Đã tải ảnh lên.'); loadImages();
});

/* ---------- khởi động ---------- */
guard(async () => { await loadStats(); await loadImages(); })();
})();