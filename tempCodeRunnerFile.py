import os
import secrets
from datetime import timedelta
from flask import Flask, redirect, render_template, request, url_for
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash
from models import (db, now, User, AnimeCharacterTemplate, UserCharacter, Item, UserInventory,
                    Universe, UniverseEnemy, Move, CharacterMove)
from routes.api import api
from routes.admin import admin_bp
from routes.auth import auth_bp, current_user, STARTER_CHARS
from story_data import STORY
from characters_data import CHARACTERS
from moves_data import MOVES, LEARNSET
from game_config import RARITY

# Mặc định: file *_data.py chỉ dùng để NẠP LẦN ĐẦU / bổ sung cái còn thiếu, không ghi đè dữ liệu
# đã sửa trong trang quản trị. Muốn ép ghi đè từ file: đặt biến môi trường SYNC_FROM_FILES=1
FORCE = os.environ.get("SYNC_FROM_FILES") == "1"

# name, kind, icon, desc, rarity, price, effect_type, effect_value, atk, hp, def
ITEMS = [
    ("Bình Hồi Máu", "consumable", "flask", "Hồi 30% HP cho toàn đội.", "R", 60, "heal_pct", 0.30, 0, 0, 0),
    ("Đại Hồi Máu", "consumable", "flask", "Hồi 60% HP cho toàn đội.", "SR", 150, "heal_pct", 0.60, 0, 0, 0),
    ("Thuốc Cuồng Nộ", "consumable", "bolt", "Tăng 30% công trong 5 lượt.", "SR", 120, "buff_atk", 0.30, 0, 0, 0),
    ("Bùa Hồi Sinh", "consumable", "heart", "Hồi sinh đồng đội gục với 40% HP.", "SSR", 300, "revive", 0.40, 0, 0, 0),
    ("Kiếm Thời Không", "equipment", "sword", "Vũ khí: +25 công.", "SR", 500, None, 0, 25, 0, 0),
    ("Khiên Cổng Dịch Chuyển", "equipment", "shield", "Phòng cụ: +20 thủ, +200 HP.", "SR", 500, None, 0, 0, 200, 20),
]

NAV = [
    {"title": None, "items": [
        {"key": "map",   "label": "Tiến độ & Bản đồ",     "icon": "fa-compass",      "endpoint": "index", "phase": 0},
        {"key": "team",  "label": "Đội hình / Kho tướng", "icon": "fa-people-group", "endpoint": "team",  "phase": 2},
        {"key": "dex",   "label": "Từ điển Anime",        "icon": "fa-book-open",    "endpoint": "dex",   "phase": 2},
    ]},
    {"title": "Hoạt động", "items": [
        {"key": "lab",   "label": "Phòng Thí Nghiệm",       "icon": "fa-flask",      "endpoint": "lab",   "phase": 3},
        {"key": "arena", "label": "Đấu Trường Xuyên Không", "icon": "fa-khanda",     "endpoint": "arena", "phase": 3},
        {"key": "tower", "label": "Tháp Vô Tận",            "icon": "fa-chess-rook", "endpoint": "tower", "phase": 3},
    ]},
    {"title": "Cửa hàng & Giao dịch", "items": [
        {"key": "gacha", "label": "Cổng Triệu Hồi (Gacha)", "icon": "fa-wand-magic-sparkles", "endpoint": "gacha", "phase": 0},
        {"key": "shop",  "label": "Tiệm Tạp Hóa",           "icon": "fa-store",               "endpoint": "shop",  "phase": 3},
        {"key": "black", "label": "Chợ Đen",                "icon": "fa-skull",               "endpoint": "black", "phase": 3},
    ]},
]
SITE = {
    "title": "Anime Multiverse", "tagline": "Hành trình triệu hồi & huấn luyện Thần Thú Long Vương",
    "studio": "PIXEL REALM GAMING",
    "footer_note": "Dự án game độc lập RPG Thần Thú Long Vương • All Beast Master Systems Operational",
    "server": "Multiverse 01", "version": "2.4.0",
    "links": {"google": "", "discord": "", "guide": "", "patch": "",
              "terms": "", "privacy": "", "status": "", "support": ""},
}
def migrate():
    """create_all() không thêm cột vào bảng đã có, nên thêm thủ công."""
    insp = inspect(db.engine)
    for table, col, typ in [("anime_character_template", "image", "VARCHAR(120)"),
                            ("universe_enemy", "image", "VARCHAR(120)"),
                            ("universe", "boss_image", "VARCHAR(120)"),
                            ("user_character", "equipped_moves", "JSON"),
                            ("user", "role", "VARCHAR(10) DEFAULT 'player'"),
                            ("user", "password_hash", "VARCHAR(255)")]:
        if col not in [c["name"] for c in insp.get_columns(table)]:
            db.session.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {col} {typ}'))
    db.session.commit()


