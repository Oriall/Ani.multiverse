import random
from datetime import timedelta
from flask import Blueprint, abort, jsonify, make_response, request
from routes.auth import current_user
from models import db, now, User, UserCharacter, AnimeCharacterTemplate, Item, UserInventory, Universe

api = Blueprint("api", __name__, url_prefix="/api")
NODES = 30
MAX_MOVES = 4


def get_user():
    u = current_user()
    if not u:
        abort(make_response(jsonify(error="Cần đăng nhập."), 401))
    return u


def node_type(n):
    return "boss" if n == NODES else "chest" if n % 10 == 0 else "normal"


def universe_of(uid):
    return db.get_or_404(Universe, uid).to_dict()


def moves_of(c):
    """Chiêu đang dùng: equipped_moves (nếu có) hoặc tối đa 4 chiêu đã học gần nhất."""
    learned = [lm for lm in c.template.learnset if lm.learn_level <= c.level]
    by_id = {lm.move_id: lm.move for lm in learned}
    if c.equipped_moves:
        ids = [i for i in c.equipped_moves if i in by_id][:MAX_MOVES]
    else:
        ids = [lm.move_id for lm in learned][-MAX_MOVES:]
    return [by_id[i].to_dict() for i in ids]


def char_dict(c):
    t, f = c.template, 1 + 0.1 * (c.level - 1)
    return {"uid": c.id, "name": t.name, "universe": t.universe, "element": t.element, "rarity": t.rarity,
            "level": c.level, "exp": c.exp, "exp_need": c.level * 50, "slot": c.slot, "image": t.image,
            "hp": int(t.base_hp * f), "atk": int(t.base_atk * f),
            "def": int(t.base_def * f), "spd": t.base_spd,
            "moves": moves_of(c)}


def state(user):
    team = sorted([c for c in user.characters if c.slot is not None], key=lambda c: c.slot)
    owned = len({c.template_id for c in user.characters})
    cons = [{"item_id": i.item_id, "name": i.item.name, "icon": i.item.icon, "quantity": i.quantity,
             "effect_type": i.item.effect_type, "effect_value": i.item.effect_value, "desc": i.item.description}
            for i in user.inventory if i.quantity > 0 and i.item.kind == "consumable"]
    return {"user": {"name": user.name, "tag": user.tag, "coins": user.coins, "tickets": user.tickets,
                     "crystals": user.crystals, "universe_id": user.universe_id, "node": user.node,
                     "owned": owned, "total_chars": AnimeCharacterTemplate.query.count()},
            "team": [char_dict(c) for c in team], "universe": universe_of(user.universe_id),
            "consumables": cons}


def add_item(user, item, qty=1):
    inv = UserInventory.query.filter_by(user_id=user.id, item_id=item.id).first()
    if inv:
        inv.quantity += qty
    else:
        db.session.add(UserInventory(user_id=user.id, item_id=item.id, quantity=qty))


@api.get("/state")
def get_state():
    user = get_user()
    user.last_online = now()
    db.session.commit()
    return jsonify(state(user))


@api.post("/save")
def save():
    user = get_user()
    user.last_online = now()
    db.session.commit()
    return jsonify({"ok": True})


@api.post("/character/<int:uid>/moves")
def set_moves(uid):
    """Chọn chiêu (dùng cho UI sau này). Body: {"moves": [move_id, ...]}"""
    user, c = get_user(), db.get_or_404(UserCharacter, uid)
    if c.user_id != user.id:
        return jsonify(error="Không phải nhân vật của bạn."), 403
    ids = (request.get_json(silent=True) or {}).get("moves", [])[:MAX_MOVES]
    ok = {lm.move_id for lm in c.template.learnset if lm.learn_level <= c.level}
    if not all(i in ok for i in ids):
        return jsonify(error="Chiêu chưa học."), 400
    c.equipped_moves = ids or None
    db.session.commit()
    return jsonify(state(user))


