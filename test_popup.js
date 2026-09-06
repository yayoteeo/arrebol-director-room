const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const source = fs.readFileSync("index.js", "utf8");
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
}

function element() {
    const attributes = {};
    const listeners = {};
    const properties = {};
    return {
        attributes, listeners, properties, scrollTop: 150,
        style: { setProperty: (key, value) => { properties[key] = value; } },
        setAttribute: (key, value) => { attributes[key] = value; },
        getAttribute: key => attributes[key],
        addEventListener: (name, handler) => { (listeners[name] ||= []).push(handler); },
        getBoundingClientRect: () => ({ left: 100, top: 100, width: 78, height: 28 }),
    };
}

function buildPopup() {
    const nodes = new Map();
    const frames = [], timers = [], refreshes = [];
    const counts = { creates: 0, binds: 0, theme: 0, anima: 0, saves: 0 };
    const state = { activeTab: "emotion" };
    const document = element();
    document.querySelector = selector => nodes.get(selector.slice(1));
    document.defaultView = { requestAnimationFrame: handler => frames.push(handler) };
    const sandbox = {
        rootDoc: () => document, rootWin: () => document.defaultView, settings: () => state,
        adr048CreatePopupPanel() {
            counts.creates++;
            for (const id of ["adr048-popup-panel", "adr048-popup-shell", "adr048-popup-body"]) nodes.set(id, element());
            nodes.get("adr048-popup-panel").setAttribute("data-open", "0");
        },
        adr048SetImportant: (node, key, value) => node.style.setProperty(key, value),
        adr048ApplyPanelTheme: () => counts.theme++, bindDirect: () => counts.binds++,
        switchTab: (type, options) => refreshes.push({ type, skipCard: options.skipCard }),
        adrDScheduleAnimaStatusRefresh: () => counts.anima++,
        syncAll: () => counts.saves++, adrDSaveLocalBackup() {}, saveNow() {},
        setTimeout: handler => timers.push(handler), console,
        alert: message => assert.fail(message),
    };
    vm.createContext(sandbox);
    vm.runInContext(section("    function adr048SchedulePopupRefresh(", "    function adrDThemeMode("), sandbox);
    return { sandbox, nodes, frames, timers, refreshes, counts, state,
        flush() { frames.splice(0).forEach(handler => handler()); timers.splice(0).forEach(handler => handler()); } };
}

test("重复打开只显示一次，关闭再开复用 DOM、绑定与滚动位置，每次仅刷新一次", () => {
    const { sandbox, nodes, counts, refreshes, flush } = buildPopup();
    sandbox.adr048OpenPopupPanel();
    const panel = nodes.get("adr048-popup-panel");
    nodes.get("adr048-popup-body").scrollTop = 321;
    panel.draft = "未提交的编辑内容";
    for (let repeat = 0; repeat < 10; repeat++) sandbox.adr048OpenPopupPanel();
    assert.equal(counts.creates, 1);
    assert.equal(counts.binds, 1);
    assert.equal(refreshes.length, 1);
    assert.equal(counts.anima, 0);
    flush();
    assert.equal(counts.anima, 1);
    sandbox.adr048ClosePopupPanel();
    sandbox.adr048ClosePopupPanel();
    assert.equal(counts.saves, 1);
    sandbox.adr048OpenPopupPanel();
    assert.equal(nodes.get("adr048-popup-panel"), panel);
    assert.equal(panel.draft, "未提交的编辑内容");
    assert.equal(nodes.get("adr048-popup-body").scrollTop, 321);
    assert.equal(counts.binds, 1);
    assert.equal(refreshes.length, 2);
    assert.equal(refreshes[1].skipCard, true);
});

test("非关键检查在首帧之后执行，快速关闭或旧面板被移除不会留下过期刷新", () => {
    const instance = buildPopup();
    const { sandbox, counts, state, refreshes, nodes, frames, timers } = instance;
    sandbox.adr048OpenPopupPanel();
    assert.equal(timers.length, 0);
    frames.splice(0).forEach(handler => handler());
    assert.equal(counts.anima, 0);
    sandbox.adr048ClosePopupPanel();
    instance.flush();
    assert.equal(counts.anima, 0);
    state.activeTab = "cd";
    sandbox.adr048OpenPopupPanel();
    assert.deepEqual(refreshes.at(-1), { type: "cd", skipCard: false });
    sandbox.adr048ClosePopupPanel();
    sandbox.adr048OpenPopupPanel();
    instance.flush();
    assert.equal(counts.anima, 1);
    sandbox.adr048ClosePopupPanel();
    sandbox.adr048OpenPopupPanel();
    nodes.delete("adr048-popup-panel");
    instance.flush();
    assert.equal(counts.anima, 1);
});

