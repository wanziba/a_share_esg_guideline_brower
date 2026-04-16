/**
 * A股《可持续发展报告指引》浏览器（丸爸）
 * 纯静态前端；数据由 tools/build_guideline_data.py 从 Excel 生成。
 * 性能优化：术语 HTML 已在构建时预渲染，浏览器无需运行正则。
 */

const DATA = window.GUIDELINE_DATA || { chapters: [], glossary: [], meta: {} };

/* ── 状态 ─────────────────────────────────────────────── */
const state = {
    selectedChapterId: null,
    selectedSectionId: null,
    selectedArticleId: null,
    selectedClauseId: null,
    currentArticlesById: {},
    expandedChapterIds: new Set(), // 左侧导航中展开的章
};

/* ── DOM refs ─────────────────────────────────────────── */
const refs = {};

/* ── 术语表 ───────────────────────────────────────────── */
const termLookup = new Map(); // term.toLowerCase() → item
let termNames = [];          // 按长度降序，仅用于运行时降级 fallback
let termPattern = null;

/* ── 类型说明（右下角面板） ──────────────────────────── */
const TYPE_LEGEND = [
    { label: "原则", cls: "type-principle", desc: "阐释了上市公司开展可持续发展相关工作的原则" },
    { label: "指引应用规则", cls: "type-rule", desc: "说明了上市公司应用指引的若干规则，比如实体范围、时间范围、过渡期安排" },
    { label: "披露操作要求", cls: "type-action", desc: "提出了开展可持续信息披露工作的基础性要求" },
    { label: "披露框架", cls: "type-framework", desc: "制定了披露议题内容的一般性框架" },
    { label: "披露要点", cls: "type-highlight", desc: "明确了披露具体议题内容的要点" },
    { label: "披露说明", cls: "type-method", desc: "针对披露要点提供进一步的说明，包括披露方式、披露条件等" },
    { label: "释义", cls: "type-definition", desc: "对指引涉及的术语进行定义" },
];

/* ── 类型 → CSS class 映射 ────────────────────────────── */
const TYPE_CLASS = {
    "未分类": "type-default",
    "原则": "type-principle",
    "指引应用规则": "type-rule",
    "释义": "type-definition",
    "披露操作要求": "type-action",
    "披露（前提）说明": "type-premise",
    "披露（方式）说明": "type-method",
    "披露框架": "type-framework",
    "披露要点": "type-highlight",
    "披露操作要求/披露框架": "type-mixed",
};

const TYPE_DESC = {
    "原则": "阐释了上市公司开展可持续发展相关工作的原则",
    "指引应用规则": "说明了上市公司应用指引的若干规则，比如实体范围、时间范围、过渡期安排",
    "披露操作要求": "提出了开展可持续信息披露工作的基础性要求",
    "披露框架": "制定了披露议题内容的一般性框架",
    "披露要点": "明确了披露具体议题内容的要点",
    "披露说明": "针对披露要点提供进一步的说明，包括披露方式、披露条件等",
    "释义": "对指引涉及的术语进行定义",
};

/* ── 搜索索引（全部条文平铺）──────────────────────────── */
let searchIndex = [];

/* ═══════════════════════════════════════════════════════
   初始化
═══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", init);

function init() {
    cacheRefs();
    bootstrapTerms();
    buildSearchIndex();
    renderNavigation();
    bindEvents();
    // 初始状态：导航全部收起，右侧显示使用提示
    if (DATA.chapters.length) {
        refs.viewTitle.textContent = "请从左侧导航选择章节";
        refs.contentList.innerHTML = renderEmpty("点击左侧「章」展开对应节，再点击「节」查看条文内容。");
    } else {
        refs.viewTitle.textContent = "暂无数据";
        refs.contentList.innerHTML = renderEmpty("请运行 tools/build_guideline_data.py 生成数据后刷新页面。");
    }
}

function cacheRefs() {
    ["navTree", "searchInput", "searchBtn", "clearBtn",
        "breadcrumb", "viewTitle", "viewStats", "contentList",
        "clausesTitle", "clausesList", "termTooltip", "typeTooltip"
    ].forEach(id => { refs[id] = document.getElementById(id); });
}

/* ═══════════════════════════════════════════════════════
   术语表初始化
═══════════════════════════════════════════════════════ */
function bootstrapTerms() {
    DATA.glossary.forEach(item => termLookup.set(item.term.toLowerCase(), item));
    termNames = [...termLookup.values()]
        .map(i => i.term)
        .sort((a, b) => b.length - a.length);
    if (termNames.length) {
        termPattern = new RegExp(termNames.map(escapeRe).join("|"), "g");
    }
}

