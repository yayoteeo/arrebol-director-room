const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const source = fs.readFileSync("index.js", "utf8");
const start = source.indexOf("    function adrDThemeMode(");
const end = source.indexOf("    function adr048BindPopupPanel(", start);
assert.ok(start >= 0 && end > start);
const helpers = source.slice(start, end);

function build() {
    const state = {};
    const elements = new Map();
    const callbacks = {};
    const timers = [];
    let saved;
    function element(id) {
        const properties = {};
        const attributes = { "data-open": "1" };
        const result = {
            id, attributes, properties,
            style: {
                setProperty: (key, value) => { properties[key] = value; },
                getPropertyValue: key => properties[key] || "",
                removeProperty: key => { delete properties[key]; }
            },
            setAttribute: (key, value) => { attributes[key] = value; },
            getAttribute: key => attributes[key],
        };
        elements.set(id, result);
        return result;
    }
    for (const id of ["adr048-popup-panel", "adr048-popup-shell", "adr048-theme-toggle", "adr044-drawer", "inline", "adrx-editor", "rm_extensions_block", "send_textarea"]) element(id);
    const nativeStyle = { color: "rgb(30, 40, 50)", backgroundColor: "rgb(245, 246, 247)", borderColor: "rgb(180, 180, 180)", fontFamily: '"Theme Font", sans-serif' };
    const view = {
        getComputedStyle: () => nativeStyle,
        addEventListener: (name, handler) => { callbacks[name] = handler; },
        matchMedia: () => ({ addEventListener: (name, handler) => { callbacks.media = handler; } }),
        MutationObserver: class {
            constructor(handler) { callbacks.mutation = handler; }
            observe() {}
        },
    };
    const document = {
        defaultView: view, head: {}, body: {}, documentElement: {},
        querySelector: selector => elements.get(selector.slice(1)) || null,
        querySelectorAll: () => [elements.get("adr048-popup-panel"), elements.get("inline"), elements.get("adrx-editor")],
        addEventListener: (name, handler) => { callbacks[name] = handler; },
    };
    const sandbox = {
        settings: () => state, rootDoc: () => document, rootWin: () => view,
        save: (key, value) => { state[key] = value; },
        saveNow: () => { saved = { ...state }; }, adrDSetAllById() {},
        adr048SetImportant: (target, key, value) => target.style.setProperty(key, value),
        opt: (current, value, label) => '<option value="' + value + '"' + (current === value ? " selected" : "") + '>' + label + '</option>',
        setTimeout: handler => { timers.push(handler); return timers.length; },
    };
    vm.createContext(sandbox);
    vm.runInContext(helpers, sandbox);
    return { sandbox, state, elements, callbacks, timers, nativeStyle, saved: () => saved };
}

test("保留旧主题选择，新增跟随酒馆选项且不强制覆盖用户原有配色", () => {
    const { sandbox } = build();
    assert.equal(sandbox.adrDThemeMode({}), "dusk");
    assert.equal(sandbox.adrDThemeMode({ dawnTheme: true }), "dawn");
    assert.equal(sandbox.adrDThemeMode({ dawnTheme: true, themeMode: "tavern" }), "tavern");
    assert.equal(sandbox.adrDThemeMode({ themeMode: "invalid" }), "dusk");
    assert.match(sandbox.adrDThemeControls({ themeMode: "tavern" }), /value="tavern" selected/);
    assert.equal((source.match(/adrDThemeControls\(st\)/g) || []).length, 3);
});

test("主题保存并同步浮窗、内嵌面板和编辑器，切回原配色会清除原生内联覆盖", () => {
    const { sandbox, elements, saved } = build();
    sandbox.adrDSetThemeMode("tavern");
    assert.equal(saved().themeMode, "tavern");
    for (const id of ["adr048-popup-panel", "adr044-drawer", "adrx-editor"]) assert.equal(elements.get(id).attributes["data-arb-theme"], "tavern");
    assert.match(elements.get("adr048-popup-shell").properties.background, /--adr-native-surface/);
    assert.equal(elements.get("inline").properties["--adr-native-font"], '"Theme Font", sans-serif');
    sandbox.adrDSetThemeMode("dawn");
    assert.equal(saved().dawnTheme, true);
    assert.doesNotMatch(elements.get("adr048-popup-shell").properties.background, /--adr-native/);
    sandbox.adrDSetThemeMode("dusk");
    assert.equal(saved().dawnTheme, false);
    assert.equal(elements.get("adr048-popup-panel").attributes["data-arb-theme"], "dusk");
    assert.equal(elements.get("adr044-drawer").attributes["data-arb-theme"], "dawn");
});

test("自定义 CSS 修改触发合并刷新，透明背景回退变量，离开跟随主题后停止取色", () => {
    const { sandbox, nativeStyle, elements, callbacks, timers } = build();
    sandbox.adrDInstallThemeWatcher();
    callbacks.change({ target: { id: "adr044-theme-mode", value: "tavern" } });
    nativeStyle.color = "rgb(240, 240, 240)";
    nativeStyle.backgroundColor = "rgba(0, 0, 0, 0)";
    callbacks.mutation();
    callbacks.mutation();
    assert.equal(timers.length, 1);
    timers.shift()();
    assert.equal(elements.get("inline").properties["--adr-native-ink"], "rgb(240, 240, 240)");
    assert.equal(elements.get("inline").properties["--adr-native-surface"], undefined);
    sandbox.adrDSetThemeMode("dusk");
    callbacks.mutation();
    assert.equal(timers.length, 0);
});

