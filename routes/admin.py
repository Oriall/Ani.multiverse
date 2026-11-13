import hmac
import os
import random
import secrets

from flask import (Blueprint, jsonify, request, session, redirect, url_for, render_template, current_app)
from werkzeug.security import generate_password_hash
from sqlalchemy import func
from werkzeug.utils import secure_filename

import admin_service as svc
from routes.auth import current_user
from models import (db, now, User, UserCharacter, UserInventory, AnimeCharacterTemplate, Move,
                    CharacterMove, Universe)

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
NODES = 30


# ------------------------------------------------------------------ xác thực
def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_hex(16)
    return session["csrf"]


@admin_bp.before_request
def guard():
    me, is_api = current_user(), request.path.startswith("/admin/api/")
    if not me:
        if is_api:
            return jsonify(error="Cần đăng nhập."), 401
        return redirect(url_for("auth.login", next=request.path))
    if me.role != "admin":
        if is_api:
            return jsonify(error="Bạn không có quyền quản trị."), 403
        return redirect(url_for("index"))
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session.get("csrf", "")):
            return jsonify(error="CSRF token không hợp lệ, hãy tải lại trang."), 403
    return None


@admin_bp.get("/")
def dashboard():
    return render_template("admin.html", csrf=csrf_token())


# ------------------------------------------------------------------ tiện ích
def ivalue(v, lo, hi, name):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"'{name}' phải là số nguyên.")
    if not lo <= n <= hi:
        raise ValueError(f"'{name}' phải nằm trong khoảng {lo}–{hi}.")
    return n


def img_dir():
    d = os.path.join(current_app.static_folder, "img_char")
    os.makedirs(d, exist_ok=True)
    return d


def err(msg, code=400):
    db.session.rollback()
    return jsonify(error=msg), code


# ------------------------------------------------------------------ tổng quan
@admin_bp.get("/api/stats")
def stats():
    return jsonify({"users": User.query.count(), "characters": AnimeCharacterTemplate.query.count(),
                    "stages": Universe.query.count(), "moves": Move.query.count(),
                    "owned": UserCharacter.query.count(),
                    "images": len([f for f in os.listdir(img_dir()) if os.path.splitext(f)[1].lower() in IMG_EXT])})


# ------------------------------------------------------------------ nạp / xuất
@admin_bp.post("/api/import")
def api_import():
    d = request.get_json(silent=True) or {}
    res = svc.run_import(d.get("text", ""), bool(d.get("dry_run")))
    return jsonify(res), (200 if res["ok"] else 400)


@admin_bp.get("/api/export")
def api_export():
    kind = request.args.get("kind", "all")
    return jsonify(text=svc.export_text(kind if kind in ("all", "characters", "stages", "moves") else "all"))


@admin_bp.get("/api/sample")
def api_sample():
    return jsonify(text=svc.SAMPLE)


# ------------------------------------------------------------------ nhân vật
def char_json(t, owners):
    sig = next((lm.move for lm in t.learnset if lm.learn_level == 1 and lm.move.key.startswith("sig_")), None)
    return {"id": t.id, "name": t.name, "universe": t.universe, "element": t.element, "rarity": t.rarity,
            "spd": t.base_spd, "image": t.image, "skill": t.skill_name, "hp": t.base_hp, "atk": t.base_atk,
            "def": t.base_def, "owners": owners,
            "learn": [{"key": lm.move.key, "name": lm.move.name, "level": lm.learn_level}
                      for lm in t.learnset if lm.move is not sig]}


@admin_bp.get("/api/characters")
def api_chars():
    owners = dict(db.session.query(UserCharacter.template_id, func.count()).group_by(UserCharacter.template_id).all())
    return jsonify([char_json(t, owners.get(t.id, 0))
                    for t in AnimeCharacterTemplate.query.order_by(AnimeCharacterTemplate.id)])


@admin_bp.delete("/api/characters/<int:tid>")
def del_char(tid):
    t = db.get_or_404(AnimeCharacterTemplate, tid)
    n = UserCharacter.query.filter_by(template_id=tid).count()
    if n:
        return err(f"Không xóa được: {n} bản đang thuộc về người chơi. Hãy xóa chúng ở tab Tài khoản trước.")
    db.session.delete(t)
    db.session.commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------ chiêu