/* ═══════════════════════════════════════════════════════
   搜索索引
═══════════════════════════════════════════════════════ */
function buildSearchIndex() {
    searchIndex = [];
    DATA.chapters.forEach(ch => ch.sections.forEach(sec => sec.articles.forEach(art =>
        art.clauses.forEach(cl => cl.items.forEach(item => {
            searchIndex.push({
                chapterId: ch.id, chapterTitle: ch.title,
                sectionId: sec.id, sectionTitle: sec.title,
                articleId: art.id, articleTitle: art.title,
                clauseId: cl.id, clauseTitle: cl.title,
                content: item.content, type: item.type,
            });
        }))
    )));
}

/* ═══════════════════════════════════════════════════════
   事件绑定
═══════════════════════════════════════════════════════ */
function bindEvents() {
    refs.searchBtn.addEventListener("click", runSearch);
    refs.clearBtn?.addEventListener("click", clearSearch);
    refs.searchInput.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

    // 内容区：条选择、款折叠、术语悬浮解释（事件委托）
    refs.contentList.addEventListener("click", e => {
        const ah = e.target.closest(".article-head");
        if (ah) {
            const articleCard = ah.closest(".article-card");
            if (articleCard) {
                const articleId = articleCard.dataset.articleId;
                const article = state.currentArticlesById[articleId] || null;
                if (article) {
                    state.selectedArticleId = article.id;
                    refs.contentList.querySelectorAll(".article-card").forEach(el => el.classList.remove("selected"));
                    articleCard.classList.add("selected");
                    showArticleClauses(article);
                }
            }
            return;
        }
    });

    refs.clausesList?.addEventListener("click", e => {
        const ch = e.target.closest(".clause-head");
        if (ch) {
            const clauseCard = ch.closest(".clause-card");
            if (!clauseCard) return;
            clauseCard.classList.toggle("collapsed");
            state.selectedClauseId = clauseCard.id || null;
            refs.clausesList.querySelectorAll(".clause-card").forEach(el => el.classList.remove("selected"));
            clauseCard.classList.add("selected");
            return;
        }

        const guidelineItem = e.target.closest(".guideline-item");
        if (guidelineItem) {
            refs.clausesList.querySelectorAll(".guideline-item").forEach(el => el.classList.remove("selected"));
            guidelineItem.classList.add("selected");
        }
    });

    refs.contentList.addEventListener("mouseover", e => {
        const trigger = e.target.closest(".term-trigger");
        if (!trigger) return;
        showTermTooltip(trigger.dataset.term, e.clientX, e.clientY);
    });
    refs.contentList.addEventListener("mousemove", e => {
        if (!refs.termTooltip || !refs.termTooltip.classList.contains("show")) return;
        moveTermTooltip(e.clientX, e.clientY);
    });
    refs.contentList.addEventListener("mouseout", e => {
        const from = e.target.closest(".term-trigger");
        if (!from) return;
        const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".term-trigger") : null;
        if (!to) hideTermTooltip();
    });
    refs.clausesList?.addEventListener("mouseover", e => {
        const trigger = e.target.closest(".term-trigger");
        if (!trigger) return;
        showTermTooltip(trigger.dataset.term, e.clientX, e.clientY);
    });
    refs.clausesList?.addEventListener("mousemove", e => {
        if (!refs.termTooltip || !refs.termTooltip.classList.contains("show")) return;
        moveTermTooltip(e.clientX, e.clientY);
    });
    refs.clausesList?.addEventListener("mouseout", e => {
        const from = e.target.closest(".term-trigger");
        if (!from) return;
        const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".term-trigger") : null;
        if (!to) hideTermTooltip();
    });

    const bindTypeTagTooltip = container => {
        if (!container) return;
        container.addEventListener("mouseover", e => {
            const tag = e.target.closest(".item-tag[data-type-desc]");
            if (!tag) return;
            showTypeTooltip(tag.dataset.typeDesc, e.clientX, e.clientY);
        });
        container.addEventListener("mousemove", e => {
            if (!refs.typeTooltip || !refs.typeTooltip.classList.contains("show")) return;
            moveTypeTooltip(e.clientX, e.clientY);
        });
        container.addEventListener("mouseout", e => {
            const from = e.target.closest(".item-tag[data-type-desc]");
            if (!from) return;
            const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".item-tag[data-type-desc]") : null;
            if (!to) hideTypeTooltip();
        });
    };

    bindTypeTagTooltip(refs.contentList);
    bindTypeTagTooltip(refs.clausesList);
}