test("浏览器实测：浅色、深色及运行中修改 CSS，三套面板保持可读且不污染扩展入口", { skip: !process.env.ADR_THEME_BROWSER }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adr-theme-"));
    const fixture = path.join(directory, "theme.html");
    const css = fs.readFileSync("style.css", "utf8");
    const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>*,*::before,*::after{transition:none!important;animation:none!important}</style><style id="custom-style"></style>
    <div id="rm_extensions_block"><b id="native-title">原生扩展</b><div id="adr044-drawer"><div class="inline-drawer"><div class="inline-drawer-header"><b id="plugin-title">导演扩展</b></div><div class="inline-drawer-content"><div class="adr044-box"><label>标签</label><textarea id="inline-field"></textarea><button>保存</button></div></div></div></div></div>
    <textarea id="send_textarea"></textarea>
    <div id="adr048-popup-panel" data-open="1"><div id="adr048-popup-shell"><div id="adr048-popup-head"><span class="adr048-title-d">D</span><button id="adr048-theme-toggle"></button></div><div id="adr048-popup-body"><div class="adr048-section"><div class="adr048-summary">共享设置</div><textarea id="popup-field"></textarea><button id="adr044-master-toggle" data-master-on="1"></button><button id="adr044-emotion-generate">分析</button><label class="adr048-check"><input id="check" type="checkbox" checked>开关</label></div></div></div></div>
    <div id="adrx-editor"><div class="adrx-editor-shell"><textarea id="editor-field" class="adrx-editor-ta"></textarea><div class="adrx-editor-foot"><button class="adrx-editor-ok">确定</button></div></div></div>
    <pre id="results"></pre><script>
    const state = { themeMode: 'tavern' };
    function settings() { return state; } function rootDoc() { return document; } function rootWin() { return window; }
    function adr048SetImportant(element, key, value) { element.style.setProperty(key, value, 'important'); }
    function save(key, value) { state[key] = value; } function saveNow() {} function adrDSetAllById() {}
    ${helpers}
    function skin(dark) {
        document.querySelector('#custom-style').textContent = ':root{--SmartThemeBodyColor:'+(dark?'#eee':'#222')+';--SmartThemeBlurTintColor:'+(dark?'#24282e':'#f4f5f6')+';--SmartThemeBorderColor:#888;--SmartThemeQuoteColor:#729b91} #rm_extensions_block{background:'+(dark?'#24282e':'#f4f5f6')+';color:'+(dark?'#eee':'#222')+';font-family:serif} #send_textarea{background:'+(dark?'#30343a':'#fff')+';color:'+(dark?'#eee':'#222')+'}';
    }
    function snapshot() {
        const result = {};
        for (const selector of ['#adr048-popup-shell', '#adr048-popup-body', '.inline-drawer-content', '.adrx-editor-shell', '#popup-field', '#inline-field', '#editor-field', '#plugin-title', '#native-title', '#check']) {
            const style = getComputedStyle(document.querySelector(selector));
            result[selector] = { color: style.color, background: style.backgroundColor, image: style.backgroundImage, font: style.fontFamily, appearance: style.appearance, field: style.getPropertyValue('--arb-field'), nativeField: style.getPropertyValue('--adr-native-field') };
        }
        return result;
    }
    document.querySelectorAll('*').forEach(element => element.style.setProperty('transition', 'none', 'important'));
    skin(false); adr048ApplyPanelTheme(); adrDInstallThemeWatcher();
    const light = snapshot(); skin(true);
    setTimeout(() => { document.querySelector('#results').textContent = JSON.stringify({light, dark:snapshot()}); }, 300);
    </script>`;
    fs.writeFileSync(fixture, html);
    const result = spawnSync(process.env.ADR_THEME_BROWSER, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--user-data-dir=" + path.join(directory, "profile"), "--virtual-time-budget=1500", "--dump-dom", pathToFileURL(fixture).href], { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, String(result.error || result.stderr));
    const match = result.stdout.match(/<pre id="results"[^>]*>([^<]+)<\/pre>/);
    assert.ok(match, result.stderr + result.stdout.slice(-1500));
    const reports = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    for (const [mode, report] of Object.entries(reports)) {
        const dark = mode === "dark";
        for (const selector of ["#adr048-popup-shell", ".inline-drawer-content", ".adrx-editor-shell"]) {
            assert.equal(report[selector].background, dark ? "rgb(36, 40, 46)" : "rgb(244, 245, 246)", mode + selector);
            assert.equal(report[selector].color, dark ? "rgb(238, 238, 238)" : "rgb(34, 34, 34)", mode + selector);
            assert.equal(report[selector].image, "none", mode + selector);
        }
        for (const selector of ["#popup-field", "#inline-field", "#editor-field"]) {
            assert.equal(report[selector].background, dark ? "rgb(48, 52, 58)" : "rgb(255, 255, 255)", mode + selector + JSON.stringify(report[selector]));
            assert.equal(report[selector].color, dark ? "rgb(238, 238, 238)" : "rgb(34, 34, 34)", mode + selector);
        }
        assert.deepEqual(report["#plugin-title"], report["#native-title"]);
        assert.equal(report["#adr048-popup-body"].color, dark ? "rgb(238, 238, 238)" : "rgb(34, 34, 34)");
        assert.equal(report["#check"].appearance, "none", "复选框跟随酒馆配色，但统一自绘以免与原生样式叠画");
    }
});
