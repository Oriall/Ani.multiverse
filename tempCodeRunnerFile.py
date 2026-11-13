import os
from flask import Flask, render_template
from sqlalchemy import inspect, text
from models import (db, User, AnimeCharacterTemplate, UserCharacter, Item, UserInventory,
                    Universe, UniverseEnemy, Move, CharacterMove)
from routes.api import api
from story_data import STORY
from characters_data import CHARACTERS
from moves_data import MOVES, LEARNSET

RARITY = {"SSR": (1000, 120, 60, 2.4), "SR": (850, 100, 50, 2.0), "R": (700, 85, 40, 1.7)}

# name, kind, icon, desc, rarity, price, effect_type, effect_value, atk, hp, def
ITEMS = [
    ("Bình Hồi Máu", "consumable", "flask", "Hồi 30% HP cho toàn đội.", "R", 60, "heal_pct", 0.30, 0, 0, 0),
    ("Đại Hồi Máu", "consumable", "flask", "Hồi 60% HP cho toàn đội.", "SR", 150, "heal_pct", 0.60, 0, 0, 0),
    ("Thuốc Cuồng Nộ", "consumable", "bolt", "Tăng 30% công trong 5 lượt.", "SR", 120, "buff_atk", 0.30, 0, 0, 0),
    ("Bùa Hồi Sinh", "consumable", "heart", "Hồi sinh đồng đội gục với 40% HP.", "SSR", 300, "revive", 0.40, 0, 0, 0),
    ("Kiếm Thời Không", "equipment", "sword", "Vũ khí: +25 công.", "SR", 500, None, 0, 25, 0, 0),
    ("Khiên Cổng Dịch Chuyển", "equipment", "shield", "Phòng cụ: +20 thủ, +200 HP.", "SR", 500, None, 0, 0, 200, 20),
]


def migrate():
    """create_all() không thêm cột vào bảng đã có, nên thêm thủ công."""
    insp = inspect(db.engine)
    for table, col, typ in [("anime_character_template", "image", "VARCHAR(120)"),
                            ("universe_enemy", "image", "VARCHAR(120)"),
                            ("universe", "boss_image", "VARCHAR(120)"),
                            ("user_character", "equipped_moves", "JSON")]:
        if col not in [c["name"] for c in insp.get_columns(table)]:
            db.session.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
    db.session.commit()


def sync_characters():
    """Thêm mới / cập nhật nhân vật theo tên (id cũ giữ nguyên)."""
    for n, uni, el, r, spd, sk, img in CHARACTERS:
        hp, atk, df, mult = RARITY[r]
        t = AnimeCharacterTemplate.query.filter_by(name=n).first() or AnimeCharacterTemplate(name=n)
        t.universe, t.element, t.rarity, t.image = uni, el, r, img
        t.base_hp, t.base_atk, t.base_def, t.base_spd = hp, atk, df, spd
        t.skill_name, t.skill_mult = sk, mult
        db.session.add(t)
    db.session.commit()


def sync_moves():
    """Upsert Move theo key, dựng lại learnset. Id chiêu giữ nguyên nên equipped_moves không hỏng."""
    by_key = {}
    for key, name, el, kind, power, cd, target, val, desc in MOVES:
        m = Move.query.filter_by(key=key).first() or Move(key=key)
        m.name, m.element, m.kind, m.power = name, el, kind, power
        m.cooldown, m.target, m.value, m.description = cd, target, val, desc
        db.session.add(m)
        by_key[key] = m
    db.session.flush()
    for tname, learn in LEARNSET.items():
        t = AnimeCharacterTemplate.query.filter_by(name=tname).first()
        if not t:
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
        user = User(name="MultiverseMaster", tag="#3200", coins=1250, tickets=10, crystals=35)
        db.session.add(user)
        db.session.flush()
        for slot, tid in enumerate([1, 2, 3, 4, 7, 8]):  # đội khởi đầu: 1 SSR, 2 SR, 3 R
            db.session.add(UserCharacter(user_id=user.id, template_id=tid, level=5, slot=slot))
        for iid, qty in {1: 17, 2: 4, 3: 10, 4: 2}.items():
            db.session.add(UserInventory(user_id=user.id, item_id=iid, quantity=qty))
        db.session.commit()


def seed_story():
    """Đồng bộ STORY vào DB. boss = (tên, hệ[, ảnh]); enemies = [(tên, hệ[, ảnh]), ...]"""
    for s in STORY:
        u = db.session.get(Universe, s["id"]) or Universe(id=s["id"])
        u.name, u.chapter = s["name"], s["chapter"]
        u.lv_min, u.lv_max = s["lv_min"], s["lv_max"]
        u.boss_name, u.boss_element, *b = s["boss"]
        u.boss_image = b[0] if b else None
        u.drops = s["drops"]