/* ═══════════════════════════════════════════════════════
   左侧导航渲染
═══════════════════════════════════════════════════════ */
function renderNavigation() {
    refs.navTree.innerHTML = "";

    DATA.chapters.forEach(chapter => {
        const block = document.createElement("div");
        block.className = "nav-chapter";

        // 无节章：附则/释义直接进入条款，或只有一个「未分节」虚拟节
        const isNoSection = isDirectArticleChapter(chapter);

        // 章按钮
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-chapter-btn";
        btn.dataset.chapterId = chapter.id;
        // 第三、第四、第五章不显示小三角（兼容 ID/标题文本变化）
        const hideArrow = isNoSection ||
            chapter.id.startsWith("第三章-") || chapter.title.startsWith("第三章 ") ||
            chapter.id.startsWith("第四章-") || chapter.title.startsWith("第四章 ") ||
            chapter.id.startsWith("第五章-") || chapter.title.startsWith("第五章 ");
        btn.innerHTML =
            (hideArrow ? "" : `<span class="nav-arrow">▶</span>`) +
            `<span class="nav-text">${esc(chapter.title)}</span>`;
        block.appendChild(btn);

        if (isNoSection) {
            // 点击章直接加载内容，无需展开节列表
            btn.addEventListener("click", () => {
                state.expandedChapterIds.clear();
                state.expandedChapterIds.add(chapter.id);
                selectSection(chapter.id, chapter.sections[0].id);
            });
        } else {
            // 节列表（折叠容器）
            const secList = document.createElement("div");
            secList.className = "nav-section-list";
            secList.dataset.chapterId = chapter.id;

            chapter.sections.forEach(section => {
                const sb = document.createElement("button");
                sb.type = "button";
                sb.className = "nav-section-btn";
                sb.dataset.chapterId = chapter.id;
                sb.dataset.sectionId = section.id;
                sb.innerHTML = `<span class="nav-text">${esc(section.title)}</span>`;
                sb.addEventListener("click", e => {
                    e.stopPropagation();
                    selectSection(chapter.id, section.id);
                });
                secList.appendChild(sb);
            });
            block.appendChild(secList);

            // 章按钮点击：单开手风琴
            btn.addEventListener("click", () => {
                const chId = chapter.id;
                if (state.expandedChapterIds.has(chId)) {
                    state.expandedChapterIds.delete(chId);
                    state.selectedChapterId = chId;
                    state.selectedSectionId = null;
                    syncNav();
                } else {
                    state.expandedChapterIds.clear();
                    state.expandedChapterIds.add(chId);
                    // 只展开节，不默认选中第一个节
                    selectChapterOnly(chId);
                    syncNav();
                }
            });
        }

        refs.navTree.appendChild(block);
    });

    syncNav();
}