def sync_characters():
    """Thêm nhân vật còn thiếu (theo tên). Nhân vật đã có: chỉ bổ sung ảnh nếu đang trống."""
    for n, uni, el, r, spd, sk, img in CHARACTERS:
        t = AnimeCharacterTemplate.query.filter_by(name=n).first()
        if t and not FORCE:
            t.image = t.image or img
            continue
        t = t or AnimeCharacterTemplate(name=n)
        hp, atk, df, mult = RARITY[r]
        t.universe, t.element, t.rarity, t.image = uni, el, r, img
        t.base_hp, t.base_atk, t.base_def, t.base_spd = hp, atk, df, spd
        t.skill_name, t.skill_mult = sk, mult
        db.session.add(t)
    db.session.commit()


def sync_moves():
    """Thêm chiêu còn thiếu; chỉ dựng learnset cho nhân vật chưa có learnset (trừ khi FORCE)."""
    by_key = {}
    for key, name, el, kind, power, cd, target, val, desc in MOVES:
        m = Move.query.filter_by(key=key).first()
        if m and not FORCE:
            by_key[key] = m
            continue
        m = m or Move(key=key)
        m.name, m.element, m.kind, m.power = name, el, kind, power
        m.cooldown, m.target, m.value, m.description = cd, target, val, desc
        db.session.add(m)
        by_key[key] = m
    db.session.flush()
    for tname, learn in LEARNSET.items():
        t = AnimeCharacterTemplate.query.filter_by(name=tname).first()
        if not t or (t.learnset and not FORCE):
            continue
        CharacterMove.query.filter_by(template_id=t.id).delete()
        for key, lv in learn:
            db.session.add(CharacterMove(template_id=t.id, move_id=by_key[key].id, learn_level=lv))
    db.session.commit()


def seed():
    sync_characters()
    if not Item.query.count():
        for n, k, ic, d, r, p, et, ev, a, h, df in ITEMS:
            db.session.add(Item(name=n, kind=k, icon=ic, description=d, rarity=r, price=p,
                                effect_type=et, effect_value=ev, atk_bonus=a, hp_bonus=h, def_bonus=df))
        db.session.commit()
    if not User.query.count():
        user = User(name="MultiverseMaster", tag="#3200", coins=1250, tickets=10, crystals=35, role="admin")
        db.session.add(user)
        db.session.flush()
        for slot, tid in enumerate([1, 2, 3, 4, 7, 8]):  # đội khởi đầu: 1 SSR, 2 SR, 3 R
            db.session.add(UserCharacter(user_id=user.id, template_id=tid, level=5, slot=slot))
        for iid, qty in {1: 17, 2: 4, 3: 10, 4: 2}.items():
            db.session.add(UserInventory(user_id=user.id, item_id=iid, quantity=qty))
        db.session.commit()


def seed_story():
    """boss = (tên, hệ[, ảnh]); enemies = [(tên, hệ[, ảnh]), ...].
    Màn đã có: chỉ bổ sung ảnh còn thiếu, không ghi đè (trừ khi FORCE)."""
    for s in STORY:
        u = db.session.get(Universe, s["id"])
        if u and not FORCE:
            img = s["boss"][2] if len(s["boss"]) > 2 else None
            u.boss_image = u.boss_image or img
            by_name = {n: (r[0] if r else None) for n, e, *r in s["enemies"]}
            for e in u.enemies:
                e.image = e.image or by_name.get(e.name)
            continue
        u = u or Universe(id=s["id"])
        u.name, u.chapter = s["name"], s["chapter"]
        u.lv_min, u.lv_max = s["lv_min"], s["lv_max"]
        u.boss_name, u.boss_element, *b = s["boss"]
        u.boss_image = b[0] if b else None
        u.drops = s["drops"]
        u.enemies = [UniverseEnemy(name=n, element=e, image=(r[0] if r else None))
                     for n, e, *r in s["enemies"]]
        db.session.add(u)
    db.session.commit()


