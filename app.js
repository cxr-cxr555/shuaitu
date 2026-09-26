import {
  CATEGORY_META,
  migrateState,
  SCORE_OPTIONS,
  addHeroToPack,
  assertUniqueHeroName,
  assertUniquePackName,
  cloneState,
  computePoolScore,
  createHeroMap,
  createId,
  createInitialState,
  deleteHeroFromState,
  normalizeGuaranteeMark,
  normalizeScore,
  rankPacks,
  removeHeroFromPack,
  syncGuaranteeMarksToRegularPacks,
} from './src/model.js';
import { ROSTER_GROUPS } from './src/roster.js';
import {
  deletePortrait,
  loadPortraits,
  loadState,
  savePortrait,
  saveState,
} from './src/db.js';
import { compressPortrait } from './src/image.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#app-dialog');
const toastRegion = document.querySelector('#toast-region');
const heroMap = () => createHeroMap(state.heroes);
let state = null;
let portraitUrls = new Map();
let heroGroupFilter = 'all';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatScore(score) {
  return score === null || score === undefined ? '--' : Number(score).toFixed(2);
}

function scoreLabel(score) {
  const option = SCORE_OPTIONS.find((item) => item.value === score);
  return option ? `${option.value} · ${option.label}` : '未评分';
}

function releasePortraitUrls() {
  for (const url of portraitUrls.values()) URL.revokeObjectURL(url);
  portraitUrls = new Map();
}

function hydratePortraitUrls(portraitMap) {
  releasePortraitUrls();
  for (const [heroId, blob] of portraitMap.entries()) {
    portraitUrls.set(heroId, URL.createObjectURL(blob));
  }
}

function getRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean);
  return { raw, parts };
}

function setActiveNav(page) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === page);
  });
}

function navigate(path) {
  window.location.hash = path;
}

function showToast(message, type = 'info') {
  const element = document.createElement('div');
  element.className = `toast ${type === 'error' ? 'error' : ''}`;
  element.textContent = message;
  toastRegion.append(element);
  window.setTimeout(() => element.remove(), 3600);
}

async function commit(nextState, { render = true } = {}) {
  state = nextState;
  state.updatedAt = Date.now();
  if (render) renderRoute();
  try {
    await saveState(state);
  } catch (error) {
    showToast(`保存失败：${error.message}`, 'error');
    throw error;
  }
}

function renderRoute() {
  if (!state) return;
  const route = getRoute();
  const [section, parameter] = route.parts;

  if (route.raw === '/') {
    setActiveNav('home');
    renderHomePage();
  } else if (section === 'category' && CATEGORY_META[parameter]) {
    setActiveNav('home');
    renderCategoryPage(parameter);
  } else if (section === 'heroes') {
    setActiveNav('heroes');
    renderHeroesPage();
  } else if (section === 'packs') {
    setActiveNav('packs');
    renderPacksPage();
  } else {
    navigate('/');
  }
}