/* ═══════════════════════════════════════════════════════
   导航状态同步
═══════════════════════════════════════════════════════ */
function syncNav() {
    document.querySelectorAll(".nav-chapter-btn").forEach(el => {
        const cid = el.dataset.chapterId;
        el.classList.toggle("active", cid === state.selectedChapterId);
        el.classList.toggle("expanded", state.expandedChapterIds.has(cid));
    });
    document.querySelectorAll(".nav-section-list").forEach(el => {
        el.classList.toggle("expanded", state.expandedChapterIds.has(el.dataset.chapterId));
    });
    document.querySelectorAll(".nav-section-btn").forEach(el => {
        el.classList.toggle("active",
            el.dataset.chapterId === state.selectedChapterId &&
            el.dataset.sectionId === state.selectedSectionId
        );
    });
}

/* ═══════════════════════════════════════════════════════
   节选择
═══════════════════════════════════════════════════════ */
function selectSection(chapterId, sectionId) {
    state.selectedChapterId = chapterId;
    state.selectedSectionId = sectionId;
    state.expandedChapterIds.add(chapterId); // 确保章展开
    refs.searchInput.value = "";
    syncNav();
    renderSection();
}

function selectChapterOnly(chapterId) {
    const chapter = DATA.chapters.find(c => c.id === chapterId);
    state.selectedChapterId = chapterId;
    state.selectedSectionId = null;
    state.selectedArticleId = null;
    state.selectedClauseId = null;
    refs.searchInput.value = "";
    syncNav();

    refs.breadcrumb.textContent = "";
    refs.viewTitle.textContent = chapter ? chapter.title : "请选择章节";
    refs.viewStats.textContent = "";
    refs.contentList.innerHTML = renderEmpty("请从当前章中选择一个节。\n点击任一节后显示对应条文。");
    refs.clausesTitle.textContent = "";
    refs.clausesList.innerHTML = renderEmpty("请先选择左侧节，再选择条查看款和指引内容。");
}

/* ═══════════════════════════════════════════════════════
   右侧条文渲染
═══════════════════════════════════════════════════════ */
function renderSection() {
    const chapter = DATA.chapters.find(c => c.id === state.selectedChapterId);
    const section = chapter?.sections.find(s => s.id === state.selectedSectionId);
    if (!chapter) {
        refs.contentList.innerHTML = renderEmpty("章节不存在，请重新选择。");
        refs.clausesList.innerHTML = "";
        return;
    }
    if (!section) {
        selectChapterOnly(chapter.id);
        return;
    }

    const isDirectChapter = isDirectArticleChapter(chapter);
    const isNoSection = section.title === "未分节" || isDirectChapter;
    const articles = isDirectChapter
        ? chapter.sections.flatMap(s => s.articles)
        : section.articles;

    refs.breadcrumb.textContent = isNoSection ? "" : chapter.title;
    refs.viewTitle.textContent = isNoSection ? chapter.title : section.title;

    const artN = articles.length;
    const clN = articles.reduce((t, a) => t + a.clauses.length, 0);
    const itN = articles.reduce((t, a) =>
        t + a.clauses.reduce((u, c) => u + c.items.length, 0), 0);
    refs.viewStats.textContent = `${artN} 条 · ${clN} 款 · ${itN} 项`;

    state.selectedArticleId = null;
    state.selectedClauseId = null;
    state.currentArticlesById = Object.fromEntries(articles.map(a => [a.id, a]));

    // 条列表（不展示款，只显示条标题和可点击的条头）
    refs.contentList.innerHTML = articles.map(article => {
        const topicHtml = article.topic
            ? `<span class="article-topic">${esc(article.topic)}</span>`
            : "";
        const cardHtml = `<article class="article-card" id="${escAttr(article.id)}" data-article-id="${escAttr(article.id)}">
    <div class="article-head">
      <h2 class="article-title">${esc(article.title)}</h2>
      ${topicHtml}
    </div>
  </article>`;
        return cardHtml;
    }).join("");

    // 初始时右侧为空
    refs.clausesList.innerHTML = renderEmpty("点击左侧「条」查看对应的「款」和「指引内容」。");
    refs.clausesTitle.textContent = "";
}

