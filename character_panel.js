/* eslint-env browser */
/* global player, playerUpgrades, updateStatsOverlay, baseCritRate:writable, showWarning, updateUI */
// character_panel.js
/** ================== CONFIG / STATE ================== */
// ⚙️ FUSION CONFIG (có thể chỉnh cho cân bằng)
const FUSION_COST_BY_COUNT = { 2: 2, 3: 3, 4: 5, 5: 8, 6: 12, 7: 17, 8: 23 }; // phí cơ bản theo số món
const FUSION_TIER_MULT = 1; // phí * bậc thấp nhất (minTier)
const FUSION_REFUND_RATE = 0.5; // hoàn 50% phí khi thất bại
// Thời gian hiển thị trạng thái tái chế trước khi show kết quả
const FUSION_PROCESS_MS = 3000; // Thời gian tái chế (ms)

const CHAR_POINTS_PER_LEVEL = 3; // +3 điểm mỗi khi lên cấp
window.CHAR_POINTS_PER_LEVEL = CHAR_POINTS_PER_LEVEL; // export để dùng nơi khác
const CharacterPanelState = {
  baseline: null, // { damageBoost, baseCritRate, maxHearts }
  spent: { damage: 0, crit: 0, hp: 0, stamina: 0 }, // số điểm đã cộng theo từng stat
};

// Slots cơ bản (tùy bạn đổi tên/thiết kế icon sau)
// Slots mở rộng 12 ô
const EQUIP_SLOTS = [
  'Vũ khí 1',
  'Vũ khí 2',
  'Giáp',
  'Mũ',
  'Găng',
  'Giày',
  'Nhẫn Trái',
  'Nhẫn Phải',
  'Dây chuyền',
  'Bông tai',
  'Mắt kính',
  'Khiên',
];

// Trạng thái trang bị & tồn kho
const Equip = {
  slots: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])),
  applied: {
    damageBoost: 0,
    bulletSpeed: 0,
    moveSpeed: 0,
    hearts: 0,
    armor: 0,
    iceArrow: 0,
    lineBulletCount: 0,
  },
  inventory: [],
  // ➕ mới:
  ironDust: 100, // bột sắt
  fusion: {
    mats: Array(8).fill(null), // 8 ô nguyên liệu
    result: null, // kết quả ở ô giữa
  },
};
window.Equip = Equip;

// === Slot alias cho đồ "2 loại" và hàm chọn ô auto ===
const SLOT_ALIASES = {
  'Vũ khí': ['Vũ khí 1', 'Vũ khí 2'],
  Nhẫn: ['Nhẫn Trái', 'Nhẫn Phải'],
};
// Gom nhóm loại: "Vũ khí 1/2" → "Vũ khí", "Nhẫn Trái/Phải" → "Nhẫn"
function getItemGroup(it) {
  if (!it) return null;
  const aliases = {
    'Vũ khí': ['Vũ khí 1', 'Vũ khí 2'],
    Nhẫn: ['Nhẫn Trái', 'Nhẫn Phải'],
  };
  if (it.slot && aliases[it.slot]) return it.slot; // slot là nhóm
  if (it.slot) {
    for (const [g, arr] of Object.entries(aliases))
      if (arr.includes(it.slot)) return g;
  }
  return it.slot || null;
}

// rarity theo bậc (đã dùng trong panel UI)
function rarityOfTier(t = 1) {
  return t <= 3
    ? 'common'
    : t <= 6
    ? 'rare'
    : t <= 8
    ? 'epic'
    : t === 9
    ? 'legendary'
    : 'relic';
}

// hệ số theo rarity (đang dùng ở sellItemById)
const RARITY_MULT = { common: 1, rare: 2, epic: 4, legendary: 8, relic: 16 };

// scale chỉ số khi tăng bậc (giữ tính chất: số nguyên làm tròn, phần trăm giữ 2 chữ số)
function scaleBonusesForTier(bonuses, oldTier, newTier) {
  if (!bonuses) return bonuses;
  const ratio = Math.max(0.1, newTier / Math.max(1, oldTier || 1));
  const out = {};
  for (const k in bonuses) {
    const v = bonuses[k];
    if (typeof v !== 'number') {
      out[k] = v;
      continue;
    }
    // các chỉ số phần trăm trong file: bulletSpeed, moveSpeed
    if (
      k === 'bulletSpeed' ||
      k === 'moveSpeed' ||
      k === 'critRate' ||
      k === 'critDmg'
    ) {
      out[k] = Math.round(v * ratio * 100) / 100;
    } else {
      out[k] = Math.round(v * ratio);
    }
  }
  return out;
}

function getAllowedSlotsForItem(item) {
  if (!item) return [];
  // Nếu item có slotOptions (từ drop) thì dùng luôn
  if (Array.isArray(item.slotOptions) && item.slotOptions.length)
    return item.slotOptions.slice();
  // Nếu item.slot là tên "tập cha" → map sang mảng con
  if (SLOT_ALIASES[item.slot]) return SLOT_ALIASES[item.slot].slice();
  // Nếu item.slot là tên slot cụ thể → trả về mảng 1 phần tử
  if (typeof item.slot === 'string') return [item.slot];
  return [];
}
function isEquippable(item) {
  return getAllowedSlotsForItem(item).length > 0;
}

function autoPickTargetSlot(item) {
  const allowed = getAllowedSlotsForItem(item);
  // Ưu tiên ô trống
  for (const s of allowed) if (!Equip.slots[s]) return s;
  // Nếu không có ô trống → chọn ô đầu (để swap)
  return allowed[0] || null;
}

/** === EQUIP AGGREGATION + CRIT HOOKS (CORE LOGIC) === */
(function equipCritIntegration() {
  function recalcEquipStats() {
    const slots =
      window.Equip && window.Equip.slots ? Object.values(Equip.slots) : [];
    const sums = {
      damageBoost: 0,
      hearts: 0,
      armor: 0,
      bulletSpeed: 0,
      moveSpeed: 0,
      critRate: 0,
      critDmg: 0,
    };
    const addB = (b) => {
      if (!b) return;
      for (const k in b) {
        sums[k] = (sums[k] || 0) + Number(b[k] || 0);
      }
    };
    slots.forEach((it) => {
      if (!it) return;
      addB(it.bonuses);
      addB(it.extraBonuses || it.extra || it.randBonuses);
    });

    window.EquipStatCache = sums;

    if (window.player) {
      player.equipDamageBoost = sums.damageBoost || 0;
      player.equipCritRate = sums.critRate || 0;
      player.equipCritDmg = sums.critDmg || 0;
      player.equipBulletSpeed = sums.bulletSpeed || 0;
      player.equipMoveSpeed = sums.moveSpeed || 0;
    }
  }
  window.recalcEquipStats = recalcEquipStats;

  // Hook crit rate / crit dmg multiplier
  (function hookCrit() {
    const cap =
      typeof window.CRIT_RATE_CAP === 'number' ? window.CRIT_RATE_CAP : 0.7;

    const origGetRate =
      typeof window.getCritRate === 'function'
        ? window.getCritRate
        : function () {
            return window.baseCritRate || 0;
          };

    window.getCritRate = function () {
      const base = Number(origGetRate() || 0);
      const eq = Number(
        (window.EquipStatCache && window.EquipStatCache.critRate) || 0
      );
      const total = base + eq;
      return total > cap ? cap : total;
    };

    const origGetDmgMul =
      typeof window.getCritDmgMultiplier === 'function'
        ? window.getCritDmgMultiplier
        : function () {
            const basePlus =
              typeof window.baseCritDmg === 'number' ? window.baseCritDmg : 0.5; // +50% → 1.5x
            return 1 + basePlus;
          };

    window.getCritDmgMultiplier = function () {
      const baseM = Number(origGetDmgMul() || 1);
      const eqAdd = Number(
        (window.EquipStatCache && window.EquipStatCache.critDmg) || 0
      );
      return baseM + eqAdd;
    };
  })();

  // Tự động re-calc khi kho/trang bị thay đổi
  (function hookInventoryMutations() {
    const wrap = (name) => {
      const fn = window[name];
      if (typeof fn === 'function' && !fn.__equipWrapped) {
        window[name] = function () {
          const r = fn.apply(this, arguments);
          try {
            window.recalcEquipStats();
          } catch {
            /* ignore */
          }
          return r;
        };
        window[name].__equipWrapped = true;
      }
    };
    wrap('equipItemById');
    wrap('unequipSlot');
    wrap('openBoxById');
    wrap('useItemById');

    window.recalcEquipStats();
    if (
      window.CharacterPanel &&
      typeof window.CharacterPanel.refresh === 'function' &&
      !window.CharacterPanel.refresh.__equipWrapped
    ) {
      const rf = window.CharacterPanel.refresh;
      window.CharacterPanel.refresh = function () {
        const r = rf.apply(this, arguments);
        try {
          window.recalcEquipStats();
        } catch {
          /* ignore */
        }
        return r;
      };
      window.CharacterPanel.refresh.__equipWrapped = true;
    }
  })();
})();

/** ================== INITIAL INVENTORY (STARTER GEAR) ================== */
(function seedInitialInventory() {
  if (seedInitialInventory.done) return;
  seedInitialInventory.done = true;

  const addOnce = (item) => {
    if (!Equip.inventory.some((it) => it.id === item.id))
      Equip.inventory.push(item);
  };

  // 8 trang bị cơ bản
  const BASIC_GEAR = [
    {
      id: 'starter_sword',
      name: 'Kiếm gỉ',
      icon: '🗡️',
      slot: 'Vũ khí',
      bonuses: { damageBoost: 1 },
      desc: 'Vũ khí nhẹ đã cũ, tăng nhẹ sát thương cơ bản (+1).',
    },
    {
      id: 'starter_armor',
      name: 'Giáp da cũ',
      icon: '🦺',
      slot: 'Giáp',
      bonuses: { hearts: 2, armor: 1 },
      desc: 'Giáp mỏng giúp sống sót tốt hơn (+2 HP, +1 Giáp).',
    },
    {
      id: 'starter_helmet',
      name: 'Mũ vải',
      icon: '🧢',
      slot: 'Mũ',
      bonuses: { hearts: 1, armor: 1 },
      desc: 'Mũ đơn giản, tăng một chút thể lực (+1 HP, +1 Giáp).',
    },
    {
      id: 'starter_gloves',
      name: 'Găng thô',
      icon: '🧤',
      slot: 'Găng',
      bonuses: { damageBoost: 1 },
      desc: 'Giúp thao tác chắc tay.',
    },
    {
      id: 'starter_boots',
      name: 'Giày nhẹ',
      icon: '🥾',
      slot: 'Giày',
      bonuses: { moveSpeed: 0.2 },
      desc: 'Nhẹ, di chuyển nhanh hơn (+20% tốc độ chạy).',
    },
    {
      id: 'starter_ring',
      name: 'Nhẫn đồng',
      icon: '💍',
      slot: 'Nhẫn',
      bonuses: { damageBoost: 1 },
      desc: 'Vòng đồng khắc runic, tăng nhẹ sát thương (+1).',
    },
    {
      id: 'starter_necklace',
      name: 'Dây chuyền gỗ',
      icon: '📿',
      slot: 'Dây chuyền',
      bonuses: { damageBoost: 1 },
      desc: 'Bùa gỗ may mắn.',
    },
    {
      id: 'starter_shield',
      name: 'Khiên gỗ',
      icon: '🛡️',
      slot: 'Khiên',
      bonuses: { hearts: 1, armor: 1 },
      desc: 'Tấm khiên tạm bợ, đỡ được vài đòn (+1 HP, +1 Giáp).',
    },
  ];

  BASIC_GEAR.forEach(addOnce);

  // Hộp quà cấp 1
  addOnce({
    id: 'box_lvl1_starter',
    name: 'Hộp quà cấp 1',
    icon: '🎁',
    type: 'box',
    desc: 'Hộp khởi đầu cho tân thủ: mở nhận 100 xu + 2 bình hồi cơ bản.',
    contents: {
      coins: 100,
      consumables: [
        {
          id: 'potion_hp_s',
          name: 'Bình máu nhỏ (+5)',
          icon: '🧪',
          type: 'consumable',
          effect: { hearts: 5 },
          desc: 'Dùng để hồi ngay +5 HP.',
        },
        {
          id: 'potion_mana_s',
          name: 'Bình mana nhỏ (+20)',
          icon: '🔷',
          type: 'consumable',
          effect: { mana: 20 },
          desc: 'Dùng để hồi ngay +20 Mana.',
        },
      ],
      note: 'Mở để nhận 100 xu + 2 bình hồi cơ bản',
    },
  });
})();