async function initialize() {
  try {
    const storedState = await loadState();
    state = storedState ?? createInitialState();
    state.heroes ??= [];
    state.packs ??= [];
    const previousVersion = Number(state.version ?? 0);
    state = migrateState(state);
    if (!storedState || previousVersion !== state.version) await saveState(state);
    const portraits = await loadPortraits();
    hydratePortraitUrls(portraits);
    window.addEventListener('hashchange', renderRoute);
    window.addEventListener('beforeunload', releasePortraitUrls);
    renderRoute();
  } catch (error) {
    app.innerHTML = `
      <section class="empty-state">
        <div>
          <strong>无法读取本地数据</strong>
          <p>请使用现代 Chromium、Firefox 或 Safari 浏览器，并确认没有禁用 IndexedDB。</p>
          <p>${escapeHtml(error.message)}</p>
        </div>
      </section>`;
  }
}
function portraitMarkup(hero, extraClass = '') {
  const url = portraitUrls.get(hero.id);
  if (url) {
    return `<img class="hero-portrait ${extraClass}" src="${url}" alt="${escapeHtml(hero.name)}立绘" loading="lazy" />`;
  }
  const initial = hero.name.trim().slice(0, 1) || '将';
  return `<span class="portrait-placeholder ${extraClass}" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function renderScoreGuide() {
  return `
    <div class="score-guide" aria-label="武将评分说明">
      ${SCORE_OPTIONS.map((option) => `
        <div class="guide-item" style="--guide-color: ${['#8f9a95', '#5fa68b', '#c9ad69', '#c25f4f'][option.value - 1]}">
          <strong>${option.value} 分 · ${option.label}</strong>
          <span>${option.description}</span>
        </div>`).join('')}
    </div>`;
}

function renderHomePage() {
  const regularCount = state.packs.filter((pack) => pack.category === 'regular').length;
  const seasonalCount = state.packs.filter((pack) => pack.category === 'seasonal').length;
  app.innerHTML = `
    <section class="page home-page">
      <div class="home-panel">
        <div class="home-intro">
          <p class="eyebrow">CARD PACK VALUE GUIDE</p>
          <h1>先定武将价值，<br /><span>再选值得抽的卡包。</span></h1>
          <p>给每个武将设置 1–4 分。工具会分别计算所有卡包的小保底与大保底平均分，并按收益高低排序。</p>
        </div>
        <div class="home-grid">
          ${renderCategoryEntry('regular', regularCount)}
          ${renderCategoryEntry('seasonal', seasonalCount)}
        </div>
      </div>
      ${renderScoreGuide()}
      <div class="notice-strip">
        <strong>计算口径</strong>
        <span>平均分仅统计已评分武将；名单存在未评分武将时会显示覆盖人数。当前版本按等概率算术平均，不处理掉率权重与抽卡成本。</span>
      </div>
    </section>`;
}

function renderCategoryEntry(categoryId, count) {
  const category = CATEGORY_META[categoryId];
  return `
    <a class="mode-card" href="#/category/${category.id}">
      <span class="mode-icon">${category.icon}</span>
      <span class="mode-content">
        <h2>${category.label}</h2>
        <p>${category.description}</p>
      </span>
      <span class="mode-meta"><strong>${count}</strong><span>个卡包</span></span>
      <span class="mode-arrow" aria-hidden="true">→</span>
    </a>`;
}

function renderCategoryPage(categoryId) {
  const category = CATEGORY_META[categoryId];
  const packs = state.packs
    .filter((pack) => pack.category === categoryId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  app.innerHTML = `
    <section class="page category-page">
      <div class="page-head">
        <div>
          <p class="eyebrow">${category.id === 'regular' ? 'REGULAR PACKS' : 'SEASONAL PACKS'}</p>
          <h1 class="page-title">${category.label}</h1>
          <p class="page-subtitle">同一页面对比小保底与大保底收益。点击卡包可查看名单、武将分值和已评分覆盖人数。</p>
        </div>
        <div class="page-actions">
          <a class="button ghost" href="#/">返回首页</a>
          <a class="button" href="#/heroes">调整武将分值</a>
        </div>
      </div>
      <div class="ranking-layout">
        ${renderRankingPanel('small', packs)}
        ${renderRankingPanel('big', packs)}
      </div>
    </section>`;
}

function renderRankingPanel(side, packs) {
  const sideLabel = side === 'small' ? '小保底榜' : '大保底榜';
  const entries = rankPacks(packs, state.heroes, side);
  return `
    <section class="ranking-panel ${side}">
      <div class="ranking-head">
        <div><h2>${sideLabel}</h2><p>分值越高越值得优先考虑</p></div>
        <span class="ranking-count">${packs.length}</span>
      </div>
      <div class="rank-list">
        ${entries.length ? entries.map((entry) => renderPackRankCard(entry, side)).join('') : renderEmptyState('暂无卡包', '可在卡包管理中新增。')}
      </div>
    </section>`;
}
function renderPackRankCard(entry, side) {
  const { pack, result, rank } = entry;
  const hasScore = result.displayScore !== null;
  const rankClass = rank === 1 ? 'rank-one' : '';
  const unavailableClass = hasScore ? '' : 'rank-unavailable';
  const coverageClass = result.unratedCount > 0 ? 'warning' : '';
  const coverageText = result.totalCount === 0
    ? '尚未配置名单'
    : `已评分 ${result.ratedCount}/${result.totalCount}`;
  const rankText = rank ? (rank === 1 ? '榜首' : `第 ${rank} 名`) : '未入榜';

  return `
    <details class="pack-card ${rankClass} ${unavailableClass}" data-pack-id="${escapeHtml(pack.id)}">
      <summary class="pack-summary">
        <span class="rank-badge">${rank ? (rank === 1 ? '冠' : rank) : '—'}</span>
        <span class="pack-main">
          <span class="pack-name">${escapeHtml(pack.name)}</span>
          <span class="pack-status">${rankText} · ${side === 'small' ? '小保底' : '大保底'}</span>
        </span>
        <span class="pack-score-block">
          <span class="score-value ${hasScore ? '' : 'empty'}">${hasScore ? formatScore(result.displayScore) : '暂无评分'}</span>
          <span class="coverage-badge ${coverageClass}">${coverageText}</span>
        </span>
        <span class="pack-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="pack-detail">
        <div class="detail-pools">
          ${renderPoolDetail(pack, 'small')}
          ${renderPoolDetail(pack, 'big')}
        </div>
      </div>
    </details>`;
}

function renderPoolDetail(pack, side) {
  const heroIds = side === 'small' ? pack.smallHeroIds : pack.bigHeroIds;
  const heroes = heroIds.map((id) => heroMap().get(id)).filter(Boolean);
  const result = computePoolScore(heroIds, heroMap());
  const title = side === 'small' ? '小保底武将' : '大保底武将';
  return `
    <section class="pool-panel">
      <div class="pool-heading">
        <h3>${title}</h3>
        <span>${result.ratedCount}/${result.totalCount} 已评分</span>
      </div>
      <div class="hero-grid">
        ${heroes.length ? heroes.map((hero) => renderHeroCard(hero)).join('') : '<div class="assignment-empty">尚未配置武将</div>'}
      </div>
    </section>`;
}

function renderHeroCard(hero) {
  const score = normalizeScore(hero.score);
  return `
    <article class="hero-card">
      ${portraitMarkup(hero)}
      <div class="hero-info">
        <div class="hero-name">${escapeHtml(hero.name)}</div>
        <span class="hero-score ${score ? `score-${score}` : 'unrated'}">${scoreLabel(score)}</span>
      </div>
    </article>`;
}

function renderEmptyState(title, description) {
  return `<div class="empty-state"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div></div>`;
}
function rosterGroupLabel(groupId) {
  return ROSTER_GROUPS.find((group) => group.id === groupId)?.label ?? '其他';
}

function heroesInCurrentGroup() {
  const heroes = heroGroupFilter === 'all'
    ? state.heroes
    : state.heroes.filter((hero) => (hero.rosterGroup ?? 'other') === heroGroupFilter);
  return [...heroes].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function renderRosterFilters() {
  return `
    <div class="roster-filters" aria-label="按阵营筛选武将">
      ${ROSTER_GROUPS.filter((group) => group.id !== 'other' || state.heroes.some((hero) => (hero.rosterGroup ?? 'other') === 'other')).map((group) => {
        const count = group.id === 'all'
          ? state.heroes.length
          : state.heroes.filter((hero) => (hero.rosterGroup ?? 'other') === group.id).length;
        return `
          <button class="roster-filter ${heroGroupFilter === group.id ? 'active' : ''}" type="button"
            data-action="filter-heroes" data-group="${group.id}">
            ${group.label}<span>${count}</span>
          </button>`;
      }).join('')}
    </div>`;
}

function renderHeroesPage() {
  const heroes = heroesInCurrentGroup();
  const markedCount = state.heroes.filter((hero) => normalizeGuaranteeMark(hero.guaranteeMark)).length;
  app.innerHTML = `
    <section class="page heroes-page">
      <div class="page-head">
        <div>
          <p class="eyebrow">WARRIOR SCORES</p>
          <h1 class="page-title">武将管理</h1>
          <p class="page-subtitle">用“− / ＋”调整分值；点击保底按钮在“未标 → 小保底 → 大保底”之间循环。一键导入会同步到四个常规卡包。</p>
        </div>
        <div class="page-actions">
          <button class="button primary" type="button" data-action="import-guarantee-marks">一键导入常规卡包${markedCount ? `（${markedCount}）` : ''}</button>
          <button class="button ghost" type="button" data-action="add-hero">＋ 新增武将</button>
        </div>
      </div>
      ${renderRosterFilters()}
      <div class="toolbar">
        <label class="search-field">
          <input type="search" placeholder="搜索武将名称或阵营…" data-role="hero-search" aria-label="搜索武将" />
        </label>
        <a class="button ghost" href="#/packs">前往卡包管理</a>
      </div>
      <div class="manager-list hero-manager-grid" data-role="hero-list">
        ${heroes.length ? heroes.map((hero) => renderHeroManagerRow(hero)).join('') : renderEmptyState('该阵营暂无武将', '可以新增武将，或切换到其他阵营。')}
      </div>
    </section>`;
}

function renderHeroManagerRow(hero) {
  const score = normalizeScore(hero.score);
  const groupLabel = rosterGroupLabel(hero.rosterGroup);
  const scoreText = score ? scoreLabel(score).split(' · ')[1] : '不参与平均';
  const guaranteeMark = normalizeGuaranteeMark(hero.guaranteeMark);
  return `
    <article class="hero-manager-card" data-hero-search="${escapeHtml(`${hero.name} ${hero.faction ?? ''} ${groupLabel}`.toLocaleLowerCase('zh-CN'))}">
      <div class="hero-manager-top">
        ${portraitMarkup(hero)}
        <div class="hero-manager-copy">
          <h2>${escapeHtml(hero.name)}</h2>
          <div class="hero-tags">
            <span class="group-chip">${escapeHtml(groupLabel)}</span>
          </div>
        </div>
      </div>
      <div class="score-stepper" aria-label="${escapeHtml(hero.name)}评分">
        <button type="button" data-action="adjust-score" data-hero-id="${escapeHtml(hero.id)}" data-delta="-1" ${score === null ? 'disabled' : ''} title="降低分值">−</button>
        <div class="score-stepper-value ${score ? `score-${score}` : 'unrated'}">
          <strong>${score ?? '未评'}</strong>
          <span>${scoreText}</span>
        </div>
        <button type="button" data-action="adjust-score" data-hero-id="${escapeHtml(hero.id)}" data-delta="1" ${score === 4 ? 'disabled' : ''} title="提高分值">＋</button>
      </div>
      <button class="guarantee-mark ${guaranteeMark ?? 'unmarked'}" type="button"
        data-action="cycle-guarantee-mark" data-hero-id="${escapeHtml(hero.id)}"
        title="点击切换：未标 → 小保底 → 大保底">
        <span>保底</span>
        <strong>${guaranteeMark === 'small' ? '小' : guaranteeMark === 'big' ? '大' : '未标'}</strong>
      </button>
      <div class="hero-manager-actions">
        <button type="button" data-action="upload-portrait" data-hero-id="${escapeHtml(hero.id)}" title="${portraitUrls.has(hero.id) ? '更换本地立绘' : '导入本地立绘'}">${portraitUrls.has(hero.id) ? '换图' : '立绘'}</button>
        ${portraitUrls.has(hero.id) ? `<button type="button" data-action="remove-portrait" data-hero-id="${escapeHtml(hero.id)}" title="移除本地立绘">撤图</button>` : ''}
        <button type="button" data-action="rename-hero" data-hero-id="${escapeHtml(hero.id)}" title="编辑名称、阵营和分类">编辑</button>
        <button type="button" class="danger" data-action="delete-hero" data-hero-id="${escapeHtml(hero.id)}" title="删除武将">删除</button>
      </div>
    </article>`;
}

function filterHeroes(query) {
  const keyword = query.trim().toLocaleLowerCase('zh-CN');
  document.querySelectorAll('[data-hero-search]').forEach((row) => {
    row.hidden = keyword.length > 0 && !row.dataset.heroSearch.includes(keyword);
  });
}
function renderPacksPage() {
  const categories = Object.values(CATEGORY_META);
  app.innerHTML = `
    <section class="page packs-page">
      <div class="page-head">
        <div>
          <p class="eyebrow">PACK CONFIGURATION</p>
          <h1 class="page-title">卡包管理</h1>
          <p class="page-subtitle">配置每个卡包的大小保底武将。同一武将在同一卡包内只能进入一个名单，可同时出现在多个不同卡包中。</p>
        </div>
        <div class="page-actions">
          <button class="button primary" type="button" data-action="add-pack">＋ 新增卡包</button>
        </div>
      </div>
      ${categories.map((category) => renderPackCategoryGroup(category)).join('')}
    </section>`;
}

function renderPackCategoryGroup(category) {
  const packs = state.packs
    .filter((pack) => pack.category === category.id)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  return `
    <section>
      <div class="group-title">
        <div><h2>${category.label}</h2><span>${packs.length} 个卡包</span></div>
        <button class="button ghost" type="button" data-action="add-pack" data-category="${category.id}">＋ 新增</button>
      </div>
      <div class="manager-list">
        ${packs.length ? packs.map((pack) => renderPackManagerCard(pack)).join('') : renderEmptyState('该分类暂无卡包', '点击新增创建一个卡包。')}
      </div>
    </section>`;
}

function renderPackManagerCard(pack) {
  return `
    <details class="pack-manager-card">
      <summary class="pack-manager-summary">
        <div class="pack-manager-title">
          <h3>${escapeHtml(pack.name)}</h3>
          <p>小保底 ${pack.smallHeroIds.length} 人 · 大保底 ${pack.bigHeroIds.length} 人</p>
        </div>
        <div class="pack-manager-actions">
          <button class="button ghost" type="button" data-action="rename-pack" data-pack-id="${escapeHtml(pack.id)}">重命名</button>
          <button class="button danger" type="button" data-action="delete-pack" data-pack-id="${escapeHtml(pack.id)}">删除</button>
        </div>
      </summary>
      <div class="assignment-grid">
        ${renderAssignmentPanel(pack, 'small')}
        ${renderAssignmentPanel(pack, 'big')}
      </div>
    </details>`;
}

function renderAssignmentPanel(pack, side) {
  const ids = side === 'small' ? pack.smallHeroIds : pack.bigHeroIds;
  const heroes = ids.map((id) => state.heroes.find((hero) => hero.id === id)).filter(Boolean);
  const sideLabel = side === 'small' ? '小保底' : '大保底';
  return `
    <section class="assignment-panel">
      <div class="assignment-head">
        <h4>${sideLabel}名单</h4>
        <button class="button ghost" type="button" data-action="add-to-pool" data-pack-id="${escapeHtml(pack.id)}" data-side="${side}">＋ 添加武将</button>
      </div>
      <div class="assigned-list">
        ${heroes.length ? heroes.map((hero) => `
          <span class="assigned-hero">
            <span>${escapeHtml(hero.name)} · ${scoreLabel(normalizeScore(hero.score))}</span>
            <button class="remove-button" type="button" data-action="remove-from-pool"
              data-pack-id="${escapeHtml(pack.id)}" data-side="${side}" data-hero-id="${escapeHtml(hero.id)}"
              title="移出${sideLabel}名单">×</button>
          </span>`).join('') : '<span class="assignment-empty">尚未添加武将</span>'}
      </div>
    </section>`;
}
function openDialog({ title, description = '', body, submitText = '保存', onSubmit }) {
  dialog.innerHTML = `
    <form class="dialog-form">
      <div class="dialog-head">
        <h2 id="dialog-title">${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
      ${body}
      <div class="dialog-actions">
        <button class="button ghost" type="button" data-dialog-cancel>取消</button>
        <button class="button primary" type="submit">${escapeHtml(submitText)}</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form');
  const submitButton = form.querySelector('[type="submit"]');
  const cancelButton = form.querySelector('[data-dialog-cancel]');
  cancelButton.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = '处理中…';
    try {
      await onSubmit(new FormData(form), form);
      dialog.close();
    } catch (error) {
      showToast(error.message, 'error');
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  dialog.showModal();
  window.setTimeout(() => dialog.querySelector('input, select, textarea')?.focus(), 20);
}

async function setHeroScore(heroId, rawScore) {
  const score = normalizeScore(rawScore);
  const nextState = cloneState(state);
  const hero = nextState.heroes.find((item) => item.id === heroId);
  if (!hero) return;
  hero.score = score;
  await commit(nextState);
}

async function cycleGuaranteeMark(heroId) {
  const nextState = cloneState(state);
  const hero = nextState.heroes.find((item) => item.id === heroId);
  if (!hero) return;
  const current = normalizeGuaranteeMark(hero.guaranteeMark);
  hero.guaranteeMark = current === null ? 'small' : current === 'small' ? 'big' : null;
  await commit(nextState);
}

async function importGuaranteeMarksToPacks() {
  const markedHeroes = state.heroes.filter((hero) => normalizeGuaranteeMark(hero.guaranteeMark));
  if (markedHeroes.length === 0) {
    showToast('还没有标记任何小保底或大保底武将', 'error');
    return;
  }

  const smallCount = markedHeroes.filter((hero) => hero.guaranteeMark === 'small').length;
  const bigCount = markedHeroes.filter((hero) => hero.guaranteeMark === 'big').length;
  const confirmed = window.confirm(
    `将按当前标记覆盖东吴、魏晋、蜀汉、群雄四个常规卡包名单。\n小保底 ${smallCount} 人，大保底 ${bigCount} 人。是否继续？`
  );
  if (!confirmed) return;

  await commit(syncGuaranteeMarksToRegularPacks(state));
  showToast(`已导入：小保底 ${smallCount} 人，大保底 ${bigCount} 人`);
}
async function adjustHeroScore(heroId, deltaValue) {
  const delta = Number(deltaValue);
  const nextState = cloneState(state);
  const hero = nextState.heroes.find((item) => item.id === heroId);
  if (!hero || !Number.isFinite(delta)) return;
  const current = normalizeScore(hero.score);
  const target = current === null ? Math.max(0, delta) : current + delta;
  hero.score = target < 1 ? null : Math.min(4, target);
  await commit(nextState);
}
function openAddHeroDialog() {
  openDialog({
    title: '新增武将',
    description: '新武将默认未评分，也可以现在设置分值。',
    submitText: '新增',
    body: `
      <div class="form-field">
        <label for="hero-name">武将名称</label>
        <input class="form-input" id="hero-name" name="name" maxlength="24" autocomplete="off" required placeholder="例如：曹操" />
      </div>
      <div class="form-field">
        <label for="hero-group">阵营分类</label>
        <select class="form-select" id="hero-group" name="rosterGroup">
          ${ROSTER_GROUPS.filter((group) => group.id !== 'all').map((group) => `<option value="${group.id}" ${(heroGroupFilter !== 'all' ? heroGroupFilter : 'dongwu') === group.id ? 'selected' : ''}>${group.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label for="hero-faction">卡面阵营</label>
        <input class="form-input" id="hero-faction" name="faction" maxlength="16" autocomplete="off" placeholder="例如：魏、蜀、吴、群、晋、汉" />
      </div>
      <div class="form-field">
        <label for="hero-score">初始分值</label>
        <select class="form-select" id="hero-score" name="score">
          <option value="">未评分</option>
          ${SCORE_OPTIONS.map((option) => `<option value="${option.value}">${option.value} 分 · ${option.label}</option>`).join('')}
        </select>
      </div>`,
    onSubmit: async (formData) => {
      const name = assertUniqueHeroName(state.heroes, formData.get('name'));
      const nextState = cloneState(state);
      nextState.heroes.push({
        id: createId('hero'),
        name,
        rosterGroup: String(formData.get('rosterGroup') ?? 'other'),
        faction: String(formData.get('faction') ?? '').trim() || null,
        score: normalizeScore(formData.get('score')),
        guaranteeMark: null,
      });
      await commit(nextState);
      showToast(`已新增武将：${name}`);
    },
  });
}

function openRenameHeroDialog(heroId) {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero) return;
  openDialog({
    title: '编辑武将',
    submitText: '保存',
    body: `
      <div class="form-field">
        <label for="hero-name">武将名称</label>
        <input class="form-input" id="hero-name" name="name" maxlength="24" autocomplete="off" required value="${escapeHtml(hero.name)}" />
      </div>
      <div class="form-field">
        <label for="hero-group">阵营分类</label>
        <select class="form-select" id="hero-group" name="rosterGroup">
          ${ROSTER_GROUPS.filter((group) => group.id !== 'all').map((group) => `<option value="${group.id}" ${(hero.rosterGroup ?? 'other') === group.id ? 'selected' : ''}>${group.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label for="hero-faction">卡面阵营</label>
        <input class="form-input" id="hero-faction" name="faction" maxlength="16" autocomplete="off" value="${escapeHtml(hero.faction ?? '')}" placeholder="例如：魏、蜀、吴、群、晋、汉" />
      </div>`,
    onSubmit: async (formData) => {
      const name = assertUniqueHeroName(state.heroes, formData.get('name'), heroId);
      const nextState = cloneState(state);
      const nextHero = nextState.heroes.find((item) => item.id === heroId);
      nextHero.name = name;
      nextHero.rosterGroup = String(formData.get('rosterGroup') ?? 'other');
      nextHero.faction = String(formData.get('faction') ?? '').trim() || null;
      await commit(nextState);
    },
  });
}
function choosePortraitFile(heroId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      showToast('正在压缩并保存立绘…');
      const blob = await compressPortrait(file);
      await savePortrait(heroId, blob);
      const oldUrl = portraitUrls.get(heroId);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      portraitUrls.set(heroId, URL.createObjectURL(blob));
      renderRoute();
      showToast('立绘已保存到当前浏览器');
    } catch (error) {
      showToast(`立绘导入失败：${error.message}`, 'error');
    }
  }, { once: true });
  input.click();
}

async function removePortraitFile(heroId) {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero || !window.confirm(`移除“${hero.name}”的本地立绘？`)) return;
  await deletePortrait(heroId);
  const oldUrl = portraitUrls.get(heroId);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  portraitUrls.delete(heroId);
  renderRoute();
  showToast('已移除本地立绘');
}

async function removeHero(heroId) {
  const hero = state.heroes.find((item) => item.id === heroId);
  if (!hero) return;
  if (!window.confirm(`删除武将“${hero.name}”？该武将也会从所有卡包名单中移除。`)) return;
  await commit(deleteHeroFromState(state, heroId));
  await deletePortrait(heroId);
  const oldUrl = portraitUrls.get(heroId);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  portraitUrls.delete(heroId);
  renderRoute();
  showToast(`已删除武将：${hero.name}`);
}

function openAddPackDialog(preferredCategory = 'regular') {
  openDialog({
    title: '新增卡包',
    description: '卡包会立即加入对应分类的排行榜。',
    submitText: '新增',
    body: `
      <div class="form-field">
        <label for="pack-category">分类</label>
        <select class="form-select" id="pack-category" name="category">
          ${Object.values(CATEGORY_META).map((category) => `<option value="${category.id}" ${category.id === preferredCategory ? 'selected' : ''}>${category.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label for="pack-name">卡包名称</label>
        <input class="form-input" id="pack-name" name="name" maxlength="24" autocomplete="off" required placeholder="例如：魏晋" />
      </div>`,
    onSubmit: async (formData) => {
      const category = String(formData.get('category'));
      if (!CATEGORY_META[category]) throw new Error('请选择有效分类');
      const name = assertUniquePackName(state.packs, formData.get('name'), category);
      const nextState = cloneState(state);
      const maxOrder = Math.max(-1, ...nextState.packs.filter((pack) => pack.category === category).map((pack) => pack.order ?? 0));
      nextState.packs.push({
        id: createId('pack'),
        name,
        category,
        order: maxOrder + 1,
        smallHeroIds: [],
        bigHeroIds: [],
      });
      await commit(nextState);
      showToast(`已新增卡包：${name}`);
    },
  });
}

function openRenamePackDialog(packId) {
  const pack = state.packs.find((item) => item.id === packId);
  if (!pack) return;
  openDialog({
    title: '重命名卡包',
    submitText: '保存',
    body: `
      <div class="form-field">
        <label for="pack-name">卡包名称</label>
        <input class="form-input" id="pack-name" name="name" maxlength="24" autocomplete="off" required value="${escapeHtml(pack.name)}" />
      </div>`,
    onSubmit: async (formData) => {
      const name = assertUniquePackName(state.packs, formData.get('name'), pack.category, packId);
      const nextState = cloneState(state);
      nextState.packs.find((item) => item.id === packId).name = name;
      await commit(nextState);
    },
  });
}

async function removePack(packId) {
  const pack = state.packs.find((item) => item.id === packId);
  if (!pack || !window.confirm(`删除卡包“${pack.name}”？此操作不会删除武将。`)) return;
  const nextState = cloneState(state);
  nextState.packs = nextState.packs.filter((item) => item.id !== packId);
  await commit(nextState);
  showToast(`已删除卡包：${pack.name}`);
}
function openAddToPoolDialog(packId, side) {
  const pack = state.packs.find((item) => item.id === packId);
  if (!pack) return;
  const assigned = new Set([...pack.smallHeroIds, ...pack.bigHeroIds]);
  const available = state.heroes
    .filter((hero) => !assigned.has(hero.id))
    .sort((left, right) => {
      const groupCompare = rosterGroupLabel(left.rosterGroup).localeCompare(rosterGroupLabel(right.rosterGroup), 'zh-CN');
      return groupCompare || left.name.localeCompare(right.name, 'zh-CN');
    });
  const sideLabel = side === 'small' ? '小保底' : '大保底';

  if (state.heroes.length === 0) {
    showToast('请先在武将管理中新增武将', 'error');
    return;
  }
  if (available.length === 0) {
    showToast('没有可加入的武将，当前卡包名单已包含全部武将', 'error');
    return;
  }

  openDialog({
    title: `添加${sideLabel}武将`,
    description: `同一卡包内不能同时进入大小保底名单。当前可添加 ${available.length} 名武将。`,
    submitText: '添加',
    body: `
      <div class="form-field">
        <label for="pool-hero-search">搜索并选择武将</label>
        <div class="pool-search-wrap">
          <input class="form-input" id="pool-hero-search" type="search" autocomplete="off"
            placeholder="输入武将名或阵营，例如：孙权、魏晋、蜀汉" data-role="pool-hero-search" />
          <span data-role="pool-visible-count">${available.length} 名</span>
        </div>
        <div class="hero-choice-list" data-role="pool-hero-list">
          ${available.map((hero) => {
            const groupLabel = rosterGroupLabel(hero.rosterGroup);
            const searchText = `${hero.name} ${hero.faction ?? ''} ${groupLabel}`.toLocaleLowerCase('zh-CN');
            return `
              <label class="hero-choice" data-search="${escapeHtml(searchText)}">
                <input type="radio" name="heroId" value="${escapeHtml(hero.id)}" />
                <span class="hero-choice-main">
                  <strong>${escapeHtml(hero.name)}</strong>
                  <small>${escapeHtml(groupLabel)} · ${scoreLabel(normalizeScore(hero.score))}</small>
                </span>
                <span class="hero-choice-group">${escapeHtml(groupLabel)}</span>
              </label>`;
          }).join('')}
        </div>
        <div class="pool-search-empty" data-role="pool-search-empty" hidden>没有找到匹配的武将</div>
        <span class="form-hint">已在当前卡包任一保底名单中的武将不会出现在列表中。</span>
      </div>`,
    onSubmit: async (formData) => {
      const heroId = String(formData.get('heroId'));
      if (!heroId) throw new Error('请选择武将');
      await commit(addHeroToPack(state, packId, side, heroId));
      const hero = state.heroes.find((item) => item.id === heroId);
      showToast(`已将${hero?.name ?? '武将'}加入${sideLabel}名单`);
    },
  });

  const searchInput = dialog.querySelector('[data-role="pool-hero-search"]');
  const choices = [...dialog.querySelectorAll('.hero-choice')];
  const countElement = dialog.querySelector('[data-role="pool-visible-count"]');
  const emptyElement = dialog.querySelector('[data-role="pool-search-empty"]');
  const filterChoices = () => {
    const keyword = searchInput.value.trim().toLocaleLowerCase('zh-CN');
    let visibleCount = 0;
    for (const choice of choices) {
      const visible = !keyword || choice.dataset.search.includes(keyword);
      choice.hidden = !visible;
      if (visible) visibleCount++;
    }
    countElement.textContent = `${visibleCount} 名`;
    emptyElement.hidden = visibleCount > 0;
  };
  searchInput.addEventListener('input', filterChoices);
  window.setTimeout(() => searchInput.focus(), 30);
}

async function removeFromPool(packId, side, heroId) {
  const nextState = removeHeroFromPack(state, packId, side, heroId);
  await commit(nextState);
  showToast(`已移出${side === 'small' ? '小保底' : '大保底'}名单`);
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const { action } = target.dataset;
  const heroId = target.dataset.heroId;
  const packId = target.dataset.packId;
  const side = target.dataset.side;

  try {
    if (action === 'set-score') await setHeroScore(heroId, target.dataset.score);
    else if (action === 'adjust-score') await adjustHeroScore(heroId, target.dataset.delta);
    else if (action === 'cycle-guarantee-mark') await cycleGuaranteeMark(heroId);
    else if (action === 'import-guarantee-marks') await importGuaranteeMarksToPacks();
    else if (action === 'filter-heroes') {
      heroGroupFilter = target.dataset.group || 'all';
      renderHeroesPage();
    }
    else if (action === 'add-hero') openAddHeroDialog();
    else if (action === 'rename-hero') openRenameHeroDialog(heroId);
    else if (action === 'delete-hero') await removeHero(heroId);
    else if (action === 'upload-portrait') choosePortraitFile(heroId);
    else if (action === 'remove-portrait') await removePortraitFile(heroId);
    else if (action === 'add-pack') openAddPackDialog(target.dataset.category || 'regular');
    else if (action === 'rename-pack') openRenamePackDialog(packId);
    else if (action === 'delete-pack') await removePack(packId);
    else if (action === 'add-to-pool') openAddToPoolDialog(packId, side);
    else if (action === 'remove-from-pool') await removeFromPool(packId, side, heroId);
  } catch (error) {
    showToast(error.message, 'error');
  }
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-role="hero-search"]')) {
    filterHeroes(event.target.value);
  }
});

initialize();