function showArticleClauses(article) {
    if (!article) {
        refs.clausesTitle.textContent = "";
        refs.clausesList.innerHTML = renderEmpty("未找到条文内容。");
        return;
    }
    refs.clausesTitle.textContent = "";
    if (!Array.isArray(article.clauses) || !article.clauses.length) {
        refs.clausesList.innerHTML = renderEmpty("该条暂无款内容。");
        return;
    }
    refs.clausesList.innerHTML = article.clauses.map(renderClause).join("");
}

function renderArticle(article) {
    return `<article class="article-card collapsed" id="${escAttr(article.id)}">
    <div class="article-head">
      <h2 class="article-title">${esc(article.title)}</h2>
      <span class="article-toggle">▾</span>
    </div>
    <div class="article-body">${article.clauses.map(renderClause).join("")}</div>
  </article>`;
}

function renderClause(clause) {
    return `<section class="clause-card" id="${escAttr(clause.id)}">
    <div class="clause-head">
      <div class="clause-title">${esc(clause.title)}</div>
      <span class="clause-toggle">▾</span>
    </div>
    <div class="clause-items">${clause.items.map(renderItem).filter(h => h.trim()).join("")}</div>
  </section>`;
}

function renderItem(item) {
    // 过滤掉空内容或无效项
    if (!item || !item.content || !String(item.content).trim()) return "";

    // 判断是否强制披露：根据 disclosureLevel 是否包含"强制"或"必"
    const isForced = item.disclosureLevel && /强制|必/.test(item.disclosureLevel);
    const isEncouraged = !isForced && item.disclosureLevel && /鼓励/.test(item.disclosureLevel);
    const tc = TYPE_CLASS[item.type] || "type-default";
    const levelHtml = item.disclosureLevel
        ? `<span class="item-level${isForced ? " item-level-forced" : ""}${isEncouraged ? " item-level-encouraged" : ""}">${esc(item.disclosureLevel)}</span>` : "";
    // 优先使用构建时预渲染的 HTML，降级时运行时替换
    const bodyHtml = item.contentHtml || hlTerms(item.content);
    // 「未分类」不显示类型标签
    const typeDesc = getTypeDesc(item.type);
    const tagHtml = item.type === "未分类"
        ? ""
        : `<span class="item-tag ${tc}" data-type-desc="${escAttr(typeDesc)}">${esc(item.type)}</span>`;
    const metaContent = tagHtml + levelHtml;
    const metaHtml = metaContent ? `<div class="item-meta">${metaContent}</div>` : "";

    const emphasisClass = isForced ? " forced-disclosure" : (isEncouraged ? " encouraged-disclosure" : "");

    return `<div class="guideline-item ${tc}${emphasisClass}">
    ${metaHtml}
    <div class="item-content">${bodyHtml}</div>
  </div>`;
}

function getTypeDesc(type) {
    if (type === "披露（前提）说明" || type === "披露（方式）说明") return TYPE_DESC["披露说明"];
    if (type === "披露操作要求/披露框架") return `${TYPE_DESC["披露操作要求"]}；${TYPE_DESC["披露框架"]}`;
    return TYPE_DESC[type] || "";
}

