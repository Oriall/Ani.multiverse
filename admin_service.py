"""Nạp / xuất dữ liệu game từ file .txt có cấu trúc (dùng cho trang quản trị)."""
import os
import re
import unicodedata

from flask import current_app
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError

from game_config import RARITY, ELEMENTS
from models import (db, AnimeCharacterTemplate, CharacterMove, Move, Universe, UniverseEnemy, Item,
                    User, UserCharacter, UserInventory)
from moves_data import ELE, SIG_POWER


class BlockError(ValueError):
    pass


# ---------------------------------------------------------------- tiện ích
def norm(s):
    """'Thế Giới' -> 'the_gioi' (cho phép gõ có dấu hoặc không dấu)."""
    s = unicodedata.normalize("NFD", str(s).replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


KINDS = {"nhan_vat": "char", "character": "char", "man_choi": "stage", "man": "stage",
         "stage": "stage", "chieu": "move", "chieu_thuc": "move", "move": "move"}
KIND_LABEL = {"char": "nhân vật", "stage": "màn chơi", "move": "chiêu"}
CHAR_KEYS = {"id", "ten", "the_gioi", "he", "do_hiem", "toc_do", "chieu_dac_trung", "anh", "chieu_hoc",
             "hp", "atk", "def"}
STAGE_KEYS = {"id", "ten", "chuong", "lv_min", "lv_max", "boss", "dich", "roi"}
MOVE_KEYS = {"key", "ten", "he", "loai", "suc_manh", "hoi_chieu", "muc_tieu", "gia_tri", "mo_ta"}

EL_ALIAS = {norm(v): k for k, v in ELE.items()}
EL_ALIAS.update({k: k for k in ELEMENTS})
KIND_ALIAS = {"damage": "damage", "sat_thuong": "damage", "heal": "heal", "hoi_mau": "heal"}
TARGET_ALIAS = {"single": "single", "don_the": "single", "all": "all", "toan_the": "all",
                "ally_lowest": "ally_lowest", "dong_doi_yeu_nhat": "ally_lowest",
                "ally_all": "ally_all", "ca_doi": "ally_all"}
DMG_T, HEAL_T = ("single", "all"), ("ally_lowest", "ally_all")


def one(f, key, required=False):
    v = f.get(key)
    val = v[-1].strip() if v else ""
    if not val and required:
        raise BlockError(f"thiếu trường '{key}'")
    return val or None


def to_int(s, name, lo, hi):
    try:
        n = int(str(s).strip())
    except ValueError:
        raise BlockError(f"'{name}' phải là số nguyên (đang là '{s}')")
    if not lo <= n <= hi:
        raise BlockError(f"'{name}' phải nằm trong khoảng {lo}–{hi} (đang là {n})")
    return n


def opt_int(f, k, lo, hi):
    s = one(f, k)
    return None if s is None else to_int(s, k, lo, hi)


def opt_float(f, k, lo, hi):
    s = one(f, k)
    if s is None:
        return None
    try:
        x = float(s.replace(",", "."))
    except ValueError:
        raise BlockError(f"'{k}' phải là số (đang là '{s}')")
    if not lo <= x <= hi:
        raise BlockError(f"'{k}' phải nằm trong khoảng {lo}–{hi}")
    return x


def to_el(s, name="he", allow_none=False):
    if allow_none and norm(s) in ("", "none", "vo_he", "khong"):
        return None
    e = EL_ALIAS.get(norm(s))
    if not e:
        raise BlockError(f"'{name}' không hợp lệ: '{s}'. Dùng: " + ", ".join(ELEMENTS))
    return e


def check_keys(f, allowed):
    bad = [k for k in f if k not in allowed]
    if bad:
        raise BlockError("trường lạ: " + ", ".join(bad) + ". Hợp lệ: " + ", ".join(sorted(allowed)))


def check_img(img, warns):
    if not img:
        return
    if "/" in img or "\\" in img:
        raise BlockError(f"tên ảnh '{img}' không được chứa dấu / hoặc \\")
    if not os.path.isfile(os.path.join(current_app.static_folder, "img_char", img)):
        warns.append(f"Chưa có file '{img}' trong static/img_char (game sẽ hiện emoji thay thế).")


def ent(line, field):
    p = [x.strip() for x in line.split("|")]
    if len(p) < 2 or not p[0]:
        raise BlockError(f"'{field}' phải có dạng: Tên | hệ | ảnh.png   (đang là '{line}')")
    return p[0], to_el(p[1], field), (p[2] if len(p) > 2 and p[2] else None)


# ---------------------------------------------------------------- phân tích file
def parse_text(txt):
    blocks, cur = [], None
    for ln, raw in enumerate(txt.splitlines(), 1):
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"\[(.+?)\]", line)
        if m:
            kind = KINDS.get(norm(m.group(1)))
            if not kind:
                raise BlockError(f"Dòng {ln}: khối '[{m.group(1)}]' không hợp lệ. Dùng [NHAN_VAT], [MAN_CHOI] hoặc [CHIEU].")
            cur = {"kind": kind, "line": ln, "f": {}}
            blocks.append(cur)
            continue
        if cur is None:
            raise BlockError(f"Dòng {ln}: dữ liệu nằm ngoài khối. Hãy bắt đầu bằng [NHAN_VAT], [MAN_CHOI] hoặc [CHIEU].")
        if "=" not in line:
            raise BlockError(f"Dòng {ln}: thiếu dấu '=' (dạng đúng: ten = Giá trị).")
        k, v = line.split("=", 1)
        cur["f"].setdefault(norm(k), []).append(v.strip())
    return blocks