@admin_bp.get("/api/moves")
def api_moves():
    used = dict(db.session.query(CharacterMove.move_id, func.count()).group_by(CharacterMove.move_id).all())
    return jsonify([m.to_dict() | {"used": used.get(m.id, 0)} for m in Move.query.order_by(Move.id)])


@admin_bp.delete("/api/moves/<int:mid>")
def del_move(mid):
    m = db.get_or_404(Move, mid)
    if CharacterMove.query.filter_by(move_id=mid).count():
        return err("Không xóa được: chiêu này đang nằm trong learnset của nhân vật.")
    db.session.delete(m)
    db.session.commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------ màn chơi
@admin_bp.get("/api/stages")
def api_stages():
    return jsonify([u.to_dict() | {"players": User.query.filter_by(universe_id=u.id).count()}
                    for u in Universe.query.order_by(Universe.id)])


@admin_bp.delete("/api/stages/<int:uid>")
def del_stage(uid):
    u = db.get_or_404(Universe, uid)
    if uid != db.session.query(func.max(Universe.id)).scalar() or uid == 1:
        return err("Chỉ xóa được màn cuối cùng (và không xóa màn 1) để id luôn liên tục.")
    if User.query.filter(User.universe_id >= uid).count():
        return err("Không xóa được: có người chơi đang ở màn này.")
    db.session.delete(u)
    db.session.commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------ tài khoản
ROLES = ("player", "admin")


def user_json(u):
    return {"id": u.id, "name": u.name, "tag": u.tag, "role": u.role or "player", "coins": u.coins,
            "tickets": u.tickets, "crystals": u.crystals, "universe_id": u.universe_id, "node": u.node,
            "chars": len(u.characters), "has_password": bool(u.password_hash), "me": u.id == current_user().id,
            "last_online": u.last_online.strftime("%d/%m/%Y %H:%M") if u.last_online else ""}


def check_name(name, exclude_id=None):
    if not 1 <= len(name) <= 40:
        raise ValueError("Tên phải từ 1 đến 40 ký tự.")
    q = User.query.filter(func.lower(User.name) == name.lower())
    if exclude_id:
        q = q.filter(User.id != exclude_id)
    if q.first():
        raise ValueError(f"Tên '{name}' đã có người dùng (không phân biệt hoa thường).")


def check_password(pw):
    if len(pw) < 6:
        raise ValueError("Mật khẩu phải có ít nhất 6 ký tự.")
    return generate_password_hash(pw)


def admin_count():
    return User.query.filter_by(role="admin").count()


@admin_bp.get("/api/users")
def api_users():
    return jsonify([user_json(u) for u in User.query.order_by(User.id)])


@admin_bp.post("/api/users")
def create_user():
    d = request.get_json(silent=True) or {}
    try:
        name, role = (d.get("name") or "").strip(), d.get("role", "player")
        check_name(name)
        if role not in ROLES:
            raise ValueError("Vai trò không hợp lệ.")
        pw_hash = check_password(d.get("password") or "")
    except ValueError as e:
        return err(str(e))
    svc.create_player(name, pw_hash, role, f"#{random.randint(0, 9999):04d}")
    return jsonify(ok=True)


@admin_bp.put("/api/users/<int:uid>")
def update_user(uid):
    u, d, me = db.get_or_404(User, uid), request.get_json(silent=True) or {}, current_user()
    try:
        name = (d.get("name") or u.name).strip()
        check_name(name, u.id)
        role = d.get("role", u.role or "player")
        if role not in ROLES:
            raise ValueError("Vai trò không hợp lệ.")
        if u.role == "admin" and role != "admin":
            if u.id == me.id:
                raise ValueError("Không thể tự hạ quyền của chính mình.")
            if admin_count() <= 1:
                raise ValueError("Phải còn ít nhất một admin.")
        u.name, u.tag, u.role = name, (d.get("tag") or u.tag)[:10], role
        if d.get("password"):
            u.password_hash = check_password(d["password"])
        u.coins = ivalue(d.get("coins", u.coins), 0, 10 ** 12, "Vàng")
        u.tickets = ivalue(d.get("tickets", u.tickets), 0, 10 ** 9, "Vé")
        u.crystals = ivalue(d.get("crystals", u.crystals), 0, 10 ** 9, "Tinh thể")
        u.universe_id = ivalue(d.get("universe_id", u.universe_id), 1, Universe.query.count() or 1, "Vũ trụ")
        u.node = ivalue(d.get("node", u.node), 1, NODES, "Ải")
        u.max_universe = max(u.max_universe or 1, u.universe_id)
    except ValueError as e:
        return err(str(e))
    db.session.commit()
    return jsonify(user_json(u))


