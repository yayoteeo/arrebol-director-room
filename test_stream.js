// v1.27.0–1.27.1 测试：导演请求改流式接收，以及流式开关。
// 收集器是纯函数，先直接喂假流；再用 jsdom 桩子真跑 index.js，把流式响应、整份 JSON 响应、
// 只回思考的响应、半路断流四种情形各走一遍导演自动触发。
// 跑法同其余几套：npm install jsdom && SPEED=10 node test_stream.js
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";

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

const enc = new TextEncoder();
function sse(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }
function delta(d, finish) { return sse({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: d, finish_reason: finish || null }] }); }

// 假响应体：按 pieces 逐块吐字节；hang=true 时最后一块之后永远不结束，等 signal.abort 才以 AbortError 拒绝。
function fakeBody(pieces, opts) {
    opts = opts || {};
    let i = 0;
    return {
        getReader() {
            return {
                read() {
                    if (i < pieces.length) {
                        const s = pieces[i++];
                        return new Promise(r => setTimeout(() => r({ done: false, value: enc.encode(s) }), Math.max(1, Math.round((opts.gapMs || 5) / SPEED))));
                    }
                    if (opts.hang) {
                        return new Promise((_, rej) => {
                            const sig = opts.signal;
                            if (sig) sig.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
                        });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }
            };
        }
    };
}

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    win.TextDecoder = TextDecoder;   // jsdom 不带，真浏览器都有
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    const calls = [], logs = [], popups = [];
    let responder = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "【情感方向】\n维持" } }] }) });

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        const rec = { url, body, headers: init.headers, signal: init.signal };
        calls.push(rec);
        return responder(rec);
    };
    win.console = {
        log(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        warn(...a) { logs.push("W " + a.map(String).join(" ")); },
        error(...a) { logs.push("E " + a.map(String).join(" ")); }, info() {}, debug() {}
    };
    win.reloadCurrentChat = () => {};

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "stream-test", getCurrentChatId: () => "stream-test",
        name1: "江", name2: "陆冀北",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        saveChat: async () => {},
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received", GENERATION_STARTED: "generation_started", GENERATION_ENDED: "generation_ended" },
        updateMessageBlock() {}
    };
    const origAppend = win.document.body.appendChild.bind(win.document.body);
    win.document.body.appendChild = function (el) {
        try { if (el && el.id === "adr044-auto-trigger-popup") popups.push(el.textContent || ""); } catch (e) {}
        return origAppend(el);
    };
    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);

    return {
        win, doc: win.document, calls, logs, popups, chat,
        setResponder(f) { responder = f; },
        addRound(userText, aiText) {
            chat.push({ is_user: true, mes: userText || "他把话说到一半就停住了。" });
            const mes = aiText || "<content>屋里安静下来，谁都没有先开口。</content>";
            chat.push({ is_user: false, name: "陆冀北", mes, swipe_id: 0, swipes: [mes] });
        },
        emit(t, ...args) { (handlers[t] || []).forEach(f => { try { f(...args); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        lastAi() { for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return chat[i]; return null; },
        statusText() { const el = win.document.querySelector("#adr044-emotion-status"); return el ? el.textContent : ""; }
    };
}

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
}

(async () => {
    // ───────────────────────────────────────────────
    section("收集器 · 思考跳过、正文拼好、[DONE] 收尾");
    {
        const b = build({});
        const col = b.win.__adrDStreamTest.collector();
        col.push(delta({ role: "assistant", content: "" }));
        col.push(delta({ reasoning_content: "先想一想这一幕的情绪走向……" }));
        col.push(delta({ reasoning_content: "再想想边界。" }));
        col.push(delta({ content: "【情感方向】\n" }));
        col.push(delta({ content: "维持" }, "stop"));
        col.push("data: [DONE]\n\n");
        col.end();
        ok(col.mode() === "sse", "认出是 SSE");
        ok(col.content() === "【情感方向】\n维持", "正文只拼 delta.content", JSON.stringify(col.content()));
        ok(col.reasoningChars() === 20, "思考只计字数不进正文", col.reasoningChars());
        ok(col.finish() === "stop", "finish_reason 记下了");
        ok(!col.error(), "没有报错");
    }

    section("收集器 · chunk 边界切在 JSON 中间、CRLF、多字节");
    {
        const b = build({});
        const col = b.win.__adrDStreamTest.collector();
        const whole = delta({ content: "红霞" }).replace(/\n/g, "\r\n") + delta({ content: "导演" }).replace(/\n/g, "\r\n") + "data: [DONE]\r\n\r\n";
        for (let i = 0; i < whole.length; i += 7) col.push(whole.slice(i, i + 7));
        col.end();
        ok(col.content() === "红霞导演", "7 字一刀切也拼得回来", JSON.stringify(col.content()));

        // 字节层面的切割交给 readBody：一个汉字三字节，切在中间不能变问号
        const bytes = enc.encode(delta({ content: "暗河" }));
        const pieces = [];
        for (let i = 0; i < bytes.length; i += 5) pieces.push(bytes.slice(i, i + 5));
        const col2 = b.win.__adrDStreamTest.collector();
        let k = 0;
        const res = { body: { getReader() { return { read() { return Promise.resolve(k < pieces.length ? { done: false, value: pieces[k++] } : { done: true }); } }; } } };
        await b.win.__adrDStreamTest.readBody(res, t => col2.push(t));
        col2.end();
        ok(col2.content() === "暗河", "UTF-8 多字节被切开也解得对", JSON.stringify(col2.content()));
    }

    section("收集器 · 整份 JSON 与流中报错");
    {
        const b = build({});
        const col = b.win.__adrDStreamTest.collector();
        col.push("  \n" + JSON.stringify({ choices: [{ message: { content: "整份" } }] }));
        col.end();
        ok(col.mode() === "json", "开头是 { 就按整份 JSON 走", col.mode());
        ok(col.content() === "", "JSON 模式不自己拼正文，交给 parseResponse");

        const col2 = b.win.__adrDStreamTest.collector();
        col2.push(delta({ content: "半" }));
        col2.push(sse({ error: { message: "upstream exploded" } }));
        col2.end();
        ok(col2.error() && col2.error().message.indexOf("upstream exploded") >= 0, "流里的 error 事件被抓住");
        ok(col2.content() === "半", "报错前收到的正文还在");

        ok(b.win.__adrDStreamTest.emptyHint(300, "length").indexOf("300 字思考") >= 0, "空正文提示写明思考字数");
        ok(b.win.__adrDStreamTest.emptyHint(0, "stop") === "", "正常收尾且没思考时不加提示");
    }

    // ───────────────────────────────────────────────
    section("导演 · 流式响应（带思考）照常注入");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setResponder(rec => ({
            ok: true, status: 200,
            body: fakeBody([
                delta({ role: "assistant", content: "" }),
                delta({ reasoning_content: "让我想想……" }),
                delta({ reasoning_content: "想好了。" }),
                delta({ content: "【情感方向】\n" }),
                delta({ content: "维持\n【人设边界】\n无" }, "stop"),
                "data: [DONE]\n\n"
            ]),
            text: async () => { throw new Error("流式下不该走 text()"); }
        }));
        await primeDirector(b);
        ok(b.calls.length === 1 && b.calls[0].body.stream === true, "请求体 stream:true", JSON.stringify(b.calls[0] && b.calls[0].body.stream));
        ok(b.calls[0].body.temperature === 0.6 && b.calls[0].body.messages.length === 2, "其余请求参数一字未变");
        ok(await waitFor(() => b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible") >= 0, 30000), "流式收完的稿注入了当前聊天");
        const mes = b.lastAi().mes;
        ok(mes.indexOf("【情感方向】") >= 0 && mes.indexOf("维持") >= 0, "稿子正文完整");
        ok(mes.indexOf("让我想想") < 0 && mes.indexOf("想好了") < 0, "思考内容没有混进稿子");
        b.killPoll();
    }

    section("导演 · 服务端不理 stream、回整份 JSON 也照常");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setResponder(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "【情感方向】\n维持" } }] }) }));
        await primeDirector(b);
        ok(await waitFor(() => b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible") >= 0, 30000), "老式整份 JSON（没有 body）仍注入");
        b.killPoll();
    }

    section("导演 · 只回思考不回正文，失败原因说清楚");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setResponder(() => ({
            ok: true, status: 200,
            body: fakeBody([delta({ reasoning_content: "想了很久很久很久很久" }), delta({}, "length"), "data: [DONE]\n\n"])
        }));
        await primeDirector(b);
        ok(await waitFor(() => b.statusText().indexOf("失败") >= 0, 30000), "状态行报了失败", b.statusText());
        const s = b.statusText();
        ok(s.indexOf("思考") >= 0 && s.indexOf("length") >= 0, "失败文案点名思考吃光额度与 length", s);
        ok(!(b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible") >= 0), "没有把空稿注进聊天");
        b.killPoll();
    }

    section("导演 · 半路断流：空闲 120 秒才判超时，收到一块就重新上表");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.setResponder(rec => ({
            ok: true, status: 200,
            body: fakeBody([delta({ content: "开了个头" })], { hang: true, signal: rec.signal })
        }));
        await primeDirector(b);
        // SPEED 缩放后 120s 空闲闸 = 120000/SPEED ms；先确认闸落下之前状态是"正在分析（已收到）"
        ok(await waitFor(() => b.statusText().indexOf("已收到") >= 0, 30000), "收到首块后状态行显示进度", b.statusText());
        ok(await waitFor(() => b.statusText().indexOf("失败") >= 0, 150000), "空闲超时后判失败", b.statusText());
        ok(b.statusText().indexOf("没有新内容") >= 0, "失败文案说明是流式接收中断", b.statusText());
        b.killPoll();
    }

    // ───────────────────────────────────────────────
    section("开关 · 关掉流式就回到 stream:false 老路");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR, { streamEnabled: false }) });
        b.setResponder(rec => ({
            ok: true, status: 200,
            body: fakeBody([JSON.stringify({ choices: [{ message: { content: "【情感方向】\n维持" } }] })])
        }));
        await primeDirector(b);
        ok(b.calls.length === 1 && b.calls[0].body.stream === false, "关掉开关后请求体 stream:false", JSON.stringify(b.calls[0] && b.calls[0].body.stream));
        ok(String(b.calls[0].headers.Accept || "").indexOf("event-stream") < 0, "Accept 头不再要 event-stream");
        ok(await waitFor(() => b.lastAi() && b.lastAi().mes.indexOf("arrebol_d_visible") >= 0, 30000), "整份 JSON 走 body 流读回来也照常注入");
        b.killPoll();
    }

    section("开关 · 默认开、面板里有勾选框、改动会存");
    {
        const b = build({ settings: Object.assign({}, DIRECTOR) });
        b.emit("app_ready"); await tick(3000);
        const boxes = Array.from(b.doc.querySelectorAll("#adr044-stream-enabled"));
        ok(boxes.length >= 1, "设置面板里有流式勾选框", "n=" + boxes.length);
        ok(boxes.every(x => x.checked), "老存档没这个字段时默认是开的");
        const box = boxes[0];
        box.checked = false; box.dispatchEvent(new b.win.Event("change", { bubbles: true }));
        await tick(500);
        const st = b.win.SillyTavern.getContext().extensionSettings[SET_KEY];
        ok(st && st.streamEnabled === false, "取消勾选立刻写进设置", JSON.stringify(st && st.streamEnabled));
        box.checked = true; box.dispatchEvent(new b.win.Event("change", { bubbles: true }));
        await tick(500);
        ok(st.streamEnabled === true, "再勾上也存回去");
        b.killPoll();
    }

    console.log("\n════════════════════════════════");
    console.log("通过 " + PASS + " · 失败 " + FAIL);
    if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
    console.log("════════════════════════════════");
    process.exit(FAIL ? 1 : 0);
})();
