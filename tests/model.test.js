import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addHeroToPack,
  assertUniqueHeroName,
  assertUniquePackName,
  computePoolScore,
  createInitialState,
  getRosterGroupForPack,
  normalizeGuaranteeMark,
  deleteHeroFromState,
  migrateState,
  rankPacks,
  syncGuaranteeMarksToRegularPacks,
} from '../src/model.js';

const hero = (id, name, score = null) => ({ id, name, score });
const pack = (id, name, smallHeroIds = [], bigHeroIds = [], order = 0) => ({
  id,
  name,
  category: 'regular',
  order,
  smallHeroIds,
  bigHeroIds,
});

test('大保底 3、2 分计算为 2.50', () => {
  const heroes = [hero('a', '甲', 3), hero('b', '乙', 2)];
  const result = computePoolScore(['a', 'b'], heroes);
  assert.equal(result.average, 2.5);
  assert.equal(result.displayScore, 2.5);
  assert.equal(result.ratedCount, 2);
  assert.equal(result.totalCount, 2);
});

test('小保底 2、2、2 分计算为 2.00', () => {
  const heroes = [hero('a', '甲', 2), hero('b', '乙', 2), hero('c', '丙', 2)];
  const result = computePoolScore(['a', 'b', 'c'], heroes);
  assert.equal(result.displayScore, 2);
  assert.equal(result.ratedCount, 3);
});

test('未评分武将被忽略，明确的一分仍参与计算', () => {
  const heroes = [hero('a', '甲', 3), hero('b', '乙', null), hero('c', '丙', 1)];
  const result = computePoolScore(['a', 'b', 'c'], heroes);
  assert.equal(result.average, 2);
  assert.equal(result.ratedCount, 2);
  assert.equal(result.unratedCount, 1);
  assert.equal(result.isComplete, false);
});

test('全部未评分时返回暂无评分状态', () => {
  const heroes = [hero('a', '甲'), hero('b', '乙')];
  const result = computePoolScore(['a', 'b'], heroes);
  assert.equal(result.average, null);
  assert.equal(result.displayScore, null);
  assert.equal(result.ratedCount, 0);
});

test('排行榜按两位小数排序，同分共享名次，未评分排最后', () => {
  const heroes = [
    hero('a', '甲', 3),
    hero('b', '乙', 2),
    hero('c', '丙', 2),
    hero('d', '丁', 2),
    hero('e', '戊', null),
  ];
  const packs = [
    pack('first', '甲包', ['a', 'b'], [], 0),
    pack('second', '乙包', ['c', 'd'], [], 1),
    pack('tie', '并列包', ['a', 'b'], [], 2),
    pack('empty', '未评包', ['e'], [], 3),
  ];
  const ranking = rankPacks(packs, heroes, 'small');
  assert.deepEqual(ranking.map((entry) => entry.pack.id), ['first', 'tie', 'second', 'empty']);
  assert.equal(ranking[0].rank, 1);
  assert.equal(ranking[1].rank, 1);
  assert.equal(ranking[2].rank, 3);
  assert.equal(ranking[3].rank, null);
});

test('同一武将不能同时进入同一卡包的大小保底名单', () => {
  const state = {
    ...createInitialState(1),
    heroes: [hero('h1', '曹操', 4)],
    packs: [pack('p1', '魏晋', [], [])],
  };
  const withSmall = addHeroToPack(state, 'p1', 'small', 'h1');
  assert.deepEqual(withSmall.packs[0].smallHeroIds, ['h1']);
  assert.throws(() => addHeroToPack(withSmall, 'p1', 'big', 'h1'), /不能同时加入大保底/);
});

test('同一武将不能在同一侧名单重复添加', () => {
  const state = {
    ...createInitialState(1),
    heroes: [hero('h1', '曹操', 4)],
    packs: [pack('p1', '魏晋', [], [])],
  };
  const next = addHeroToPack(state, 'p1', 'small', 'h1');
  assert.throws(() => addHeroToPack(next, 'p1', 'small', 'h1'), /已在小保底或大保底名单中/);
});

test('删除武将时从所有卡包名单级联移除', () => {
  const state = {
    ...createInitialState(1),
    heroes: [hero('h1', '曹操', 4), hero('h2', '刘备', 3)],
    packs: [pack('p1', '魏晋', ['h1', 'h2'], []), pack('p2', '蜀汉', [], ['h1'])],
  };
  const next = deleteHeroFromState(state, 'h1');
  assert.deepEqual(next.heroes.map((item) => item.id), ['h2']);
  assert.deepEqual(next.packs[0].smallHeroIds, ['h2']);
  assert.deepEqual(next.packs[1].bigHeroIds, []);
});

