<!--
  🎮 Zombie Survivor
  ✨ Version: 1.0.0
  🖋️ Tác giả: Dang

  📖 Mô tả trò chơi:
    Zombie Survivor là một tựa game 2D sinh tồn, nơi người chơi phải chiến đấu chống lại những đợt tấn công ngày càng mạnh mẽ của zombie.
    Game cung cấp hệ thống kỹ năng đa dạng, các vật phẩm hỗ trợ (Energy, Mana, HP, Hộp vật phẩm đặc biệt) rơi ngẫu nhiên từ zombie,
    cho phép người chơi nâng cấp sức mạnh và tồn tại lâu nhất có thể.

  📂 Cấu trúc file:
  |-- 🎮 Khởi tạo game & cấu hình Canvas
  |-- 🌀 Object Pooling (zombie, đạn, vật phẩm...)
  |-- 💥 Các hàm tiện ích (distance, quản lý object pooling)
  |-- 🎁 Quản lý vật phẩm rơi (dropItem, openItemBox)
  |-- 🔫 Xử lý kỹ năng, trạng thái và logic bắn
  |-- 🧟 Quản lý spawn Zombie & Boss
  |-- 🔄 Hàm update() - Cập nhật trạng thái game, logic nhặt vật phẩm
  |-- 🎨 Hàm draw() - Hiển thị player, zombie, vật phẩm, hiệu ứng...
  |-- 📌 Quản lý UI, Overlay, giao diện, và các nút bấm điều khiển.
-->

Vòng lặp render > • Dồn các phép tính trùng (như distance(player,z)) vào biến tạm.
DOM update > Trong updateUI() vẫn cập nhật innerText mọi 16 ms; bạn có cờ lastScore, nhưng với stat-moveSpeed\* vẫn thay liên tục. Nên gom vào requestAnimationFrame/setInterval 250 ms.

- Nút: tất cả <button> chưa có aria-label; icon emoji không đọc được bởi screen-reader.
- Bàn phím: Bạn đã map phím X/Z/M/C, nhưng thiếu focus outline khi ẩn UI (WCAG 2.1). > giải thích đoạn này

Mobile: thiếu <meta name="viewport"> → canvas bị phóng to. > Thêm <meta viewport> và scale canvas theo window.devicePixelRatio.
Chơi lại: location.reload() mất cache; nên reset state thay vì reload trang.
Lag ở wave cao: Xem xét Web Worker cho AI

Const/Enum: Các chuỗi “wave”, “boss”, “miniBoss”… nên gom về const TYPE = {BOSS:'boss', …}.
Dynamic data: Bảng levelBackgrounds 50 dòng → có thể sinh tự động (HSL) để giảm code.

-

1. Ưu điểm
   Tính năng đa dạng:
   Đã có nhiều kỹ năng chủ động, kỹ năng mặc định, hệ thống nâng cấp, boss, big boss, pet, vật phẩm, hiệu ứng ngày đêm, minimap, hiệu ứng hình ảnh đẹp mắt.
   Tối ưu hóa:
   Sử dụng object pooling cho zombie, đạn, hiệu ứng nổ, giúp giảm rác bộ nhớ và tăng FPS.
   UI/UX:
   Có các popup nâng cấp, bảng kỹ năng, thống kê, hướng dẫn, thông báo, hiệu ứng động đẹp.
   Tổ chức code:
   Chia nhỏ thành các hàm riêng cho từng chức năng (spawn, update, draw, hiệu ứng, kỹ năng...).
   Tất cả trong 1 file:
   Đáp ứng mục tiêu single-file, dễ deploy, dễ test.