test("同值同步不会重复写入长文本和勾选框，API 选项仅在内容变化时重建", () => {
    let value = "长文本".repeat(5000), writes = 0, checked = true, checks = 0, htmlWrites = 0;
    const text = { type: "textarea", get value() { return value; }, set value(next) { writes++; value = next; } };
    const checkbox = { type: "checkbox", get checked() { return checked; }, set checked(next) { checks++; checked = next; } };
    const select = { value: "模型预设", set innerHTML(next) { htmlWrites++; } };
    const input = { value: "模型预设" };
    let html = '<option value="模型预设">模型预设</option>';
    const sandbox = {
        rootDoc: () => ({ querySelectorAll: selector => selector.includes("api-profile-select") ? [select] : selector.includes("api-profile-name") ? [input] : selector === "#text" ? [text] : [checkbox] }),
        adrDSelectedApiProfileName: () => "模型预设", adrDApiProfileSelectOptions: () => html,
    };
    vm.createContext(sandbox);
    vm.runInContext(section("    function adrDSetAllById(", "    function adrDRefreshAllFieldsFromSettings(") + section("    function adrDRefreshApiProfileSelects(", "    function adrDApiProfileStatus("), sandbox);
    sandbox.adrDSetAllById("text", value);
    sandbox.adrDSetAllById("checkbox", "", true);
    assert.equal(writes, 0);
    assert.equal(checks, 0);
    sandbox.adrDSetAllById("text", "更新的内容");
    sandbox.adrDSetAllById("checkbox", "", false);
    assert.equal(writes, 1);
    assert.equal(checks, 1);
    sandbox.adrDRefreshApiProfileSelects("emotion");
    sandbox.adrDRefreshApiProfileSelects("emotion");
    assert.equal(htmlWrites, 1);
    html += '<option value="新增">新增</option>';
    sandbox.adrDRefreshApiProfileSelects("emotion");
    assert.equal(htmlWrites, 2);
});

test("实际悬浮球鼠标和触摸点击只打开一次，拖动、右键及触摸取消不误打开", () => {
    const document = element();
    let button, opens = 0, saved = 0;
    document.querySelector = () => button;
    document.createElement = () => element();
    document.body = { appendChild: node => { button = node; } };
    const sandbox = {
        rootDoc: () => document, adr048ShouldShowFab: () => true, ADR048_FAB_INSTANCE_ID: "test",
        adr048SetImportant: (node, key, value) => node.style.setProperty(key, value),
        adr048ApplyFabPosition() {}, adr048GetFabSavedPosition: () => null,
        adr048ClampPoint: (left, top) => ({ left, top }), adr048SaveFabPosition: () => saved++,
        adr048OpenPopupPanel: () => opens++, console,
    };
    vm.createContext(sandbox);
    vm.runInContext(section("    function adr048CreateFab(", "    function adr048EnsureFabLater("), sandbox);
    sandbox.adr048CreateFab();
    function emit(target, type, extra = {}) {
        const event = { type, button: 0, detail: 1, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...extra };
        (target.listeners[type] || []).forEach(handler => handler(event));
    }
    assert.equal(button.listeners.click.length, 1);
    assert.equal(button.onclick, undefined);
    emit(button, "mousedown"); emit(document, "mouseup"); emit(button, "click");
    assert.equal(opens, 1);
    emit(button, "mousedown"); emit(document, "mousemove", { clientX: 150 }); emit(document, "mouseup"); emit(button, "click");
    assert.equal(opens, 1); assert.equal(saved, 1);
    emit(button, "click", { detail: 0 });
    assert.equal(opens, 2);
    emit(button, "touchstart"); emit(document, "touchend");
    assert.equal(opens, 3);
    emit(button, "touchstart"); emit(document, "touchcancel");
    assert.equal(opens, 3);
    emit(button, "mousedown", { button: 2 }); emit(document, "mouseup", { button: 2 });
    assert.equal(opens, 3);
});