/** ================== STAT DEFINITIONS ================== */
const STAT_DEFS = [
  {
    key: 'damage',
    name: '💥 Sát thương',
    read: () => Number(playerUpgrades.damageBoost || 0),
    add: () => {
      if (!player.statPoints || player.statPoints <= 0) return;
      playerUpgrades.damageBoost = (playerUpgrades.damageBoost || 0) + 1;
      player.statPoints -= 1;
      CharacterPanelState.spent.damage += 1;
      updateStatsOverlay?.();
      window.CharacterPanel?.refresh();
    },
    stepText: '1',
    enabled: () => true,
  },
  {
    key: 'crit_perm',
    name: '💥 Crit Rate',
    read: () => `${Math.round((baseCritRate || 0) * 100)}%`,
    add: () => {
      if (!player.statPoints || player.statPoints <= 0) return;
      const cur = Number(baseCritRate || 0);
      if (cur >= 0.3) return;
      const next = Math.min(0.3, cur + 0.01);
      baseCritRate = next;
      player.statPoints -= 1;
      CharacterPanelState.spent.crit += 1;
      updateStatsOverlay?.();
      window.CharacterPanel?.refresh();
    },
    stepText: '1%',
    enabled: () => (baseCritRate || 0) < 0.3,
  },
  {
    key: 'hp_cap',
    name: '❤️ HP tối đa',
    read: () => Number(player.maxHearts || 0),
    add: () => {
      if (!player.statPoints || player.statPoints <= 0) return;
      player.maxHearts = Number(player.maxHearts || 0) + 5;
      player.hearts = Math.min((player.hearts || 0) + 5, player.maxHearts);
      player.statPoints -= 1;
      CharacterPanelState.spent.hp += 1;
      updateStatsOverlay?.();
      window.CharacterPanel?.refresh();
    },
    stepText: '5',
    enabled: () => true,
  },
  {
    key: 'stamina',
    name: '🔹 Thể lực',
    read: () => {
      if (typeof player.staminaMax !== 'number') player.staminaMax = 10;
      if (typeof player.stamina !== 'number')
        player.stamina = player.staminaMax;
      return `${player.staminaMax}`;
    },
    add: () => {
      if (!player.statPoints || player.statPoints <= 0) return;
      // Tăng giới hạn stamina thêm 2 mỗi lần
      player.staminaMax = Number(player.staminaMax || 10) + 2;
      // Hồi đầy để tiện theo dõi
      player.stamina = player.staminaMax;
      player.statPoints -= 1;
      CharacterPanelState.spent.stamina =
        (CharacterPanelState.spent.stamina || 0) + 1;
      updateStatsOverlay?.();
      window.CharacterPanel?.refresh();
    },
    stepText: '2',
    enabled: () => true,
  },
];

/** ================== APPLY EQUIPMENT ================== */
function applyEquipmentBonuses() {
  const a = Equip.applied;
  if (a.armor) player.armor = (player.armor || 0) - a.armor;
  if (a.damageBoost)
    playerUpgrades.damageBoost =
      (playerUpgrades.damageBoost || 0) - a.damageBoost;
  if (a.bulletSpeed)
    playerUpgrades.bulletSpeed =
      (playerUpgrades.bulletSpeed || 0) - a.bulletSpeed;
  if (a.moveSpeed) player.speed = (player.speed || 0) - a.moveSpeed;
  if (a.hearts) player.hearts = Math.max(0, (player.hearts || 0) - a.hearts);
  if (a.iceArrow)
    playerUpgrades.iceArrow = (playerUpgrades.iceArrow || 1) - a.iceArrow;
  if (a.lineBulletCount)
    playerUpgrades.lineBulletCount =
      (playerUpgrades.lineBulletCount || 1) - a.lineBulletCount;

  const sum = {
    damageBoost: 0,
    bulletSpeed: 0,
    moveSpeed: 0,
    hearts: 0,
    armor: 0,
    iceArrow: 0,
    lineBulletCount: 0,
  };
  for (const slot of EQUIP_SLOTS) {
    const it = Equip.slots[slot];
    if (!it || !it.bonuses) continue;
    for (const k in sum) sum[k] += it.bonuses[k] || 0;
  }

  player.armor = (player.armor || 0) + sum.armor;
  playerUpgrades.damageBoost =
    (playerUpgrades.damageBoost || 0) + sum.damageBoost;
  playerUpgrades.bulletSpeed =
    (playerUpgrades.bulletSpeed || 0) + sum.bulletSpeed;
  player.speed = (player.speed || 0) + sum.moveSpeed;
  player.hearts = (player.hearts || 0) + sum.hearts;
  playerUpgrades.iceArrow = (playerUpgrades.iceArrow || 1) + sum.iceArrow;
  playerUpgrades.lineBulletCount =
    (playerUpgrades.lineBulletCount || 1) + sum.lineBulletCount;

  Equip.applied = sum;
  updateStatsOverlay?.();
}
/** Tháo tất cả trang bị đang mặc */
function unequipAllItems() {
  let unequippedCount = 0;
  // Duyệt qua tất cả các slot trang bị
  for (const slot of EQUIP_SLOTS) {
    const currentItem = Equip.slots[slot];
    // Nếu có trang bị thì tháo ra và bỏ vào kho đồ
    if (currentItem) {
      Equip.inventory.push(currentItem);
      Equip.slots[slot] = null;
      unequippedCount++;
    }
  }

  // Nếu có ít nhất 1 món được tháo, thì cập nhật lại chỉ số và UI
  if (unequippedCount > 0) {
    applyEquipmentBonuses();
    window.CharacterPanel?.refresh();
    showWarning?.(`✅ Đã tháo ${unequippedCount} trang bị.`);
  } else {
    showWarning?.('Không có trang bị nào để tháo.');
  }
}

/** Reset toàn bộ điểm thuộc tính đã cộng */
function resetStatPoints() {
  const spent = CharacterPanelState.spent || {};
  const sDmg = spent.damage || 0;
  const sCrit = spent.crit || 0;
  const sHp = spent.hp || 0;
  const sSta = spent.stamina || 0;

  // Rollback lại chỉ số gốc dựa trên số điểm đã cộng
  if (sDmg)
    playerUpgrades.damageBoost = Math.max(
      0,
      (playerUpgrades.damageBoost || 0) - sDmg
    );
  if (sCrit) baseCritRate = Math.max(0, (baseCritRate || 0) - sCrit * 0.01);
  if (sHp) {
    player.maxHearts = Math.max(10, (player.maxHearts || 10) - sHp * 5);
    player.hearts = Math.min(player.hearts || 0, player.maxHearts);
  }
  if (sSta) {
    player.staminaMax = Math.max(10, (player.staminaMax || 10) - sSta * 2);
    player.stamina = Math.min(player.stamina || 0, player.staminaMax);
  }

  const refund = sDmg + sCrit + sHp + sSta;
  if (refund <= 0) {
    showWarning?.('Chưa có điểm nào để reset!');
    return;
  }

  player.statPoints = (player.statPoints || 0) + refund;

  // Reset lại bộ đếm điểm đã cộng
  CharacterPanelState.spent = { damage: 0, crit: 0, hp: 0, stamina: 0 };

  updateStatsOverlay?.();
  window.CharacterPanel?.refresh?.();
  showWarning?.(`↺ Đã reset và hoàn lại ${refund} điểm`);
}
/** ================== EQUIP OPS: unequip / discard equipped ================== */
function unequipSlot(slot, sendToBag = true) {
  const current = Equip.slots[slot];
  if (!current) {
    UIPopup.open({
      title: 'Slot trống',
      message: `[${slot}] hiện không có trang bị.`,
    });
    return;
  }
  if (sendToBag) Equip.inventory.push(current);
  Equip.slots[slot] = null;

  applyEquipmentBonuses();
  window.CharacterPanel?.refresh();
}

function scrapEquipped(slot) {
  const it = Equip.slots[slot];
  if (!it) return;

  const tier = Math.max(1, Math.min(10, Number(it.tier || 1)));
  const rarity = it.rarity || rarityOfTier(tier);
  const mult = RARITY_MULT[rarity] || 1;
  const dust = 5 * tier * mult;

  // gỡ khỏi slot, cộng bột sắt
  Equip.slots[slot] = null;
  Equip.ironDust = Number(Equip.ironDust || 0) + dust;

  applyEquipmentBonuses();
  showWarning?.(`⚙️ +${dust} bột sắt (Scrap ${it.name})`);
  updateUI?.();
  window.CharacterPanel?.refresh();
}

