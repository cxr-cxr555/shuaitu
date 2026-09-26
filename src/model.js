import { DEFAULT_HEROES } from './roster.js';

export const APP_VERSION = 3;

export const CATEGORY_META = Object.freeze({
  regular: {
    id: 'regular',
    label: '常规卡包',
    shortLabel: '常规',
    description: '东吴、魏晋、蜀汉、群雄',
    icon: '常',
  },
  seasonal: {
    id: 'seasonal',
    label: '赛季卡包',
    shortLabel: '赛季',
    description: '征服 1–4、割据 1–2',
    icon: '季',
  },
});

export const SCORE_OPTIONS = Object.freeze([
  { value: 1, label: '无用', shortLabel: '无用', description: '当前阵容中没有使用价值' },
  { value: 2, label: '能加红', shortLabel: '加红', description: '能加红，或只有边际价值' },
  { value: 3, label: '有用', shortLabel: '有用', description: '对阵容有明确帮助' },
  { value: 4, label: '刚需', shortLabel: '刚需', description: '当前阵容急需或核心武将' },
]);

export const DEFAULT_PACKS = Object.freeze([
  { id: 'regular-wu', name: '东吴', category: 'regular', order: 0 },
  { id: 'regular-wei-jin', name: '魏晋', category: 'regular', order: 1 },
  { id: 'regular-shu-han', name: '蜀汉', category: 'regular', order: 2 },
  { id: 'regular-qun-xiong', name: '群雄', category: 'regular', order: 3 },
  { id: 'seasonal-conquest-1', name: '征服 1', category: 'seasonal', order: 0 },
  { id: 'seasonal-conquest-2', name: '征服 2', category: 'seasonal', order: 1 },
  { id: 'seasonal-conquest-3', name: '征服 3', category: 'seasonal', order: 2 },
  { id: 'seasonal-conquest-4', name: '征服 4', category: 'seasonal', order: 3 },
  { id: 'seasonal-separatist-1', name: '割据 1', category: 'seasonal', order: 4 },
  { id: 'seasonal-separatist-2', name: '割据 2', category: 'seasonal', order: 5 },
]);

export function createInitialState(now = Date.now()) {
  return {
    version: APP_VERSION,
    updatedAt: now,
    heroes: DEFAULT_HEROES.map((hero) => ({ ...hero })),
    packs: DEFAULT_PACKS.map((pack) => ({
      ...pack,
      smallHeroIds: [],
      bigHeroIds: [],
    })),
  };
}

export function migrateState(state) {
  const nextState = cloneState(state);
  const previousVersion = Number(nextState.version ?? 0);

  if (previousVersion < 3) {
    const oldHeroes = nextState.heroes;
    const nextHeroes = DEFAULT_HEROES.map((hero) => ({ ...hero }));
    const idMap = new Map();

    for (const nextHero of nextHeroes) {
      const exactMatch = oldHeroes.find((hero) => hero.name === nextHero.name);
      const prefixedMatches = oldHeroes.filter((hero) => (
        nextHero.name.endsWith(hero.name)
        && (!hero.faction || hero.faction.split(' / ').includes(nextHero.faction))
      ));
      const oldHero = exactMatch ?? (prefixedMatches.length === 1 ? prefixedMatches[0] : null);
      if (!oldHero) continue;
      nextHero.score = oldHero.score ?? null;
      idMap.set(oldHero.id, nextHero.id);
    }

    const isLegacyRosterHero = (hero) => DEFAULT_HEROES.some((defaultHero) => (
      defaultHero.name === hero.name || defaultHero.name.endsWith(hero.name)
    ));
    const customHeroes = oldHeroes
      .filter((hero) => !isLegacyRosterHero(hero))
      .map((hero) => ({ ...hero }));

    nextState.heroes = [...nextHeroes, ...customHeroes];
    nextState.packs = nextState.packs.map((pack) => ({
      ...pack,
      smallHeroIds: pack.smallHeroIds.map((id) => idMap.get(id) ?? id),
      bigHeroIds: pack.bigHeroIds.map((id) => idMap.get(id) ?? id),
    }));
  }

  nextState.version = APP_VERSION;
  return nextState;
}

export function createId(prefix = 'item') {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

export function normalizeScore(value) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 4 ? score : null;
}

export function getScoreOption(value) {
  return SCORE_OPTIONS.find((option) => option.value === normalizeScore(value)) ?? null;
}

export function createHeroMap(heroes = []) {
  return new Map(heroes.map((hero) => [hero.id, hero]));
}

export function computePoolScore(heroIds = [], heroesOrMap = []) {
  const heroMap = heroesOrMap instanceof Map ? heroesOrMap : createHeroMap(heroesOrMap);
  const ratedScores = [];

  for (const heroId of heroIds) {
    const score = normalizeScore(heroMap.get(heroId)?.score);
    if (score !== null) ratedScores.push(score);
  }

  const totalCount = heroIds.length;
  const ratedCount = ratedScores.length;
  const average = ratedCount > 0
    ? ratedScores.reduce((sum, score) => sum + score, 0) / ratedCount
    : null;
  const displayScore = average === null ? null : Number(average.toFixed(2));

  return {
    average,
    displayScore,
    ratedCount,
    totalCount,
    unratedCount: totalCount - ratedCount,
    isComplete: totalCount > 0 && ratedCount === totalCount,
    hasList: totalCount > 0,
  };
}

