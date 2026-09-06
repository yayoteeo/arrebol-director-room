// v1.24.0 测试：导演的记忆搬进聊天文件 · 显示只读 · 面板手感。
// 跑法同其余四套：npm install jsdom && SPEED=10 node test_v124.js
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";
const BACKUP_KEY = "arrebol-d-final-v1040-stable-settings-backup";
const D_META_KEY = "arrebol_d";
const D_META_LS_KEY = "arrebol_d_chat_v1";
const FLOAT_EP_KEY = "ARREBOL_D_DIRECTOR_FLOAT";

let PASS = 0, FAIL = 0; const failures = [];
function ok(c, name, extra) {
    if (c) { PASS++; console.log("  ✓ " + name); }
    else { FAIL++; failures.push(name); console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n── " + t + " ──"); }
const SPEED = Number(process.env.SPEED || 1);
const tick = ms => new Promise(r => setTimeout(r, Math.max(1, Math.round(ms / SPEED))));
async function waitFor(fn, maxMs) {
    const t0 = Date.now(); const cap = Math.max(1, Math.round((maxMs || 30000) / SPEED));
    while (Date.now() - t0 < cap) { if (fn()) return true; await new Promise(r => setTimeout(r, 20)); }
    return !!fn();
}

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    const chat = opts.chat || [], prompts = {}, extensionSettings = {}, handlers = {};
    let chatMetadata = opts.metadata || {};
    let chatId = opts.chatId || "chat-a";
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;
    if (opts.localStorage) for (const k in opts.localStorage) win.localStorage.setItem(k, opts.localStorage[k]);

    const calls = [], logs = [], observed = [];
    let backupReads = 0;
    let script = () => "【情感方向】\n维持";
    const origGet = win.Storage.prototype.getItem;
    win.Storage.prototype.getItem = function (k) { if (k === BACKUP_KEY) backupReads++; return origGet.call(this, k); };
    const origObserve = win.MutationObserver.prototype.observe;
    win.MutationObserver.prototype.observe = function (target, options) { observed.push({ target: target === win.document.body ? "body" : "other", options }); return origObserve.call(this, target, options); };

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, sys: body.messages[0].content, user: body.messages[1].content, body });
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: script(calls.length, body) } }] }) };
    };
    win.console = {
        log(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        warn(...a) { logs.push("W " + a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error(...a) { logs.push("E " + a.map(x => String(x)).join(" ")); }, info() {}, debug() {}
    };
    const context = {
        extensionSettings, chat,
        get chatMetadata() { return chatMetadata; },
        get chatId() { return chatId; }, getCurrentChatId: () => chatId,
        name1: "江", name2: "陆冀北",
        saveSettingsDebounced() {}, saveSettings() {}, saveMetadataDebounced() {}, saveMetadata() {},
        saveChat: async () => {},
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; }, extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }, substituteParams: s => s,
        updateMessageBlock() {},
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received", CHAT_CHANGED: "chat_changed", MESSAGE_DELETED: "message_deleted" }
    };
    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);
    return {
        win, doc: win.document, context, prompts, calls, logs, chat, observed,
        get backupReads() { return backupReads; }, resetBackupReads() { backupReads = 0; },
        setScript(f) { script = f; },
        meta: () => chatMetadata, dmeta: () => chatMetadata[D_META_KEY],
        switchChat(id, metadata, newChat) { chatId = id; chatMetadata = metadata; if (newChat) { chat.length = 0; newChat.forEach(m => chat.push(m)); } },
        ls: k => win.localStorage.getItem(k),
        addRound() {
            chat.push({ is_user: true, mes: "他把话说到一半就停住了。" });
            const mes = "<content>屋里安静下来，谁都没有先开口。</content>";
            chat.push({ is_user: false, name: "陆冀北", mes, swipe_id: 0, swipes: [mes] });
        },
        emit(t, ...args) { (handlers[t] || []).forEach(f => { try { f(...args); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        lastAi() { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return chat[i]; return null; },
        counterText(type) { const el = this.doc.querySelector("#adr044-auto-counter-" + type); return el ? el.textContent : ""; }
    };
}

const DIRECTOR = {
    masterEnabled: true, autoInjectEmotion: true, autoTriggerEmotion: true, autoTriggerEmotionRange: "custom", autoTriggerEmotionCustomRange: 2,
    showAutoTriggerPopup: false, emotionApiEndpoint: "https://dir.example/v1", emotionApiKey: "k", emotionModel: "m",
    directorLogEnabled: true, floatInjectEnabled: true, cdEnabled: false
};
function roundMsgs(n) { const out = []; for (let i = 0; i < n; i++) { const mes = "<content>第 " + (i + 1) + " 楼。</content>"; out.push({ is_user: true, mes: "问。" }); out.push({ is_user: false, name: "陆冀北", mes, swipe_id: 0, swipes: [mes] }); } return out; }
const clone = o => JSON.parse(JSON.stringify(o));

(async () => {
    // ───────────────────────────────────────────────
    section("基准线 · 住进聊天文件");
    let metaAfterA = null;
    {
        const b = build({ settings: clone(DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.dmeta() && b.dmeta().auto && b.dmeta().auto.emotion && b.dmeta().auto.emotion.base === 1, 30000), "第一次检查把基准线写进 chat_metadata.arrebol_d", JSON.stringify(b.dmeta()));
        const mirror = JSON.parse(b.ls(D_META_LS_KEY) || "{}");
        ok(mirror["chat-a"] && mirror["chat-a"].auto.emotion.base === 1, "localStorage 只留一份按 chatKey 的镜像");
        ok(!b.ls("arrebol_d_auto_trigger_state_v1") && !b.ls("arrebol_d_auto_trigger_last_key_v1"), "旧的 LS 基准线键不再被写");
        b.addRound(); b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.calls.length === 1 && b.lastAi().mes.indexOf("arrebol_d_visible:emotion###") >= 0, 30000), "到点触发并注入");
        await waitFor(() => b.dmeta().auto.emotion.base === 3, 15000);
        const d = b.dmeta();
        ok(d.auto.emotion.base === 3, "结算后基准线前移到 3", JSON.stringify(d.auto));
        ok(d.log.emotion.length === 1 && d.log.emotion[0].text.indexOf("【情感方向】") >= 0, "跟组记录在聊天文件里");
        ok(d.float && d.float.type === "emotion" && d.float.text.indexOf("最新指导（常驻）") >= 0, "常驻贴耳稿在聊天文件里");
        ok(b.prompts[FLOAT_EP_KEY] && b.prompts[FLOAT_EP_KEY].value === d.float.text, "贴耳稿同时挂在扩展提示词通道");
        metaAfterA = clone(b.meta());
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("换设备 · 只有聊天文件、浏览器一片空白");
    {
        const b = build({ settings: clone(DIRECTOR), metadata: clone(metaAfterA), chat: roundMsgs(3) });
        b.setScript(() => "【情感方向】\n第二次");
        b.emit("app_ready");
        ok(await waitFor(() => b.prompts[FLOAT_EP_KEY] && b.prompts[FLOAT_EP_KEY].value.indexOf("最新指导（常驻）") >= 0, 20000), "启动即恢复贴耳稿（旧版换设备后这里是空的）");
        ok(!b.ls("arrebol_d_float_note_v1") && !b.ls("arrebol_d_director_log_v1"), "没碰过旧键");
        b.addRound(); b.emit("message_received"); await tick(9000);
        ok(b.calls.length === 0 && b.dmeta().auto.emotion.base === 3, "基准线接着 3 数，第 4 楼不触发（旧版换设备后会重新对齐甚至误触发）", "calls=" + b.calls.length + " base=" + b.dmeta().auto.emotion.base);
        b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.calls.length === 1, 30000), "第 5 楼按原节奏触发");
        ok(b.calls[0].user.indexOf("【跟组记录｜你此前已下达的 1 条指导") >= 0, "导演记得自己在另一台设备上下过的指导");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("老存档 · 从浏览器旧键搬家一次");
    {
        const legacy = {};
        legacy["arrebol_d_auto_trigger_state_v1"] = JSON.stringify({ "chat-a::emotion": { base: 7, updatedAt: 1, broad: "char::x", mode: "window-v1" }, "other::emotion": { base: 99 } });
        legacy["arrebol_d_director_log_v1"] = JSON.stringify({ "chat-a::emotion": [{ t: 1, floor: 7, text: "旧指导一" }, { t: 2, floor: 5, text: "旧指导二" }] });
        legacy["arrebol_d_float_note_v1"] = JSON.stringify({ "chat-a": { t: 1, type: "emotion", text: "【暗河红霞 Arrebol D｜情感导演·最新指导（常驻）】\n旧贴耳稿" } });
        legacy["arrebol_d_graze_v1"] = JSON.stringify({ "chat-a::plot": { on: true, t: 1, floor: 7 } });
        const b = build({ settings: clone(DIRECTOR), localStorage: legacy, chat: roundMsgs(8) });
        b.emit("app_ready");
        await waitFor(() => b.dmeta() && b.dmeta().auto && b.dmeta().auto.emotion, 20000);
        const d = b.dmeta();
        ok(d && d.auto.emotion && d.auto.emotion.base === 7, "旧基准线 7 搬进聊天文件", JSON.stringify(d && d.auto));
        ok(d && !d.auto.plot, "别的聊天的记录（other::）没被误搬");
        ok(d && d.log.emotion.length === 2 && d.log.emotion[1].text === "旧指导二", "旧跟组记录搬进来了");
        ok(d && d.float && d.float.text.indexOf("旧贴耳稿") >= 0, "旧贴耳稿搬进来了");
        ok(d && d.graze.plot && d.graze.plot.on === true, "放养标记搬进来了");
        ok(await waitFor(() => b.prompts[FLOAT_EP_KEY] && b.prompts[FLOAT_EP_KEY].value.indexOf("旧贴耳稿") >= 0, 20000), "搬家当场就把旧贴耳稿挂上");
        ok(b.logs.some(l => l.indexOf("导演记忆已从浏览器搬进聊天文件") >= 0), "日志说了一声");
        ok(JSON.parse(b.ls("arrebol_d_auto_trigger_state_v1"))["chat-a::emotion"].base === 7, "旧键原样留着，回退 1.23 仍可用");
        b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.calls.length === 1, 30000), "第 9 楼＝7+2，按老进度到点触发（进度没丢）");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("两把聊天 · 各记各的，不靠猜");
    {
        const b = build({ settings: clone(DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.dmeta() && b.dmeta().auto.emotion, 30000);
        const metaA = b.meta();
        // 同角色、更长的另一把聊天，聊天文件里没有导演记录
        b.switchChat("chat-b", {}, roundMsgs(30));
        b.emit("chat_changed");
        ok(await waitFor(() => b.dmeta() && b.dmeta().auto.emotion && b.dmeta().auto.emotion.base === 30, 30000), "新聊天从自己的当前楼数起步（旧版会继承 chat-a 的 base=1 然后立刻触发）", JSON.stringify(b.dmeta() && b.dmeta().auto));
        await tick(9000);
        ok(b.calls.length === 0, "没有莫名触发", "calls=" + b.calls.length);
        b.switchChat("chat-a", metaA, roundMsgs(1));
        b.emit("chat_changed"); await tick(9000);
        ok(b.dmeta().auto.emotion.base === 1, "切回 chat-a，基准线还是 1");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("计数显示 · 只读，不再顺手建账");
    {
        const b = build({ settings: clone(DIRECTOR), chat: roundMsgs(5) });
        b.emit("app_ready"); await tick(2000);
        // 页面刚载入的 20 秒启动保护期（真实时间，不受 SPEED 影响）里，计数条走只读 peek 分支
        ok(b.counterText("emotion").indexOf("启动保护") >= 0, "第一次检查之前计数条走只读分支（启动保护）", b.counterText("emotion").slice(0, 40));
        ok(!b.dmeta(), "显示没有往聊天文件里写任何东西", JSON.stringify(b.dmeta()));
        ok(await waitFor(() => b.dmeta() && b.dmeta().auto.emotion && b.dmeta().auto.emotion.base === 5, 30000), "轮询带来的第一次检查才建账，基准线 = 当前 5 楼");
        await waitFor(() => b.counterText("emotion").indexOf("0/2") >= 0 || b.counterText("emotion").indexOf("已攒") >= 0, 15000);
        ok(b.counterText("emotion").indexOf("等第一次检查对表") < 0, "建账后计数条正常显示", b.counterText("emotion").slice(0, 40));
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("删楼 · 基准线在聊天文件里照样位移");
    {
        const b = build({ settings: clone(DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.addRound(); b.addRound(); b.emit("message_received");
        await waitFor(() => b.dmeta() && b.dmeta().auto.emotion && b.dmeta().auto.emotion.base === 3, 30000);
        await tick(10000);
        b.chat.splice(2, 4);                      // 删掉两轮
        b.emit("message_deleted");
        ok(await waitFor(() => b.dmeta().auto.emotion.base === 1, 30000), "删两楼，基准线 3 → 1", JSON.stringify(b.dmeta().auto.emotion));
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("面板手感 · 备份不再每次解析、观察器不再盯整棵树");
    {
        const b = build({ settings: clone(DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        b.resetBackupReads();
        for (let i = 0; i < 3; i++) { b.addRound(); b.emit("message_received"); await tick(9000); }
        ok(b.backupReads <= 3, "一整段自动触发流程里备份最多读几次（旧版几十上百次）", "reads=" + b.backupReads);
        const bodyObs = b.observed.filter(o => o.target === "body");
        ok(bodyObs.length >= 1 && bodyObs.every(o => o.options && o.options.subtree === false), "body 上的观察器只盯直接子节点", JSON.stringify(bodyObs.map(o => o.options)));
        b.killPoll();
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