test("浏览器完整插件：反复打开保留节点和最新字段，页签、关闭保存与放大编辑正常", { skip: !process.env.ADR_THEME_BROWSER }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "adr-popup-"));
    const fixture = path.join(directory, "popup.html");
    const css = fs.readFileSync("style.css", "utf8");
    const instrumented = source.replace("function adrDRefreshAllFieldsFromSettings(options) {", "function adrDRefreshAllFieldsFromSettings(options) { window.popupStats.refreshes++; ")
        .replace("function bindDirect() {", "function bindDirect() { window.popupStats.binds++; ");
    fs.writeFileSync(path.join(directory, "app.js"), instrumented);
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="extensions_settings2"></div><pre id="results"></pre><script>
    window.popupStats = {refreshes:0,binds:0};
    const handlers = {}, key = 'arrebol-d-final-v1040-stable-settings';
    const state = {showFloatingWindow:true,themeMode:'tavern',emotionPreset:'长预设测试'.repeat(10000),supplementMemory:'初始内容'};
    const context = {extensionSettings:{[key]:state},chatMetadata:{},chat:[],chatId:'fixture',getCurrentChatId:()=>context.chatId,
        saveSettingsDebounced(){},saveSettings(){},saveMetadataDebounced(){},saveMetadata(){},setExtensionPrompt(){},extensionPrompts:{},
        extensionPromptTypes:{IN_CHAT:1},extensionPromptRoles:{SYSTEM:0},substituteParams:text=>text,
        eventSource:{on:(name,handler)=>(handlers[name] ||= []).push(handler)},event_types:{APP_READY:'app_ready'}};
    window.SillyTavern={getContext:()=>context}; window.toastr={info(){},success(){},warning(){},error(){}};
    window.fetch=async()=>{throw new Error('测试禁止网络请求');};
    function check(condition, message) {if(!condition) throw new Error(message);}
    </script><script src="app.js"></script><script>
    (handlers.app_ready || []).forEach(handler=>handler());
    setTimeout(()=>{try {
        const fab=document.querySelector('#adr048-fab'); check(fab,'悬浮球未初始化');
        const original=document.querySelector('#adr048-popup-panel');
        const results=[];
        for(let round=0;round<5;round++) {
            state.supplementMemory='最新设置'+round;
            const before=popupStats.refreshes, start=performance.now();
            fab.click();
            const panel=document.querySelector('#adr048-popup-panel');
            results.push(performance.now()-start);
            check(panel===original,'打开时重建了面板');
            check(panel.getAttribute('data-open')==='1','面板未打开');
            check(popupStats.refreshes-before===1,'一次打开重复同步字段');
            check(panel.querySelector('#adr044-memory').value==='最新设置'+round,'读取到旧设置');
            const bindings=popupStats.binds;
            fab.click(); check(popupStats.binds===bindings,'重复点击重新绑定');
            panel.querySelector('#adr048-popup-close').click();
            check(panel.getAttribute('data-open')==='0','关闭失败');
        }
        fab.click();
        const panel=original, body=panel.querySelector('#adr048-popup-body');
        panel.querySelector('#adr044-tab-plot').click();
        check(panel.querySelector('#adr048-page-plot').style.display!=='none','页签切换失效');
        const extra=panel.querySelector('#adr044-plot-extra');extra.value='保留临时指令';
        body.scrollTop=180; const scroll=body.scrollTop;
        panel.querySelector('#adr048-popup-close').click();fab.click();
        check(extra.value==='保留临时指令','重开丢失临时指令');
        check(body.scrollTop===scroll,'重开滚动位置丢失');
        const memory=panel.querySelector('#adr044-memory');
        memory.parentNode.querySelector('.adrx-expand').click();
        check(document.querySelector('#adrx-editor'),'放大编辑器打不开');
        document.querySelector('.adrx-editor-cancel').click();
        check(!document.querySelector('#adrx-editor'),'放大编辑器不能关闭');
        panel.querySelector('#adr044-tab-cd').click();
        check(panel.querySelector('#adr048-page-cd').style.display!=='none','抽卡页打不开');
        document.querySelector('#results').textContent=JSON.stringify({ok:true,openMilliseconds:results,refreshes:popupStats.refreshes});
    } catch(error) {document.querySelector('#results').textContent=JSON.stringify({ok:false,error:error.message,stack:error.stack});}},400);
    </script>`);
    const result = spawnSync(process.env.ADR_THEME_BROWSER, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--user-data-dir=" + path.join(directory, "profile"), "--virtual-time-budget=2500", "--dump-dom", pathToFileURL(fixture).href], { encoding: "utf8", timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, String(result.error || result.stderr));
    const match = result.stdout.match(/<pre id="results"[^>]*>([^<]+)<\/pre>/);
    assert.ok(match, result.stderr + result.stdout.slice(-1800));
    const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    assert.equal(report.ok, true, report.error + "\n" + report.stack);
});