# ---------------------------------------------------------------- chiêu
def ensure_element_moves(el):
    vn = ELE[el]
    for key, name, power, cd, target, desc in (
            (f"{el}_strike", f"{vn} Kích", 1.4, 2, "single", f"Đòn đánh hệ {vn}."),
            (f"{el}_wave", f"Sóng {vn}", 0.9, 4, "all", f"Tấn công toàn bộ kẻ địch bằng hệ {vn}.")):
        if not Move.query.filter_by(key=key).first():
            db.session.add(Move(key=key, name=name, element=el, kind="damage", power=power, cooldown=cd,
                                target=target, value=0, description=desc))
    db.session.flush()


def signature_move(t, skill, el, rarity):
    sig = next((lm.move for lm in t.learnset if lm.learn_level == 1 and lm.move.key.startswith("sig_")), None)
    if sig is None:
        key = "sig_" + norm(t.name)
        sig = Move.query.filter_by(key=key).first() or Move(key=key)
        db.session.add(sig)
    sig.name, sig.element, sig.kind, sig.power = skill, el, "damage", SIG_POWER[rarity]
    sig.cooldown, sig.target, sig.value = 3, "single", 0
    sig.description = f"Tuyệt chiêu của {t.name}."
    db.session.flush()
    return sig


def set_learnset(t, pairs):
    t.learnset.clear()
    db.session.flush()
    seen = set()
    for m, lv in pairs:
        if m.id not in seen:
            seen.add(m.id)
            t.learnset.append(CharacterMove(move_id=m.id, learn_level=lv))
    db.session.flush()


def apply_move(f):
    check_keys(f, MOVE_KEYS)
    key = one(f, "key", required=True)
    if not re.fullmatch(r"[a-z0-9_]{2,40}", key):
        raise BlockError("'key' chỉ gồm a-z, 0-9 và _ (2–40 ký tự)")
    m = Move.query.filter_by(key=key).first()
    new = m is None
    if new:
        m = Move(key=key)
    m.name = one(f, "ten", required=new) or m.name
    if "he" in f:
        m.element = to_el(one(f, "he") or "none", "he", allow_none=True)
    elif new:
        m.element = None
    kind = KIND_ALIAS.get(norm(one(f, "loai") or m.kind or "damage"))
    if not kind:
        raise BlockError("'loai' phải là damage hoặc heal")
    raw = one(f, "muc_tieu")
    target = TARGET_ALIAS.get(norm(raw)) if raw else None
    if raw and not target:
        raise BlockError("'muc_tieu' phải là single, all, ally_lowest hoặc ally_all")
    allowed = HEAL_T if kind == "heal" else DMG_T
    if not target:
        target = m.target if m.target in allowed else allowed[0]
    if target not in allowed:
        raise BlockError(f"chiêu '{kind}' chỉ dùng được mục tiêu: {', '.join(allowed)}")
    pw, cd, val = opt_float(f, "suc_manh", 0, 10), opt_int(f, "hoi_chieu", 0, 20), opt_float(f, "gia_tri", 0, 1)
    m.power = pw if pw is not None else (m.power if m.power is not None else (0 if kind == "heal" else 1.0))
    m.cooldown = cd if cd is not None else (m.cooldown if m.cooldown is not None else 3)
    m.value = val if val is not None else (m.value or 0)
    if kind == "heal" and not m.value > 0:
        raise BlockError("chiêu hồi máu cần 'gia_tri' trong khoảng (0, 1], ví dụ 0.3 = 30% HP")
    if kind == "damage" and not m.power > 0:
        raise BlockError("chiêu sát thương cần 'suc_manh' > 0")
    m.kind, m.target = kind, target
    if "mo_ta" in f:
        m.description = one(f, "mo_ta") or ""
    elif new:
        m.description = ""
    db.session.add(m)
    db.session.flush()
    return ("thêm" if new else "cập nhật"), m.name, []


