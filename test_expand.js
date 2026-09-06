// v1.26.0 放大编辑测试。跑法同其余：npm install jsdom && node test_expand.js
// v1.26.0 放大编辑：按钮就位、回填触发保存、取消不动、单行框去换行、ESC 关闭
const fs = require("fs"); const { JSDOM } = require("jsdom");
const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";
let PASS = 0, FAIL = 0;
function ok(c, n, x) { if (c) { PASS++; console.log("  ✓ " + n); } else { FAIL++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } }
const tick = ms => new Promise(r => setTimeout(r, ms));
function build(settings) {
    const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings2"></div></body></html>', { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    extensionSettings[SET_KEY] = Object.assign({ supplementMemory: "旧的" }, settings || {});
    for (let i = 0; i < 4; i++) { chat.push({ is_user: true, mes: "a" }); chat.push({ is_user: false, mes: "<content>b</content>" }); }
    // v1.26.1：仿 iOS 可视视口——键盘弹出后 offsetTop / height 会变，编辑器必须跟着走
    const vvHandlers = {};
    win.visualViewport = { offsetTop: 0, offsetLeft: 0, width: 390, height: 844,
        addEventListener(t, f) { (vvHandlers[t] = vvHandlers[t] || []).push(f); },
        removeEventListener(t, f) { vvHandlers[t] = (vvHandlers[t] || []).filter(x => x !== f); },
        fire(t) { (vvHandlers[t] || []).forEach(f => f()); }, handlers: vvHandlers };
    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async () => { throw new Error("offline"); };
    const context = { extensionSettings, chatMetadata, chat, chatId: "t", getCurrentChatId: () => "t",
        saveSettingsDebounced() {}, saveSettings() {}, saveMetadataDebounced() {}, saveMetadata() {},
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; }, extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }, substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received" } };
    win.eval(SRC);
    return { win, doc: win.document, st: () => extensionSettings[SET_KEY], handlers };
}
(async () => {
    const e = build();
    e.doc.dispatchEvent(new e.win.Event("DOMContentLoaded")); await tick(600);
    (e.handlers["app_ready"] || []).forEach(f => { try { f(); } catch (x) {} }); await tick(500);
    const d = e.doc, W = e.win;
    const click = el => el.dispatchEvent(new W.Event("click", { bubbles: true }));

    console.log("\n── 抽屉 ──");
    const drawerTas = d.querySelectorAll("#adr044-drawer textarea");
    const drawerBtns = d.querySelectorAll("#adr044-drawer .adrx-ta > .adrx-expand");
    ok(drawerTas.length > 0 && drawerBtns.length === drawerTas.length + 2, "抽屉里每个文字框（+两个补充指令框）都有 ⛶", drawerTas.length + "/" + drawerBtns.length);
    ok(!!d.querySelector("#adr044-drawer #adr044-memory"), "textarea 的 id 没被包裹改掉");

    console.log("\n── 浮窗 ──");
    click(d.querySelector("#adr048-fab")); await tick(400);
    const popTas = d.querySelectorAll("#adr048-popup-body textarea");
    const popBtns = d.querySelectorAll("#adr048-popup-body .adrx-ta > .adrx-expand");
    ok(popTas.length > 0 && popBtns.length === popTas.length + 2, "浮窗里每个文字框（+两个补充指令框）都有 ⛶", popTas.length + "/" + popBtns.length);

    const mem = d.querySelector("#adr048-popup-body #adr044-memory");
    click(mem.parentNode.querySelector(".adrx-expand")); await tick(50);
    let ed = d.querySelector("#adrx-editor");
    ok(!!ed, "点 ⛶ 打开整屏编辑器");
    ok(ed && ed.getAttribute("data-arb-theme") === "dusk", "浮窗里打开的编辑器跟随暗河主题");
    ok(ed && ed.querySelector(".adrx-editor-title").textContent.indexOf("角色卡要点") === 0, "标题取自上方 label", ed && ed.querySelector(".adrx-editor-title").textContent);
    let ta = ed.querySelector(".adrx-editor-ta");
    ok(ta.value === "旧的", "编辑器里预填原内容");
    ta.value = "新的\n第二行"; ta.dispatchEvent(new W.Event("input", { bubbles: true }));
    ok(ed.querySelector(".adrx-editor-count").textContent.indexOf("6") === 0, "字数实时更新", ed.querySelector(".adrx-editor-count").textContent);
    click(ed.querySelector(".adrx-editor-ok")); await tick(100);
    ok(!d.querySelector("#adrx-editor"), "确定后编辑器关闭");
    ok(mem.value === "新的\n第二行", "确定后内容回填原框（保留换行）");
    ok(e.st().supplementMemory === "新的\n第二行", "回填触发了原有自动保存链路（settings 已更新）", e.st().supplementMemory);

    click(mem.parentNode.querySelector(".adrx-expand")); await tick(50);
    ed = d.querySelector("#adrx-editor"); ta = ed.querySelector(".adrx-editor-ta");
    ta.value = "不该保存"; click(ed.querySelector(".adrx-editor-cancel")); await tick(50);
    ok(!d.querySelector("#adrx-editor") && mem.value === "新的\n第二行", "取消不回填");

    click(mem.parentNode.querySelector(".adrx-expand")); await tick(50);
    d.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ok(!d.querySelector("#adrx-editor"), "ESC 关闭编辑器");

    const extra = d.querySelector("#adr048-popup-body #adr044-emotion-extra");
    ok(!!extra && !!extra.parentNode.querySelector(".adrx-expand"), "单行补充指令框也有 ⛶");
    click(extra.parentNode.querySelector(".adrx-expand")); await tick(50);
    ed = d.querySelector("#adrx-editor"); ta = ed.querySelector(".adrx-editor-ta");
    ta.value = "第一行\n第二行"; click(ed.querySelector(".adrx-editor-ok")); await tick(50);
    ok(extra.value === "第一行 第二行", "单行框回填时换行换成空格", extra.value);

    // 抽卡编辑区：回填触发 600ms 防抖写库
    click(d.querySelector("#adr044-tab-cd")); await tick(100);
    const lib = d.querySelector("#adr048-popup-body #adr044-cd-lib-editor");
    click(lib.parentNode.querySelector(".adrx-expand")); await tick(50);
    ed = d.querySelector("#adrx-editor"); ta = ed.querySelector(".adrx-editor-ta");
    ta.value = "## 测试池\n一张卡"; click(ed.querySelector(".adrx-editor-ok")); await tick(900);
    const libs = e.st().cdLibraries || {};
    const name = d.querySelector("#adr048-popup-body #adr044-cd-edit-select").value;
    ok(libs[name] === "## 测试池\n一张卡", "卡库编辑区回填后写进了卡库存档", name + " → " + String(libs[name]).slice(0, 20));

    // 重开浮窗后按钮照常在，且不重复
    click(d.querySelector("#adr048-popup-close")); await tick(100);
    click(d.querySelector("#adr048-fab")); await tick(400);
    const mem2 = d.querySelector("#adr048-popup-body #adr044-memory");
    ok(mem2.parentNode.querySelectorAll(".adrx-expand").length === 1, "重开浮窗后每个框仍只有一枚 ⛶");
    ok(d.querySelectorAll("#adr044-drawer #adr044-memory + .adrx-expand, #adr044-drawer .adrx-ta .adrx-expand").length === drawerBtns.length, "抽屉侧按钮数不变（幂等）");

    console.log("\n── iOS 可视视口 ──");
    const vv = W.visualViewport;
    click(mem2.parentNode.querySelector(".adrx-expand")); await tick(50);
    ed = d.querySelector("#adrx-editor");
    ok(ed.style.getPropertyValue("height") === "844px" && ed.style.getPropertyValue("top") === "0px", "打开时按可视视口定位", ed.style.cssText);
    vv.offsetTop = 260; vv.height = 420; vv.fire("resize"); vv.fire("scroll");
    ok(ed.style.getPropertyValue("top") === "260px" && ed.style.getPropertyValue("height") === "420px", "键盘弹出（视口缩小并上顶）后编辑器跟着钉住", ed.style.cssText);
    vv.offsetTop = 0; vv.height = 844; vv.fire("resize");
    ok(ed.style.getPropertyValue("top") === "0px" && ed.style.getPropertyValue("height") === "844px", "收键盘后回到整屏");
    click(ed.querySelector(".adrx-editor-cancel")); await tick(50);
    ok((vv.handlers.resize || []).length === 0 && (vv.handlers.scroll || []).length === 0, "关闭后视口监听全部摘掉");

    console.log("\n通过 " + PASS + " · 失败 " + FAIL);
    process.exit(FAIL ? 1 : 0);
})();
