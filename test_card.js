// v1.23.0 测试：择卡档 + 「看时机」出厂信封。
// 择卡是新链路，请求体、候选构成、弃权、越界答复、降级五条都要验；
// 信封那条重点验"老用户也能拿到"——这正是初版漏掉的地方。
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
// 时间加速：插件的事件防抖是 4.2s，逐楼真等会让整套跑好几分钟。
// 这里只压缩测试环境的定时器，插件代码一字不改；楼层节奏由事件驱动，与真实时长无关。
const SPEED = Number(process.env.SPEED || 1);
const tick = ms => new Promise(r => setTimeout(r, Math.max(1, Math.round(ms / SPEED))));

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window; win.top = win;
    const chat = [], prompts = {}, extensionSettings = {}, chatMetadata = {}, handlers = {};
    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    const calls = [], draws = [], logs = [];
    let script = () => "1";
    let failNext = false;

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ sys: body.messages[0].content, user: body.messages[1].content, body });
        if (failNext) throw new Error("mock DS down");
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: script(calls.length, body) } }] })
        };
    };
    win.console = {
        log(...a) { logs.push(String(a[0] || "")); if (String(a[0] || "").indexOf("投卡") >= 0 && a[1]) draws.push(a[1]); },
        warn(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error() {}, info() {}, debug() {}
    };

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "pc-test", getCurrentChatId: () => "pc-test",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: { APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received" }
    };
    if (SPEED > 1) {
        const rT = win.setTimeout.bind(win), rI = win.setInterval.bind(win);
        win.setTimeout = (fn, ms, ...a) => rT(fn, Math.max(0, Math.round((ms || 0) / SPEED)), ...a);
        win.setInterval = (fn, ms, ...a) => rI(fn, Math.max(1, Math.round((ms || 0) / SPEED)), ...a);
    }
    win.eval(SRC);

    return {
        win, doc: win.document, context, prompts, calls, draws, logs,
        setScript(f) { script = f; }, setFail(v) { failNext = v; },
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        addRound() {
            chat.push({ is_user: true, mes: "他把话说到一半就停住了。" });
            chat.push({ is_user: false, mes: "<content>屋里安静下来，谁都没有先开口。</content>" });
        },
        emit(t) { (handlers[t] || []).forEach(f => { try { f(); } catch (e) {} }); },
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        stop() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); } catch (e) {} dom.window.close(); }
    };
}
function tapFast(win, el) {
    el.__adrDLastAcceptedTapAt = 0; el.__adrDLastTouchEndAt = 0; el.__adrDTapStart = null;
    el.dispatchEvent(new win.Event("click", { bubbles: true }));
}
function setCheck(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.checked = v; el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
function setSelect(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.value = v; el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
function setInput(win, el, v) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.value = v;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
}

async function bootCard(opts) {
    opts = opts || {};
    const e = build({ settings: opts.settings || { supplementMemory: "调性：" + "设定文字".repeat(1200) } });
    e.win.document.dispatchEvent(new e.win.Event("DOMContentLoaded"));
    await tick(2400);
    e.killPoll();
    const d = e.doc;
    const libs = [
        ["专属卡库", "## 甲\n" + Array.from({ length: 12 }, (_, i) => "专属事件" + i).join("\n"), "story"],
        ["通用卡库", "## 乙\n" + Array.from({ length: 12 }, (_, i) => "通用事件" + i).join("\n"), "common"]
    ];
    if (opts.nsfw !== false) libs.push(["情欲卡库", "## 丙\n" + Array.from({ length: 12 }, (_, i) => "情欲事件" + i).join("\n"), "nsfw"]);
    for (const [name, text, slot] of libs) {
        setSelect(e.win, d.querySelector("#adr044-cd-import-slot"), slot);
        await tick(30);
        d.querySelector("#adr044-cd-lib-name").value = name;
        d.querySelector("#adr044-cd-lib-editor").value = text;
        tapFast(e.win, d.querySelector("#adr044-cd-lib-save"));
        await tick(120);
    }
    const stock = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]');
    if (stock && stock.classList.contains("on")) { tapFast(e.win, stock); await tick(1700); }
    ["story", "common"].forEach(s => setCheck(e.win, d.querySelector("#adr044-cd-slot-on-" + s), true));
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-nsfw"), opts.nsfw !== false);
    setInput(e.win, d.querySelector("#adr044-cd-endpoint"), "https://ds.example.org/v1/chat/completions");
    setInput(e.win, d.querySelector("#adr044-cd-model"), "deepseek-chat");
    setSelect(e.win, d.querySelector("#adr044-cd-mode"), "pickcard");
    setCheck(e.win, d.querySelector("#adr044-cd-enabled"), true);
    setInput(e.win, d.querySelector("#adr044-cd-n"), String(opts.n || 1));
    await tick(150);
    return e;
}
async function beat(e) { e.addRound(); e.emit("message_received"); await tick(4600); }

