/* eslint-env browser */

// news_ticker.js — Thanh thông báo & mẹo chạy chữ

(function (window) {
  'use strict';

  /** =========================================
   * [0] STATE & CONFIG
   * ========================================= */
  const NewsTicker = {
    // [0.1] Tin nền mặc định (giữ lại & có thể chỉnh wording)
    defaultMessages: [
      'Mẹo: Tiêu diệt Boss và Mini-Boss sẽ có tỉ lệ rơi ra các trang bị hiếm!',
      'Thông báo: Cẩn thận vào ban đêm, zombie sẽ trở nên hung dữ và khó lường hơn.',
      'Mẹo: Sử dụng kỹ năng hợp lý để vượt qua các đợt tấn công khó khăn.',
      'Thông báo: Cửa hàng cung cấp nhiều vật phẩm hỗ trợ hữu ích.',
      'Mẹo: Hãy để ý đến thanh thể lực (Stamina), một số hành động sẽ tiêu hao nó.',
      'Thông báo: Phiên bản mới đã cập nhật hệ thống trang bị và ghép đồ!',
      "Mẹo: Nhấn phím 'C' để mở bảng nhân vật và quản lý trang bị của bạn.",
      'Mẹo: Mỗi khi ghép đồ thất bại, bạn sẽ nhận được 1% may mắn cho lần sau.',
    ],

    // [0.2] Bản tin theo buổi trong ngày (dựa trên dayTime → giờ game)
    timeBased: {
      morning: [
        '🌅 Buổi sáng: Zombie di chuyển chậm hơn.',
        '☀️ Mặt trời thiêu đốt khiến zombie mất HP theo thời gian.',
      ],
      evening: [
        '🌇 Chiều/chiều muộn: Chuẩn bị trước khi đêm xuống — kiểm tra lại trang bị.',
      ],
      night: [
        '🌙 Buổi tối: Zombie có thể hồi phục HP.',
        '⚠️ Buổi tối: Zombie di chuyển nhanh hơn — giữ khoảng cách an toàn!',
      ],
    },

    // [0.3] Runtime state
    messageQueue: [],
    isAnimating: false,
    tickerTextElement: null,
    tickerContainerElement: null,

    // [0.4] Guards chống spam theo giờ/buổi
    _lastHourPushed: -1,
    _lastDaypartPushed: '',

    // [0.5] Mảng tạm tái sử dụng (giảm cấp phát)
    _tmp: [],
  };

  /** =========================================
   * [1] init() — Khởi tạo & gắn events
   * ========================================= */
  NewsTicker.init = function init() {
    this.tickerTextElement = document.getElementById('newsTickerText');
    this.tickerContainerElement = document.getElementById(
      'newsTickerContainer'
    );

    if (!this.tickerTextElement || !this.tickerContainerElement) {
      console.error('News Ticker: Không tìm thấy các phần tử HTML cần thiết.');
      return;
    }

    // Khi 1 tin chạy xong → lấy tin kế tiếp; nếu hết thì ẩn + lên lịch đợt mới
    this.tickerTextElement.addEventListener('animationend', () => {
      this.isAnimating = false;
      if (this.messageQueue.length > 0) {
        this.showNextMessage(); // [6]
      } else {
        this.tickerContainerElement.classList.add('hidden'); // auto-ẩn khi hết
        this.scheduleNextBatch(); // [3] tạo đợt mới sau 20–60s
      }
    });

    // Phím H: ẩn/hiện ticker
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if ((e.key || '').toLowerCase() === 'h') this.toggleVisibility(); // [5]
    });
  };

  /** =========================================
   * [2] start(delay=3000) — Lên lịch đợt đầu
   * ========================================= */
  NewsTicker.start = function start(delay = 3000) {
    this.scheduleNextBatch(delay); // [3]
  };

  /** =========================================
   * [3] scheduleNextBatch(initialDelay=0)
   *     - Nghỉ ngẫu nhiên 20–60s (đợt đầu dùng delay truyền vào)
   *     - Nạp queue bằng _enqueueNextBatch()
   * ========================================= */
  NewsTicker.scheduleNextBatch = function scheduleNextBatch(initialDelay = 0) {
    const minDelay = 20000; // 20s
    const maxDelay = 60000; // 60s
    const randomDelay = Math.random() * (maxDelay - minDelay) + minDelay;
    const delay = initialDelay > 0 ? initialDelay : randomDelay;

    setTimeout(() => {
      this._enqueueNextBatch(); // [11]
      this.showNextMessage(); // [6]
    }, delay);
  };

  /** =========================================
   * [4] pushMessage(message, highPriority=false)
   *     - Module khác có thể đẩy tin vào hàng đợi
   * ========================================= */
  NewsTicker.pushMessage = function pushMessage(message, highPriority = false) {
    if (typeof message !== 'string' || message.trim() === '') return;
    if (highPriority) this.messageQueue.unshift(message);
    else this.messageQueue.push(message);
    if (!this.isAnimating) this.showNextMessage(); // [6]
  };

  /** =========================================
   * [5] toggleVisibility() — Ẩn/hiện bằng phím H
   * ========================================= */
  NewsTicker.toggleVisibility = function toggleVisibility() {
    const isHidden = this.tickerContainerElement.classList.toggle('hidden');
    if (this.isAnimating) {
      this.tickerTextElement.style.animationPlayState = isHidden
        ? 'paused'
        : 'running';
    }
  };

  /** =========================================
   * [6] showNextMessage() — Chạy 1 tin từ hàng đợi
   * ========================================= */
  NewsTicker.showNextMessage = function showNextMessage() {
    if (this.isAnimating || this.messageQueue.length === 0) return;

    this.isAnimating = true;
    this.tickerContainerElement.classList.remove('hidden');

    const message = this.messageQueue.shift();
    this.tickerTextElement.style.animation = 'none';

    // Force reflow + setup animation
    requestAnimationFrame(() => {
      this.tickerTextElement.textContent = message;

      const containerWidth = this.tickerContainerElement.offsetWidth;
      const textWidth = this.tickerTextElement.offsetWidth;

      this.tickerTextElement.style.setProperty(
        '--scroll-start',
        `${containerWidth}px`
      );
      this.tickerTextElement.style.setProperty(
        '--scroll-end',
        `-${textWidth}px`
      );

      const totalDistance = containerWidth + textWidth;
      const scrollSpeed = 40; // px/s (giữ giống bản gốc) :contentReference[oaicite:1]{index=1}
      const duration = totalDistance / scrollSpeed;

      this.tickerTextElement.style.animation = `scrollTicker ${duration}s linear`;
    });
  };

  /** =========================================
   * [7] getGameHour() — Lấy giờ (0..23) từ dayTime (0..1)
   *     - Fallback 6h nếu dayTime chưa sẵn sàng để tránh đẩy tin 'night' lúc mới vào
   * ========================================= */
  NewsTicker.getGameHour = function getGameHour() {
    try {
      const dt = typeof window.dayTime === 'number' ? window.dayTime : 0;
      if (Number.isFinite(dt) && dt > 0) {
        return Math.floor((dt * 24) % 24); // 0..23
      }
    } catch {
      /* ignore */
    }
    return 6; // fallback sáng 6h
  };

  /** =========================================
   * [8] getDaypart(h) — Suy ra buổi: morning/evening/night
   *     - Theo yêu cầu: 19h trở đi là night
   * ========================================= */
  NewsTicker.getDaypart = function getDaypart(h) {
    if (h >= 19 || h < 6) return 'night';
    if (h >= 6 && h <= 11) return 'morning';
    if (h >= 12 && h <= 17) return 'evening';
    return 'night'; // 18h coi là tối
  };

  /** =========================================
   * [9] pickTimeNews() — Lấy 0–2 tin theo buổi; mỗi buổi chỉ bơm 1 lần/chu kỳ
   * ========================================= */
  NewsTicker.pickTimeNews = function pickTimeNews() {
    const h = this.getGameHour(); // [7]
    const part = this.getDaypart(h); // [8]
    const list = this.timeBased[part];
    if (!list) return [];

    // Ngăn lặp lại trong cùng buổi
    if (this._lastDaypartPushed === part) return [];
    this._lastDaypartPushed = part;

    // Random 0–2 tin (thi thoảng không đẩy để đợt gọn)
    const pool = list.slice().sort(() => Math.random() - 0.5);
    const take = Math.random() < 0.25 ? 0 : Math.random() < 0.6 ? 1 : 2; // 25%:0, 45%:1, 30%:2
    return take > 0 ? pool.slice(0, take) : [];
  };

  /** =========================================
   * [10] bindGameClock() — Theo dõi mốc giờ & đẩy tin tức thì
   *      - 06:00: sáng bắt đầu
   *      - 19:00: tối bắt đầu
   * ========================================= */
  NewsTicker.bindGameClock = function bindGameClock() {
    if (this._clockBound) return;
    this._clockBound = true;

    setInterval(() => {
      const h = this.getGameHour(); // [7]
      if (h === this._lastHourPushed) return;
      this._lastHourPushed = h;

      if (h === 6) {
        this.pushMessage(
          '🌅 06:00 — Buổi sáng bắt đầu! Zombie bị mặt trời làm yếu và chậm hơn.',
          true
        );
        this.pushMessage(
          '☀️ Tip: Đi săn ban ngày an toàn hơn, ưu tiên clear map.',
          true
        );
        this._lastDaypartPushed = ''; // reset để batch kế tiếp có thể bơm time-news sáng
      }
      if (h === 19) {
        this.pushMessage(
          '🌙 19:00 — Buổi tối đã đến! Zombie có thể hồi phục HP và chạy nhanh hơn.',
          true
        );
        this.pushMessage(
          '⚠️ Tip: Dùng khống chế/đẩy lùi, tránh giao tranh gần.',
          true
        );
        this._lastDaypartPushed = ''; // reset để batch kế tiếp có thể bơm time-news tối
      }
    }, 1000);
  };

  /** =========================================
   * [11] _enqueueNextBatch() — Nạp queue cho 1 đợt:
   *      (a) 0–2 tin theo buổi  +  (b) 1–3 tin default đã xáo trộn
   * ========================================= */
  NewsTicker._enqueueNextBatch = function _enqueueNextBatch() {
    // (a) Lấy 0–2 tin theo buổi
    const timeNews = this.pickTimeNews(); // [9]

    // (b) Random 1–3 tin nền
    this._tmp.length = 0;
    for (let i = 0; i < this.defaultMessages.length; i++)
      this._tmp.push(this.defaultMessages[i]);
    this._tmp.sort(() => Math.random() - 0.5);

    const baseCount = this.pick1to3Count(); // [12]
    const baseNews = this._tmp.slice(0, baseCount);

    // (c) queue = timeNews (nếu có) + baseNews
    this.messageQueue = timeNews.length ? timeNews.concat(baseNews) : baseNews;
  };

  /** =========================================
   * [12] pick1to3Count() — Chọn 1..3 tin/đợt (60%:1, 30%:2, 10%:3)
   * ========================================= */
  NewsTicker.pick1to3Count = function pick1to3Count() {
    const r = Math.random();
    if (r < 0.6) return 1;
    if (r < 0.9) return 2;
    return 3;
  };

  // Xuất module
  window.NewsTicker = NewsTicker;
})(window);
