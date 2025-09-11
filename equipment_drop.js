/* eslint-env browser */
// equipment_drop.js — New rarity-by-zombie-level & tier-window drop, GC-optimized
(function EquipmentDropModule() {
  'use strict';

  /* ================== CONFIG ================== */
  const CONFIG = {
    // Tần suất rơi (không thay đổi theo wave/level người chơi)
    BASE_CHANCE: 0.06,
    MULT: { normal: 1.0, mini: 1.8, elite: 1.3, boss: 2.2, bigboss: 3.5 },
    LUCKY_BONUS: 0.04, // +4% nếu đang buff lucky

    // Rarity base distribution theo cấp zombie (L=1..10) cho quái thường
    // (giá trị dạng tỉ lệ: 1 = 100%)
    RARITY_BASE_BY_L: {
      1: [1.0, 0.0, 0.0, 0.0, 0.0], // C,R,E,L,RC
      2: [0.92, 0.08, 0.0, 0.0, 0.0],
      3: [0.85, 0.13, 0.02, 0.0, 0.0],
      4: [0.75, 0.2, 0.05, 0.0, 0.0],
      5: [0.65, 0.25, 0.08, 0.02, 0.0],
      6: [0.55, 0.28, 0.12, 0.04, 0.01],
      7: [0.45, 0.3, 0.16, 0.07, 0.02],
      8: [0.38, 0.32, 0.18, 0.09, 0.03],
      9: [0.32, 0.33, 0.2, 0.11, 0.04],
      10: [0.26, 0.34, 0.22, 0.13, 0.05],
    },

    // “Đẩy” phân phối lên bậc cao hơn theo loại quái (chuyển khối lượng từ bậc thấp -> cao)
    // thứ tự: C->R, R->E, E->L, L->RC
    RARITY_SHIFT: {
      mini: [0.12, 0.08, 0.03, 0.01],
      elite: [0.12, 0.08, 0.03, 0.01],
      boss: [0.2, 0.1, 0.05, 0.02],
      bigboss: [0.28, 0.14, 0.07, 0.03],
      normal: [0.0, 0.0, 0.0, 0.0],
    },

    // Cửa sổ tier theo L và loại
    // normal: [L-2..L+2], mini/elite: [L-1..L+3], boss/bigboss: [L..L+4] (cắt [1..10])
    // L1 đặc biệt: normal chỉ 1..3
    JACKPOT_T10_BY_L: {
      1: 0,
      2: 0,
      3: 0,
      4: 0.01,
      5: 0.02,
      6: 0.04,
      7: 0.06,
      8: 0.1,
      9: 0.15,
      10: 0.2,
    },

    // Nametag, màu
    RARITY_NAMES: ['common', 'rare', 'epic', 'legendary', 'relic'],
    RARITY_COLOR: {
      common: '#9e9e9e',
      rare: '#4fc3f7',
      epic: '#ab47bc',
      legendary: '#ffb300',
      relic: '#ff7043',
    },

    // Hiển thị, TTL, magnet
    FALLBACK_ICON: '◉',
    PICKUP_R: 20,
    MAGNET_R: 200,
    MAGNET_SPEED: 5,
    TTL_MS: typeof window.ITEM_TTL_MS === 'number' ? window.ITEM_TTL_MS : 15000,
  };
  const MAGNET_R2 = CONFIG.MAGNET_R * CONFIG.MAGNET_R;
  const PICKUP_R2 = CONFIG.PICKUP_R * CONFIG.PICKUP_R;

  /* ================== STATE/POOL ================== */
  const equipDrops = [];
  const dropPool = [];
  let VERBOSE = false;
  const DEBUG = {
    lastSpawn: {},
    lastPickup: {},
    lastError: null,
    drops: equipDrops,
  };
  function log(...a) {
    if (VERBOSE) console.log('[EquipDrop]', ...a);
  }
  function warn(...a) {
    console.warn('[EquipDrop]', ...a);
  }

  window.EquipmentDropAPI = window.EquipmentDropAPI || {};
  Object.assign(window.EquipmentDropAPI, {
    enableVerbose(v = true) {
      VERBOSE = !!v;
    },
    debugDump() {
      console.log('[EquipDrop][dump]', {
        drops: equipDrops.slice(),
        DEBUG,
        CONFIG,
      });
    },
    CONFIG,
  });

  /* ================== HELPERS ================== */
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function luckyActive() {
    return (
      typeof window.luckyBuffEndTime === 'number' &&
      Date.now() < window.luckyBuffEndTime
    );
  }

  function roll01() {
    return Math.random();
  }
  function pickByWeights(ws) {
    // ws = [w1,w2,...], return index
    let sum = 0;
    for (let i = 0; i < ws.length; i++) sum += ws[i];
    if (sum <= 0) return 0;
    let r = Math.random() * sum;
    for (let i = 0; i < ws.length; i++) {
      r -= ws[i];
      if (r <= 0) return i;
    }
    return ws.length - 1;
  }

  /* ================== RARITY BY Z-LEVEL ================== */
  function getBaseRarityDist(L) {
    const key = clamp(L | 0, 1, 10);
    return CONFIG.RARITY_BASE_BY_L[key].slice(); // copy
  }
  // shift khối lượng theo schema [c2r,r2e,e2l,l2rc]
  function shiftRarity(dist, type) {
    const sh = CONFIG.RARITY_SHIFT[type] || CONFIG.RARITY_SHIFT.normal;
    // dist: [C,R,E,L,RC]
    // C->R
    let m = Math.min(sh[0], dist[0]);
    dist[0] -= m;
    dist[1] += m;
    // R->E
    m = Math.min(sh[1], dist[1]);
    dist[1] -= m;
    dist[2] += m;
    // E->L
    m = Math.min(sh[2], dist[2]);
    dist[2] -= m;
    dist[3] += m;
    // L->RC
    m = Math.min(sh[3], dist[3]);
    dist[3] -= m;
    dist[4] += m;
    // normalize (đề phòng sai số nhỏ)
    const s = dist[0] + dist[1] + dist[2] + dist[3] + dist[4];
    if (s > 0) {
      for (let i = 0; i < 5; i++) dist[i] /= s;
    }
    return dist;
  }
  function rollRarityByZLevel(L, type = 'normal') {
    const base = getBaseRarityDist(L);
    const dist = shiftRarity(base, type);
    const idx = pickByWeights(dist);
    return CONFIG.RARITY_NAMES[idx];
  }

  /* ================== TIER WINDOW BY Z-LEVEL ================== */
  function getTierWindow(L, type = 'normal') {
    const l = clamp(L | 0, 1, 10);
    let lo, hi;
    if (type === 'boss' || type === 'bigboss') {
      lo = l;
      hi = l + 4;
    } else if (type === 'mini' || type === 'elite') {
      lo = l - 1;
      hi = l + 3;
    } else {
      // normal
      lo = l - 2;
      hi = l + 2;
      if (l === 1) {
        lo = 1;
        hi = 3;
      } // đúng yêu cầu: L1 chỉ 1..3
    }
    lo = clamp(lo, 1, 10);
    hi = clamp(hi, 1, 10);
    if (hi < lo) hi = lo;
    return [lo, hi];
  }
  function tierWeights(n, type) {
    // n = số bậc trong cửa sổ
    if (type === 'boss') return Array.from({ length: n }, (_, i) => i + 1); // k
    if (type === 'bigboss')
      return Array.from({ length: n }, (_, i) => (i + 1) * (i + 1)); // k^2
    if (type === 'mini' || type === 'elite') return Array(n).fill(1); // đều
    // normal: đáy-nặng
    return Array.from({ length: n }, (_, i) => n - i); // n, n-1, ...
  }
  function jackpotT10(L, type) {
    if (type !== 'bigboss') return 0;
    const key = clamp(L | 0, 1, 10);
    return CONFIG.JACKPOT_T10_BY_L[key] || 0;
  }
  function rollTierByZLevel(L, type = 'normal') {
    // BigBoss jackpot trước
    const jp = jackpotT10(L, type);
    if (jp > 0 && roll01() < jp) return 10;

    const [lo, hi] = getTierWindow(L, type);
    const n = hi - lo + 1;
    const ws = tierWeights(n, type);
    const idx = pickByWeights(ws);
    return lo + idx;
  }

  /* ================== EQUIP CATALOG (12 slots) ================== */
  // Với slot “2 loại”, dùng slotOptions để auto-equip vào ô trống.
  const SLOT_META = [
    {
      name: 'Vũ khí',
      icon: '🗡️',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({ damageBoost: Math.max(1, Math.round(t * 1.4)) }),
    },
    {
      name: 'Giáp',
      icon: '🦺',
      slot: 'Giáp',
      bonus: (t) => ({
        hearts: Math.round(t * 0.8) + 1,
        armor: t >= 6 ? 1 : 0,
      }),
    },
    {
      name: 'Mũ',
      icon: '🪖',
      slot: 'Mũ',
      bonus: (t) => ({
        hearts: Math.round(t * 0.4),
        critRate: t >= 6 ? 0.02 : 0,
      }),
    },
    {
      name: 'Găng',
      icon: '🧤',
      slot: 'Găng',
      bonus: (t) => ({ critDmg: Math.min(1.2, 0.1 + (t - 1) * 0.05) }),
    },
    {
      name: 'Giày',
      icon: '🥾',
      slot: 'Giày',
      bonus: (t) => ({ moveSpeed: Math.min(1.5, 0.05 * t) }),
    },
    {
      name: 'Nhẫn',
      icon: '💍',
      slotOptions: ['Nhẫn Trái', 'Nhẫn Phải'],
      bonus: (t) => ({
        critRate: Math.min(0.3, 0.015 * t),
        critDmg: Math.min(0.8, 0.06 * t),
      }),
    },
    {
      name: 'Dây chuyền',
      icon: '📿',
      slot: 'Dây chuyền',
      bonus: (t) => ({ bulletSpeed: Math.min(3.0, 0.12 * t) }),
    },
    {
      name: 'Bông tai',
      icon: '🦻',
      slot: 'Bông tai',
      bonus: (t) => ({ critRate: Math.min(0.25, 0.02 * t) }),
    },
    {
      name: 'Mắt kính',
      icon: '🕶️',
      slot: 'Mắt kính',
      bonus: (t) => ({ critDmg: Math.min(1.0, 0.08 * t) }),
    },
    {
      name: 'Khiên',
      icon: '🛡️',
      slot: 'Khiên',
      bonus: (t) => ({
        hearts: Math.round(t * 0.7) + 1,
        armor: t >= 7 ? 1 : 0,
      }),
    },
  ];
  const ALL_SINGLE_SLOTS = [
    'Giáp',
    'Mũ',
    'Găng',
    'Giày',
    'Dây chuyền',
    'Bông tai',
    'Mắt kính',
    'Khiên',
  ];
  const ALL_MULTI_SLOTS = [
    ['Vũ khí 1', 'Vũ khí 2'],
    ['Nhẫn Trái', 'Nhẫn Phải'],
  ];
  // Export để tái sử dụng và tránh ESLint no-unused-vars
  Object.assign(window.EquipmentDropAPI, {
    ALL_SINGLE_SLOTS,
    ALL_MULTI_SLOTS,
  });

  function buildEntry({ tier, rarity, meta }) {
    const inst = {
      id: `${(meta.name || 'item')
        .toLowerCase()
        .replace(/\s+/g, '_')}_${Date.now().toString(36)}`,
      name: `${meta.name} Bậc ${tier}`,
      icon: meta.icon || CONFIG.FALLBACK_ICON,
      slot: meta.slot || undefined,
      slotOptions: meta.slotOptions ? meta.slotOptions.slice() : undefined,
      tier,
      rarity, // <-- rarity độc lập, UI sẽ dùng nếu có; nếu không có sẽ tự suy theo tier
      bonuses: meta.bonus ? meta.bonus(tier) : {},
    };
    return inst;
  }

  function pickMetaForDrop() {
    // Chọn 1 “loại” slot ngẫu nhiên (có trọng số nhẹ để vũ khí/nhẫn không quá nhiều)
    // bạn có thể tinh chỉnh thêm nếu muốn
    const pool = SLOT_META;
    return pool[(Math.random() * pool.length) | 0];
  }

  /* ================== POOL & RENDER ================== */
  function getDrop() {
    return dropPool.length
      ? dropPool.pop()
      : {
          x: 0,
          y: 0,
          active: false,
          bornAt: 0,
          icon: '',
          color: '',
          entry: null,
        };
  }
  function releaseDrop(d) {
    d.active = false;
    d.entry = null;
    dropPool.push(d);
  }

  function spawnEquipEntryAt(x, y, entry) {
    const d = getDrop();
    d.x = x;
    d.y = y;
    d.active = true;
    d.bornAt = Date.now();
    d.icon = entry.icon || CONFIG.FALLBACK_ICON;
    d.color = CONFIG.RARITY_COLOR[entry.rarity] || '#fff';
    d.entry = entry;
    equipDrops.push(d);
    const sp = DEBUG.lastSpawn;
    sp.time = d.bornAt;
    sp.x = x;
    sp.y = y;
    sp.id = entry.id;
    sp.tier = entry.tier;
    sp.rarity = entry.rarity;
    log('Spawn equip', entry);
  }

  function updateEquipDrops(now, px, py) {
    const hasXY = Number.isFinite(px) && Number.isFinite(py);
    const pX = hasXY ? px : window.player?.x;
    const pY = hasXY ? py : window.player?.y;
    if (!Number.isFinite(pX) || !Number.isFinite(pY)) {
      DEBUG.lastError = 'No player coords';
      return;
    }

    // Magnet
    if (
      typeof window.magnetBuffEndTime === 'number' &&
      now < window.magnetBuffEndTime
    ) {
      for (let i = 0; i < equipDrops.length; i++) {
        const it = equipDrops[i];
        if (!it.active) continue;
        const dx = pX - it.x,
          dy = pY - it.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < MAGNET_R2 && d2 > 1e-4) {
          const inv = CONFIG.MAGNET_SPEED / Math.sqrt(d2);
          it.x += dx * inv;
          it.y += dy * inv;
        }
      }
    }

    // Pickup
    for (let i = 0; i < equipDrops.length; i++) {
      const it = equipDrops[i];
      if (!it.active) continue;
      const dx = it.x - pX,
        dy = it.y - pY;
      if (dx * dx + dy * dy > PICKUP_R2) continue;

      if (!window.Equip || !Array.isArray(window.Equip.inventory)) {
        DEBUG.lastError = 'Equip.inventory missing';
        warn('Equip.inventory missing');
        it.active = false;
        continue;
      }
      window.playSound && window.playSound('sfx-pickup', 0.5);
      window.Equip.inventory.push(it.entry);

      const rare = it.entry.rarity;
      window.showWarning &&
        window.showWarning(
          `${rare ? rare.toUpperCase() : ''} ✅ Nhặt: ${it.entry.icon || ''} ${
            it.entry.name
          }`
        );

      if (typeof window.recalcEquipStats === 'function')
        window.recalcEquipStats();
      if (window.CharacterPanel?.refresh) window.CharacterPanel.refresh();

      it.active = false;
      const pk = DEBUG.lastPickup;
      pk.time = now;
      pk.id = it.entry.id;
      pk.tier = it.entry.tier;
      pk.rarity = rare;
    }

    // TTL cleanup (nén mảng + trả pool)
    if (!updateEquipDrops._next || now >= updateEquipDrops._next) {
      updateEquipDrops._next = now + 300;
      let w = 0;
      for (let r = 0; r < equipDrops.length; r++) {
        const it = equipDrops[r];
        const alive =
          it && it.active && now - (it.bornAt || now) <= CONFIG.TTL_MS;
        if (alive) {
          if (w !== r) equipDrops[w] = it;
          w++;
        } else if (it) {
          releaseDrop(it);
        }
      }
      equipDrops.length = w;
    }
  }

  function drawEquipDrops(ctx) {
    if (!ctx) return;
    let left = -Infinity,
      right = Infinity,
      top = -Infinity,
      bottom = Infinity;
    const cam = window.camera,
      cvs = window.canvas;
    if (cam && cvs) {
      left = cam.x - 32;
      right = cam.x + cvs.width + 32;
      top = cam.y - 32;
      bottom = cam.y + cvs.height + 32;
    }

    for (let i = 0; i < equipDrops.length; i++) {
      const it = equipDrops[i];
      if (!it.active) continue;
      if (it.x < left || it.x > right || it.y < top || it.y > bottom) continue;

      const icon = it.icon || CONFIG.FALLBACK_ICON;
      const color = it.color || '#fff';
      const bob = Math.sin((window.frame || 0) / 10 + it.x + it.y) * 2;

      ctx.save();
      ctx.font = '0.9rem serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.fillText(icon, it.x, it.y + bob);

      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(it.x, it.y + bob, 13, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(it.x, it.y + bob, 14.5, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }

  /* ================== DROP LOGIC (PUBLIC) ================== */
  function rollDropChance(type = 'normal') {
    let p = CONFIG.BASE_CHANCE * (CONFIG.MULT[type] || 1.0);
    if (luckyActive()) p += CONFIG.LUCKY_BONUS;
    return Math.min(p, 0.95);
  }

  function attemptEquipmentDrop(x, y, flags = {}) {
    // flags: { zLevel, type: 'normal|mini|elite|boss|bigboss' }
    const type = flags.type || 'normal';
    const p = rollDropChance(type);
    if (Math.random() >= p) return;

    const L = clamp(flags.zLevel | 0 || guessZombieLevel() || 1, 1, 10);
    const rarity = rollRarityByZLevel(L, type);
    const tier = rollTierByZLevel(L, type);
    const meta = pickMetaForDrop();

    const entry = buildEntry({ tier, rarity, meta });
    spawnEquipEntryAt(x, y, entry);
  }

  // force có thể truyền thêm { rarity, type, zLevel, metaIndex }
  function forceDropAt(x, y, tierOrFlags = 1) {
    if (typeof tierOrFlags === 'number') {
      const meta = pickMetaForDrop();
      const rarity = 'legendary'; // mặc định ép đẹp
      const entry = buildEntry({
        tier: clamp(tierOrFlags, 1, 10),
        rarity,
        meta,
      });
      spawnEquipEntryAt(x, y, entry);
      return;
    }
    const f = tierOrFlags || {};
    const L = clamp(f.zLevel | 0 || guessZombieLevel() || 1, 1, 10);
    const type = f.type || 'normal';
    const tier = clamp(f.tier || rollTierByZLevel(L, type), 1, 10);
    const rarity = f.rarity || rollRarityByZLevel(L, type);
    const meta = Number.isFinite(f.metaIndex)
      ? SLOT_META[f.metaIndex | 0] || pickMetaForDrop()
      : pickMetaForDrop();
    spawnEquipEntryAt(x, y, buildEntry({ tier, rarity, meta }));
  }

  // Cố đoán zLevel nếu caller chưa truyền (đọc từ wave nếu game có hàm này)
  function guessZombieLevel() {
    try {
      if (typeof window.getZombieLevelByWave === 'function') {
        const w = Number(window.wave || 1);
        return clamp(window.getZombieLevelByWave(w) | 0 || 1, 1, 10);
      }
    } catch (e) {
      // Swallow lỗi dò level, fallback L1 (ghi log khi bật VERBOSE)
      if (VERBOSE) console.warn('[EquipDrop] guessZombieLevel failed', e);
    }
    return 1;
  }

  Object.assign(window.EquipmentDropAPI, {
    updateEquipDrops,
    drawEquipDrops,
    attemptEquipmentDropAt: attemptEquipmentDrop,
    forceDropAt,
  });

  /* ================== AUTO-WRAP dropItem() (giữ tương thích) ================== */
  function tryWrapDropItem() {
    const g = window;
    if (!g || g.__dropItemWrapped) return false;
    const original = g.dropItem;
    if (typeof original !== 'function') return false;

    g.dropItem = function (
      x,
      y,
      isBoss = false,
      isBigBoss = false,
      isMiniBoss = false,
      isElite = false,
      zLevel = undefined
    ) {
      const ret = original.apply(this, arguments);
      try {
        const type = isBigBoss
          ? 'bigboss'
          : isBoss
          ? 'boss'
          : isMiniBoss || isElite
          ? isElite
            ? 'elite'
            : 'mini'
          : 'normal';
        window.EquipmentDropAPI.attemptEquipmentDropAt(x, y, { type, zLevel });
      } catch (e) {
        DEBUG.lastError = e;
        warn('attemptEquipmentDrop failed', e);
      }
      return ret;
    };
    g.__dropItemWrapped = true;
    log('dropItem wrapped');
    return true;
  }
  if (!tryWrapDropItem()) {
    let tries = 0,
      t = setInterval(() => {
        if (tryWrapDropItem() || ++tries > 200) clearInterval(t);
      }, 100);
  }

  log('EquipmentDrop initialized (rarity-by-zLevel).');
})();