export function computePackScores(pack, heroesOrMap = []) {
  const heroMap = heroesOrMap instanceof Map ? heroesOrMap : createHeroMap(heroesOrMap);
  return {
    small: computePoolScore(pack.smallHeroIds, heroMap),
    big: computePoolScore(pack.bigHeroIds, heroMap),
  };
}

export function rankPacks(packs, heroesOrMap, side) {
  if (side !== 'small' && side !== 'big') {
    throw new Error(`未知保底类型：${side}`);
  }

  const heroMap = heroesOrMap instanceof Map ? heroesOrMap : createHeroMap(heroesOrMap);
  const scored = [];
  const unranked = [];

  for (const pack of packs) {
    const result = side === 'small'
      ? computePoolScore(pack.smallHeroIds, heroMap)
      : computePoolScore(pack.bigHeroIds, heroMap);

    if (result.displayScore === null) {
      unranked.push({ pack, result, rank: null });
    } else {
      scored.push({ pack, result, displayScore: result.displayScore });
    }
  }

  scored.sort((left, right) => {
    const scoreDifference = right.displayScore - left.displayScore;
    if (scoreDifference !== 0) return scoreDifference;
    const orderDifference = (left.pack.order ?? 0) - (right.pack.order ?? 0);
    if (orderDifference !== 0) return orderDifference;
    return left.pack.name.localeCompare(right.pack.name, 'zh-CN');
  });

  let previousScore = null;
  let previousRank = 0;
  return [
    ...scored.map((entry, index) => {
      const rank = entry.displayScore === previousScore ? previousRank : index + 1;
      previousScore = entry.displayScore;
      previousRank = rank;
      return { ...entry, rank };
    }),
    ...unranked,
  ];
}

export function normalizeName(value, maxLength = 30) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('名称不能为空');
  if (name.length > maxLength) throw new Error(`名称不能超过 ${maxLength} 个字`);
  return name;
}

export function assertUniqueHeroName(heroes, name, ignoredHeroId = null) {
  const normalized = normalizeName(name, 24);
  const duplicate = heroes.some((hero) => (
    hero.id !== ignoredHeroId
    && hero.name.trim().toLocaleLowerCase('zh-CN') === normalized.toLocaleLowerCase('zh-CN')
  ));
  if (duplicate) throw new Error('已存在同名武将');
  return normalized;
}

export function assertUniquePackName(packs, name, category, ignoredPackId = null) {
  const normalized = normalizeName(name, 24);
  const duplicate = packs.some((pack) => (
    pack.id !== ignoredPackId
    && pack.category === category
    && pack.name.trim().toLocaleLowerCase('zh-CN') === normalized.toLocaleLowerCase('zh-CN')
  ));
  if (duplicate) throw new Error('该分类中已存在同名卡包');
  return normalized;
}

export function cloneState(state) {
  return {
    ...state,
    heroes: state.heroes.map((hero) => ({ ...hero })),
    packs: state.packs.map((pack) => ({
      ...pack,
      smallHeroIds: [...pack.smallHeroIds],
      bigHeroIds: [...pack.bigHeroIds],
    })),
  };
}

export function addHeroToPack(state, packId, side, heroId) {
  if (side !== 'small' && side !== 'big') {
    throw new Error(`未知保底类型：${side}`);
  }

  const heroExists = state.heroes.some((hero) => hero.id === heroId);
  if (!heroExists) throw new Error('武将不存在');

  const nextState = cloneState(state);
  const pack = nextState.packs.find((item) => item.id === packId);
  if (!pack) throw new Error('卡包不存在');

  const sideKey = side === 'small' ? 'smallHeroIds' : 'bigHeroIds';
  const oppositeKey = side === 'small' ? 'bigHeroIds' : 'smallHeroIds';
  const sideLabel = side === 'small' ? '小保底' : '大保底';
  const oppositeLabel = side === 'small' ? '大保底' : '小保底';

  if (pack[sideKey].includes(heroId)) {
    throw new Error(`该武将已在小保底或大保底名单中`);
  }
  if (pack[oppositeKey].includes(heroId)) {
    throw new Error(`该武将已属于${oppositeLabel}名单，不能同时加入${sideLabel}`);
  }

  pack[sideKey].push(heroId);
  nextState.updatedAt = Date.now();
  return nextState;
}

export function removeHeroFromPack(state, packId, side, heroId) {
  const nextState = cloneState(state);
  const pack = nextState.packs.find((item) => item.id === packId);
  if (!pack) throw new Error('卡包不存在');
  const sideKey = side === 'small' ? 'smallHeroIds' : 'bigHeroIds';
  pack[sideKey] = pack[sideKey].filter((id) => id !== heroId);
  nextState.updatedAt = Date.now();
  return nextState;
}

export function deleteHeroFromState(state, heroId) {
  const nextState = cloneState(state);
  nextState.heroes = nextState.heroes.filter((hero) => hero.id !== heroId);
  nextState.packs = nextState.packs.map((pack) => ({
    ...pack,
    smallHeroIds: pack.smallHeroIds.filter((id) => id !== heroId),
    bigHeroIds: pack.bigHeroIds.filter((id) => id !== heroId),
  }));
  nextState.updatedAt = Date.now();
  return nextState;
}