/** ================== INVENTORY OPS ================== */
function equipItemById(id) {
  const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));

  const item = Equip.inventory[idx];

  const targetSlot = autoPickTargetSlot(item);

  const current = Equip.slots[targetSlot];

  // lấy ra khỏi kho
  Equip.inventory.splice(idx, 1);

  // nếu ô đã có đồ → đẩy vào kho
  if (current) Equip.inventory.push(current);

  // trang bị
  Equip.slots[targetSlot] = item;

  applyEquipmentBonuses();
  window.CharacterPanel?.refresh();
  showWarning?.(`✅ Trang bị vào ô: ${targetSlot}`);
}
function equipItemByIdToSlot(id, targetSlot) {
  const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));

  const item = Equip.inventory[idx];

  // Lấy khỏi kho
  Equip.inventory.splice(idx, 1);

  // Nếu ô đã có đồ → đẩy vào kho (swap)
  if (Equip.slots[targetSlot]) {
    Equip.inventory.push(Equip.slots[targetSlot]);
  }

  // Trang bị
  Equip.slots[targetSlot] = item;

  applyEquipmentBonuses();
  window.CharacterPanel?.refresh();
  showWarning?.(`✅ Trang bị vào ô: ${targetSlot}`);
}
// Utils nhỏ (dùng cho sellItemById)
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function sellItemById(id) {
  const i = Equip.inventory.findIndex((it) => String(it.id) === String(id));
  if (i === -1) return;
  const it = Equip.inventory[i];
  const tier = clamp(Number(it.tier || 1), 1, 10);
  const rarity =
    it.rarity ||
    (tier <= 3
      ? 'common'
      : tier <= 6
      ? 'rare'
      : tier <= 8
      ? 'epic'
      : tier === 9
      ? 'legendary'
      : 'relic');
  const mult =
    { common: 1, rare: 2, epic: 4, legendary: 8, relic: 16 }[rarity] || 1;
  const coins = 5 * tier * mult; // công thức đơn giản, bạn có thể chỉnh sau
  Equip.inventory.splice(i, 1);
  player.coins = Number(player.coins || 0) + coins;
  showWarning?.(`🪙 +${coins} xu (đã bán ${it.name})`);
  updateUI?.();
  window.CharacterPanel?.refresh();
}

function useItemById(id) {
  const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));
  const it = Equip.inventory[idx];
  if (it.type !== 'consumable') return;

  const eff = it.effect || {};
  if (eff.hearts) {
    const maxH = Number(player.maxHearts || 9999);
    player.hearts = Math.min(maxH, Number(player.hearts || 0) + eff.hearts);
    showWarning?.(`❤️ +${eff.hearts} HP`);
  }
  if (eff.mana) {
    player.mana = Number(player.mana || 0) + eff.mana;
    showWarning?.(`🔷 +${eff.mana} Mana`);
  }
  if (eff.coins) {
    player.coins = Number(player.coins || 0) + eff.coins;
    showWarning?.(`🪙 +${eff.coins} xu`);
  }

  Equip.inventory.splice(idx, 1);
  updateStatsOverlay?.();
  updateUI?.();
  window.CharacterPanel?.refresh();
}

function openBoxById(id) {
  const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));
  const box = Equip.inventory[idx];
  if (box.type !== 'box') return;

  Equip.inventory.splice(idx, 1);

  const addOnce = (item) => {
    if (!Equip.inventory.some((it) => it.id === item.id))
      Equip.inventory.push(item);
  };

  const c = box.contents || {};
  if (c.coins) {
    player.coins = Number(player.coins || 0) + c.coins;
  }
  (c.consumables || []).forEach(addOnce);
  (c.items || []).forEach(addOnce);

  showWarning?.(
    `🎁 Mở hộp: +${c.coins || 0} xu, thêm ${
      (c.consumables?.length || 0) + (c.items?.length || 0)
    } vật phẩm vào kho`
  );
  updateStatsOverlay?.();
  updateUI?.();
  window.CharacterPanel?.refresh();
}

function scrapItemById(id) {
  const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));
  const it = Equip.inventory[idx];
  const tier = Math.max(1, Math.min(10, Number(it.tier || 1)));
  const rarity = it.rarity || rarityOfTier(tier);
  const mult = RARITY_MULT[rarity] || 1;

  // ✅ Quy bột sắt theo đúng khuôn sell: 5 * tier * mult (đã dùng cho xu)
  // để đảm bảo tăng dần theo bậc/độ hiếm như yêu cầu.
  const dust = 5 * tier * mult;

  Equip.inventory.splice(idx, 1);
  Equip.ironDust = Number(Equip.ironDust || 0) + dust;

  showWarning?.(`⚙️ +${dust} bột sắt (Scrap ${it.name})`);
  updateUI?.();
  window.CharacterPanel?.refresh();
}

/** ================== UI BUILDERS ================== */
function makeEl(tag, style = {}, text = '') {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  if (text) el.textContent = text;
  return el;
}

/** ================== UI POPUP (no-alert) ================== */
const UIPopup = (() => {
  let overlay, box, titleEl, bodyEl, btnRow;
  function ensure() {
    if (overlay) return;
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      placeItems: 'center',
      background: 'rgba(0,0,0,.45)',
      zIndex: 9999,
    });
    box = document.createElement('div');
    Object.assign(box.style, {
      background: '#10141c',
      border: '1px solid #2b3444',
      width: 'min(540px,90vw)',
      borderRadius: '14px',
      boxShadow: '0 20px 60px rgba(0,0,0,.45)',
      color: '#e3eefc',
      font: '14px/1.4 system-ui,Segoe UI,Roboto',
      overflow: 'hidden',
    });
    const head = document.createElement('div');
    Object.assign(head.style, {
      padding: '12px 16px',
      borderBottom: '1px solid #2b3444',
      background: 'linear-gradient(180deg,#152033,#0d1420)',
    });
    titleEl = document.createElement('div');
    Object.assign(titleEl.style, { fontWeight: 700, fontSize: '15px' });
    head.appendChild(titleEl);
    bodyEl = document.createElement('div');
    Object.assign(bodyEl.style, {
      padding: '14px 16px',
      whiteSpace: 'pre-wrap',
      maxHeight: '45vh',
      overflow: 'auto',
    });
    btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      padding: '12px 16px',
      display: 'flex',
      gap: '8px',
      justifyContent: 'flex-end',
      background: '#0b111a',
      borderTop: '1px solid #2b3444',
    });
    box.append(head, bodyEl, btnRow);
    overlay.append(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  // Tạo nút - Font chữ lấy từ hàm này
  function button(label, onClick, variant) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      minWidth: '4.2rem', // min-width để nút không quá nhỏ
      padding: '8px 12px',
      borderRadius: '10px',
      border: '1px solid #2b3444',
      background: variant === 'danger' ? '#431d24' : '#1b2738',
      color: '#fff',
      cursor: 'pointer',
      /*fontSize: '14px',*/
    });
    b.onclick = () => {
      close();
      onClick && onClick();
    };
    return b;
  }
  function open({ title = '', message = '', actions = [], html = false }) {
    ensure();
    titleEl.textContent = title;
    if (html) bodyEl.innerHTML = message;
    else bodyEl.textContent = message;
    btnRow.innerHTML = '';
    if (!actions.length) actions = [{ label: 'Đóng' }];
    actions.forEach((a) =>
      btnRow.appendChild(button(a.label, a.onClick, a.variant))
    );
    overlay.style.display = 'grid';
  }
  function close() {
    if (overlay) overlay.style.display = 'none';
  }
  return { open, close };
})();

function fmt(val) {
  if (typeof val === 'string') return val;
  return Math.abs(val) >= 100 ? Math.round(val) : Number(val).toFixed(1);
}

