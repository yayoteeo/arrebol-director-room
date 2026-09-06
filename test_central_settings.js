const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync("index.js", "utf8");

test("两套页签栏占满内容宽度，不再扣除右侧留白，操作按钮安全区保持不变", () => {
    const css = fs.readFileSync("style.css", "utf8");
    for (const [root, tabs, gutter] of [
        ["#adr048-popup-body", ".adr048-tabs", "--adr048-action-safe-gutter"],
        ["#adr044-drawer", ".adr044-tabs", "--adr044-action-safe-gutter"]
    ]) {
        assert.ok(css.includes(root + " " + tabs + " {\n    width: 100% !important;\n    margin-right: 0 !important;\n    box-sizing: border-box !important;"));
        assert.ok(css.includes("width: calc(100% - var(" + gutter + ")) !important;"));
    }
});

test("扩展列表入口沿用酒馆原生标题和箭头，装饰仅应用于展开内容", () => {
    const css = fs.readFileSync("style.css", "utf8");
    assert.doesNotMatch(css, /#adr044-drawer\s+(?:>\s*\.inline-drawer\s*\{|\.inline-drawer-(?:toggle|header|icon))/);
    assert.doesNotMatch(css, /#adr044-drawer\s*\*\s*\{/);
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/font-family\s*:/.test(rule[2])) continue;
        const selectors = rule[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",");
        assert.ok(selectors.every(selector => !/^(?:html\s+)?#adr044-drawer\s*$/.test(selector.trim())), "外层入口不能继承插件强制字体");
    }
    assert.match(css, /html #adr044-drawer \.inline-drawer-content\s*\{\s*--adrx-font:/);
    assert.match(css, /html #adr044-drawer \.inline-drawer-content\s*\{\s*border: 1px solid rgba\(255, 255, 255, \.9\)/);
    const html = build().sandbox.drawerHTML();
    assert.match(html, /class="inline-drawer-toggle inline-drawer-header"><b>[^<]+<\/b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"><\/div>/);
});

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
}

function build(saved = {}) {
    const state = { masterEnabled: true, activeTab: "emotion" };
    const listeners = {};
    const document = { addEventListener: (name, handler) => { listeners[name] = handler; } };
    const sandbox = {
        settings: () => state,
        esc: value => String(value),
        opt: (current, value, label) => '<option value="' + value + '">' + label + '</option>',
        adrDMasterToggleLabel: () => "运行开关",
        adrDThemeMode: () => "dusk",
        adrDThemeControls: () => '<select id="adr044-theme-mode"></select>',
        adrDChatReadControls: () => '<input id="chat-read-controls">',
        adrDAnimaHistoryControls: () => '<input id="anima-controls">',
        adrDApiRetryControls: () => '<input id="retry-controls">',
        adrDContentExclusionControls: () => '<input id="exclusion-controls">',
        pageHTML: type => '<div id="page-' + type + '"></div>',
        adr048PageHTML: type => '<div id="page-' + type + '"></div>',
        adrCdPageHTML: () => '<div id="page-cd"></div>',
        adrCd048PageHTML: () => '<div id="page-cd"></div>',
        ADR_D_NG_THRESHOLD: 3,
        ADRX_DRAWER_KEY: "drawers",
        adrDReadJsonLS: () => ({ ...saved }),
        adrDWriteJsonLS: (key, value) => { Object.assign(saved, value); },
        rootDoc: () => document,
    };
    vm.createContext(sandbox);
    vm.runInContext([
        section("    function adrxDrawerStates()", "    function adr048PanelHTML()"),
        section("    function drawerHTML()", "    function mountDrawer()"),
        section("    function adr048PanelHTML()", "    function adr048CreatePopupPanel()"),
    ].join("\n"), sandbox);
    return { sandbox, state, listeners, saved };
}

function centralRegion(html) {
    const start = html.indexOf('<details class="adrx-drawer" data-drawer-id="central-settings"');
    assert.ok(start >= 0);
    const tags = /<\/?details\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(html))) {
        depth += match[0].startsWith("</") ? -1 : 1;
        if (depth === 0) return { start, end: tags.lastIndex, html: html.slice(start, tags.lastIndex) };
    }
    assert.fail("中控抽屉未闭合");
}

for (const renderer of ["drawerHTML", "adr048PanelHTML"]) {
    test(renderer + " 默认折叠，收纳运行与共享设置，页签留在外面", () => {
        const { sandbox, state } = build();
        const html = sandbox[renderer]();
        const central = centralRegion(html);
        assert.match(central.html, /^<details[^>]*(?<! open)><summary>中控设置<\/summary>/);
        for (const marker of ["adr044-theme-mode", "adr044-master-toggle", "共享设置", "chat-read-controls", "anima-controls", "retry-controls", "exclusion-controls", "shared-adv", "shared-diag"]) {
            assert.ok(central.html.includes(marker), marker);
        }
        assert.equal((html.match(/id="adr044-master-toggle"/g) || []).length, 1);
        for (const marker of ["adr044-tab-emotion", "adr044-tab-plot", "adr044-tab-cd", "page-emotion", "page-plot", "page-cd"]) {
            assert.ok(html.indexOf('id="' + marker + '"') >= central.end, marker);
        }
        assert.equal(state.masterEnabled, true);
        const stack = [];
        for (const match of html.matchAll(/<(\/?)(div|details)\b[^>]*>/g)) {
            if (match[1]) assert.equal(stack.pop(), match[2]);
            else stack.push(match[2]);
        }
        assert.deepEqual(stack, []);
    });

    test(renderer + " 点击展开和收起沿用本地抽屉记忆，不修改运行开关", () => {
        const { sandbox, state, listeners, saved } = build();
        sandbox.adrxInstallDrawerMemory();
        for (const open of [true, false]) {
            listeners.toggle({ target: {
                classList: { contains: name => name === "adrx-drawer" },
                getAttribute: () => "central-settings", open,
            } });
            assert.equal(saved["central-settings"], open);
            const region = centralRegion(sandbox[renderer]()).html;
            assert.equal(/^[^>]*\sopen>/.test(region), open);
            assert.equal(state.masterEnabled, true);
        }
    });
}
