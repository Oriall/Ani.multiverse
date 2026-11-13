import re
import secrets
import time
from flask import Blueprint, g, redirect, render_template, request, session, url_for
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash
from models import db, now, User, AnimeCharacterTemplate, UserCharacter, Item, UserInventory

auth_bp = Blueprint("auth", __name__)

# Quà cho tài khoản mới đăng ký (cùng bộ với tài khoản mẫu trong seed() của app.py)
STARTER_CHARS = [1, 2, 3, 4, 7, 8]
STARTER_ITEMS = {1: 17, 2: 4, 3: 10, 4: 2}
STARTER_WALLET = {"coins": 1250, "tickets": 10, "crystals": 35}
NAME_RE = re.compile(r"[\w .\-]{3,24}")


def current_user():
    """Người dùng đang đăng nhập (hoặc None). Cache trong request."""
    if "_cu" not in g:
        uid = session.get("user_id")
        g._cu = db.session.get(User, uid) if uid else None
    return g._cu


def start_session(user, remember):
    session.clear()
    session["user_id"] = user.id
    session.permanent = bool(remember)      # phải đặt SAU session.clear()
    user.last_online = now()
    db.session.commit()


def give_starter_kit(user):
    db.session.flush()
    tids = [t.id for t in AnimeCharacterTemplate.query
            .filter(AnimeCharacterTemplate.id.in_(STARTER_CHARS)).order_by(AnimeCharacterTemplate.id)]
    for slot, tid in enumerate(tids):
        db.session.add(UserCharacter(user_id=user.id, template_id=tid, level=5, slot=slot))
    for it in Item.query.filter(Item.id.in_(list(STARTER_ITEMS))):
        db.session.add(UserInventory(user_id=user.id, item_id=it.id, quantity=STARTER_ITEMS[it.id]))


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET" and current_user():
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        name, pw = request.form.get("username", "").strip(), request.form.get("password", "")
        u = User.query.filter(func.lower(User.name) == name.lower()).first() if name else None
        if u and u.password_hash and check_password_hash(u.password_hash, pw):
            remember = bool(request.form.get("remember"))
            start_session(u, remember)
            nxt = request.args.get("next", "")
            resp = redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("index"))
            if remember:   # nhớ tên để trang đăng nhập hiện thẻ "Phiên chơi gần nhất"
                resp.set_cookie("last_user", u.name, max_age=60 * 60 * 24 * 90, httponly=True, samesite="Lax")
            else:
                resp.delete_cookie("last_user")
            return resp
        time.sleep(0.6)
        error = "Sai tên tài khoản hoặc mật khẩu."
    return render_template("login.html", error=error)


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user():
        return redirect(url_for("index"))
    if request.method == "GET":
        return render_template("login.html", tab="register")

    name = " ".join(request.form.get("username", "").split())
    pw, pw2 = request.form.get("password", ""), request.form.get("password2", "")
    err = None
    if not NAME_RE.fullmatch(name):
        err = "Tên tài khoản dài 3-24 ký tự, chỉ gồm chữ, số, dấu cách, _ . -"
    elif not 6 <= len(pw) <= 128:
        err = "Mật khẩu cần từ 6 đến 128 ký tự."
    elif pw != pw2:
        err = "Hai mật khẩu không khớp."
    elif User.query.filter(func.lower(User.name) == name.lower()).first():
        err = "Tên tài khoản đã tồn tại."
    if err:
        return render_template("login.html", error=err, tab="register", form_user=name), 400

    user = User(name=name, tag=f"#{secrets.randbelow(9000) + 1000}", role="player",
                password_hash=generate_password_hash(pw), **STARTER_WALLET)
    db.session.add(user)
    give_starter_kit(user)
    db.session.commit()
    start_session(user, remember=False)      # đăng ký xong vào game luôn
    return redirect(url_for("index"))


@auth_bp.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))