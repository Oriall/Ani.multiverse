# Dữ liệu cốt truyện gốc. Sửa ở đây rồi khởi động lại app để đồng bộ vào DB.
STORY = [
    {"id": 1, "name": "Vũ trụ Nhẫn Giả", "chapter": "Chương 1: Làng Lá Rơi", "lv_min": 1, "lv_max": 12,
     "enemies": [("Nhẫn giả lạc lối", "earth", "rogue.png"), ("Rối đất", "earth", "earth_monster.png"), ("Sát thủ bóng đêm", "dark", "assasin.png")],
     "boss": ("Kỵ Sĩ Hắc Diện", "dark", "knight.png"), "drops": ["Bình Hồi Máu", "Thuốc Cuồng Nộ"]},
    {"id": 2, "name": "Vũ trụ Hải Tặc & Thợ Săn", "chapter": "Chương 2: Biển Sấm Chớp", "lv_min": 12, "lv_max": 30,
     "enemies": [("Hải tặc nổi loạn", "water", "pirate.png"), ("Thú săn mồi", "thunder", "hunter.png"), ("Pháo thủ ma", "fire", "artillery.png")],
     "boss": ("Thuyền Trưởng Bão Tố", "thunder", "captain.png"), "drops": ["Bình Hồi Máu", "Đại Hồi Máu"]},
    {"id": 3, "name": "Vũ trụ Giả Kim", "chapter": "Chương 3: Đại Chiến Khôi Lỗi", "lv_min": 30, "lv_max": 55,
     "enemies": [("Khôi lỗi sắt", "earth", "golem.png"), ("Chimera thí nghiệm", "wind", "chimera.png"), ("Hồn thể đỏ", "fire", "soul.png")],
     "boss": ("Giáo Sư Hiền Giả", "light", "sage.png"), "drops": ["Đại Hồi Máu", "Bùa Hồi Sinh"]},
    {"id": 4, "name": "Vũ trụ Học Viện Anh Hùng", "chapter": "Chương 4: Kỳ Thi Phản Diện", "lv_min": 55, "lv_max": 85,
    "enemies": [("Nhẫn Giả Phản Bội", "dark", "rogue_ninja.png"), ("Sói Rừng", "earth", "wolf.png")],
    "boss": ("Chúa Tể Cửu Vĩ", "fire", "kyubi.png"), "drops": ["Đại Hồi Máu", "Bùa Hồi Sinh", "Thuốc Cuồng Nộ"]},
]