// v1.23.2 测试：全盘审读热修的回归。
// 每一条都对着当时复现出来的现象写：先能抓到旧 bug，再证明新版不犯。
// 跑法同其余三套：npm install jsdom && SPEED=10 node test_hotfix.js
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";
const META_KEY = "arrebol_d_cd";

let PASS = 0, FAIL = 0; const failures = [];
function ok(c, name, extra) {
    if (c) { PASS++; console.log("  ✓ " + name); }
    else { FAIL++; failures.push(name); console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n── " + t + " ──"); }
const SPEED = Number(process.env.SPEED || 1);
const tick = ms => new Promise(r => setTimeout(r, Math.max(1, Math.round(ms / SPEED))));
// 事件防抖 4.2s 会被 9s 轮询反复顺延，固定等几秒不可靠；条件满足就走，超时才判失败。
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
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    const calls = [], logs = [], redrawn = [], popups = [];
    let reloads = 0, saves = 0;
    let script = () => "1";
    let delayMs = 0;
    let failNext = false;

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const rec = { url, sys: body.messages[0].content, user: body.messages[1].content, body };
        calls.push(rec);
        if (delayMs) await tick(delayMs);
        if (failNext) throw new Error("mock API down");
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: script(calls.length, body) } }] })
        };
    };
    win.console = {
        log(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        warn(...a) { logs.push("W " + a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error(...a) { logs.push("E " + a.map(x => String(x)).join(" ")); }, info() {}, debug() {}
    };
    if (opts.reloadCurrentChat !== false) win.reloadCurrentChat = () => { reloads++; };

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "hotfix-test", getCurrentChatId: () => "hotfix-test",
        name1: opts.name1 || "江", name2: opts.name2 || "陆冀北",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        saveChat: async () => { saves++; },
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received", GENERATION_STARTED: "generation_started", GENERATION_ENDED: "generation_ended" }
    };
    if (opts.updateMessageBlock !== false) context.updateMessageBlock = (i, m) => { redrawn.push(i); };

    // 数失败弹窗：data-kind 在 appendChild 之前就设好了
    const origAppend = win.document.body.appendChild.bind(win.document.body);
    win.document.body.appendChild = function (el) {
        try { if (el && el.id === "adr044-auto-trigger-popup") popups.push(el.getAttribute("data-kind") || "info"); } catch (e) {}
        return origAppend(el);
    };

    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);

    return {
        win, doc: win.document, context, prompts, calls, logs, redrawn, popups, chat,
        get reloads() { return reloads; }, get saves() { return saves; },
        setScript(f) { script = f; }, setDelay(ms) { delayMs = ms; }, setFail(v) { failNext = v; },
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        addRound(userText, aiText) {
            chat.push({ is_user: true, mes: userText || "他把话说到一半就停住了。" });
            const mes = aiText || "<content>屋里安静下来，谁都没有先开口。</content>";
            chat.push({ is_user: false, name: "陆冀北", mes, swipe_id: 0, swipes: [mes] });
        },
        emit(t, ...args) { (handlers[t] || []).forEach(f => { try { f(...args); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        lastAi() { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return chat[i]; return null; }
    };
}

const CD_LIBS = {
    "通用": "## 意外\n门房捎来一句口信：三天前就该到的人，今晚到了。\n后厨传来一声碎响。\n## 转折\n那把椅子今天有人坐了。\n价钱临场翻了一倍。",
    "夜库": "## 夜一\n灯没关，门没锁，话说了一半。\n## 夜二\n二号卡面\n## 夜三\n三号卡面\n## 夜四\n四号卡面"
};
const CD_HOMES = { "通用": "common", "夜库": "nsfw" };

(async () => {
    // ───────────────────────────────────────────────
    section("冷却区 · 填 0 就是没有冷却");
    {
        const b = build({});
        const pick = b.win.__adrCdTest.pickFromPool;
        const cards = ["A", "B", "C", "D"];
        const got = {};
        for (let i = 0; i < 400; i++) { const c = pick(cards, ["A", "B", "C"], 0); got[c] = (got[c] || 0) + 1; }
        ok(Object.keys(got).length === 4, "冷却 0 时四张都抽得到（旧版只出 D）", JSON.stringify(got));
        ok(Object.values(got).every(n => n > 40), "分布大致均匀", JSON.stringify(got));
        const got8 = {};
        for (let i = 0; i < 200; i++) { const c = pick(cards, ["A", "B", "C"], 8); got8[c] = (got8[c] || 0) + 1; }
        ok(Object.keys(got8).join("") === "D", "冷却 8、池只有 4 张 → 自动降到 3，仍只出 D（老行为不变）", JSON.stringify(got8));
        b.emit("app_ready"); await tick(3000);
        const inp = b.doc.querySelector("#adr044-cd-cooldown");
        ok(inp && inp.getAttribute("max") === "32", "面板冷却上限与 32 张缓冲对齐", inp && inp.getAttribute("max"));
        const san = b.win.__adrCdTest.sanitizePickResponse;
        ok(san("通用・意外", ["通用·意外"]) === "通用·意外", "答复里的「・」认成「·」");
        ok(san("「通用•意外」。", ["通用·意外"]) === "通用·意外", "「•」＋括号标点一并清掉");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("择卡候选 · NSFW 池不再只取前两个");
    {
        const b = build({ settings: {
            cdEnabled: true, cdN: 2, cdMode: "pickcard", cdApiEndpoint: "https://ds.example/v1", cdApiKey: "k",
            cdLibraries: CD_LIBS, cdLibHomes: CD_HOMES,
            cdSlotDefaults: { story: "", common: "通用", nsfw: "夜库" }, cdSlotOnDefaults: { story: false, common: true, nsfw: true }
        } });
        b.setScript(() => "1");
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 1, 30000);
        for (let i = 0; i < 16; i++) {
            const before = b.calls.length;
            b.addRound(); b.addRound(); b.emit("message_received");
            await waitFor(() => b.calls.length > before, 30000);
        }
        const seen = {};
        b.calls.forEach(c => (c.user.match(/【NSFW·夜[一二三四]】/g) || []).forEach(m => { seen[m] = 1; }));
        ok(Object.keys(seen).length === 4, "16 拍里四个 NSFW 池都进过候选（旧版永远只有夜一夜二）", Object.keys(seen).join(" "));
        ok(b.calls.every(c => (c.user.match(/【NSFW·/g) || []).length <= 2), "每拍仍只放两个 NSFW 占位");
        ok(b.calls.every(c => c.user.indexOf("灯没关，门没锁") < 0 && c.user.indexOf("号卡面") < 0), "NSFW 卡面照旧一个字不外传");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("兑现判定 · NSFW 卡不问小眼睛");
    {
        const b = build({ settings: {
            cdEnabled: true, cdN: 2, cdMode: "blind", cdAutoDone: true, cdLifeMode: "half",
            cdApiEndpoint: "https://ds.example/v1", cdApiKey: "k",
            cdLibraries: { "夜库": "## 夜\n灯没关，门没锁，话说了一半。" }, cdLibHomes: { "夜库": "nsfw" },
            cdSlotDefaults: { story: "", common: "", nsfw: "夜库" }, cdSlotOnDefaults: { story: false, common: false, nsfw: true }
        } });
        b.setScript(() => "否");
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 1, 30000);                 // 基准线
        b.addRound(); b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 3, 30000);                 // 第 3 楼投卡
        b.addRound(); b.emit("message_received");                                            // 第 4 楼到半衰期
        ok(await waitFor(() => b.meta() && b.meta().floatStage === "faded", 30000), "半衰期到了照常降级为背景", b.meta() && b.meta().floatStage);
        ok(b.calls.length === 0, "一次小眼睛调用都没发（旧版把卡面全文发出去了）", "calls=" + b.calls.length);
        ok(b.logs.some(l => l.indexOf("NSFW 卡不问小眼睛") >= 0), "日志说清了为什么没问");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("兑现判定 · 通用卡照常问");
    {
        const b = build({ settings: {
            cdEnabled: true, cdN: 2, cdMode: "blind", cdAutoDone: true, cdLifeMode: "half",
            cdApiEndpoint: "https://ds.example/v1", cdApiKey: "k",
            cdLibraries: { "通用": CD_LIBS["通用"] }, cdLibHomes: { "通用": "common" },
            cdSlotDefaults: { story: "", common: "通用", nsfw: "" }, cdSlotOnDefaults: { story: false, common: true, nsfw: false }
        } });
        b.setScript(() => "是");
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 1, 30000);
        b.addRound(); b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 3, 30000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.calls.length >= 1, 30000);
        ok(b.calls.length === 1 && b.calls[0].user.indexOf("【待发生事件】") >= 0, "通用卡问了一次", "calls=" + b.calls.length);
        ok(await waitFor(() => b.meta() && b.meta().floatStage === "done", 30000), "小眼睛说是 → 自动结案", b.meta() && b.meta().floatStage);
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("生命周期 · 问询期间不重入、被挡的检查会补查");
    {
        const b = build({ settings: {
            cdEnabled: true, cdN: 4, cdMode: "blind", cdAutoDone: true, cdLifeMode: "half",
            cdApiEndpoint: "https://ds.example/v1", cdApiKey: "k",
            cdLibraries: { "通用": "## 意外\n卡一\n卡二\n卡三\n卡四\n卡五\n卡六" }, cdLibHomes: { "通用": "common" },
            cdSlotDefaults: { story: "", common: "通用", nsfw: "" }, cdSlotOnDefaults: { story: false, common: true, nsfw: false }
        } });
        b.setScript(() => "否");
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received");
        await waitFor(() => b.meta() && b.meta().lastDrawAt === 1, 30000);            // 基准线 1
        for (let i = 0; i < 4; i++) b.addRound();
        b.emit("message_received");
        ok(await waitFor(() => b.meta() && b.meta().lastDrawAt === 5, 30000), "第 5 楼投下第一张", JSON.stringify(b.meta() && b.meta().lastDrawAt));
        b.setDelay(8000);                                                       // 小眼睛很慢
        b.addRound(); b.addRound();                                             // 第 7 楼 → 半衰期，进入问询
        b.emit("message_received");
        ok(await waitFor(() => b.calls.length === 1, 30000), "问询已发出一次", "calls=" + b.calls.length);
        b.addRound(); b.addRound();                                             // 第 9 楼 → 到投卡点，问询还没回
        b.emit("message_received"); await tick(4500); b.emit("message_received"); await tick(3000);
        ok(b.calls.length === 1, "问询没回之前，新来的检查不会再问一次（旧版并发进来重复扣费）", "calls=" + b.calls.length);
        ok(await waitFor(() => b.meta() && b.meta().lastDrawAt === 9, 40000), "问询回来后被挡的检查自动补查，第 9 楼的新卡投下了", JSON.stringify(b.meta() && b.meta().lastDrawAt));
        ok(b.meta() && b.meta().floatStage === "active", "新卡是 active，没被旧卡的判定误伤", b.meta() && b.meta().floatStage);
        ok(b.calls.length === 1, "全程只问了一次", "calls=" + b.calls.length);
        b.killPoll();
    }

    section("API 地址 · 只在没有版本段时补 /v1");
    {
        const cases = [
            ["https://api.deepseek.com", "https://api.deepseek.com/v1/chat/completions"],
            ["https://api.deepseek.com/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"],
            ["https://generativelanguage.googleapis.com/v1beta/openai/", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
            ["https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
            ["https://ark.cn-beijing.volces.com/api/v3/chat/completions", "https://ark.cn-beijing.volces.com/api/v3/chat/completions"]
        ];
        for (const [inp, want] of cases) {
            const b = build({ settings: {
                cdEnabled: true, cdN: 1, cdMode: "pick", cdApiEndpoint: inp, cdApiKey: "k",
                cdLibraries: { "通用": CD_LIBS["通用"] }, cdLibHomes: { "通用": "common" },
                cdSlotDefaults: { story: "", common: "通用", nsfw: "" }, cdSlotOnDefaults: { story: false, common: true, nsfw: false }
            } });
            b.setScript(() => "通用·意外");
            b.emit("app_ready"); await tick(3000);
            b.addRound(); b.emit("message_received");
            await waitFor(() => b.meta() && b.meta().lastDrawAt === 1, 30000);
            b.addRound(); b.emit("message_received");
            await waitFor(() => b.calls.length >= 1, 30000);
            ok(b.calls.length && b.calls[0].url === want, inp + " → " + want, b.calls.length ? b.calls[0].url : "no call");
            b.killPoll();
        }
    }

    // ───────────────────────────────────────────────
    section("esc · 库名里的引号撕不开属性");
    {
        const evil = 'x" onmouseover="alert(1)';
        const libs = { "通用": CD_LIBS["通用"] }; libs[evil] = "## 池\n一张卡";
        const b = build({ settings: {
            cdEnabled: true, cdLibraries: libs, cdLibHomes: { "通用": "common" },
            cdSlotDefaults: { story: "", common: "通用", nsfw: "" }, cdSlotOnDefaults: { story: false, common: true, nsfw: false }
        } });
        b.emit("app_ready"); await tick(3000);
        const chip = Array.from(b.doc.querySelectorAll("[data-adrcd-lib]")).find(el => el.getAttribute("data-adrcd-lib") === evil);
        ok(!!chip, "芯片属性里原样保住了带引号的库名");
        ok(chip && !chip.hasAttribute("onmouseover"), "没有被撕出 onmouseover 属性");
        const opt = Array.from(b.doc.querySelectorAll("#adr044-cd-edit-select option")).find(o => o.value === evil);
        ok(!!opt, "下拉 option 的 value 也完整");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    const DIRECTOR = {
        masterEnabled: true, autoInjectEmotion: true, autoTriggerEmotion: true, autoTriggerEmotionRange: "custom", autoTriggerEmotionCustomRange: 2,
        showAutoTriggerPopup: false, emotionApiEndpoint: "https://dir.example/v1", emotionApiKey: "k", emotionModel: "m",
        cdEnabled: false
    };
    async function primeDirector(b) {
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received"); await tick(6000);   // 基准线
        b.addRound(); b.addRound(); b.emit("message_received");       // 到点
        await waitFor(() => b.calls.length >= 1, 30000);
        await waitFor(() => b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible") >= 0, 30000);
        await tick(1500);   // saveChat 落定后 180ms 才重绘
    }

    section("导演 · 用户名是 name1，不是角色名");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR), name1: "江", name2: "陆冀北" });
        b.setScript(() => "【情感方向】\n维持\n【人设边界】\n无\n【避免】\n无");
        await primeDirector(b);
        ok(b.calls.length === 1, "情感导演到点触发了一次", "calls=" + b.calls.length);
        const u = b.calls[0] ? b.calls[0].user : "";
        ok(u.indexOf("【用户名称】\n江") >= 0, "采买清单里用户名称是「江」");
        ok(u.indexOf("【用户名称】\n陆冀北") < 0, "不再把角色名当用户名（旧版如此）");
        b.killPoll();
    }

    section("导演 · 注入同写 swipes，重绘只画一楼");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setScript(() => "【情感方向】\n降温");
        await primeDirector(b);
        const m = b.lastAi();
        ok(m && m.mes.indexOf("arrebol_d_visible:emotion###") >= 0, "稿子写进了最后一个助手楼");
        ok(m && m.swipes[m.swipe_id] === m.mes, "swipes[swipe_id] 与 mes 一致，翻页回来稿还在（旧版只写 mes）");
        ok(b.redrawn.length >= 1 && b.reloads === 0, "用 updateMessageBlock 重画那一楼，没有整聊天重载", "redrawn=" + b.redrawn.length + " reloads=" + b.reloads);
        b.killPoll();
    }

    section("导演 · 老酒馆没有 updateMessageBlock 时仍整体重载");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR), updateMessageBlock: false });
        b.setScript(() => "【情感方向】\n降温");
        await primeDirector(b);
        ok(b.reloads >= 1, "兜底路径还在", "reloads=" + b.reloads);
        b.killPoll();
    }

    section("导演 · 生成中不写楼，等写完再挂");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setScript(() => "【情感方向】\n延迟");
        b.setDelay(8000);
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received"); await tick(6000);
        b.addRound(); b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.calls.length === 1, 30000), "导演在飞", "calls=" + b.calls.length);
        b.emit("generation_started", "normal", {}, false);                          // 用户没等，开始生成下一楼
        b.addRound("下一句。", "<content>正在写……</content>");
        await tick(12000);                                                          // 导演早回来了
        const streaming = b.lastAi();
        ok(streaming.mes.indexOf("arrebol_d_visible") < 0, "生成中：稿子没有写进正在生成的楼", streaming.mes.slice(0, 40));
        b.emit("generation_ended");
        ok(await waitFor(() => b.lastAi().mes.indexOf("arrebol_d_visible:emotion###") >= 0, 15000), "生成结束后才挂上");
        b.killPoll();
    }

    section("导演 · 拍子按基准线建键：API 挂着时不每楼弹一次");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setFail(true);
        b.emit("app_ready"); await tick(3000);
        b.addRound(); b.emit("message_received"); await tick(6000);
        for (let i = 0; i < 4; i++) {
            const before = b.calls.length;
            b.addRound(); b.emit("message_received");
            await waitFor(() => b.calls.length > before, 30000);
        }
        const errs = b.popups.filter(k => k === "error").length;
        ok(b.calls.length >= 3, "到点后每楼都重试了（失败保拍）", "calls=" + b.calls.length);
        ok(errs === 1, "失败首报只弹了一次（旧版每楼一个新拍子、每楼弹一次）", "error popups=" + errs);
        b.setFail(false);
        b.addRound(); b.emit("message_received");
        ok(await waitFor(() => b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible:emotion###") >= 0, 30000), "API 恢复后这一拍结算成功");
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("死代码 · 已清");
    {
        for (const n of ["escapeHtmlForDetails", "saveChatSafe", "refreshMessageDom", "adrCdMarkTopHistory", "adrCdFindMountedSlot", "adr048RemoveOldFloatingBits"]) {
            ok(SRC.indexOf("function " + n + "(") < 0, n + " 不在了");
        }
        ok(SRC.indexOf("var floorNow") < 0, "floorNow 不在了");
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