(async function main() {

section("面板 · 择卡档在场");
{
    const e = await bootCard();
    const sel = e.doc.querySelector("#adr044-cd-mode");
    const vals = Array.from(sel.options).map(o => o.value).join(",");
    ok(vals === "blind,pick,pickcard", "模式下拉三档齐全", vals);
    ok(e.st().cdMode === "pickcard", "选中后写进设置", e.st().cdMode);
    const apiHead = e.doc.body.textContent;
    ok(/择池／择卡 API/.test(apiHead), "API 分节标题已说明择卡也用它");
    e.stop();
}

section("请求体 · 候选构成与顺序");
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "1");
    for (let i = 0; i < 2; i++) await beat(e);
    ok(e.calls.length >= 1, "择卡调用了 DS", "调用 " + e.calls.length + " 次");
    const u = e.calls[e.calls.length - 1].user;
    const s = e.calls[e.calls.length - 1].sys;

    const iNow = u.indexOf("【刚刚这一楼");
    const iCand = u.indexOf("【候选卡】");
    const iTone = u.indexOf("【这个故事的整体调性");
    ok(iNow === 0, "此刻排最前", "位置 " + iNow);
    ok(iCand > iNow, "候选卡排在正文之后", "位置 " + iCand);
    ok(iTone > iCand, "静态调性压到最后", "位置 " + iTone);
    ok(u.slice(iTone).length < 2300, "静态调性截到 2000 上下", "长度 " + u.slice(iTone).length);

    const block = u.slice(iCand, iTone);
    const nums = block.match(/^\d+\. /gm) || [];
    ok(nums.length >= 4, "候选有若干张", nums.join("").trim());
    ok(!/此刻不投卡/.test(block), "候选里没有弃权出口了");
    ok(/只准回复一个数字/.test(s) && !/或 0/.test(s), "只准回编号，不给 0 这条退路");
    ok(/专属·/.test(block) && /通用·/.test(block), "候选跨仓库摊开，不是全挤在一格",
        block.slice(0, 120).replace(/\n/g, " | "));
    ok(/只准回复一个数字/.test(s), "系统提示词要求只回数字");
    e.stop();
}

section("NSFW 候选 · 只给标签不给卡面");
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "1");
    for (let i = 0; i < 2; i++) await beat(e);
    const u = e.calls[e.calls.length - 1].user;
    const s = e.calls[e.calls.length - 1].sys;
    ok(/NSFW·/.test(u), "NSFW 候选在名单里（该来的时候要能被选中）");
    ok(!/情欲事件\d/.test(u), "但情欲卡面一个字都没发出去（避开审核，也避开泄露）",
        (u.match(/情欲事件\d/g) || []).join(","));
    ok(/卡面不外传/.test(u), "候选行明说这一格卡面不展示");
    ok(/双向规则|两条都满足/.test(s), "NSFW 双向硬门照旧注入");
    e.stop();
}
{
    const e = await bootCard({ n: 1, nsfw: false });
    e.setScript(() => "1");
    for (let i = 0; i < 2; i++) await beat(e);
    const s = e.calls[e.calls.length - 1].sys;
    ok(!/NSFW/.test(s), "没有 NSFW 池时整段硬门不注入");
    e.stop();
}

section("选中 · DS 报几号就投几号");
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "2");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "投出来了", "投出 " + e.draws.length + " 张");
    const u = e.calls[0].user;
    const line2 = (u.match(/^2\. 【(.+?)】(.*)$/m) || []);
    const drew = e.draws[0];
    ok(String(drew["模式"]) === "择卡", "记为择卡模式", String(drew["模式"]));
    ok(line2[1] && String(drew["卡池"]) === line2[1],
        "投出的正是候选里的 2 号（卡池对得上）",
        "候选2=" + line2[1] + " 实投=" + drew["卡池"]);
    e.stop();
}