# ---------------------------------------------------------------- nhân vật
def apply_char(f):
    check_keys(f, CHAR_KEYS)
    warns = []
    tid, name = one(f, "id"), one(f, "ten", required=True)
    if tid:
        t = db.session.get(AnimeCharacterTemplate, to_int(tid, "id", 1, 10 ** 9))
        if not t:
            raise BlockError(f"không có nhân vật id={tid}")
    else:
        t = AnimeCharacterTemplate.query.filter_by(name=name).first()
    new = t is None
    if new:
        t = AnimeCharacterTemplate()
    else:
        other = AnimeCharacterTemplate.query.filter_by(name=name).first()
        if other and other.id != t.id:
            raise BlockError(f"đã có nhân vật khác tên '{name}'")
    world = one(f, "the_gioi", required=new) or t.universe
    el = to_el(one(f, "he", required=new)) if (new or "he" in f) else t.element
    r = (one(f, "do_hiem", required=new) or t.rarity).upper()
    if r not in RARITY:
        raise BlockError(f"'do_hiem' phải là SSR, SR hoặc R (đang là '{r}')")
    skill = one(f, "chieu_dac_trung", required=new) or t.skill_name
    hp, atk, df, mult = RARITY[r]
    rar_changed = new or r != t.rarity
    t.base_hp = opt_int(f, "hp", 1, 10 ** 7) or (hp if rar_changed else t.base_hp)
    t.base_atk = opt_int(f, "atk", 1, 10 ** 6) or (atk if rar_changed else t.base_atk)
    t.base_def = opt_int(f, "def", 0, 10 ** 6) or (df if rar_changed else t.base_def)
    t.base_spd = opt_int(f, "toc_do", 1, 1000) or (100 if new else t.base_spd)
    t.name, t.universe, t.element, t.rarity = name, world, el, r
    t.skill_name, t.skill_mult = skill, mult
    if "anh" in f:
        t.image = one(f, "anh")
        check_img(t.image, warns)
    elif new:
        warns.append("Chưa khai báo 'anh' (game sẽ hiện emoji thay thế).")
    db.session.add(t)
    db.session.flush()

    ensure_element_moves(el)
    sig = signature_move(t, skill, el, r)
    spec = one(f, "chieu_hoc")
    if spec:
        pairs = [(sig, 1)]
        for part in re.split(r"[,;]", spec):
            part = part.strip()
            if not part:
                continue
            key, _, lv = part.partition("@")
            m = Move.query.filter_by(key=key.strip()).first()
            if not m:
                raise BlockError(f"chiêu '{key.strip()}' chưa tồn tại (thêm bằng khối [CHIEU] hoặc dùng key có sẵn)")
            pairs.append((m, to_int(lv.strip() or "1", f"level của {key.strip()}", 1, 200)))
        set_learnset(t, pairs)
    elif new or not t.learnset:
        strike = Move.query.filter_by(key=f"{el}_strike").first()
        wave = Move.query.filter_by(key=f"{el}_wave").first()
        set_learnset(t, [(sig, 1), (strike, 3), (wave, 8)])
    return ("thêm" if new else "cập nhật"), name, warns


# ---------------------------------------------------------------- màn chơi
def apply_stage(f):
    check_keys(f, STAGE_KEYS)
    warns = []
    uid = to_int(one(f, "id", required=True), "id", 1, 999)
    u = db.session.get(Universe, uid)
    new = u is None
    if new:
        mx = db.session.query(func.max(Universe.id)).scalar() or 0
        if uid != mx + 1:
            raise BlockError(f"id màn mới phải là {mx + 1} (id phải liên tục vì game mở khóa màn theo thứ tự)")
        u = Universe(id=uid)
    u.name = one(f, "ten", required=new) or u.name
    u.chapter = one(f, "chuong", required=new) or u.chapter
    lo, hi = opt_int(f, "lv_min", 1, 999), opt_int(f, "lv_max", 1, 999)
    if new and (lo is None or hi is None):
        raise BlockError("màn mới cần cả 'lv_min' và 'lv_max'")
    u.lv_min = lo if lo is not None else u.lv_min
    u.lv_max = hi if hi is not None else u.lv_max
    if u.lv_min > u.lv_max:
        raise BlockError("'lv_min' không được lớn hơn 'lv_max'")
    if new or "boss" in f:
        u.boss_name, u.boss_element, u.boss_image = ent(one(f, "boss", required=True), "boss")
        check_img(u.boss_image, warns)
    lines = [x for x in f.get("dich", []) if x.strip()]
    if lines:
        foes = [ent(x, "dich") for x in lines]
        for _, _, img in foes:
            check_img(img, warns)
        u.enemies = [UniverseEnemy(name=n, element=e, image=i) for n, e, i in foes]
    elif new:
        raise BlockError("màn mới cần ít nhất một dòng 'dich = Tên | hệ | ảnh.png'")
    if "roi" in f or new:
        names = [x.strip() for x in re.split(r"[,;]", one(f, "roi") or "") if x.strip()]
        known = {i.name for i in Item.query.all()}
        miss = [n for n in names if n not in known]
        if miss:
            raise BlockError("vật phẩm rơi không tồn tại: " + ", ".join(miss))
        u.drops = names
    db.session.add(u)
    db.session.flush()
    return ("thêm" if new else "cập nhật"), u.name, warns