2. Nhược điểm & Vấn đề
   A. Cấu trúc và tổ chức code
   Quá dài và phức tạp:
   File đã vượt 5000 dòng, rất khó bảo trì, tìm lỗi, mở rộng.
   Chưa tách biệt rõ các module:
   Logic game, UI, hiệu ứng, pooling, kỹ năng, AI zombie... đều nằm chung, khó tái sử dụng.
   Một số biến toàn cục có thể bị trùng hoặc khó kiểm soát khi mở rộng.
   B. Trùng lặp & thừa
   Nhiều nút kỹ năng thunderBtn bị lặp trong HTML (có 3 nút thunderBtn, chỉ nên có 1).
   Một số hàm hoặc biến có thể bị lặp lại logic (ví dụ: update trạng thái kỹ năng, update UI, updateStatsOverlay).
   Một số hiệu ứng vẽ (explosions, particles, drawEffects) có thể gộp lại hoặc tối ưu hơn.
   C. Thiếu & chưa tối ưu
   Chưa có hệ thống quản lý trạng thái game rõ ràng (state machine).
   Chưa gom các constant cấu hình (ví dụ: thời gian, sát thương, cooldown) vào 1 nơi dễ chỉnh sửa.
   Chưa có lazy rendering cho các hiệu ứng phức tạp (có thể gây drop FPS khi nhiều zombie/hiệu ứng).
   Chưa có throttle/debounce cho các sự kiện DOM hoặc update UI (có thể gây lag khi nhiều update liên tục).
   Chưa có kiểm soát FPS tối đa (có thể gây nóng máy khi không giới hạn requestAnimationFrame).
   Chưa có phân tách rõ ràng giữa logic game và logic vẽ (draw/update đôi khi lẫn lộn).
   Chưa có hệ thống lưu trạng thái (save/load) hoặc highscore thực sự.
3. Các bước cải tiến đề xuất
   A. Tối ưu cấu trúc & tổ chức code
   Gom các nhóm hàm liên quan thành "module" nhỏ (theo dạng comment hoặc object):
   Ví dụ: ZombieManager, SkillManager, UIManager, EffectManager, PoolManager, ...
   Đặt các constant cấu hình (cooldown, damage, duration, limit, ...) vào 1 object duy nhất để dễ chỉnh sửa.
   Đảm bảo mỗi kỹ năng chỉ có 1 nút trên UI, tránh trùng lặp id.
   Tách rõ các hàm update logic và hàm vẽ (draw), tránh lẫn lộn.
   Tối ưu vòng lặp update:
   Chỉ update những gì cần thiết (ví dụ: zombie ngoài màn hình không cần update hiệu ứng).
   Sử dụng pooling triệt để cho mọi object động (đạn, hiệu ứng, zombie, ...).
   B. Tối ưu hiệu năng (FPS)
   Giới hạn số lượng zombie, đạn, hiệu ứng nổ, particle tối đa trên màn hình.
   Chỉ vẽ những gì nằm trong camera (viewport).
   Giảm tần suất update UI, chỉ update khi có thay đổi thực sự.
   Sử dụng requestAnimationFrame hợp lý, có thể thêm throttle nếu cần.
   Tối ưu các hàm vẽ hiệu ứng động (particles, explosions, ...), tránh vẽ quá nhiều hoặc quá phức tạp khi không cần thiết.
   C. Cải thiện logic & mở rộng
   Tách rõ các biến trạng thái cho từng hiệu ứng (stun, burn, freeze, slow, ...).
   Chuẩn hóa hệ thống cooldown, hiệu ứng cho từng loại kỹ năng/zombie.
   Thêm hệ thống lưu trạng thái (localStorage) cho highscore, setting, ...
   Thêm hướng dẫn, tooltip chi tiết cho từng kỹ năng, nâng cấp.
   Tối ưu AI zombie: chỉ update AI cho zombie gần player hoặc trong camera.
   D. Dọn dẹp & chuẩn hóa
   Xóa các biến, hàm, nút, logic không còn dùng hoặc bị lặp.
   Đặt tên biến, hàm rõ ràng, nhất quán (tiếng Anh hoặc Việt, không lẫn lộn).
   Thêm comment cho các đoạn code phức tạp, giải thích ý nghĩa.
   Kiểm tra lại các id, class trong HTML để tránh trùng lặp.
4. Các bước thực hiện cụ thể
   Dọn dẹp HTML:

Chỉ giữ 1 nút cho mỗi kỹ năng (id duy nhất).
Gom các popup, overlay vào cuối file, đặt id/class rõ ràng.
Gom constant cấu hình:

Tạo 1 object CONFIG chứa toàn bộ giá trị mặc định (cooldown, damage, limit, ...).
Tách module logic:

Gom các hàm spawn/update zombie vào 1 block.
Gom các hàm kỹ năng vào 1 block.
Gom các hàm vẽ hiệu ứng vào 1 block.
Tối ưu vòng lặp update/draw:

Chỉ update/vẽ những gì cần thiết.
Giới hạn số lượng object động.
Tối ưu UI:

Chỉ update DOM khi có thay đổi.
Sử dụng class, id nhất quán.
Kiểm tra và chuẩn hóa biến trạng thái:

Mỗi hiệu ứng (stun, burn, freeze, slow, ...) có biến riêng.
Không dùng chung biến cho nhiều hiệu ứng.
Thêm comment, hướng dẫn, chuẩn hóa tên hàm/biến.

---

A. Tái tổ chức lại block theo dạng module trong 1 file:
Block Nội dung
🔰 // CONFIG / CONSTANTS Toàn bộ số cố định, enum, map, bảng màu... gom hết về đây.
🔰 // GLOBAL STATE Gom lại các biến player, zombieList, bulletList thành 1 khối rõ ràng.
🔰 // ENTITY / CLASS Tách riêng các khối: Bullet, Zombie, Boss, Item, Explosion, ... thành function createXXX().
🔰 // INPUT Gom tất cả key, mouse, touch vào 1 block duy nhất.
🔰 // GAME LOOP 1 function rõ ràng update(), draw(), tách riêng.
🔰 // UI Mọi thứ liên quan UI (score, button, popup) gom về 1 chỗ.
🔰 // SKILL SYSTEM Toàn bộ kỹ năng active / passive gom rõ ràng.
🔰 // DEBUG / DEV TOOL Bảng test, debug warning,... gom 1 block.

🔹 B. Loại bỏ / sửa lỗi thừa, trùng:
Vấn đề Cần làm gì
id="thunderBtn" trùng 3 lần Đổi id hoặc gom lại chung 1 nút.
Nhiều activateSkill... giống nhau Viết lại theo dạng activateSkill(name, config).
Magic numbers (0.5, 60,...) Tạo 1 object CONFIG = { ENERGY_COST: ..., FIRE_DURATION: ...}.
🔹 C. Tối ưu hiệu suất (FPS):
Vấn đề Việc cần làm
Pooling đã tốt 👍 Giữ nguyên. Có thể thêm pool cho explosion, thunder.
Particle, drawBackground, star... Đừng recreate array mỗi frame, chỉ update.
Tách UI update riêng với canvas render UI DOM chỉ update khi thay đổi, đừng mỗi frame .innerText.
Giảm check distance() khi list zombie quá nhiều Dùng broad phase: vùng camera trước, sau mới distance().

- Thêm phím ESC để mở cài đặt âm thanh, menu game
- Thêm ExpUp, magnet
  Thêm rương vật phẩm hỗ trợ 9h 12h 15h
  Thêm vật phẩm mới secret, expbonus
  secret sẽ nhận ngẫu nhiên xu, exp, buff hoặc boss
  Thay đổi hệ thống tính exp
- Sắp làm: thêm đạn đặc biệt vào shop sẽ mua bằng xu
- Thêm vật phẩm mới: Potion > tăng nhiều hp

---

> thêm boss có 1% sinh ra: done
>
> > sắp làm:
> > thêm trang bị cho đủ 16 ô: done
> > thêm logic ghép các sợi lông thành cánh
> > safe zone tự hủy và hồi phục: done
> > thêm bản tin : done

- Thêm giáp cho zombie: done
- Thêm % att % giáp

  === thả đúng 32 món
  (() => {
  if (!window.EquipmentDropAPI?.forceDropAt) { console.warn('Thiếu EquipmentDropAPI.forceDropAt'); return; }
  // ĐIỀN LIST metaIndex đúng bạn đã tra được ở bước B1:
  const IDX = [
  /* ví dụ */ 142,143, 151,152, 161,162, 170,171,
  182,183, 190,191, 205,206, 214,215,
  223,224, 231,232, 241,242, 253,254,
  261,262, 271,272, 281,282,
  ];
  const px = player?.x ?? 0, py = player?.y ?? 0;
  const R = 140, step = (Math.PI*2)/IDX.length;
  const tier = 8, rarity = 'legendary';
  let ok=0,fail=0;
  for (let i=0;i<IDX.length;i++){
  const ang = i*step, x=px+Math.cos(ang)*R, y=py+Math.sin(ang)*R;
  try { EquipmentDropAPI.forceDropAt(x,y,{tier,rarity,metaIndex:IDX[i]}); ok++; } catch(e){ console.warn(e); fail++; }
  }
  console.log(`✅ Đã thả chính xác ${ok}/${IDX.length} món theo metaIndex đã dò.`);
  })();