@admin_bp.post("/api/users/<int:uid>/reset")
def reset_user(uid):
    u, d = db.get_or_404(User, uid), request.get_json(silent=True) or {}
    u.universe_id, u.node, u.max_universe = 1, 1, 1
    if d.get("full"):
        for c in u.characters:
            c.level, c.exp = 1, 0
    db.session.commit()
    return jsonify(ok=True)


@admin_bp.delete("/api/users/<int:uid>")
def delete_user(uid):
    u = db.get_or_404(User, uid)
    if u.id == current_user().id:
        return err("Không thể tự xóa tài khoản đang đăng nhập.")
    if u.role == "admin" and admin_count() <= 1:
        return err("Không thể xóa admin cuối cùng.")
    UserCharacter.query.filter_by(user_id=uid).delete()
    UserInventory.query.filter_by(user_id=uid).delete()
    db.session.delete(u)
    db.session.commit()
    return jsonify(ok=True)


@admin_bp.get("/api/users/<int:uid>/characters")
def user_chars(uid):
    db.get_or_404(User, uid)
    rows = UserCharacter.query.filter_by(user_id=uid).order_by(UserCharacter.id).all()
    return jsonify([{"id": c.id, "name": c.template.name, "rarity": c.template.rarity, "image": c.template.image,
                     "level": c.level, "slot": c.slot} for c in rows])


@admin_bp.post("/api/users/<int:uid>/characters")
def grant_char(uid):
    u, d = db.get_or_404(User, uid), request.get_json(silent=True) or {}
    try:
        t = db.session.get(AnimeCharacterTemplate, ivalue(d.get("template_id"), 1, 10 ** 9, "template_id"))
        if not t:
            raise ValueError("Không có nhân vật này.")
        lv = ivalue(d.get("level", 1), 1, 200, "level")
    except ValueError as e:
        return err(str(e))
    used = {c.slot for c in u.characters if c.slot is not None}
    slot = next((s for s in range(6) if s not in used), None)
    db.session.add(UserCharacter(user_id=u.id, template_id=t.id, level=lv, slot=slot))
    db.session.commit()
    return jsonify(ok=True)


@admin_bp.put("/api/ucharacters/<int:cid>")
def update_uchar(cid):
    c, d = db.get_or_404(UserCharacter, cid), request.get_json(silent=True) or {}
    try:
        if "level" in d:
            c.level, c.exp = ivalue(d["level"], 1, 200, "level"), 0
        if "slot" in d:
            if d["slot"] is None:
                c.slot = None
            else:
                s = ivalue(d["slot"], 0, 5, "slot")
                if UserCharacter.query.filter(UserCharacter.user_id == c.user_id, UserCharacter.slot == s,
                                              UserCharacter.id != c.id).count():
                    raise ValueError(f"Ô {s} đã có nhân vật khác.")
                c.slot = s
    except ValueError as e:
        return err(str(e))
    db.session.commit()
    return jsonify(ok=True)


@admin_bp.delete("/api/ucharacters/<int:cid>")
def delete_uchar(cid):
    db.session.delete(db.get_or_404(UserCharacter, cid))
    db.session.commit()
    return jsonify(ok=True)


# ------------------------------------------------------------------ ảnh
@admin_bp.get("/api/images")
def api_images():
    return jsonify(sorted(f for f in os.listdir(img_dir()) if os.path.splitext(f)[1].lower() in IMG_EXT))


@admin_bp.post("/api/images")
def upload_image():
    f = request.files.get("file")
    name = secure_filename(f.filename) if f else ""
    if not name or os.path.splitext(name)[1].lower() not in IMG_EXT:
        return err("Chỉ nhận file png, jpg, webp, gif (tên file cần có chữ/số ASCII).")
    path = os.path.join(img_dir(), name)
    if os.path.exists(path) and request.form.get("overwrite") != "1":
        return jsonify(error=f"'{name}' đã tồn tại.", exists=True), 409
    f.save(path)
    return jsonify(ok=True, name=name)