/* ═══════════════════════════════════════════════════════
   全局搜索
═══════════════════════════════════════════════════════ */
function runSearch() {
    const q = refs.searchInput.value.trim();
    if (!q) { renderSection(); return; }

    // 搜索态下先清空右侧款面板，避免残留上一次浏览内容
    refs.clausesTitle.textContent = "";
    refs.clausesList.innerHTML = renderEmpty("点击左侧搜索结果查看对应的「款」和「指引内容」。");

    const lq = q.toLowerCase();
    const results = searchIndex.filter(row =>
        [row.chapterTitle, row.sectionTitle, row.articleTitle,
        row.clauseTitle, row.type, row.content].join(" ").toLowerCase().includes(lq)
    );

    refs.breadcrumb.textContent = "搜索结果";
    refs.viewTitle.textContent = `"${q}"`;
    refs.viewStats.textContent = `${results.length} 条匹配`;

    if (!results.length) {
        refs.contentList.innerHTML = renderEmpty("未找到匹配内容，请换个关键词试试。");
        return;
    }

    refs.contentList.innerHTML = results.slice(0, 80).map(r => renderSearchResult(r, q)).join("");

    // 绑定跳转事件
    refs.contentList.querySelectorAll(".search-result").forEach(el => {
        el.addEventListener("click", () => {
            jumpToSearchResult({
                chapterId: el.dataset.chapterId,
                sectionId: el.dataset.sectionId,
                articleId: el.dataset.articleId,
                clauseId: el.dataset.clauseId,
            });
        });
    });
}

function clearSearch() {
    refs.searchInput.value = "";
    renderSection();
}

function renderSearchResult(r, q) {
    const tc = TYPE_CLASS[r.type] || "type-default";
    const typeDesc = getTypeDesc(r.type);
    const secStr = r.sectionTitle === "未分节" ? "" : esc(r.sectionTitle);
    const pathParts = [esc(r.chapterTitle), secStr, esc(r.articleTitle), esc(r.clauseTitle)].filter(Boolean);
    return `<button class="search-result" type="button"
    data-chapter-id="${escAttr(r.chapterId)}"
    data-section-id="${escAttr(r.sectionId)}"
    data-article-id="${escAttr(r.articleId)}"
    data-clause-id="${escAttr(r.clauseId)}">
    <div class="search-path">${pathParts.join(" › ")}</div>
        <div class="search-tag-row"><span class="item-tag ${tc}" data-type-desc="${escAttr(typeDesc)}">${esc(r.type)}</span></div>
    <div class="search-snippet">${hlQuery(r.content, q)}</div>
  </button>`;
}

function jumpToSearchResult(targetRef) {
    selectSection(targetRef.chapterId, targetRef.sectionId);

    const article = state.currentArticlesById[targetRef.articleId] || null;
    if (!article) return;

    state.selectedArticleId = article.id;
    refs.contentList.querySelectorAll(".article-card").forEach(el => {
        el.classList.toggle("selected", el.dataset.articleId === article.id);
    });
    showArticleClauses(article);

    const target = document.getElementById(targetRef.clauseId);
    if (!target) return;

    // 其他款全部折叠，仅展开目标款
    refs.clausesList.querySelectorAll(".clause-card").forEach(el => {
        el.classList.remove("selected");
        if (el.id !== targetRef.clauseId) el.classList.add("collapsed");
    });
    target.classList.remove("collapsed");
    target.classList.add("selected");
    state.selectedClauseId = target.id;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("flash-focus");
    setTimeout(() => target.classList.remove("flash-focus"), 1400);
}

/* ═══════════════════════════════════════════════════════
   术语面板
═══════════════════════════════════════════════════════ */
function showTerm(termName) {
    const match = termLookup.get(termName.toLowerCase());
    if (!match) return;
    refs.conceptTitle.textContent = match.term;
    refs.conceptBody.innerHTML = match.definitionHtml || hlTerms(match.definition);
    refs.conceptMeta.innerHTML = `术语来源：释义`;
}

