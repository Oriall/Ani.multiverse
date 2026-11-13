from characters_data import CHARACTERS

ELE = {"fire": "Hỏa", "water": "Thủy", "wind": "Phong", "earth": "Thổ",
       "thunder": "Lôi", "light": "Quang", "dark": "Ám"}
SIG_POWER = {"SSR": 2.4, "SR": 2.0, "R": 1.7}

# key, tên, hệ, loại, power, cooldown, target, value, mô tả
MOVES = [
    ("heal_light", "Ánh Sáng Chữa Lành", "light", "heal", 0, 4, "ally_lowest", 0.35, "Hồi 35% HP cho đồng đội yếu nhất."),
    ("heal_mist", "Sương Thanh Tẩy", "water", "heal", 0, 5, "ally_all", 0.20, "Hồi 20% HP cho cả đội."),
]

# Chiêu học thêm: tên nhân vật -> [(key, level)]
EXTRA = {
    "Alina Giả Kim": [("heal_light", 6)],
    "Hana Dược Sư": [("heal_mist", 4)],
    "Maya Hoa Tiêu": [("heal_mist", 10)],
}

LEARNSET = {}
for n, uni, el, r, spd, sk, img in CHARACTERS:
    sig = "sig_" + img.rsplit(".", 1)[0]
    MOVES.append((sig, sk, el, "damage", SIG_POWER[r], 3, "single", 0, f"Tuyệt chiêu của {n}."))
    LEARNSET[n] = [(sig, 1), (f"{el}_strike", 3), (f"{el}_wave", 8)] + EXTRA.get(n, [])

for el, vn in ELE.items():
    MOVES.append((f"{el}_strike", f"{vn} Kích", el, "damage", 1.4, 2, "single", 0, f"Đòn đánh hệ {vn}."))
    MOVES.append((f"{el}_wave", f"Sóng {vn}", el, "damage", 0.9, 4, "all", 0, f"Tấn công toàn bộ kẻ địch bằng hệ {vn}."))