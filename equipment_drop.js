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
      // Tỷ lệ rơi theo cấp độ quái vật (C, R, E, L, RC)
      1: [0.94, 0.05, 0.007, 0.002, 0.001], // L1: 94% C, 5% R, 0.7% E, 0.2% L, 0.1% RC
      2: [0.85, 0.12, 0.025, 0.01, 0.005],
      3: [0.75, 0.18, 0.05, 0.02, 0.01],
      4: [0.65, 0.22, 0.08, 0.04, 0.01],
      5: [0.55, 0.25, 0.12, 0.06, 0.02],
      6: [0.45, 0.28, 0.16, 0.08, 0.03],
      7: [0.38, 0.3, 0.2, 0.09, 0.03],
      8: [0.3, 0.32, 0.22, 0.12, 0.04],
      9: [0.25, 0.33, 0.25, 0.13, 0.04],
      10: [0.2, 0.3, 0.28, 0.16, 0.06],
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
      rare: '#2e7dff',
      epic: '#7b3ff0',
      legendary: '#f0b400',
      relic: '#ff5252',
    },

    // Hiển thị, TTL
    FALLBACK_ICON: '◉',
    PICKUP_R: 20,
    TTL_MS: typeof window.ITEM_TTL_MS === 'number' ? window.ITEM_TTL_MS : 15000,
  };
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
  // ===== RARITY HELPERS (dùng chung toàn game) =====
  window.RARITY_NAMES = window.RARITY_NAMES || (CONFIG && CONFIG.RARITY_NAMES);
  window.RARITY_COLOR = window.RARITY_COLOR || (CONFIG && CONFIG.RARITY_COLOR);

  // (tuỳ chọn) chuyển 'legendary' -> 'Legendary' / hoặc 'LEGENDARY'
  window.toRarityText = function (rar, mode = 'title') {
    const k = String(rar || 'common').toLowerCase();
    if (mode === 'upper') return k.toUpperCase();
    return k.charAt(0).toUpperCase() + k.slice(1);
  };

  window.rarityLabelHTML = function (rar, mode = 'title') {
    const k = String(rar || 'common').toLowerCase();
    const c = (window.RARITY_COLOR && window.RARITY_COLOR[k]) || '#ccc';
    const txt = window.toRarityText(k, mode);
    return `<span class="rarity-label" style="color:${c}">${txt}</span>`;
  };
  /* ================== HELPERS ================== */
  // === AFFIX & SPECIAL CONFIG ==================================================
  const AFFIX = {
    // Số dòng affix theo rarity (min,max)
    rollsByRarity: {
      common: [0, 1],
      rare: [1, 2],
      epic: [2, 3],
      legendary: [3, 4],
      relic: [4, 5],
    },
    // Pool chỉ số có thể roll
    pool: [
      {
        key: 'damageBoost',
        w: 3,
        range: {
          common: [1, 3],
          rare: [3, 6],
          epic: [6, 10],
          legendary: [10, 15],
          relic: [15, 20],
        },
      },
      {
        key: 'critRate',
        w: 2,
        range: {
          common: [0.01, 0.02],
          rare: [0.02, 0.04],
          epic: [0.03, 0.06],
          legendary: [0.04, 0.08],
          relic: [0.05, 0.1],
        },
      },
      {
        key: 'critDmg',
        w: 2,
        range: {
          common: [0.1, 0.2],
          rare: [0.15, 0.3],
          epic: [0.2, 0.4],
          legendary: [0.3, 0.6],
          relic: [0.4, 0.8],
        },
      },
      {
        key: 'hearts',
        w: 2,
        range: {
          common: [1, 2],
          rare: [2, 4],
          epic: [3, 6],
          legendary: [5, 10],
          relic: [8, 15],
        },
      },
      {
        key: 'stamina',
        w: 2,
        range: {
          common: [1, 2],
          rare: [2, 3],
          epic: [3, 4],
          legendary: [4, 5],
          relic: [5, 6],
        },
      },
      {
        key: 'armor',
        w: 2,
        range: {
          common: [1, 2],
          rare: [2, 4],
          epic: [4, 6],
          legendary: [6, 10],
          relic: [10, 14],
        },
      },
      {
        key: 'spRegen',
        w: 1,
        range: {
          common: [1, 1],
          rare: [1, 1],
          epic: [1, 2],
          legendary: [2, 3],
          relic: [3, 4],
        },
      },
      {
        key: 'hpRegen',
        w: 1,
        range: {
          common: [1, 1],
          rare: [1, 1],
          epic: [1, 2],
          legendary: [2, 3],
          relic: [3, 4],
        },
      },
    ],
  };

  const SPECIALS_BY_GROUP = {
    weapon: [
      {
        effect: 'slow',
        name: 'Làm chậm',
        chance: 0.1,
        duration: 3,
        power: 0.5,
      }, // 50% tốc độ
      {
        effect: 'burn',
        name: 'Thiêu đốt',
        chance: 0.1,
        duration: 3,
        dpsMul: 0.18,
      },
      { effect: 'stun', name: 'Choáng', chance: 0.1, duration: 1.5 },
      { effect: 'push', name: 'Đẩy lùi', chance: 0.1, power: 140 },
    ],
  };

  function groupFromMeta(meta) {
    const s = (meta.slot || meta.name || '').toLowerCase();
    if (s.includes('vũ khí')) return 'weapon';
    if (s.includes('khiên')) return 'shield';
    if (s.includes('nhẫn')) return 'ring';
    if (s.includes('dây') || s.includes('neck')) return 'necklace';
    if (s.includes('mũ') || s.includes('nón') || s.includes('hat'))
      return 'hat';
    if (s.includes('găng')) return 'gloves';
    if (s.includes('giày') || s.includes('shoes')) return 'shoes';
    if (s.includes('áo') || s.includes('giáp') || s.includes('armor'))
      return 'armor';
    if (s.includes('kính') || s.includes('glasses')) return 'glasses';
    return 'misc';
  }

  function rollExtraBonuses(rarity, tier, group) {
    const rr = AFFIX.rollsByRarity[rarity] || [0, 0];
    const rolls = rr[0] + Math.floor(Math.random() * (rr[1] - rr[0] + 1));
    const pool = AFFIX.pool.map((p) => ({ ...p }));

    // ưu tiên theo nhóm
    const boost = (key, f) => {
      const p = pool.find((x) => x.key === key);
      if (p) p.w *= f;
    };
    if (group === 'weapon') {
      boost('damageBoost', 2);
      boost('critRate', 1.5);
      boost('critDmg', 1.5);
    }
    if (group === 'armor' || group === 'shield') {
      boost('armor', 2);
      boost('hearts', 1.5);
    }
    if (group === 'ring' || group === 'necklace' || group === 'glasses') {
      boost('critRate', 1.5);
      boost('critDmg', 1.5);
    }

    const out = {};
    for (let i = 0; i < rolls && pool.length; i++) {
      // pick theo trọng số
      const idx = pickByWeights(pool.map((p) => p.w));
      const a = pool.splice(idx, 1)[0];
      const [lo, hi] = a.range[rarity] || a.range.common;
      let v = lo + Math.random() * (hi - lo);

      // scale nhẹ theo tier với các chỉ số "phẳng"
      if (['damageBoost', 'hearts', 'stamina', 'armor'].includes(a.key)) {
        v = Math.round(v * (1 + (tier - 1) * 0.1));
      } else {
        v = Math.round(v * 100) / 100; // phần trăm giữ 2 số
      }
      out[a.key] = (out[a.key] || 0) + v;
    }
    return out;
  }
  // Gán hiệu ứng đặc biệt cho vũ khí
  function rollSpecial(group, rarity) {
    const list = SPECIALS_BY_GROUP[group];
    if (!list) return null;
    // chỉ xuất hiện từ RARE+, tỉ lệ bật theo bậc
    const allow =
      { common: 0, rare: 0.35, epic: 0.6, legendary: 0.85, relic: 1 }[rarity] ||
      0;
    if (Math.random() > allow) return null;
    const pick = list[(Math.random() * list.length) | 0];
    return JSON.parse(JSON.stringify(pick)); // clone
  }

  // gắn affix/special cho item đã build
  function enrichEntryWithAffixes(entry) {
    try {
      const group = groupFromMeta(entry);
      entry.extraBonuses = rollExtraBonuses(entry.rarity, entry.tier, group);
      const sp = rollSpecial(group, entry.rarity);
      if (sp) {
        // 🎲 Luôn roll lại tỉ lệ kích hoạt 5%..70% cho mỗi item
        const MIN = 0.05,
          MAX = 0.7;
        sp.chance = Math.round((MIN + Math.random() * (MAX - MIN)) * 100) / 100;

        // (tuỳ chọn) có thể scale nhẹ theo độ hiếm:
        // const mult = { common:1, rare:1, epic:1.1, legendary:1.2, relic:1.25 }[entry.rarity] || 1;
        // sp.chance = Math.min(MAX, Math.max(MIN, Math.round(sp.chance * mult * 100) / 100));

        entry.special = sp;
      }
    } catch (e) {
      DEBUG.lastError = e;
    }
  }

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
    // --- MỞ RỘNG KHO ITEM CHUẨN HÓA CHO 4 SLOT MỚI + VŨ KHÍ/ÁO ---
    {
      name: 'Rìu',
      icon: '🪓',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({
        damageBoost: Math.round(3 + t * 2), // thiên sát thương thô
        critDmg: Math.min(1.0, 0.07 * t), // % crit dmg nhẹ
      }),
    },
    {
      name: 'Áo khoác',
      icon: '🧥',
      slot: 'Giáp',
      bonus: (t) => ({
        hearts: Math.round(2 + t * 1.2), // +máu trần
        armor: t >= 6 ? 1 : 0, // bậc cao mới có giáp cứng
      }),
    },
    {
      name: 'Quần',
      icon: '👖',
      slot: 'Quần',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.6), // +stamina trần
        moveSpeed: Math.min(1.2, 0.03 * t), // % tốc độ nhẹ
      }),
    },
    {
      name: 'Thắt lưng',
      icon: '🎗️',
      slot: 'Thắt lưng',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.8), // nhấn mạnh vào stamina
        hpRegen: t >= 7 ? 1 : 0, // mở regen HP ở bậc cao
      }),
    },
    {
      name: 'Phụ kiện (Đồng hồ)',
      icon: '⌚',
      slot: 'Phụ kiện',
      bonus: (t) => ({
        spRegen: 1, // +1 hồi SP định kỳ (đã tích hợp regen)
        bulletSpeed: Math.min(2.0, 0.08 * t), // % tốc độ đạn
      }),
    },
    {
      name: 'Cánh',
      icon: '🪽',
      slot: 'Cánh',
      bonus: (t) => ({
        moveSpeed: Math.min(2.0, 0.08 * t), // % tốc độ chạy
        hearts: Math.round(1 + t * 0.5), // thêm chút HP trần
      }),
    },
    // --- Vũ khí 1 ---
    {
      name: 'Song kiếm',
      icon: '⚔️',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({
        damageBoost: Math.max(1, Math.round(t * 1.6)),
        critRate: Math.min(0.2, 0.01 * t),
      }),
    },
    {
      name: 'Cung Ngắn',
      icon: '🏹',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({
        damageBoost: Math.max(1, Math.round(t * 1.2)),
        bulletSpeed: Math.min(3.0, 0.12 * t),
      }),
    },

    // --- Vũ khí 2 ---
    {
      name: 'Búa Chiến',
      icon: '🔨',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({
        damageBoost: Math.max(2, Math.round(t * 1.9)),
        critDmg: Math.min(1.0, 0.07 * t),
      }),
    },
    {
      name: 'Gậy Phép',
      icon: '🪄',
      slotOptions: ['Vũ khí 1', 'Vũ khí 2'],
      bonus: (t) => ({
        damageBoost: Math.max(1, Math.round(t * 1.3)),
        spRegen: 1,
      }),
    },

    // --- Giáp ---
    {
      name: 'Giáp Gai',
      icon: '🥋',
      slot: 'Giáp',
      bonus: (t) => ({
        hearts: Math.round(t * 0.9) + 1,
        armor: t >= 6 ? 1 : 0,
      }),
    },
    {
      name: 'Áo Giáp vải',
      icon: '🥼',
      slot: 'Giáp',
      bonus: (t) => ({
        hearts: Math.round(t * 0.8) + 1,
        hpRegen: t >= 7 ? 1 : 0,
      }),
    },

    // --- Quần ---
    {
      name: 'Quần short',
      icon: '🩳',
      slot: 'Quần',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.7),
        moveSpeed: Math.min(1.3, 0.035 * t),
      }),
    },
    {
      name: 'Quần bơi',
      icon: '🩲',
      slot: 'Quần',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.8),
      }),
    },

    // --- Mũ ---
    {
      name: 'Mũ Phù Thủy',
      icon: '🎩',
      slot: 'Mũ',
      bonus: (t) => ({
        hearts: Math.round(t * 0.4),
        critRate: t >= 6 ? 0.02 : 0,
      }),
    },
    {
      name: 'Mũ Cứu Thương',
      icon: '⛑️',
      slot: 'Mũ',
      bonus: (t) => ({
        hearts: Math.round(t * 0.5),
        hpRegen: t >= 7 ? 1 : 0,
      }),
    },

    // --- Găng ---
    {
      name: 'Găng Quyền',
      icon: '🥊',
      slot: 'Găng',
      bonus: (t) => ({
        critDmg: Math.min(1.0, 0.08 * t),
        damageBoost: Math.max(1, Math.round(t * 0.8)),
      }),
    },
    {
      name: 'Găng Đấm Thép',
      icon: '🧤',
      slot: 'Găng',
      bonus: (t) => ({
        critRate: Math.min(0.18, 0.012 * t),
        critDmg: Math.min(0.9, 0.06 * t),
      }),
    },

    // --- Giày ---
    {
      name: 'Giày Chạy Bộ',
      icon: '👟',
      slot: 'Giày',
      bonus: (t) => ({
        moveSpeed: Math.min(1.6, 0.06 * t),
      }),
    },
    {
      name: 'Giày Da',
      icon: '👞',
      slot: 'Giày',
      bonus: (t) => ({
        moveSpeed: Math.min(1.3, 0.045 * t),
        stamina: Math.round(t * 0.3),
      }),
    },

    // --- Thắt lưng ---
    {
      name: 'Dây Lưng Thợ Săn',
      icon: '🪢',
      slot: 'Thắt lưng',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.9),
      }),
    },
    {
      name: 'Khóa Ghim',
      icon: '🧷',
      slot: 'Thắt lưng',
      bonus: (t) => ({
        stamina: Math.round(1 + t * 0.7),
        hpRegen: t >= 7 ? 1 : 0,
      }),
    },

    // --- Nhẫn Trái ---
    {
      name: 'Nhẫn Lam Bảo',
      icon: '💍',
      slotOptions: ['Nhẫn Trái', 'Nhẫn Phải'],
      bonus: (t) => ({
        critRate: Math.min(0.22, 0.014 * t),
        critDmg: Math.min(0.7, 0.05 * t),
      }),
    },
    {
      name: 'Nhẫn Chiêm Tinh',
      icon: '💍',
      slotOptions: ['Nhẫn Trái', 'Nhẫn Phải'],
      bonus: (t) => ({
        critRate: Math.min(0.2, 0.012 * t),
        spRegen: 1,
      }),
    },

    // --- Nhẫn Phải ---
    {
      name: 'Nhẫn Phù Văn',
      icon: '💍',
      slotOptions: ['Nhẫn Trái', 'Nhẫn Phải'],
      bonus: (t) => ({
        critDmg: Math.min(0.9, 0.06 * t),
        damageBoost: Math.max(1, Math.round(t * 0.8)),
      }),
    },
    {
      name: 'Nhẫn Hồng Ngọc',
      icon: '💍',
      slotOptions: ['Nhẫn Trái', 'Nhẫn Phải'],
      bonus: (t) => ({
        critRate: Math.min(0.22, 0.014 * t),
      }),
    },

    // --- Khiên ---
    {
      name: 'Khiên Gỗ',
      icon: '🛡️',
      slot: 'Khiên',
      bonus: (t) => ({
        hearts: Math.round(t * 0.7) + 1,
      }),
    },
    {
      name: 'Khiên Thép',
      icon: '🛡️',
      slot: 'Khiên',
      bonus: (t) => ({
        hearts: Math.round(t * 0.9) + 1,
        armor: t >= 7 ? 1 : 0,
      }),
    },

    // --- Phụ kiện ---
    {
      name: 'La Bàn',
      icon: '🧭',
      slot: 'Phụ kiện',
      bonus: (t) => ({
        bulletSpeed: Math.min(2.2, 0.085 * t),
      }),
    },
    {
      name: 'Đồng hồ số',
      icon: '⌚',
      slot: 'Phụ kiện',
      bonus: (t) => ({
        spRegen: 1,
        bulletSpeed: Math.min(1.8, 0.07 * t),
      }),
    },

    // --- Dây chuyền ---
    {
      name: 'Bùa Mắt Xanh',
      icon: '🧿',
      slot: 'Dây chuyền',
      bonus: (t) => ({
        bulletSpeed: Math.min(3.0, 0.12 * t),
        critRate: Math.min(0.15, 0.01 * t),
      }),
    },
    {
      name: 'Xích Bạc',
      icon: '🔗',
      slot: 'Dây chuyền',
      bonus: (t) => ({
        damageBoost: Math.max(1, Math.round(t * 0.9)),
      }),
    },

    // --- Bông tai ---
    {
      name: 'Khuyên Bạc',
      icon: '👂',
      slot: 'Bông tai',
      bonus: (t) => ({
        critRate: Math.min(0.24, 0.018 * t),
      }),
    },
    {
      name: 'Khuyên Vàng',
      icon: '👂',
      slot: 'Bông tai',
      bonus: (t) => ({
        critRate: Math.min(0.22, 0.016 * t),
        bulletSpeed: Math.min(1.5, 0.06 * t),
      }),
    },

    // --- Mắt kính ---
    {
      name: 'Kính Cận',
      icon: '👓',
      slot: 'Mắt kính',
      bonus: (t) => ({
        critDmg: Math.min(1.0, 0.08 * t),
      }),
    },
    {
      name: 'Kính Bảo Hộ',
      icon: '🥽',
      slot: 'Mắt kính',
      bonus: (t) => ({
        critDmg: Math.min(0.9, 0.065 * t),
        bulletSpeed: Math.min(1.6, 0.06 * t),
      }),
    },

    // --- Cánh ---
    {
      name: 'Cánh Bướm',
      icon: '🪽',
      slot: 'Cánh',
      bonus: (t) => ({
        moveSpeed: Math.min(2.0, 0.08 * t),
      }),
    },
    {
      name: 'Cánh Bồ Câu',
      icon: '🕊️',
      slot: 'Cánh',
      bonus: (t) => ({
        moveSpeed: Math.min(1.8, 0.07 * t),
        hearts: Math.round(1 + t * 0.4),
      }),
    },
    {
      name: 'Cánh Thiên Thần',
      icon: 'Ƹ̴Ӂ̴Ʒ',
      slot: 'Cánh',
      bonus: (t) => ({
        moveSpeed: Math.min(1.8, 0.07 * t),
        hearts: Math.round(1 + t * 0.4),
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
    'Quần',
    'Thắt lưng',
    'Phụ kiện',
    'Cánh',
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
      type: 'equipment',
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
    d._tipHTML = undefined;
    d._ver = (d._ver | 0) + 1; // để mọi con trỏ hover cũ biết là item đã đổi
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
    d._ver = (d._ver | 0) + 1; // tăng version để kill cache cũ
    d._tipHTML = undefined; // xoá HTML cũ (nếu có)
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
          `Nhặt: ${it.entry.icon || ''} ${it.entry.name} - ${
            rare ? rare.toUpperCase() : ''
          }`
        );
      // Nếu độ hiếm từ Legendary trở lên → đẩy bản tin
      try {
        if (rare === 'legendary' || rare === 'relic') {
          const vnRarity = rare === 'relic' ? 'Cổ Vật' : 'Huyền Thoại';
          window.NewsTicker?.pushMessage(
            `🎉 Vừa nhặt được trang bị cấp ${vnRarity}: ${
              it.entry.icon || '⭐'
            } ${it.entry.name}`,
            true
          );
        }
      } catch {
        /* ignore */
      }

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

  // vẽ các trang bị rơi trên mặt đất — tối ưu state-change + throttle glow khi quá đông
  function drawEquipDrops(ctx) {
    if (!ctx) return;

    // --- Culling theo camera (giữ nguyên ý tưởng cũ) ---
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

    // Lấy frame 1 lần, tránh đọc window nhiều lần
    const frame = window.frame || 0;

    // Gom danh sách item hiển thị (tránh lặp điều kiện nhiều lần)
    const vis = [];
    for (let i = 0; i < equipDrops.length; i++) {
      const it = equipDrops[i];
      if (!it || !it.active) continue;
      if (it.x < left || it.x > right || it.y < top || it.y > bottom) continue;
      vis.push(it);
    }
    if (vis.length === 0) return;

    // ========= PASS 1: icon + vòng viền trong (source-over) =========
    ctx.font = '0.9rem serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0; // shadow/halo sẽ vẽ ở pass 2

    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      const icon = it.icon || CONFIG.FALLBACK_ICON;
      const color = it.color || '#fff';
      const bob = Math.sin(frame / 10 + it.x + it.y) * 2;

      // Icon (emoji/char); fillStyle hầu như không ảnh hưởng đến emoji nhưng set cho chắc
      ctx.fillStyle = '#fff';
      ctx.fillText(icon, it.x, it.y + bob);

      // Vòng viền trong (r nhỏ, đậm)
      ctx.beginPath();
      ctx.arc(it.x, it.y + bob, 13, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
    }

    // ========= PASS 2: quầng sáng bên ngoài (lighter), vẽ GỘP cho cả frame =========
    // Throttle khi rơi siêu nhiều để giữ FPS: nếu >80 món → vẽ glow cách frame
    const DO_GLOW = vis.length <= 80 || frame % 2 === 0;
    if (DO_GLOW) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';

      // (Tùy theo mật độ, giảm alpha/độ dày để nhẹ hơn)
      const many = vis.length > 140;
      const glowAlpha = many ? 0.22 : 0.3;
      const glowWidth = many ? 2 : 3;

      for (let i = 0; i < vis.length; i++) {
        const it = vis[i];
        const color = it.color || '#fff';
        const bob = Math.sin(frame / 10 + it.x + it.y) * 2;

        ctx.beginPath();
        ctx.arc(it.x, it.y + bob, 14.5, 0, Math.PI * 2);
        ctx.lineWidth = glowWidth;
        ctx.strokeStyle = color;
        ctx.globalAlpha = glowAlpha;
        ctx.stroke();
      }
    }

    // Trả trạng thái về mặc định (cho các hệ thống render khác)
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
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
    enrichEntryWithAffixes(entry);
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
      enrichEntryWithAffixes(entry);
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
    const entry = buildEntry({ tier, rarity, meta });
    enrichEntryWithAffixes(entry);
    spawnEquipEntryAt(x, y, entry);
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
    applyAffixes: enrichEntryWithAffixes,
    spawnEquipEntryAt,
  });
  // [ADD] Export read-only accessors to avoid GC and enable hover picking
  Object.assign(window.EquipmentDropAPI, {
    getActiveDropsRef() {
      return equipDrops;
    }, // direct reference (đừng mutate bên ngoài)
    forEachActiveDrop(fn) {
      // không tạo mảng mới
      for (let i = 0; i < equipDrops.length; i++) {
        const d = equipDrops[i];
        if (d && d.active) fn(d);
      }
    },
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