function showTermTooltip(termName, x, y) {
    if (!refs.termTooltip) return;
    const match = termLookup.get((termName || "").toLowerCase());
    if (!match) return;
    refs.termTooltip.innerHTML = `<div class="term-tooltip-title">${esc(match.term)}</div><div class="term-tooltip-body">${esc(match.definition)}</div>`;
    refs.termTooltip.classList.add("show");
    moveTermTooltip(x, y);
}

function moveTermTooltip(x, y) {
    if (!refs.termTooltip) return;
    const gap = 14;
    const rect = refs.termTooltip.getBoundingClientRect();
    let left = x + gap;
    let top = y + gap;
    if (left + rect.width > window.innerWidth - 12) left = x - rect.width - gap;
    if (top + rect.height > window.innerHeight - 12) top = y - rect.height - gap;
    refs.termTooltip.style.left = `${Math.max(12, left)}px`;
    refs.termTooltip.style.top = `${Math.max(12, top)}px`;
}

function hideTermTooltip() {
    refs.termTooltip?.classList.remove("show");
}

function showTypeTooltip(desc, x, y) {
    if (!refs.typeTooltip || !desc) return;
    refs.typeTooltip.innerHTML = `<div class="type-tooltip-body">${esc(desc)}</div>`;
    refs.typeTooltip.classList.add("show");
    moveTypeTooltip(x, y);
}

function moveTypeTooltip(x, y) {
    if (!refs.typeTooltip) return;
    const gap = 14;
    const rect = refs.typeTooltip.getBoundingClientRect();
    let left = x + gap;
    let top = y + gap;
    if (left + rect.width > window.innerWidth - 12) left = x - rect.width - gap;
    if (top + rect.height > window.innerHeight - 12) top = y - rect.height - gap;
    refs.typeTooltip.style.left = `${Math.max(12, left)}px`;
    refs.typeTooltip.style.top = `${Math.max(12, top)}px`;
}

function hideTypeTooltip() {
    refs.typeTooltip?.classList.remove("show");
}

function renderTypeLegend() {
    refs.conceptTitle.textContent = "类型说明";
    refs.conceptBody.innerHTML = TYPE_LEGEND.map(item =>
        `<div class="legend-item">
          <span class="item-tag ${item.cls}">${esc(item.label)}</span>
          <span class="legend-desc">${esc(item.desc)}</span>
        </div>`
    ).join("");
    refs.conceptMeta.innerHTML = `点击正文 <span style="color:var(--accent-hi)">蓝色术语</span> 查看释义`;
}

function isDirectArticleChapter(chapter) {
    if (!chapter || !Array.isArray(chapter.sections) || !chapter.sections.length) return false;
    if (chapter.sections.length === 1 && chapter.sections[0].title === "未分节") return true;
    return /附则|释义/.test(chapter.title || "");
}

/* ═══════════════════════════════════════════════════════
   工具函数
═══════════════════════════════════════════════════════ */
function fmtSec(title) { return title === "未分节" ? "" : title; }

/** 术语高亮（运行时降级，通常不会执行）*/
function hlTerms(text) {
    if (!text || !termPattern) return esc(text || "");
    termPattern.lastIndex = 0;
    const parts = []; let last = 0, m;
    while ((m = termPattern.exec(text)) !== null) {
        parts.push(esc(text.slice(last, m.index)));
        parts.push(`<button type="button" class="term-trigger" data-term="${escAttr(m[0])}">${esc(m[0])}</button>`);
        last = m.index + m[0].length;
    }
    parts.push(esc(text.slice(last)));
    return parts.join("");
}

/** 搜索关键词高亮（HTML 安全） */
function hlQuery(text, query) {
    const html = esc(text);
    if (!query) return html;
    return html.replace(new RegExp(escapeRe(query), "gi"), m => `<mark>${m}</mark>`);
}

function renderEmpty(msg) { return `<div class="empty-state">${esc(msg)}</div>`; }

function esc(v) {
    return String(v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escAttr(v) { return esc(v); }
function escapeRe(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