section("不许弃权 · 回 0 也照样投卡");
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "0");
    for (let i = 0; i < 4; i++) await beat(e);
    ok(e.draws.length > 0, "答 0 不再空过（上一版就是一路空过，一张都不投）",
        "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("降级") >= 0),
        "0 号按越界处理，降级盲抽", e.draws.map(x => x["模式"]).join("/"));
    const line = e.doc.querySelector("#adr044-cd-status-line");
    ok(!/空过中/.test(line.textContent || ""), "状态行不再有空过字样");
    e.stop();
}

section("答复不合法 · 越界与废话都要降级，不能乱投");
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "99");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("降级") >= 0),
        "编号越界时降级盲抽，不拿越界号硬索引", e.draws.map(x => x["模式"]).join("/"));
    ok(e.logs.some(l => /越界/.test(l)), "日志点名是越界", e.logs.filter(l => /越界|降级/.test(l)).slice(-1)[0]);
    e.stop();
}
{
    const e = await bootCard({ n: 1 });
    e.setScript(() => "我觉得第二张比较合适");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "夹带解释时不停摆", "投出 " + e.draws.length + " 张");
    e.stop();
}

section("降级 · DS 挂掉时不给 NSFW");
{
    const e = await bootCard({ n: 1 });
    e.setFail(true);
    for (let i = 0; i < 12; i++) await beat(e);
    const drew = e.draws.length;
    ok(drew >= 8, "降级路径反复走到", "投出 " + drew + " 张");
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("择卡降级") >= 0),
        "如实记为择卡降级盲抽", e.draws.map(x => x["模式"]).join("/").slice(0, 40));
    ok(e.draws.every(x => String(x["卡池"]).indexOf("NSFW·") !== 0),
        "降级 " + drew + " 次一张 NSFW 都没有", e.draws.map(x => x["卡池"]).join("、"));
    e.stop();
}

section("「看时机」信封 · 全新账号");
{
    const e = await bootCard({ n: 1 });
    const names = Array.from(e.doc.querySelector("#adr044-cd-env-select").options).map(o => o.value);
    ok(names.indexOf("看时机") >= 0, "出厂四套里有「看时机」", names.join("/"));
    const envs = e.st().cdEnvelopes;
    ok(/等一个合适的时机/.test(envs["看时机"].active), "正文说的是等时机，不是这楼就用",
        envs["看时机"].active.slice(0, 40));
    ok(/以下事件已然发生。织入正文/.test(envs["标准"].active), "标准信封原样保留，没被改掉");
    e.stop();
}

section("「看时机」信封 · 老用户也要拿得到（初版就漏在这）");
{
    // 模拟升级前的存档：已经存着旧的三套，没有「看时机」
    const old = {
        cdEnvelopes: {
            "标准": { active: "旧标准", faded: "旧标准背景" },
            "强硬": { active: "旧强硬", faded: "旧强硬背景" },
            "轻柔": { active: "旧轻柔", faded: "旧轻柔背景" }
        }
    };
    const e = await bootCard({ n: 1, settings: old });
    const envs = e.st().cdEnvelopes;
    ok(!!envs["看时机"], "老存档升级后补上了「看时机」（旧写法只在仓库全空时才铺，这里会漏）");
    ok(envs["标准"].active === "旧标准", "用户改过的旧信封一字未动", envs["标准"].active);
    ok((e.st().cdEnvSeeded || []).indexOf("看时机") >= 0, "记账里登记了已补发");
    e.stop();
}

section("「看时机」信封 · 用户删掉之后不复活");
{
    const gone = {
        cdEnvelopes: { "标准": { active: "A", faded: "B" } },
        cdEnvSeeded: ["标准", "强硬", "轻柔", "看时机"]
    };
    const e = await bootCard({ n: 1, settings: gone });
    const envs = e.st().cdEnvelopes;
    ok(!envs["看时机"] && !envs["强硬"], "删过的出厂信封不会每次启动又冒出来",
        Object.keys(envs).join("/"));
    e.stop();
}

console.log("\n════════════════════════════════");
console.log("通过 " + PASS + " · 失败 " + FAIL);
if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
console.log("════════════════════════════════");
process.exit(FAIL ? 1 : 0);

})().catch(e => { console.error("测试崩溃：", e); process.exit(2); });
