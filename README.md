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