function buildPanel() {
  if (!CharacterPanelState.baseline) {
    CharacterPanelState.baseline = {
      damageBoost: Number(playerUpgrades?.damageBoost || 0),
      baseCritRate: Number(baseCritRate || 0),
      maxHearts: Number(player?.maxHearts || 10),
    };
  }
  if (document.getElementById('characterPanel')) return;

  const wrap = makeEl('div', {
    position: 'fixed',
    right: '16px',
    top: '64px',
    width: '420px',
    zIndex: 10000,
    background: 'rgba(20,20,28,0.95)',
    color: '#eaeaea',
    borderRadius: '14px',
    boxShadow: '0 10px 32px rgba(0,0,0,0.45)',
    display: 'none',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial',
  });
  wrap.id = 'characterPanel';

  const header = makeEl('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '2px',
    padding: '2px 4px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
  });
  const title = makeEl(
    'div',
    { fontWeight: '700', letterSpacing: '0.3px' },
    '📜 Nhân vật (C)'
  );
  const closeBtn = makeEl(
    'button',
    {
      background: 'none',
      border: 'none',
      color: '#fff',
      fontSize: '18px',
      fontWeight: 'bold',
      cursor: 'pointer',
      padding: '4px',
      lineHeight: '1',
      opacity: '0.6',
      transition: 'opacity 0.2s',
    },
    '×'
  );
  closeBtn.onmouseenter = () => (closeBtn.style.opacity = '1');
  closeBtn.onmouseleave = () => (closeBtn.style.opacity = '0.6');
  closeBtn.onclick = () => {
    window.CharacterPanel.toggle();
  };
  header.append(title, closeBtn);
  wrap.appendChild(header);

  const profile = makeEl('div', {
    display: 'grid',
    gridTemplateColumns: '88px 1fr',
    gap: '12px',
    padding: '12px',
  });
  const avatar = makeEl(
    'div',
    {
      width: '88px',
      height: '88px',
      borderRadius: '10px',
      background: 'linear-gradient(145deg,#1f2531,#171b24)',
      display: 'grid',
      placeItems: 'center',
      fontSize: '42px',
    },
    '🧟'
  );
  const pRight = makeEl('div', {});
  const name = makeEl('div', {
    fontSize: '16px',
    fontWeight: '700',
    marginBottom: '2px',
  });
  const line1 = makeEl('div', {
    opacity: 0.9,
    fontSize: '13px',
    marginBottom: '2px',
  });
  const line2 = makeEl('div', { opacity: 0.8, fontSize: '12px' });
  pRight.append(name, line1, line2);
  profile.append(avatar, pRight);
  wrap.appendChild(profile);

  const tabs = makeEl('div', {
    display: 'flex',
    gap: '6px',
    padding: '0 12px 10px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
  });
  const btnStats = makeEl(
    'button',
    {
      padding: '6px 10px',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      background: '#2e7d32',
      color: '#fff',
    },
    'Thuộc tính'
  );
  const btnGear = makeEl(
    'button',
    {
      padding: '6px 10px',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      background: '#3c475a',
      color: '#fff',
    },
    'Trang bị'
  );
  const btnBag = makeEl(
    'button',
    {
      padding: '6px 10px',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      background: '#3c475a',
      color: '#fff',
    },
    'Kho đồ'
  );
  const btnFuse = makeEl(
    'button',
    {
      padding: '6px 10px',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      background: '#3c475a',
      color: '#fff',
    },
    'Ghép đồ'
  );
  tabs.append(btnStats, btnGear, btnBag, btnFuse);
  wrap.appendChild(tabs);

  const statsArea = makeEl('div', { padding: '12px' });
  const pts = makeEl('div', { marginBottom: '8px', opacity: 0.9 });
  pts.id = 'char-pts';
  const statsList = makeEl('div');
  statsList.id = 'char-stats';

  statsArea.append(pts, statsList); // stats area

  const gearArea = makeEl('div', { display: 'none', padding: '12px' });
  const grid = makeEl('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
  });
  for (const slot of EQUIP_SLOTS) {
    const cell = makeEl('div', {
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '10px',
      height: '74px',
      display: 'grid',
      gridTemplateRows: '1fr auto',
      cursor: 'pointer',
    });
    const icon = makeEl('div', {
      display: 'grid',
      placeItems: 'center',
      fontSize: '20px',
    });
    const label = makeEl('div', {
      fontSize: '11px',
      textAlign: 'center',
      opacity: 0.85,
      padding: '4px 6px',
    });
    cell.dataset.slot = slot;
    icon.textContent = Equip.slots[slot]?.icon || '⬚';
    label.textContent = slot;
    cell.append(icon, label);
    cell.onclick = () => {
      const equipped = Equip.slots[slot];
      if (equipped) {
        UIPopup.open({
          title: `${equipped.icon || ''} ${equipped.name}`,
          html: true,
          message: (() => {
            const ROMAN = [
              'I',
              'II',
              'III',
              'IV',
              'V',
              'VI',
              'VII',
              'VIII',
              'IX',
              'X',
            ];
            const rarityOfTier = (t = 1) =>
              t <= 3
                ? 'common'
                : t <= 6
                ? 'rare'
                : t <= 8
                ? 'epic'
                : t === 9
                ? 'legendary'
                : 'relic';
            const rarityColor = {
              common: '#9e9e9e',
              rare: '#2e7dff',
              epic: '#7b3ff0',
              legendary: '#f0b400',
              relic: '#ff5252',
            };
            const BONUS_LABEL = {
              damageBoost: (v) => `+${v} sát thương`,
              hearts: (v) => `+${v} HP`,
              armor: (v) => `+${v} Giáp`,
              bulletSpeed: (v) => `+${Math.round(v * 100)}% tốc độ đạn`,
              moveSpeed: (v) => `+${Math.round(v * 100)}% tốc độ di chuyển`,
              critRate: (v) => `+${Math.round(v * 1000) / 10}% tỉ lệ chí mạng`,
              critDmg: (v) =>
                `+${Math.round(v * 1000) / 10}% sát thương chí mạng`,
              iceArrow: (v) => `+${v} cấp Ice Arrow`,
              lineBulletCount: (v) => `+${v} đạn/dòng`,
            };
            const chipsFromBonuses = (b) =>
              !b
                ? '—'
                : Object.entries(b)
                    .map(([k, v]) => {
                      const txt = BONUS_LABEL[k]
                        ? BONUS_LABEL[k](v)
                        : `${k}: ${v}`;
                      return `<span style="display:inline-block;padding:2px 8px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);margin:2px 6px 0 0;font-size:12px;line-height:20px;">${txt}</span>`;
                    })
                    .join('');
            const formatSpecial = (sp) => {
              if (!sp) return '—';
              const name = sp.name || 'Kỹ năng đặc biệt';
              const parts = [];
              if (sp.effect === 'slow' && sp.value)
                parts.push(`Làm chậm ${Math.round(sp.value * 100)}%`);
              if (sp.duration) parts.push(`trong ${sp.duration}s`);
              if (sp.cooldown) parts.push(`(Hồi chiêu ${sp.cooldown}s)`);
              if (!parts.length && sp.text) parts.push(sp.text);
              const trig =
                sp.trigger === 'active'
                  ? 'Kích hoạt thủ công'
                  : 'Kích hoạt khi đánh trúng';
              return `${name}: ${parts.join(' ')} • ${trig}`;
            };
            const tier = Math.max(1, Math.min(10, Number(equipped.tier || 1)));
            const rarity = equipped.rarity || rarityOfTier(tier);
            const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:8px;background:${
              rarityColor[rarity]
            };color:#0b111a;font-weight:700">
         ${ROMAN[tier - 1]} (${tier})
       </span>
       <span style="opacity:.75;margin-left:6px">${String(
         rarity
       ).toUpperCase()}</span>`;
            const section = (title, body, color) =>
              `<div style="margin:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         <span style="color:${color};font-weight:700">${title}:</span>
         <span style="opacity:.95">${body || '—'}</span>
       </div>`;
            return `<div style="font-size:13px;line-height:1.35;white-space:normal">
      ${section('Thông tin', equipped.desc || 'Trang bị.', '#66e3ff')}
      ${section('Tên', equipped.name, '#ffd166')}
      ${section('Thuộc tính', chipsFromBonuses(equipped.bonuses), '#a5d6a7')}
      ${section('Level', badge, '#b39ddb')}
      ${section(
        'Thuộc tính cộng thêm',
        chipsFromBonuses(
          equipped.extraBonuses || equipped.extra || equipped.randBonuses
        ) || '—',
        '#ffab91'
      )}
      ${section(
        'Tính năng đặc biệt',
        formatSpecial(equipped.special),
        '#f48fb1'
      )}
      ${section('Trạng thái', 'Đang được trang bị', '#90caf9')}
    </div>`;
          })(),
          actions: [
            { label: 'Tháo ra', onClick: () => unequipSlot(slot) },
            {
              label: 'Kho đồ',
              onClick: () => window.CharacterPanel?.openTab?.('bag'),
            },
            {
              label: 'Scrap (bột sắt)',
              onClick: () => scrapEquipped(slot),
              variant: 'danger',
            },
            { label: 'Đóng' },
          ],
        });
      } else {
        UIPopup.open({
          title: `Slot ${slot} trống`,
          message: 'Mở Kho đồ để chọn trang bị phù hợp.',
          actions: [
            {
              label: 'Mở Kho đồ',
              onClick: () => window.CharacterPanel?.openTab?.('bag'),
            },
            { label: 'Đóng' },
          ],
        });
      }
    };
    grid.appendChild(cell);
  }
  gearArea.appendChild(grid);

  const bagArea = makeEl('div', { display: 'none', padding: '12px' });
  const bagHeader = makeEl(
    'div',
    { marginBottom: '8px', opacity: 0.85, fontSize: '12px' },
    'Nhấp vào thẻ để xem chi tiết / Trang bị / Dùng / Mở'
  );
  const fuseArea = makeEl('div', { display: 'none', padding: '12px' });
  // ==== GHÉP ĐỒ ====
  // UI:
  fuseArea.innerHTML = `
  <div style="opacity:.9;margin-bottom:8px">
    Bột sắt: <b id="ironDustBadge">0</b>
  </div>
  <div id="fuseGrid" style="
    display:grid;grid-template-columns:repeat(3,84px);
    gap:8px;justify-content:center;margin:8px auto 10px auto">
    ${Array.from({ length: 9 })
      .map(
        (_, i) => `
      <div data-fcell="${i}" style="
        width:84px;height:84px;border-radius:10px;
        border:1px dashed rgba(255,255,255,.25);
        display:grid;place-items:center;position:relative;cursor:pointer;">
        <div style="font-size:22px;opacity:.8">⬚</div>
        <div data-fname style="position:absolute;bottom:4px;left:4px;right:4px;font-size:10px;opacity:.8;text-align:center;"></div>
      </div>
    `
      )
      .join('')}
  </div>
  <div id="fuseInfo" style="text-align:center;opacity:.9;margin-bottom:8px">—</div>
<div style="display:flex; gap:8px; justify-content:center">
  <button id="btnDoFuse" style="padding:6px 10px;border-radius:10px;border:1px solid #2b3444;background:#2e7d32;color:#fff;opacity:.6;cursor:not-allowed">
    Ghép
  </button>
  <button id="btnQuickPick" style="padding:6px 10px;border-radius:10px;border:1px solid #2b3444;background:#1b2738;color:#fff;">
    Chọn nhanh
  </button>
  <button id="btnClearFuse" style="padding:6px 10px;border-radius:10px;border:1px solid #2b3444;background:#1b2738;color:#fff;">
    Xóa
  </button>
</div>
`;
  wrap.appendChild(fuseArea);

  function quickFillFusionSlots() {
    const pool = (Equip.inventory || []).filter(
      (it) => it && (it.type === 'equipment' || it.slot || it.slotOptions)
    );
    if (!pool.length) {
      showWarning?.('Kho trống');
      return;
    }

    // dọn các slot hiện có về kho
    for (let i = 0; i < 8; i++) {
      if (Equip.fusion.mats[i]) {
        Equip.inventory.push(Equip.fusion.mats[i]);
        Equip.fusion.mats[i] = null;
      }
    }
    // bốc ngẫu nhiên tối đa 8
    for (let i = 0; i < 8 && pool.length; i++) {
      const k = (Math.random() * pool.length) | 0;
      const pick = pool.splice(k, 1)[0];
      const idx = Equip.inventory.findIndex(
        (x) => String(x.id) === String(pick.id)
      );
      if (idx !== -1) Equip.inventory.splice(idx, 1);
      Equip.fusion.mats[i] = pick;
    }
    window.CharacterPanel?.refresh?.();
  }

  // gắn sự kiện
  const btnQuick = fuseArea.querySelector('#btnQuickPick');
  if (btnQuick) btnQuick.onclick = quickFillFusionSlots;

  // map vị trí 0..8 → 8 ô vòng ngoài, ô 4 là trung tâm
  const RING_IDX = [0, 1, 2, 5, 8, 7, 6, 3]; // theo chiều kim đồng hồ
  function getFuseCells() {
    const grid = document.getElementById('fuseGrid');
    return grid ? Array.from(grid.querySelectorAll('[data-fcell]')) : [];
  }

  function refreshFuseAreaUI() {
    // cập nhật bột sắt
    const ironEl = document.getElementById('ironDustBadge');
    if (ironEl) ironEl.textContent = String(Equip.ironDust || 0);

    // grid chưa gắn thì thoát sớm
    const cells = getFuseCells();
    if (!cells || cells.length < 9) return;

    const mats =
      Equip.fusion && Array.isArray(Equip.fusion.mats)
        ? Equip.fusion.mats
        : new Array(8).fill(null);

    // 8 ô vòng ngoài
    for (let i = 0; i < 8; i++) {
      const ci = RING_IDX[i];
      const cell = cells[ci];
      if (!cell) continue;

      const it = mats[i] || null;

      // icon top
      let iconEl = cell.firstElementChild;
      if (!iconEl) {
        iconEl = document.createElement('div');
        iconEl.style.fontSize = '22px';
        iconEl.style.opacity = '.8';
        cell.appendChild(iconEl);
      }

      // tên đáy
      let nameEl = cell.querySelector('[data-fname]');
      if (!nameEl) {
        nameEl = document.createElement('div');
        nameEl.setAttribute('data-fname', '');
        nameEl.style.position = 'absolute';
        nameEl.style.bottom = '4px';
        nameEl.style.left = '4px';
        nameEl.style.right = '4px';
        nameEl.style.fontSize = '10px';
        nameEl.style.opacity = '.8';
        nameEl.style.textAlign = 'center';
        cell.appendChild(nameEl);
      }

      iconEl.textContent = it && it.icon ? it.icon : '⬚';
      nameEl.textContent = it && it.name ? it.name : '';

      cell.style.border = it
        ? '1px solid rgba(102, 227, 255, .35)'
        : '1px dashed rgba(255,255,255,.25)';
    }

    // ô giữa = kết quả
    const center = cells[4];
    if (center) {
      let iconM = center.firstElementChild;
      if (!iconM) {
        iconM = document.createElement('div');
        iconM.style.fontSize = '22px';
        iconM.style.opacity = '.8';
        center.appendChild(iconM);
      }
      let nameM = center.querySelector('[data-fname]');
      if (!nameM) {
        nameM = document.createElement('div');
        nameM.setAttribute('data-fname', '');
        nameM.style.position = 'absolute';
        nameM.style.bottom = '4px';
        nameM.style.left = '4px';
        nameM.style.right = '4px';
        nameM.style.fontSize = '10px';
        nameM.style.opacity = '.8';
        nameM.style.textAlign = 'center';
        center.appendChild(nameM);
      }

      const res = Equip.fusion.result;
      iconM.textContent = res?.icon || '🎁';
      nameM.textContent = res ? res.name || 'Kết quả' : 'Kết quả';
      center.style.border = res
        ? '1px solid rgba(255, 222, 120, .5)'
        : '1px dashed rgba(255,255,255,.25)';
    }

    // hint + enable nút
    const info = document.getElementById('fuseInfo');
    if (info) {
      const p = getFusionParams(); // { ready, n, group, targetTier, chance, failDust }
      if (p.ready) {
        info.textContent =
          `${p.group} bậc ${p.targetTier} • ` +
          `Chi phí: ${p.cost} bột sắt • Tỉ lệ: ${Math.round(p.chance * 100)}% `;
      } else {
        info.textContent = 'Chọn 2–8 trang bị bất kỳ để ghép.';
      }
    }
    const btn = document.getElementById('btnDoFuse');
    if (btn) {
      const p = getFusionParams();
      const can =
        !!p.ready &&
        Number(Equip.ironDust || 0) >= p.cost &&
        !Equip.fusion.isProcessing;
      btn.style.opacity = can ? '1' : '.6';
      btn.style.cursor = can ? 'pointer' : 'not-allowed';
      btn.disabled = !can;
    }
  }

  // tham số ghép: nhóm, bậc mục tiêu, chi phí, tỉ lệ
  function getFusionParams() {
    const mats = Equip.fusion.mats.filter(Boolean);
    const n = mats.length;
    if (n < 2) return { ready: false }; // >=2 món mới ghép

    // Bậc thấp nhất trong nguyên liệu → bậc đích = minTier + 1 (tối đa 10)
    const tiers = mats.map((it) => Number(it.tier || 1));
    const minTier = Math.min(...tiers);
    const targetTier = Math.min(10, minTier + 1);

    // Chọn NGẪU NHIÊN nhóm từ các món có bậc thấp nhất
    const candGroups = mats
      .filter((it) => Number(it.tier || 1) === minTier)
      .map(getItemGroup)
      .filter(Boolean);
    const group = candGroups.length
      ? candGroups[(Math.random() * candGroups.length) | 0]
      : getItemGroup(mats[0]) || 'Trang bị';

    // Bảng tỉ lệ theo số lượng ghép (có thể tinh chỉnh để cân bằng)
    const CHANCE_BY_COUNT = {
      2: 0.3,
      3: 0.4,
      4: 0.55,
      5: 0.7,
      6: 0.82,
      7: 0.9,
      8: 0.96,
    };
    const chance = CHANCE_BY_COUNT[Math.min(8, Math.max(2, n))];
    // 💰 Phí ghép = phí cơ bản theo số món * hệ số theo bậc thấp nhất
    const baseCost = FUSION_COST_BY_COUNT[Math.min(8, Math.max(2, n))] || 0;
    const cost = Math.max(
      1,
      Math.ceil(baseCost * FUSION_TIER_MULT * Math.max(1, minTier))
    );
    // 🔁 Khi fail, hoàn một phần phí theo REFUND_RATE
    const failDust = Math.floor(cost * FUSION_REFUND_RATE);

    return {
      ready: true,
      n,
      group,
      targetTier,
      cost,
      chance,
      failDust,
      minTier,
    };
  }
  // thêm/xóa nguyên liệu
  function addToFusion(id) {
    const idx = Equip.inventory.findIndex((it) => String(it.id) === String(id));
    const empty = Equip.fusion.mats.findIndex((x) => !x);
    if (empty === -1) {
      showWarning?.('Đã đủ 8 nguyên liệu');
      return;
    }
    const it = Equip.inventory[idx];
    Equip.inventory.splice(idx, 1);
    Equip.fusion.mats[empty] = it;
    window.CharacterPanel?.refresh();
  }
  function removeFuseAt(i) {
    const it = Equip.fusion.mats[i];
    if (!it) return;
    Equip.inventory.push(it);
    Equip.fusion.mats[i] = null;
    window.CharacterPanel?.refresh();
  }
  function clearFusion() {
    for (let i = 0; i < 8; i++)
      if (Equip.fusion.mats[i]) {
        Equip.inventory.push(Equip.fusion.mats[i]);
        Equip.fusion.mats[i] = null;
      }
    Equip.fusion.result = null;
    window.CharacterPanel?.refresh();
  }

  // click ô vòng ngoài để bỏ nguyên liệu, click ô giữa để nhận kết quả
  (function wireFuseGrid() {
    const cells = getFuseCells();
    if (cells.length < 9) {
      // DOM chưa gắn xong -> defer đến frame kế tiếp
      requestAnimationFrame(wireFuseGrid);
      return;
    }
    // 8 ô vòng ngoài
    RING_IDX.forEach((ci, i) => {
      const cell = cells[ci];
      cell.onclick = () => openFusionPicker(i);
      cell.title = 'Nhấp để chọn trang bị từ Kho đưa vào ô ghép';
    });
    // ô giữa = kết quả
    const cMid = cells[4];
    cMid.onclick = () => {
      const res = Equip.fusion.result;
      if (!res) return;
      UIPopup.open({
        title: `${res.icon || ''} ${res.name}`,
        message: `Nhận về Kho đồ?`,
        actions: [
          {
            label: 'Nhận',
            onClick: () => {
              Equip.inventory.push(res);
              Equip.fusion.result = null;
              window.CharacterPanel?.refresh();
            },
          },
          { label: 'Đóng' },
        ],
      });
    };
  })();

  // nút hành động
  const btnDo = fuseArea.querySelector('#btnDoFuse');
  if (btnDo)
    btnDo.onclick = () => {
      const p = getFusionParams();
      if (!p?.ready) return;
      if (Equip?.fusion?.isProcessing) return; // chống spam khi đang xử lý

      // 🧱 Kiểm tra bột sắt
      const dust = Number(Equip.ironDust || 0);
      if (dust < p.cost) {
        showWarning?.('Không đủ bột sắt để ghép');
        return;
      }

      // 💳 Trừ phí ngay khi bấm
      Equip.ironDust = dust - p.cost;

      // Lấy & clear nguyên liệu
      const mats = (Equip.fusion.mats || []).filter(Boolean);
      Equip.fusion.mats.fill(null);

      // Đánh dấu trạng thái đang tái chế + cập nhật UI
      Equip.fusion.isProcessing = true;
      window.CharacterPanel?.refresh?.();

      // ⏳ Pha 1: hiển thị "Đang tái chế…" với progress
      window.openFuseProcessingToast(FUSION_PROCESS_MS, {
        n: p.n,
        group: p.group,
        targetTier: p.targetTier,
      });
      setTimeout(() => {
        /* tính ok/fail rồi show kết quả */
      }, FUSION_PROCESS_MS + 30);
      // ⏲️ Pha 2: hết thời gian mới quyết định & show kết quả
      setTimeout(() => {
        try {
          const ok = Math.random() < p.chance;

          if (ok) {
            // Chọn 1 base trong nhóm cùng bậc thấp nhất để scale bonus & icon
            const base =
              mats.find(
                (it) =>
                  getItemGroup(it) === p.group &&
                  Number(it.tier || 1) === p.minTier
              ) || mats[0];

            const newTier = p.targetTier;
            const bonuses = scaleBonusesForTier(
              base?.bonuses || {},
              Number(base?.tier || 1),
              newTier
            );

            // Lưu kết quả ghép
            Equip.fusion.result = {
              id: `fuse_${Date.now()}_${(Math.random() * 1e6) | 0}`,
              name: `${p.group} Bậc ${newTier}`,
              icon: base?.icon || '⭐',
              slot: p.group,
              tier: newTier,
              rarity: rarityOfTier(newTier),
              bonuses,
              type: 'equipment',
            };

            const fusedResult = Equip?.fusion?.result || null;
            window.openFuseResultPopup?.(true, {
              chance: p.chance,
              result: fusedResult,
              targetTier: p.targetTier,
              group: p.group,
            });
          } else {
            // ❌ Thất bại → hoàn một phần phí
            Equip.ironDust = Number(Equip.ironDust || 0) + (p.failDust || 0);
            Equip.fusion.result = null;

            window.openFuseResultPopup?.(false, {
              chance: p.chance,
              failDust: p.failDust,
              group: p.group,
              targetTier: p.targetTier,
            });
          }
        } finally {
          Equip.fusion.isProcessing = false;
          window.CharacterPanel?.refresh?.();
        }
      }, (typeof FUSION_PROCESS_MS === 'number' ? FUSION_PROCESS_MS : 3000) + 30);
    };

  const btnClr = fuseArea.querySelector('#btnClearFuse');
  if (btnClr) btnClr.onclick = clearFusion;

  // Mở popup chọn trang bị trong Kho, click 1 cái là đưa vào ô ghép vị trí i
  function openFusionPicker(i) {
    // xác định nhóm đang ghép (nếu đã có món trong các ô)
    const mats =
      Equip.fusion && Array.isArray(Equip.fusion.mats) ? Equip.fusion.mats : [];
    const firstMat = mats.find(Boolean);
    const requiredGroup = firstMat ? getItemGroup(firstMat) : null;

    // lọc item trong Kho
    let pool = (Equip.inventory || []).filter(
      (it) => !!it && (it.type === 'equipment' || it.slot || it.slotOptions)
    );

    UIPopup.open({
      title: requiredGroup
        ? `Chọn ${requiredGroup} từ Kho`
        : 'Chọn trang bị từ Kho',
      html: true, // ✅ quan trọng: cho phép render HTML
      message: `
  <div id="fusionPicker"
       style="
         display:grid;
         grid-template-columns:repeat(4,1fr);
         gap:8px;
         max-height:calc(4 * 74px + 3 * 8px);
         overflow:auto;
         padding:4px 2px 4px 4px;">
  </div>
`,
      actions: [
        mats[i]
          ? {
              label: 'Bỏ ô này',
              onClick: () => {
                removeFuseAt(i);
              },
            }
          : null,
        { label: 'Đóng' },
      ].filter(Boolean),
    });

    // Sau khi popup mount xong, render danh sách nút chọn
    setTimeout(() => {
      const box = document.getElementById('fusionPicker');
      if (!box) return;

      for (const it of pool) {
        // Map hiếm & badge (giống Kho đồ)
        const ROMAN = [
          'I',
          'II',
          'III',
          'IV',
          'V',
          'VI',
          'VII',
          'VIII',
          'IX',
          'X',
        ];
        const rarityOfTier = (t = 1) =>
          t <= 3
            ? 'common'
            : t <= 6
            ? 'rare'
            : t <= 8
            ? 'epic'
            : t === 9
            ? 'legendary'
            : 'relic';
        const rarityColor = {
          common: '#9e9e9e',
          rare: '#2e7dff',
          epic: '#7b3ff0',
          legendary: '#f0b400',
          relic: '#ff5252',
        };

        const tier = Number(it.tier || 1);
        const rarity = it.rarity || rarityOfTier(tier);

        // Card giống Kho đồ (nền, viền theo rarity, bố cục, badge…)
        const card = document.createElement('div');
        Object.assign(card.style, {
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${
            rarityColor[rarity] || 'rgba(255,255,255,0.07)'
          }`,
          borderRadius: '10px',
          height: '74px',
          display: 'grid',
          gridTemplateRows: '1fr auto',
          cursor: 'pointer',
          position: 'relative',
        });

        const icon = document.createElement('div');
        Object.assign(icon.style, {
          display: 'grid',
          placeItems: 'center',
          fontSize: '20px',
        });
        icon.textContent = it.icon || '⬚';

        const label = document.createElement('div');
        Object.assign(label.style, {
          fontSize: '11px',
          textAlign: 'center',
          opacity: 0.9,
          padding: '4px 6px',
        });
        label.textContent = it.name || it.id;

        const badge = document.createElement('div');
        Object.assign(badge.style, {
          position: 'absolute',
          right: '4px',
          top: '4px',
          padding: '1px 6px',
          borderRadius: '8px',
          fontSize: '10px',
          fontWeight: '700',
          background: rarityColor[rarity] || '#444',
          color: '#0b111a',
        });
        badge.textContent = ROMAN[Math.max(1, Math.min(10, tier)) - 1];

        card.append(icon, label, badge);

        // Click để đưa thẳng vào ô ghép (giữ nguyên logic cũ)
        card.onclick = () => {
          if (Equip.fusion.mats[i]) Equip.inventory.push(Equip.fusion.mats[i]);
          const idx = Equip.inventory.findIndex(
            (x) => String(x.id) === String(it.id)
          );
          if (idx !== -1) Equip.inventory.splice(idx, 1);
          Equip.fusion.mats[i] = it;
          window.CharacterPanel?.refresh?.();
          UIPopup.close?.();
        };

        box.appendChild(card);
      }
    }, 0);
  }

  const bagGrid = makeEl('div', {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
    maxHeight: 'calc(4 * 74px + 3 * 8px)',
    overflowY: 'auto',
    paddingRight: '2px',
  });
  bagGrid.id = 'bagGrid';
  bagArea.append(bagHeader, bagGrid);

  function renderBag() {
    const grid = document.getElementById('bagGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const equippedSet = new Set(Object.values(Equip.slots).filter(Boolean));
    const list = Equip.inventory.filter((it) => !equippedSet.has(it));

    function buildItemPopupHTML(it) {
      const ROMAN = [
        'I',
        'II',
        'III',
        'IV',
        'V',
        'VI',
        'VII',
        'VIII',
        'IX',
        'X',
      ];
      const tier = Math.max(1, Math.min(10, Number(it.tier || 1)));
      const rarity = it.rarity || rarityOfTier(tier);
      const tshow = `${ROMAN[tier - 1]} (${tier})`;
      const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:8px;
                  background:${
                    rarityColor[rarity]
                  };color:#0b111a;font-weight:700">
       ${tshow}
     </span>
     <span style="opacity:.75;margin-left:6px">${String(
       rarity
     ).toUpperCase()}</span>`;
      const mainAttr = it.slot ? chipsFromBonuses(it.bonuses) : '—';
      const extraAttr =
        chipsFromBonuses(it.extraBonuses || it.extra || it.randBonuses) || '—';
      const special = formatSpecial(it.special);
      const state = formatState(it);
      const line = (title, body, color) =>
        `<div style="margin:3px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
       <span style="color:${color};font-weight:700">${title}:</span>
       <span style="opacity:.95">${body || '—'}</span>
     </div>`;
      return `<div style="font-size:13px;line-height:1.35;white-space:normal">
    ${line('Thông tin', describeItem(it), '#66e3ff')}
    ${line('Tên', it.name, '#ffd166')}
    ${line('Thuộc tính', mainAttr, '#a5d6a7')}
    ${line('Level', badge, '#b39ddb')}
    ${line('Thuộc tính cộng thêm', extraAttr, '#ffab91')}
    ${line('Tính năng đặc biệt', special, '#f48fb1')}
    ${line('Trạng thái', state, '#90caf9')}
  </div>`;
    }

    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const rarityOfTier = (t = 1) =>
      t <= 3
        ? 'common'
        : t <= 6
        ? 'rare'
        : t <= 8
        ? 'epic'
        : t === 9
        ? 'legendary'
        : 'relic';
    const rarityColor = {
      common: '#9e9e9e',
      rare: '#2e7dff',
      epic: '#7b3ff0',
      legendary: '#f0b400',
      relic: '#ff5252',
    };
    const BONUS_LABEL = {
      damageBoost: (v) => `+${v} sát thương`,
      hearts: (v) => `+${v} HP`,
      armor: (v) => `+${v} Giáp`,
      bulletSpeed: (v) => `+${Math.round(v * 100)}% tốc độ đạn`,
      moveSpeed: (v) => `+${Math.round(v * 100)}% tốc độ di chuyển`,
      critRate: (v) => `+${Math.round(v * 1000) / 10}% tỉ lệ chí mạng`,
      critDmg: (v) => `+${Math.round(v * 1000) / 10}% sát thương chí mạng`,
      iceArrow: (v) => `+${v} cấp Ice Arrow`,
      lineBulletCount: (v) => `+${v} đạn/dòng`,
    };

    function formatBonuses(b) {
      if (!b) return '—';
      return Object.entries(b)
        .map(([k, v]) => (BONUS_LABEL[k] ? BONUS_LABEL[k](v) : `${k}: ${v}`))
        .join(', ');
    }

    function chipsFromBonuses(b) {
      if (!b) return '';
      return Object.entries(b)
        .map(([k, v]) => {
          const txt = BONUS_LABEL[k] ? BONUS_LABEL[k](v) : `${k}: ${v}`;
          return `<span style="
      display:inline-block;padding:2px 8px;border-radius:8px;
      background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);
      margin:2px 6px 0 0; font-size:12px; line-height:20px;">${txt}</span>`;
        })
        .join('');
    }

    function describeItem(it) {
      if (it.desc) return it.desc;
      if (it.type === 'box') {
        const c = it.contents || {};
        const parts = [];
        if (c.coins) parts.push(`+${c.coins} xu`);
        const extra = (c.consumables?.length || 0) + (c.items?.length || 0);
        if (extra) parts.push(`${extra} vật phẩm kèm theo`);
        return `Hộp quà. ${parts.join(', ')}`.trim();
      }
      if (it.type === 'consumable') {
        const eff = it.effect || {};
        const arr = [];
        if (eff.hearts) arr.push(`+${eff.hearts} HP`);
        if (eff.mana) arr.push(`+${eff.mana} Mana`);
        if (eff.coins) arr.push(`+${eff.coins} xu`);
        return `Vật phẩm tiêu hao: ${arr.join(', ')}`.trim();
      }
      if (it.slot && it.bonuses)
        return `Trang bị. ${formatBonuses(it.bonuses)}.`;
      return '';
    }

    function formatSpecial(sp) {
      if (!sp) return '—';
      const name = sp.name || 'Kỹ năng đặc biệt';
      const parts = [];
      if (sp.effect === 'slow' && sp.value)
        parts.push(`Làm chậm ${Math.round(sp.value * 100)}%`);
      if (sp.duration) parts.push(`trong ${sp.duration}s`);
      if (sp.cooldown) parts.push(`(Hồi chiêu ${sp.cooldown}s)`);
      if (!parts.length && sp.text) parts.push(sp.text);
      const trig =
        sp.trigger === 'active'
          ? 'Kích hoạt thủ công'
          : 'Kích hoạt khi đánh trúng';
      return `${name}: ${parts.join(' ')} • ${trig}`;
    }

    function formatState(it) {
      if (it.type === 'box') return 'Có thể mở';
      if (it.type === 'consumable') return 'Có thể sử dụng';
      if (it.special?.trigger === 'active') return 'Có thể kích hoạt';
      if (it.special) return 'Bị động (tự kích hoạt)';
      if (it.slot || it.type === 'equipment') return 'Có thể trang bị';
      return '—';
    }

    list.forEach((it) => {
      const tier = Number(it.tier || 1);
      const rarity = it.rarity || rarityOfTier(tier);
      const card = makeEl('div', {
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${rarityColor[rarity] || 'rgba(255,255,255,0.07)'}`,
        borderRadius: '10px',
        height: '74px',
        display: 'grid',
        gridTemplateRows: '1fr auto',
        cursor: 'pointer',
        position: 'relative',
      });
      const icon = makeEl(
        'div',
        { display: 'grid', placeItems: 'center', fontSize: '20px' },
        it.icon || '⬚'
      );
      const label = makeEl(
        'div',
        {
          fontSize: '11px',
          textAlign: 'center',
          opacity: 0.9,
          padding: '4px 6px',
        },
        it.name || it.id
      );
      const badge = makeEl(
        'div',
        {
          position: 'absolute',
          right: '4px',
          top: '4px',
          padding: '1px 6px',
          borderRadius: '8px',
          fontSize: '10px',
          fontWeight: '700',
          background: rarityColor[rarity] || '#444',
          color: '#0b111a',
        },
        ROMAN[Math.max(1, Math.min(10, tier)) - 1]
      );
      card.title = `${it.name} • Slot: ${it.slot || it.type || '—'}`;
      card.append(icon, label, badge);
      card.onclick = () => {
        const actions = [];
        if (it.type === 'box') {
          actions.push({ label: 'Mở', onClick: () => openBoxById(it.id) });
        } else if (it.type === 'consumable') {
          actions.push({ label: 'Dùng', onClick: () => useItemById(it.id) });
        } else if (isEquippable(it)) {
          const allowed = getAllowedSlotsForItem(it);
          if (allowed.length > 1) {
            // ✅ Chỉ hiện 2 nút cho item 2 slot
            actions.push({
              label: 'Trang bị 1',
              onClick: () => equipItemByIdToSlot(it.id, allowed[0]),
            });
            actions.push({
              label: 'Trang bị 2',
              onClick: () => equipItemByIdToSlot(it.id, allowed[1]),
            });
          } else {
            // ✅ Item 1 slot vẫn có 1 nút "Trang bị"
            actions.push({
              label: 'Trang bị',
              onClick: () => equipItemById(it.id),
            });
          }
        }
        // ➕ Bán lấy xu
        actions.push({ label: 'Bán', onClick: () => sellItemById(it.id) });

        // 🔧 Scrap đổi bột sắt (thay cho Hủy)
        actions.push({
          label: 'Scrap',
          onClick: () => scrapItemById(it.id),
          variant: 'danger',
        });

        // ➕ Đưa vào ghép (nếu là trang bị)
        if (isEquippable(it)) {
          actions.push({
            label: 'Ghép',
            onClick: () => {
              addToFusion(it.id);
              window.CharacterPanel?.openTab?.('fuse');
            },
          });
        }
        actions.push({ label: 'Đóng' });
        UIPopup.open({
          title: `${it.icon || ''} ${it.name}`,
          html: true,
          message: buildItemPopupHTML(it),
          actions,
        });
      };
      grid.appendChild(card);
    });
  }

  const footer = makeEl('div', {
    padding: '10px 12px',
    fontSize: '12px',
    opacity: 0.85,
    borderTop: '1px solid rgba(255,255,255,0.07)',
  });
  footer.id = 'char-footer';

  (function ensureBagScrollCSS() {
    if (document.getElementById('bagScrollCSS')) return;
    const css = document.createElement('style');
    css.id = 'bagScrollCSS';
    css.textContent = `
    #bagGrid { scrollbar-width: none; -ms-overflow-style: none; }
    #bagGrid::-webkit-scrollbar { width: 0; height: 0; }
  `;
    document.head.appendChild(css);
  })();
  // Ẩn scrollbar cho danh sách chọn từ Kho trong popup ghép
  (function ensureFusionPickerScrollCSS() {
    if (document.getElementById('fusionPickerScrollCSS')) return;
    const css = document.createElement('style');
    css.id = 'fusionPickerScrollCSS';
    css.textContent = `
    #fusionPicker { scrollbar-width: none; -ms-overflow-style: none; }
    #fusionPicker::-webkit-scrollbar { width: 0; height: 0; }
  `;
    document.head.appendChild(css);
  })();

  wrap.append(statsArea, gearArea, bagArea, footer);
  document.body.appendChild(wrap);

  // === Tab switching (null-safe) ===
  function showTab(tab) {
    // helpers
    const show = (el) => {
      if (el) el.style.display = 'block';
    };
    const hide = (el) => {
      if (el) el.style.display = 'none';
    };
    const on = (btn) => {
      if (btn) btn.style.background = '#2e7d32';
    };
    const off = (btn) => {
      if (btn) btn.style.background = '#3c475a';
    };

    // ẩn tất cả vùng
    hide(statsArea);
    hide(gearArea);
    hide(bagArea);
    hide(fuseArea);
    // reset màu
    off(btnStats);
    off(btnGear);
    off(btnBag);
    off(btnFuse);

    switch (tab) {
      case 'gear':
        show(gearArea);
        on(btnGear);
        break;
      case 'bag':
        show(bagArea);
        on(btnBag);
        break;
      case 'fuse':
        show(fuseArea);
        on(btnFuse);
        break;
      default:
        show(statsArea);
        on(btnStats);
    }
    window.CharacterPanel.activeTab = tab;
    refreshFooter();
  }

  // Gán handler an toàn
  btnStats && btnStats.addEventListener('click', () => showTab('stats'));
  btnGear && btnGear.addEventListener('click', () => showTab('gear'));
  btnBag && btnBag.addEventListener('click', () => showTab('bag'));
  btnFuse && btnFuse.addEventListener('click', () => showTab('fuse'));

  function refreshProfile() {
    const n = player?.name ?? 'Player';
    const lv = player?.level ?? 1;
    const hp = player?.hearts ?? 0;
    const stamina = player?.stamina ?? 0;
    const spd = player?.speed ?? 0;
    const dmg = playerUpgrades?.damageBoost ?? 0;
    const bulletSpeed = playerUpgrades?.bulletSpeed ?? 1;
    name.textContent = n;
    line1.textContent = `Lv ${lv} • HP ${hp}/${player.maxHearts} • Stamina ${stamina}/${player.staminaMax}`;
    line2.textContent = `👟 ${fmt(spd)} | 💥 ${fmt(dmg)} | 💨 ${bulletSpeed}`;
  }

  function renderRows() {
    statsList.innerHTML = '';
    STAT_DEFS.forEach((def) => {
      const row = makeEl('div', {
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: '6px',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      });
      const left = makeEl('div', {}, def.name);
      const keyMap = {
        damage: 'damage',
        crit_perm: 'crit',
        hp_cap: 'hp',
        stamina: 'stamina',
      };
      const stepMap = { damage: 1, crit_perm: 1, hp_cap: 5, stamina: 2 };
      const unitMap = { crit_perm: '%' };

      const val = makeEl('div', { textAlign: 'right', opacity: 0.9 });

      (function renderVal() {
        const total = def.read(); // có thể là số hoặc chuỗi '0%'
        const cnt = CharacterPanelState.spent?.[keyMap[def.key]] | 0;
        const addRaw = cnt * (stepMap[def.key] || 0);
        const addStr =
          addRaw > 0 ? ` (+${addRaw}${unitMap[def.key] || ''})` : '';
        val.textContent = `${fmt(total)}${addStr}`;
      })();
      const btn = makeEl(
        'button',
        {
          padding: '2px 8px',
          background: '#2e7d32',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
        },
        `+ ${def.stepText}`
      );
      btn.setAttribute('type', 'button');
      const renderEnabled = !def.enabled || def.enabled();
      const renderPtsOk = Number(player?.statPoints || 0) > 0;
      if (!(renderEnabled && renderPtsOk)) {
        btn.disabled = true;
        btn.style.opacity = 0.6;
        btn.style.cursor = 'not-allowed';
      }
      btn.onclick = () => {
        if (def.enabled && !def.enabled()) return;
        const pts = Number(player?.statPoints || 0);
        if (pts <= 0) return;
        def.add?.();
        window.CharacterPanel?.refresh?.();
        updateStatsOverlay?.();
      };
      row.append(left, val, btn);
      statsList.appendChild(row);
    });
  }
  // === Footer with EXP and action button ===
  function refreshFooter() {
    const footer = document.getElementById('char-footer');
    if (!footer) return;

    const cur = player?.currentLevelExp ?? player?.exp ?? 0;
    const req = player?.requiredExp ?? 0;
    const activeTab = window.CharacterPanel?.activeTab;

    let buttonsHTML = '';
    // Dựa vào tab đang hoạt động để tạo nút tương ứng
    switch (activeTab) {
      case 'stats':
        buttonsHTML = `
          <button id="btnResetStats" style="padding:4px 10px;border-radius:8px;border:1px solid #555;background:#2b2b2b;color:#ffd54f;cursor:pointer">
            ↺ Reset điểm
          </button>`;
        break;
      case 'gear':
        buttonsHTML = `
          <button id="btnUnequipAll" style="padding:4px 10px;border-radius:8px;border:1px solid #2b3444;background:#1b2738;color:#fff;cursor:pointer">
            Tháo tất cả
          </button>`;
        break;
      case 'bag':
        // Thêm một div để nhóm 2 nút lại với nhau
        buttonsHTML = `
          <div style="display:flex; gap: 8px;">
            <button id="btnQuickEquip" style="padding:4px 10px;border-radius:8px;border:1px solid #2b3444;background:#1b2738;color:#fff;cursor:pointer">
              Trang bị nhanh
            </button>
            <button id="btnSortInv" style="padding:4px 10px;border-radius:8px;border:1px solid #2b3444;background:#1b2738;color:#fff;cursor:pointer">
              Sắp xếp
            </button>
          </div>`;
        break;
    }

    // Render footer với EXP và các nút đã tạo
    footer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div>EXP: ${cur}/${req}</div>
      ${buttonsHTML}
    </div>`;

    // Gán sự kiện click cho các nút sau khi render
    switch (activeTab) {
      case 'stats': {
        const btn = footer.querySelector('#btnResetStats');
        if (btn) btn.onclick = resetStatPoints;
        break;
      }
      case 'gear': {
        const btn = footer.querySelector('#btnUnequipAll');
        if (btn) btn.onclick = unequipAllItems;
        break;
      }
      case 'bag': {
        const btnSort = footer.querySelector('#btnSortInv');
        if (btnSort)
          btnSort.onclick = () => {
            sortInventoryQuick();
            renderBag?.();
          };

        const btnEquip = footer.querySelector('#btnQuickEquip');
        if (btnEquip) btnEquip.onclick = quickEquipBestItems;
        break;
      }
    }
  }

  // THÊM helper: Trang bị nhanh đồ tốt nhất
  function quickEquipBestItems() {
    const bestInSlot = new Map(); // Dùng Map để lưu trang bị tốt nhất cho mỗi loại (Vũ khí, Giáp,...)

    // 1. Tìm trang bị có bậc cao nhất cho mỗi loại trong kho đồ
    for (const item of Equip.inventory) {
      if (!isEquippable(item)) continue;
      const group = getItemGroup(item); // Lấy nhóm trang bị (vd: 'Vũ khí', 'Giáp', 'Nhẫn')
      if (!group) continue;

      const currentBest = bestInSlot.get(group);
      const itemTier = Number(item.tier || 1);

      // Nếu chưa có món tốt nhất hoặc món này có bậc cao hơn -> cập nhật
      if (!currentBest || itemTier > Number(currentBest.tier || 1)) {
        bestInSlot.set(group, item);
      }
    }

    const itemsToEquip = Array.from(bestInSlot.values());
    if (itemsToEquip.length === 0) {
      showWarning?.('Không có trang bị trong kho để trang bị nhanh.');
      return;
    }

    let equippedCount = 0;
    // 2. Duyệt qua danh sách đồ tốt nhất và trang bị nếu nó tốt hơn đồ đang mặc
    for (const bestItem of itemsToEquip) {
      const targetSlot = autoPickTargetSlot(bestItem); // Tự động chọn ô trang bị
      const currentItemInSlot = Equip.slots[targetSlot];

      const bestItemTier = Number(bestItem.tier || 1);
      // Gán bậc là -1 nếu ô trống để đảm bảo luôn trang bị vào ô trống
      const currentItemTier = currentItemInSlot
        ? Number(currentItemInSlot.tier || 1)
        : -1;

      // Chỉ trang bị khi món mới có bậc cao hơn món đang mặc
      if (bestItemTier > currentItemTier) {
        const invIndex = Equip.inventory.findIndex(
          (it) => it.id === bestItem.id
        );
        if (invIndex === -1) continue;

        const itemToEquip = Equip.inventory.splice(invIndex, 1)[0]; // Lấy đồ ra khỏi kho

        if (currentItemInSlot) {
          Equip.inventory.push(currentItemInSlot); // Trả đồ cũ vào kho
        }

        Equip.slots[targetSlot] = itemToEquip; // Mặc đồ mới
        equippedCount++;
      }
    }

    if (equippedCount > 0) {
      applyEquipmentBonuses(); // Cập nhật lại chỉ số nhân vật
      window.CharacterPanel?.refresh(); // Làm mới giao diện
      showWarning?.(`✅ Đã trang bị nhanh ${equippedCount} món đồ tốt nhất.`);
    } else {
      showWarning?.('Bạn đã đang mặc trang bị tốt nhất rồi.');
    }
  }

  // THÊM helper:
  function sortInventoryQuick() {
    const keyGroup = (it) => getItemGroup(it) || 'ZZZ';
    const keyTier = (it) => Number(it.tier || 1);
    // Tier giảm dần, group A→Z
    Equip.inventory.sort((a, b) => {
      const dt = keyTier(b) - keyTier(a);
      if (dt) return dt;
      const ga = keyGroup(a),
        gb = keyGroup(b);
      return ga.localeCompare(gb, 'vi');
    });
  }

  function refreshHeaderPts() {
    const p = Number(player?.statPoints || 0);
    pts.textContent = `Điểm nâng cấp: ${p}`;
    pts.style.color = p > 0 ? '#ffd54f' : '#e0e0e0';
  }

  function refreshGearIcons() {
    for (const cell of gearArea.querySelectorAll('[data-slot]')) {
      const slot = cell.dataset.slot;
      const icon = cell.firstChild;
      icon.textContent = Equip.slots[slot]?.icon || '⬚';
    }
  }

  function refresh() {
    refreshProfile();
    refreshHeaderPts();
    renderRows();
    refreshFooter();
    refreshGearIcons();
    renderBag();
    if (typeof refreshFuseAreaUI === 'function') refreshFuseAreaUI();
  }

  window.CharacterPanel = {
    // Khởi tạo tab mặc định là 'stats'
    activeTab: 'stats',

    toggle() {
      const show = wrap.style.display === 'none';
      if (show) {
        // Khi mở panel, luôn hiển thị tab đang hoạt động (hoặc tab mặc định)
        showTab(this.activeTab); // Cập nhật giao diện tab (vùng hiển thị, màu nút)
        refresh(); // Cập nhật tất cả dữ liệu (chỉ số, túi đồ, v.v.)
      }
      wrap.style.display = show ? 'block' : 'none';
    },
    refresh,
    openTab(tab) {
      const validTabs = ['gear', 'bag', 'fuse', 'stats'];
      if (validTabs.includes(tab)) {
        showTab(tab);
      } else {
        showTab('stats'); // Mặc định về stats nếu tab không hợp lệ
      }
    },
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      window.CharacterPanel.toggle();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    refresh();
  });
}
// THÊM mới phía dưới — popup riêng cho Ghép
// ==== Fusion Toast (core + processing + result) =================================
(function () {
  function injectFusionToastStyles() {
    const css = `
.fusion-toast-overlay{
  position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  pointer-events:none;z-index:10050;
}
.fusion-toast{
  min-width:360px;max-width:clamp(360px,60vw,520px);
  background:rgba(20,24,32,.9);
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 10px 40px rgba(0,0,0,.35), inset 0 0 120px rgba(255,255,255,.03);
  border-radius:16px;padding:22px 26px;backdrop-filter:blur(6px);
  transform:scale(.92);opacity:0;pointer-events:none;
  will-change: transform, opacity;
  position:relative;overflow:hidden;
  animation:ft-pop 260ms cubic-bezier(.2,.7,.2,1.1) forwards,
            ft-hide 420ms ease 2600ms forwards;
}
.fusion-toast.success{border-color:rgba(0,255,170,.35);box-shadow:0 10px 40px rgba(0,255,170,.15), inset 0 0 140px rgba(0,255,170,.06)}
.fusion-toast.fail{border-color:rgba(255,75,95,.35);box-shadow:0 10px 40px rgba(255,75,95,.15), inset 0 0 140px rgba(255,75,95,.06)}
.fusion-toast.processing{border-color:rgba(130,180,255,.35);box-shadow:0 10px 40px rgba(130,180,255,.15), inset 0 0 140px rgba(130,180,255,.06)
animation: ft-pop 260ms cubic-bezier(.2,.7,.2,1.1) forwards; }
.fusion-toast .row{display:flex;gap:14px;align-items:center}
.fusion-toast .icon{
  font-size:28px;line-height:1;width:42px;height:42px;flex:0 0 42px;border-radius:50%;
  display:grid;place-items:center;color:#0f0;
  background:radial-gradient(120% 120% at 30% 30%, rgba(255,255,255,.18), rgba(255,255,255,.03));
}
.fusion-toast.fail .icon{color:#ff4b5f}
.fusion-toast.processing .icon{color:#00ffaa}
.fusion-toast .icon .spin{
  width:22px;height:22px;border-radius:50%;
  border:3px solid rgba(255,255,255,.25);border-top-color:#00ffaa;animation:ft-rotate 900ms linear infinite;
}
.fusion-toast .text{color:#e8f6ff}
.fusion-toast .title{font-weight:700;font-size:18px;letter-spacing:.2px;margin-bottom:4px}
.fusion-toast .desc{opacity:.85;font-size:14px}
.fusion-toast .meta{opacity:.7;font-size:12px;margin-top:6px}
.fusion-toast .progress{
  position:absolute;left:0;bottom:0;height:3px;background:linear-gradient(90deg,#00ffaa,#70f);
  width:100%;opacity:.9;animation:ft-progress 3000ms linear forwards;
}
.fusion-toast.fail .progress{background:linear-gradient(90deg,#ff4b5f,#ffb86b)}
/* confetti bits */
.fusion-toast i.confetti{
  position:absolute;width:8px;height:14px;top:12px;left:50%;
  background:#fff;opacity:.9;border-radius:2px;transform:translateX(-50%) rotate(0deg);
  animation:ft-confetti 1100ms ease-out forwards;
}
/* subtle particles */
.fusion-toast i.spark{
  position:absolute;width:6px;height:6px;border-radius:50%;background:#fff;opacity:.7;
  filter:blur(.2px);animation:ft-spark 900ms ease-out forwards;
}
/* ❗ giữ ft-pop khi fail + thêm shake */
.fusion-toast.shake{
  animation:
    ft-pop 260ms cubic-bezier(.2,.7,.2,1.1) forwards,
    ft-shake 360ms cubic-bezier(.36,.07,.19,.97) 80ms 2 both,
    ft-hide 420ms ease 2600ms forwards;
}
/* keyframes */
@keyframes ft-pop{from{opacity:0;transform:scale(.92) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes ft-hide{to{opacity:0;transform:scale(.98) translateY(-6px)}}
@keyframes ft-progress{to{width:0%}}
@keyframes ft-confetti{to{transform:translate(calc(-50% + var(--dx,0px)),70px) rotate(var(--rot,160deg));opacity:0}}
@keyframes ft-spark{to{transform:translate(var(--sx,0px), var(--sy,0px)) scale(.6);opacity:0}}
@keyframes ft-shake{
  10%,90%{transform:translateX(-1px)}
  20%,80%{transform:translateX(2px)}
  30%,50%,70%{transform:translateX(-4px)}
  40%,60%{transform:translateX(4px)}
}
@keyframes ft-rotate{to{transform:rotate(360deg)}}
`;
    let style = document.getElementById('fusionToastStyles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'fusionToastStyles';
      document.head.appendChild(style);
    }
    style.textContent = css; // luôn đảm bảo có đầy đủ core CSS
  }

  function spawnConfetti(toast, n = 24) {
    const palette = [
      '#00ffaa',
      '#09f',
      '#ffd166',
      '#ef476f',
      '#06d6a0',
      '#a78bfa',
    ];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.setProperty('--dx', Math.random() * 240 - 120 + 'px');
      c.style.setProperty('--rot', Math.random() * 240 - 120 + 'deg');
      c.style.left = 50 + (Math.random() * 40 - 20) + '%';
      c.style.background = palette[i % palette.length];
      toast.appendChild(c);
      setTimeout(() => c.remove(), 1300);
    }
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.left = 50 + (Math.random() * 40 - 20) + '%';
      s.style.top = 18 + Math.random() * 10 + 'px';
      s.style.setProperty('--sx', Math.random() * 120 - 60 + 'px');
      s.style.setProperty('--sy', Math.random() * 70 + 30 + 'px');
      toast.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  // ✅ Popup: KẾT QUẢ
  window.openFuseResultPopup = function (ok, ctx = {}) {
    injectFusionToastStyles();

    // dọn overlay cũ nếu còn
    document
      .querySelectorAll('.fusion-toast-overlay')
      .forEach((e) => e.remove());

    const overlay = document.createElement('div');
    overlay.className = 'fusion-toast-overlay';

    const toast = document.createElement('div');
    toast.className = 'fusion-toast ' + (ok ? 'success' : 'fail');

    const chancePct = Math.round((ctx.chance || 0) * 100);
    const title = ok ? 'Ghép thành công!' : 'Ghép thất bại';
    const resultText = ok
      ? ctx?.result?.name
        ? `${ctx.result.name} • Bậc ${ctx.result.tier ?? ctx.targetTier ?? ''}`
        : `${ctx.group ?? 'Trang bị'} • Bậc ${ctx.targetTier ?? ''}`
      : `Nhận lại +${ctx.failDust ?? 0} bột sắt`;
    const meta = `Tỉ lệ: ${isFinite(chancePct) ? chancePct : 0}%`;

    toast.innerHTML = `
      <div class="row">
        <div class="icon">${ok ? '✔️' : '✖️'}</div>
        <div class="text">
          <div class="title">${title}</div>
          <div class="desc">${resultText}</div>
          <div class="meta">${meta}</div>
        </div>
      </div>
      <div class="progress"></div>
    `;
    overlay.appendChild(toast);
    document.body.appendChild(overlay);

    if (ok) spawnConfetti(toast);
    else toast.classList.add('shake');

    setTimeout(() => overlay.remove(), 3000);
  };

  // ⏳ Popup: ĐANG TÁI CHẾ
  window.openFuseProcessingToast = function (durationMs, ctx = {}) {
    injectFusionToastStyles();
    document
      .querySelectorAll('.fusion-toast-overlay.processing')
      .forEach((e) => e.remove());

    const overlay = document.createElement('div');
    overlay.className = 'fusion-toast-overlay processing';
    overlay.style.zIndex = '10050';

    const toast = document.createElement('div');
    toast.className = 'fusion-toast processing';
    const desc = `Đang tái chế ${ctx.n ?? ''} món → ${
      ctx.group ?? 'Trang bị'
    } • Bậc ${ctx.targetTier ?? ''}`;

    toast.innerHTML = `
      <div class="row">
        <div class="icon"><span class="spin"></span></div>
        <div class="text">
          <div class="title">Đang tái chế…</div>
          <div class="desc">${desc}</div>
          <div class="meta">Vui lòng chờ</div>
        </div>
      </div>
      <div class="progress"></div>
    `;
    overlay.appendChild(toast);
    document.body.appendChild(overlay);

    const bar = toast.querySelector('.progress');
    if (bar) bar.style.animationDuration = FUSION_PROCESS_MS + 'ms';
    setTimeout(() => overlay.remove(), FUSION_PROCESS_MS);
  };
})();

/** ================== INIT ================== */
(function init() {
  if (typeof player.statPoints !== 'number') player.statPoints = 0;
  buildPanel();
})();