test('默认预置四个常规卡包、六个赛季卡包和 133 名五星武将', () => {
  const state = createInitialState(1);
  assert.equal(state.packs.filter((item) => item.category === 'regular').length, 4);
  assert.equal(state.packs.filter((item) => item.category === 'seasonal').length, 6);
  assert.ok(state.packs.every((item) => item.smallHeroIds.length === 0 && item.bigHeroIds.length === 0));
  assert.equal(state.heroes.length, 133);
  assert.ok(state.heroes.every((item) => item.score === null));
  assert.ok(state.heroes.every((item) => item.guaranteeMark === null));
  assert.equal(state.heroes.filter((item) => item.rosterGroup === 'dongwu').length, 26);
  assert.equal(state.heroes.filter((item) => item.rosterGroup === 'weijin').length, 34);
  assert.equal(state.heroes.filter((item) => item.rosterGroup === 'shuhan').length, 44);
  assert.equal(state.heroes.filter((item) => item.rosterGroup === 'qunxiong').length, 29);
  assert.ok(state.heroes.some((item) => item.name === 'xp孙权'));
  assert.ok(state.heroes.some((item) => item.name === '晋司马懿'));
  assert.ok(state.heroes.some((item) => item.name === 'xp姜维'));
});

test('旧版本数据升级时替换为修正后的名册，同时保留可匹配的分值', () => {
  const legacyState = {
    version: 1,
    updatedAt: 1,
    heroes: [{ id: 'custom', name: '孙权', score: 4 }],
    packs: [{ id: 'p1', name: '东吴', category: 'regular', order: 0, smallHeroIds: ['custom'], bigHeroIds: [] }],
  };
  const migrated = migrateState(legacyState);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.heroes.length, 133);
  assert.equal(migrated.heroes.find((item) => item.name === '孙权').score, 4);
  assert.equal(migrated.packs[0].smallHeroIds.length, 1);
  assert.equal(migrated.heroes.some((item) => item.id === migrated.packs[0].smallHeroIds[0]), true);
});

test('武将名和分类内卡包名按忽略大小写去重', () => {
  const heroes = [{ id: 'h1', name: 'SP赵云', score: null }];
  const packs = [{ id: 'p1', name: '东吴', category: 'regular' }];
  assert.throws(() => assertUniqueHeroName(heroes, 'sp赵云'), /同名武将/);
  assert.throws(() => assertUniquePackName(packs, '东吴', 'regular'), /同名卡包/);
});



test('常规卡包能映射到对应武将阵营，赛季卡包不限制阵营', () => {
  const state = createInitialState(1);
  assert.equal(getRosterGroupForPack(state.packs.find((pack) => pack.id === 'regular-wu')), 'dongwu');
  assert.equal(getRosterGroupForPack(state.packs.find((pack) => pack.id === 'regular-wei-jin')), 'weijin');
  assert.equal(getRosterGroupForPack(state.packs.find((pack) => pack.id === 'regular-shu-han')), 'shuhan');
  assert.equal(getRosterGroupForPack(state.packs.find((pack) => pack.id === 'seasonal-conquest-1')), null);
  assert.equal(normalizeGuaranteeMark('small'), 'small');
  assert.equal(normalizeGuaranteeMark('bad'), null);
});

test('一键导入会将武将标记同步到对应常规卡包', () => {
  const state = createInitialState(1);
  const dongwuSmall = state.heroes.find((hero) => hero.rosterGroup === 'dongwu' && hero.name === '孙权');
  const dongwuBig = state.heroes.find((hero) => hero.rosterGroup === 'dongwu' && hero.name === 'xp孙权');
  const weijinBig = state.heroes.find((hero) => hero.rosterGroup === 'weijin' && hero.name === '魏曹操');
  dongwuSmall.guaranteeMark = 'small';
  dongwuBig.guaranteeMark = 'big';
  weijinBig.guaranteeMark = 'big';

  const next = syncGuaranteeMarksToRegularPacks(state);
  const wuPack = next.packs.find((pack) => pack.id === 'regular-wu');
  const weijinPack = next.packs.find((pack) => pack.id === 'regular-wei-jin');
  assert.deepEqual(wuPack.smallHeroIds, [dongwuSmall.id]);
  assert.deepEqual(wuPack.bigHeroIds, [dongwuBig.id]);
  assert.deepEqual(weijinPack.bigHeroIds, [weijinBig.id]);
  assert.equal(new Set([...wuPack.smallHeroIds, ...wuPack.bigHeroIds]).size, 2);
});


