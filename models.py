from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(40), nullable=False)
    tag = db.Column(db.String(10), default="#0000")
    coins = db.Column(db.Integer, default=0)
    tickets = db.Column(db.Integer, default=0)
    crystals = db.Column(db.Integer, default=0)
    universe_id = db.Column(db.Integer, default=1)
    node = db.Column(db.Integer, default=1)
    max_universe = db.Column(db.Integer, default=1)
    last_online = db.Column(db.DateTime, default=now)
    last_reward_at = db.Column(db.DateTime)
    role = db.Column(db.String(10), default="player")   # player | admin
    password_hash = db.Column(db.String(255))
    characters = db.relationship("UserCharacter", backref="owner", lazy=True)
    inventory = db.relationship("UserInventory", backref="owner", lazy=True)


class AnimeCharacterTemplate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(60), nullable=False)
    universe = db.Column(db.String(60), nullable=False)
    element = db.Column(db.String(10), nullable=False)  # fire water wind earth thunder light dark
    rarity = db.Column(db.String(3), nullable=False)    # SSR SR R
    base_hp = db.Column(db.Integer, nullable=False)
    base_atk = db.Column(db.Integer, nullable=False)
    base_def = db.Column(db.Integer, nullable=False)
    base_spd = db.Column(db.Integer, nullable=False)
    skill_name = db.Column(db.String(80), nullable=False)
    skill_mult = db.Column(db.Float, nullable=False)
    image = db.Column(db.String(120))                   # vd: "naruto.png" trong static/img_char/
    learnset = db.relationship("CharacterMove", order_by="CharacterMove.learn_level",
                               cascade="all, delete-orphan")


class UserCharacter(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey("anime_character_template.id"), nullable=False)
    level = db.Column(db.Integer, default=1)
    exp = db.Column(db.Integer, default=0)
    slot = db.Column(db.Integer)  # 0-5 trong đội hình, None = nằm trong kho
    weapon_item_id = db.Column(db.Integer, db.ForeignKey("item.id"))  # dùng ở Giai đoạn 2
    equipped_moves = db.Column(db.JSON)  # [move_id, ...] tối đa 4; None = tự động
    template = db.relationship("AnimeCharacterTemplate")


class Move(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(40), unique=True, nullable=False)  # định danh ổn định để upsert
    name = db.Column(db.String(80), nullable=False)
    element = db.Column(db.String(10))                           # None = vô hệ
    kind = db.Column(db.String(10), default="damage")            # damage | heal
    power = db.Column(db.Float, default=1.0)
    cooldown = db.Column(db.Integer, default=3)
    target = db.Column(db.String(12), default="single")          # single | all | ally_lowest | ally_all
    value = db.Column(db.Float, default=0)                       # heal: % maxHP
    description = db.Column(db.String(160), default="")

    def to_dict(self):
        return {"id": self.id, "key": self.key, "name": self.name, "element": self.element,
                "kind": self.kind, "power": self.power, "cooldown": self.cooldown,
                "target": self.target, "value": self.value, "desc": self.description}


class CharacterMove(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    template_id = db.Column(db.Integer, db.ForeignKey("anime_character_template.id"), nullable=False)
    move_id = db.Column(db.Integer, db.ForeignKey("move.id"), nullable=False)
    learn_level = db.Column(db.Integer, default=1)
    move = db.relationship("Move")


class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(60), nullable=False)
    kind = db.Column(db.String(12), nullable=False)  # consumable | equipment
    icon = db.Column(db.String(20), default="flask")
    description = db.Column(db.String(160), default="")
    rarity = db.Column(db.String(3), default="R")
    price = db.Column(db.Integer, default=0)
    effect_type = db.Column(db.String(12))  # heal_pct | buff_atk | revive
    effect_value = db.Column(db.Float, default=0)
    atk_bonus = db.Column(db.Integer, default=0)
    hp_bonus = db.Column(db.Integer, default=0)
    def_bonus = db.Column(db.Integer, default=0)


class UserInventory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey("item.id"), nullable=False)
    quantity = db.Column(db.Integer, default=0)
    item = db.relationship("Item")


class Universe(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    chapter = db.Column(db.String(80), nullable=False)
    lv_min = db.Column(db.Integer, nullable=False)
    lv_max = db.Column(db.Integer, nullable=False)
    boss_name = db.Column(db.String(80), nullable=False)
    boss_element = db.Column(db.String(10), nullable=False)
    boss_image = db.Column(db.String(120))
    drops = db.Column(db.JSON, default=list)  # tên vật phẩm rơi
    enemies = db.relationship("UniverseEnemy", backref="universe", order_by="UniverseEnemy.id",
                              cascade="all, delete-orphan")

    def to_dict(self):
        return {"id": self.id, "name": self.name, "chapter": self.chapter,
                "lv_min": self.lv_min, "lv_max": self.lv_max,
                "enemies": [{"name": e.name, "element": e.element, "image": e.image} for e in self.enemies],
                "boss": {"name": self.boss_name, "element": self.boss_element, "image": self.boss_image},
                "drops": self.drops or []}


class UniverseEnemy(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    universe_id = db.Column(db.Integer, db.ForeignKey("universe.id"), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    element = db.Column(db.String(10), nullable=False)
    image = db.Column(db.String(120))