# ---------------------------------------------------------------- chạy nạp
HANDLERS = {"move": apply_move, "char": apply_char, "stage": apply_stage}
ORDER = {"move": 0, "char": 1, "stage": 2}   # chiêu trước, rồi nhân vật, rồi màn


def run_import(text, dry_run=False):
    try:
        blocks = parse_text(text)
    except BlockError as e:
        return {"ok": False, "items": [], "errors": [str(e)]}
    if not blocks:
        return {"ok": False, "items": [], "errors": ["Không có khối dữ liệu nào (cần [NHAN_VAT], [MAN_CHOI] hoặc [CHIEU])."]}
    blocks.sort(key=lambda b: (ORDER[b["kind"]], b["line"]))
    items, errors = [], []
    try:
        for b in blocks:
            try:
                action, name, warns = HANDLERS[b["kind"]](b["f"])
                items.append({"line": b["line"], "kind": KIND_LABEL[b["kind"]], "action": action,
                              "name": name, "warnings": warns})
            except BlockError as e:
                errors.append(f"Dòng {b['line']} [{KIND_LABEL[b['kind']]}]: {e}")
        if errors or dry_run:
            db.session.rollback()
        else:
            db.session.commit()
    except SQLAlchemyError as e:
        db.session.rollback()
        errors.append(f"Lỗi cơ sở dữ liệu: {e.__class__.__name__}")
    return {"ok": not errors, "dry_run": dry_run, "items": [] if errors else items, "errors": errors}


# ---------------------------------------------------------------- xuất
def fmt_block(title, pairs):
    lines = [f"[{title}]"]
    for k, v in pairs:
        if v is None or v == "":
            continue
        for x in (v if isinstance(v, list) else [v]):
            lines.append(f"{k} = {x}")
    return "\n".join(lines) + "\n"


def export_text(kind="all"):
    parts = ["# Dữ liệu xuất từ trang quản trị. Sửa rồi nạp lại ở tab 'Nạp dữ liệu'.\n"]
    if kind in ("all", "moves"):
        for m in Move.query.order_by(Move.id):
            parts.append(fmt_block("CHIEU", [("key", m.key), ("ten", m.name), ("he", m.element or "none"),
                                             ("loai", m.kind), ("suc_manh", m.power), ("hoi_chieu", m.cooldown),
                                             ("muc_tieu", m.target), ("gia_tri", m.value), ("mo_ta", m.description)]))
    if kind in ("all", "characters"):
        for t in AnimeCharacterTemplate.query.order_by(AnimeCharacterTemplate.id):
            learn = ", ".join(f"{lm.move.key}@{lm.learn_level}" for lm in t.learnset
                              if not (lm.learn_level == 1 and lm.move.key.startswith("sig_")))
            parts.append(fmt_block("NHAN_VAT", [("ten", t.name), ("the_gioi", t.universe), ("he", t.element),
                                                ("do_hiem", t.rarity), ("toc_do", t.base_spd),
                                                ("chieu_dac_trung", t.skill_name), ("anh", t.image),
                                                ("chieu_hoc", learn)]))
    if kind in ("all", "stages"):
        for u in Universe.query.order_by(Universe.id):
            parts.append(fmt_block("MAN_CHOI", [
                ("id", u.id), ("ten", u.name), ("chuong", u.chapter), ("lv_min", u.lv_min), ("lv_max", u.lv_max),
                ("boss", f"{u.boss_name} | {u.boss_element} | {u.boss_image or ''}".rstrip(" |")),
                ("dich", [f"{e.name} | {e.element} | {e.image or ''}".rstrip(" |") for e in u.enemies]),
                ("roi", ", ".join(u.drops or []))]))
    return "\n".join(parts)