def ensure_admin():
    """Luôn có ít nhất một admin có mật khẩu. DB cũ: tài khoản đầu tiên được nâng lên admin."""
    for u in User.query.filter(User.role.is_(None)):
        u.role = "player"
    admin = User.query.filter_by(role="admin").order_by(User.id).first()
    if not admin:
        admin = User.query.order_by(User.id).first()
        admin.role = "admin"
    if not admin.password_hash:
        pw = os.environ.get("ADMIN_PASSWORD")
        admin.password_hash = generate_password_hash(pw or "admin123")
        if not pw:
            print(f"[!] Tài khoản admin '{admin.name}' dùng mật khẩu mặc định 'admin123'. "
                  "Hãy đổi trong trang quản trị hoặc đặt biến môi trường ADMIN_PASSWORD trước lần chạy đầu.")
    db.session.commit()

def vn(n):
    """1250 -> '1.250'"""
    return f"{int(n or 0):,}".replace(",", ".")


def login_info():
    """Dữ liệu động cho trang đăng nhập (chỉ chạy khi template gọi)."""
    me = current_user()
    last_name = request.cookies.get("last_user", "")
    last = me or (User.query.filter_by(name=last_name).first() if last_name else None)
    card = None
    if last:
        uni = db.session.get(Universe, last.universe_id)
        card = {"name": last.name, "tag": last.tag or "", "level": max([c.level for c in last.characters] or [1]),
                "coins": vn(last.coins), "crystals": vn(last.crystals), "world": uni.name if uni else "-",
                "is_me": bool(me)}
    ver = SITE["version"]
    return {
        "server": SITE["server"], "version": ver, "ver_short": ".".join(ver.split(".")[:2]), "year": now().year,
        "online": vn(User.query.filter(User.last_online >= now() - timedelta(minutes=10)).count()),
        "players": vn(User.query.count()), "worlds": Universe.query.count(),
        "chars": AnimeCharacterTemplate.query.count(),
        "starter": AnimeCharacterTemplate.query.filter(AnimeCharacterTemplate.id.in_(STARTER_CHARS)).count(),
        "secure": request.is_secure, "session": card,
    }
def load_secret(app):
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    path = os.path.join(app.instance_path, "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as fh:
            fh.write(secrets.token_hex(32))
    with open(path) as fh:
        return fh.read().strip()


def create_app():
    app = Flask(__name__)
    os.makedirs(app.instance_path, exist_ok=True)
    app.config.update(
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        SQLALCHEMY_DATABASE_URI="sqlite:///" + os.path.join(app.instance_path, "game.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SECRET_KEY=load_secret(app),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,   # giới hạn upload 8MB
    )
    db.init_app(app)
    app.register_blueprint(api)
    app.register_blueprint(admin_bp)
    app.register_blueprint(auth_bp)

    @app.context_processor
    def inject_globals():
        # Mục nào đã có route cùng tên endpoint thì thành link thật, chưa có thì tự khoá
        groups = [{"title": g["title"],
                   "items": [{**it, "url": url_for(it["endpoint"]) if it["endpoint"] in app.view_functions else None}
                             for it in g["items"]]}
                  for g in NAV]
        return {"current_user": current_user(), "nav_groups": groups, "site": SITE, "login_info": login_info}

    @app.route("/")
    def index():
        if not current_user():
            return redirect(url_for("auth.login"))
        return render_template("index.html")
    @app.route("/ping")
    def ping():
        return "ok", 200, {"Cache-Control": "no-store"}
    with app.app_context():
        db.create_all()
        migrate()
        seed()
        ensure_admin()
        sync_moves()
        seed_story()
    return app


if __name__ == "__main__":
    create_app().run(debug=True)