@api.post("/battle/reward")
def battle_reward():
    user, data = get_user(), request.get_json(silent=True) or {}
    if not data.get("victory"):
        return jsonify(error="Chỉ nhận thưởng khi thắng."), 400
    if data.get("universe_id") != user.universe_id or data.get("node") != user.node:
        return jsonify(error="Tiến độ ải không khớp với máy chủ."), 409
    if user.last_reward_at and now() - user.last_reward_at < timedelta(seconds=1.5):
        return jsonify(error="Nhận thưởng quá nhanh."), 429

    u, node = universe_of(user.universe_id), user.node
    kind = node_type(node)
    lvl = u["lv_min"] + round((u["lv_max"] - u["lv_min"]) * (node - 1) / (NODES - 1))
    coins = int((25 + lvl * 8) * {"normal": 1, "chest": 3, "boss": 8}[kind])
    crystals = {"boss": 10 + user.universe_id * 5, "chest": 3}.get(kind, 1 if random.random() < 0.25 else 0)
    tickets = {"boss": 2, "chest": 1}.get(kind, 0)
    exp = (12 + lvl * 3) * (2 if kind == "boss" else 1)

    drops = []
    pool = Item.query.filter(Item.name.in_(u["drops"])).all()
    n_drops = {"boss": 2, "chest": 1}.get(kind, 1 if random.random() < 0.12 else 0)
    for _ in range(n_drops if pool else 0):
        it = random.choice(pool)
        add_item(user, it)
        drops.append(it.name)

    cap = u["lv_max"]
    alive_ids = data.get("alive")          # danh sách uid còn sống do client gửi
    level_ups = []
    team = [c for c in user.characters if c.slot is not None]
    for c in team:
        if alive_ids is not None and c.id not in alive_ids:
            continue                        # nhân vật đã gục: không nhận EXP
        if c.level >= cap:
            c.exp = 0
            continue
        c.exp += exp
        while c.level < cap and c.exp >= c.level * 50:
            c.exp -= c.level * 50
            c.level += 1
            if c.template.name not in level_ups:
                level_ups.append(c.template.name)
        if c.level >= cap:
            c.exp = 0
    all_capped = bool(team) and all(c.level >= cap for c in team)

    user.coins += coins
    user.crystals += crystals
    user.tickets += tickets
    unlocked = False
    if node < NODES:
        user.node += 1
    elif user.universe_id < Universe.query.count():
        user.universe_id += 1
        user.node = 1
        user.max_universe = max(user.max_universe, user.universe_id)
        unlocked = True
    user.last_reward_at = user.last_online = now()
    db.session.commit()
    return jsonify({"rewards": {"coins": coins, "crystals": crystals, "tickets": tickets, "exp": exp,
                                "drops": drops, "level_ups": level_ups, "kind": kind, "unlocked": unlocked,
                                "capped": all_capped},
                    "state": state(user)})


@api.post("/battle/defeat")
def battle_defeat():
    user, data = get_user(), request.get_json(silent=True) or {}
    if data.get("universe_id") != user.universe_id or data.get("node") != user.node:
        return jsonify(error="Tiến độ ải không khớp với máy chủ."), 409
    user.node = 1          # về đầu chương
    user.last_online = now()
    db.session.commit()
    return jsonify({"state": state(user)})


@api.post("/item/use")
def use_item():
    user, data = get_user(), request.get_json(silent=True) or {}
    inv = UserInventory.query.filter_by(user_id=user.id, item_id=data.get("item_id")).first()
    if not inv or inv.quantity <= 0 or inv.item.kind != "consumable":
        return jsonify(error="Không có vật phẩm này."), 400
    inv.quantity -= 1
    db.session.commit()
    it = inv.item
    return jsonify({"item_id": it.id, "quantity": inv.quantity, "effect_type": it.effect_type,
                    "effect_value": it.effect_value, "name": it.name})