SAMPLE = """# ============================================================
# FILE MẪU NẠP DỮ LIỆU (lưu dạng UTF-8)
# - Dòng bắt đầu bằng # là ghi chú. Mỗi khối bắt đầu bằng [TÊN KHỐI].
# - Mỗi dòng dạng:  tên_trường = giá trị   (gõ có dấu hay không dấu đều được)
# - Đã tồn tại (cùng tên nhân vật / cùng key chiêu / cùng id màn) thì CẬP NHẬT,
#   chưa có thì THÊM MỚI. Trường bỏ trống khi cập nhật sẽ giữ nguyên.
# - Hệ: fire(Hỏa) water(Thủy) wind(Phong) earth(Thổ) thunder(Lôi) light(Quang) dark(Ám)
# - Ảnh: chỉ ghi TÊN FILE, file nằm trong static/img_char/
# ============================================================

# ---------- CHIÊU THỨC ----------
# loai: damage | heal      muc_tieu: single | all | ally_lowest | ally_all
# damage: dùng suc_manh (hệ số sát thương).  heal: dùng gia_tri (0.3 = hồi 30% HP tối đa)
[CHIEU]
key = heal_nature
ten = Gió Xuân Chữa Lành
he = wind
loai = heal
hoi_chieu = 4
muc_tieu = ally_lowest
gia_tri = 0.30
mo_ta = Hồi 30% HP cho đồng đội yếu nhất.

[CHIEU]
key = meteor_rain
ten = Mưa Sao Băng
he = fire
loai = damage
suc_manh = 1.1
hoi_chieu = 5
muc_tieu = all
mo_ta = Thiêu đốt toàn bộ kẻ địch.

# ---------- NHÂN VẬT ----------
# do_hiem: SSR | SR | R  (quyết định chỉ số gốc và hệ số tuyệt chiêu)
# hp / atk / def: TÙY CHỌN, ghi đè chỉ số gốc theo độ hiếm
# chieu_hoc: TÙY CHỌN, dạng  key@level, key@level  (tuyệt chiêu luôn học ở Lv.1;
#            bỏ trống thì tự gán chiêu hệ: <hệ>_strike@3, <hệ>_wave@8)
[NHAN_VAT]
ten = Haruka Tinh Linh
the_gioi = Pháp Sư Rừng Xanh
he = wind
do_hiem = SSR
toc_do = 111
chieu_dac_trung = Vũ Điệu Lốc Xoáy
anh = haruka.png
chieu_hoc = wind_strike@3, heal_nature@6, meteor_rain@12

# ---------- MÀN CHƠI ----------
# id phải LIÊN TỤC (màn mới = số lớn nhất hiện có + 1).
# boss / dich:  Tên | hệ | ảnh.png   (ảnh có thể bỏ). 'dich' viết nhiều dòng, mỗi dòng một loại quái.
# roi: tên vật phẩm rơi, cách nhau dấu phẩy (phải là vật phẩm có sẵn trong game)
[MAN_CHOI]
id = 5
ten = Vũ trụ Pháp Sư Rừng Xanh
chuong = Chương 5: Khu Rừng Thì Thầm
lv_min = 85
lv_max = 120
boss = Cổ Thụ Ngàn Năm | earth | ancient_tree.png
dich = Yêu Tinh Rừng | wind | goblin.png
dich = Nấm Độc | dark | mushroom.png
roi = Đại Hồi Máu, Bùa Hồi Sinh
"""


# ---------------------------------------------------------------- tạo người chơi mới
def create_player(name, pw_hash, role="player", tag="#0000"):
    """Tạo tài khoản kèm bộ khởi đầu (đội 6 nhân vật Lv.5 + ít vật phẩm) để vào game là chơi được."""
    u = User(name=name, tag=tag, role=role, password_hash=pw_hash, coins=500, tickets=5, crystals=0)
    db.session.add(u)
    db.session.flush()
    ids = [i for i in (1, 2, 3, 4, 7, 8) if db.session.get(AnimeCharacterTemplate, i)]
    if len(ids) < 6:
        ids = [t.id for t in AnimeCharacterTemplate.query.order_by(AnimeCharacterTemplate.id).limit(6)]
    for slot, tid in enumerate(ids):
        db.session.add(UserCharacter(user_id=u.id, template_id=tid, level=5, slot=slot))
    for iid, qty in {1: 5, 2: 1, 3: 2, 4: 1}.items():
        if db.session.get(Item, iid):
            db.session.add(UserInventory(user_id=u.id, item_id=iid, quantity=qty))
    db.session.commit()
    return u