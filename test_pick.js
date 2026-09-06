// v1.22.0 择池测试。DS 用假接口顶替，既能断言"我们到底喂了什么、按什么顺序"，
// 也能脚本化它的答复来验弃权、节流、降级三条链路。
// 语境顺序是这一版的核心改动，必须逐段断言，不能只看"跑通了"。
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

    const calls = [];                 // 每次发给 DS 的请求
    let script = () => "";            // DS 这次答什么
    let failNext = false;             // 让 DS 这次直接挂掉

    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, sys: body.messages[0].content, user: body.messages[1].content, body });
        if (failNext) throw new Error("mock DS down");
        const answer = script(calls.length, body);
        return {
            ok: true, status: 200,
            text: async () => JSON.stringify({ choices: [{ message: { content: answer } }] })
        };
    };
    const draws = [], logs = [];
    win.console = {
        log(...a) { logs.push(String(a[0] || "")); if (String(a[0] || "").indexOf("投卡") >= 0 && a[1]) draws.push(a[1]); },
        warn(...a) { logs.push(a.map(x => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); },
        error() {}, info() {}, debug() {}
    };

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "pick-test", getCurrentChatId: () => "pick-test",
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
        setScript(f) { script = f; },
        setFail(v) { failNext = v; },
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        float: () => (prompts["ARREBOL_D_CARD_DRAWER"] ? String(prompts["ARREBOL_D_CARD_DRAWER"].value || "") : ""),
        addRound() {
            chat.push({ is_user: true, mes: "用户回了一句。" });
            chat.push({ is_user: false, mes: "<content>第 " + (chat.length + 1) + " 段正文。</content>" });
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

// 三格建库 + 开择池 + 填好假 API
async function bootPick(opts) {
    opts = opts || {};
    const e = build({ settings: { supplementMemory: "调性设定：" + "情欲描写".repeat(1200) } });
    e.win.document.dispatchEvent(new e.win.Event("DOMContentLoaded"));
    await tick(2400);
    e.killPoll();
    const d = e.doc;

    const libs = [["专属卡库", "## 甲\nS1\nS2\nS3\nS4\nS5", "story"],
                  ["通用卡库", "## 乙\nC1\nC2\nC3\nC4\nC5", "common"]];
    if (opts.nsfw !== false) libs.push(["情欲卡库", "## 丙\nN1\nN2\nN3\nN4\nN5", "nsfw"]);
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
    setSelect(e.win, d.querySelector("#adr044-cd-mode"), opts.mode || "pick");
    setCheck(e.win, d.querySelector("#adr044-cd-enabled"), true);
    setInput(e.win, d.querySelector("#adr044-cd-n"), String(opts.n || 1));
    await tick(150);
    return e;
}
async function beat(e) { e.addRound(); e.emit("message_received"); await tick(4600); }

(async function main() {

section("撤掉的两条闸确实不在了");
{
    const e = await bootPick();
    ok(!e.doc.querySelector("#adr044-cd-nsfwfreq"), "NSFW 出场频率下拉已移除（那是给盲抽用户的，打错了靶）");
    ok(e.st().cdNsfwFreq === undefined, "设置里也没留下这个字段", String(e.st().cdNsfwFreq));
    e.stop();
}

section("喂给 DS 的语境：顺序与配额");
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "通用·乙");
    for (let i = 0; i < 2; i++) await beat(e);
    ok(e.calls.length >= 1, "择池确实调用了 DS", "调用 " + e.calls.length + " 次");
    const u = e.calls[e.calls.length - 1].user;
    const s = e.calls[e.calls.length - 1].sys;

    const iNow = u.indexOf("【刚刚这一楼");
    const iBefore = u.indexOf("【再往前几楼");
    const iMenu = u.indexOf("【卡池名单】");
    const iTone = u.indexOf("【这个故事的整体调性");

    ok(iNow === 0, "此刻排在最前（旧版这里是 8000 字角色卡）", "位置 " + iNow);
    ok(iBefore > iNow, "前情排在此刻之后", "位置 " + iBefore);
    ok(iMenu > iBefore, "名单排在正文之后", "位置 " + iMenu);
    ok(iTone > iMenu, "静态调性被压到最后", "位置 " + iTone);

    const tone = u.slice(iTone);
    ok(tone.length < 2300, "静态调性截到 2000 上下（旧版 8000）", "长度 " + tone.length);
    ok(/只用来判断某类情节允不允许发生/.test(tone), "并且明说了它不是此刻的依据");
    ok(/【刚刚这一楼】就是此刻/.test(s), "系统提示词把此刻锚定在最后一楼");
    ok(/判断依据只看【刚刚这一楼】/.test(s), "NSFW 硬门也改成只看此刻（前几楼收场的不算数）");
    e.stop();
}

section("没有 NSFW 池时，那段硬门整段不注入");
{
    const e = await bootPick({ n: 1, nsfw: false });
    e.setScript(() => "通用·乙");
    for (let i = 0; i < 2; i++) await beat(e);
    const s = e.calls[e.calls.length - 1].sys;
    ok(!/NSFW/.test(s), "菜单里没有 NSFW 池就不提这个概念（省 token，也不平白种进去）");
    e.stop();
}

section("不许弃权 · 名单里不再有出口");
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "通用·乙");
    for (let i = 0; i < 2; i++) await beat(e);
    const u = e.calls[e.calls.length - 1].user;
    const s2 = e.calls[e.calls.length - 1].sys;
    ok(!/此刻不投卡/.test(u), "卡池名单里没有弃权项了", (u.match(/此刻不投卡/g) || []).join());
    ok(!/此刻不投卡/.test(s2), "系统提示词里也不再提弃权");
    ok(/必须从名单中选出一个卡池/.test(s2) && /不存在「都不选」/.test(s2),
        "改成明说必须选一个", s2.slice(s2.indexOf("你必须"), s2.indexOf("你必须") + 40));
    ok(/最不打断当下/.test(s2),
        "并给出选不出时怎么办——挑最不打断当下的那个，而不是撂挑子");
    e.stop();
}

section("不许弃权 · 旧答复「此刻不投卡」现在算无效，降级但不停摆");
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "此刻不投卡");
    for (let i = 0; i < 4; i++) await beat(e);
    ok(e.draws.length > 0, "照样有卡投出来（这正是上一版一路空过的病）",
        "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("降级") >= 0),
        "答复不在名单里就当无效答复，降级盲抽", e.draws.map(x => x["模式"]).join("/"));
    e.stop();
}

section("旧存档 · 升级后立刻解除未走完的空过窗口");
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "专属·甲");
    await beat(e);
    // 手动伪造一个 1.23.0 遗留的空过窗口
    const m = e.meta();
    m.passUntil = 9999;
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "老存档里遗留的 passUntil 不再拦住投卡",
        "投出 " + e.draws.length + " 张");
    ok(Number(e.meta().passUntil || 0) === 0, "读出来就归零", "passUntil=" + e.meta().passUntil);
    e.stop();
}

section("DS 点 NSFW 池就照给 · 该来的时候不能被拦下");
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "NSFW·丙");
    for (let i = 0; i < 6; i++) await beat(e);
    ok(e.draws.length >= 3, "连着投了几张", "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["卡池"]).indexOf("NSFW·") === 0),
        "场面持续时连点同一格不会被拦（v1.21 那条连抽闸已撤，正是它会打断场面）",
        e.draws.map(x => x["卡池"]).join("、"));
    e.stop();
}

section("降级 · DS 挂掉时排除 NSFW，并且要出声");
{
    const e = await bootPick({ n: 1 });
    e.setFail(true);
    for (let i = 0; i < 12; i++) await beat(e);
    const drew = e.draws.length;
    ok(drew >= 8, "降级路径反复走到", "投出 " + drew + " 张");
    ok(e.draws.every(x => String(x["卡池"]).indexOf("NSFW·") !== 0),
        "降级 " + drew + " 次一张 NSFW 都没有（无闸门时撞不上的概率约 " +
        (Math.pow(2 / 3, drew) * 100).toFixed(2) + "%）",
        e.draws.map(x => x["卡池"]).join("、"));
    const line = e.doc.querySelector("#adr044-cd-status-line");
    ok(line && /小眼睛没应答时随机给的/.test(line.textContent),
        "状态行主动说明这张是降级随机给的（旧版降级完全静默）", line && line.textContent);
    e.stop();
}

section("答复清洗 · 弃权位也要认得出，垃圾答复照旧作废");
{
    // 弃权取消后，这条答复不在名单里 → 按无效答复降级，而不是被认成弃权
    const e = await bootPick({ n: 1 });
    e.setScript(() => "「此刻不投卡」");
    for (let i = 0; i < 4; i++) await beat(e);
    ok(e.draws.length > 0, "旧的弃权说法现在一律无效，照常降级投卡",
        "投出 " + e.draws.length + " 张");
    e.stop();
}
{
    const e = await bootPick({ n: 1 });
    e.setScript(() => "我觉得应该选通用·乙这个池子比较合适");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "答复不合法时降级盲抽，不停摆", "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("降级") >= 0),
        "并且如实记为降级", e.draws.map(x => x["模式"]).join("/"));
    e.stop();
}

section("出厂信封「看时机」");
{
    const e = await bootPick({ n: 1 });
    const sel = e.doc.querySelector("#adr044-cd-env-select");
    const names = sel ? Array.from(sel.options).map(o => o.value) : [];
    ok(names.indexOf("看时机") >= 0, "新出厂信封在下拉里", names.join("/"));
    setSelect(e.win, sel, "看时机");
    await tick(120);
    const act = e.doc.querySelector("#adr044-cd-envelope").value;
    ok(/等一个合适的时机再织入正文/.test(act), "前半程把时点决定权还给模型", act.slice(0, 40));
    ok(/不得复述原文/.test(act) && /不得在单楼内全部兑现/.test(act), "两条家法仍在，没有因为放软而丢掉");
    e.setScript(() => "通用·乙");
    for (let i = 0; i < 2; i++) await beat(e);
    ok(e.float().indexOf("等一个合适的时机") > 0, "真投出去的稿子用的就是这套信封", e.float().slice(0, 50));
    e.stop();
}

section("择卡 · 候选按仓库均摊");
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setScript(() => "1");
    for (let i = 0; i < 2; i++) await beat(e);
    ok(e.calls.length >= 1, "择卡调用了 DS", "调用 " + e.calls.length + " 次");
    const u = e.calls[e.calls.length - 1].user;
    const lines = (u.split("【候选卡】\n")[1] || "").split("\n").filter(l => /^\d+\./.test(l));
    ok(lines.length >= 5, "候选数量按仓库数算出来（不含已取消的 0 号出口）", "共 " + lines.length + " 行");
    const bySlot = { 专属: 0, 通用: 0, NSFW: 0 };
    lines.forEach(l => { Object.keys(bySlot).forEach(k => { if (l.indexOf("【" + k + "·") > 0) bySlot[k]++; }); });
    // 真正的契约不是"三格数量相等"：NSFW 候选不带卡面，同一个池给两行一模一样的
    // 「（卡面不外传）」，DS 根本分辨不了，等于白占位置。所以 NSFW 是一池一行、上限两行。
    // "仓库数即权重"管的是盲抽掷仓库；择卡按贴合度挑，只要 NSFW 在名单上有一行、
    // 门开时选得到就够了。
    ok(bySlot["专属"] === bySlot["通用"] && bySlot["专属"] > 0,
        "带卡面的两格在候选里均摊，谁都不被池多的一边淹掉", JSON.stringify(bySlot));
    ok(bySlot["NSFW"] >= 1 && bySlot["NSFW"] <= 2,
        "NSFW 一池一行占位（上限两行），门开时选得到，又不用重复的占位刷屏",
        JSON.stringify(bySlot));
    const seen = lines.map(l => l.replace(/^\d+\.\s*/, ""));
    ok(new Set(seen).size === seen.length, "候选之间不重复");
    ok(!/此刻不投卡/.test(u), "候选表里没有弃权出口");
    e.stop();
}

section("择卡 · NSFW 卡面不出门");
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setScript(() => "1");
    for (let i = 0; i < 2; i++) await beat(e);
    const u = e.calls[e.calls.length - 1].user;
    ok(!/N[1-5]/.test(u), "请求体里没有任何一张 NSFW 卡面（DeepSeek 审核会把整次调用打回）",
        (u.match(/N[1-5]/g) || []).join(","));
    ok(/【NSFW·丙】（这一格的卡面不外传/.test(u), "NSFW 候选以不透明占位出现，仍可被选中");
    ok(/S[1-5]/.test(u) && /C[1-5]/.test(u), "非 NSFW 的卡面照常展示，DS 才挑得动");
    const s = e.calls[e.calls.length - 1].sys;
    ok(/双向|两条/.test(s) && /卡面不展示给你/.test(s), "系统提示词说明了这一格改用双向硬门判断");
    e.stop();
}

section("择卡 · 选中哪张就投哪张");
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setScript(() => "2");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "投出来了", "投出 " + e.draws.length + " 张");
    const u = e.calls[0].user;
    const line2 = (u.split("【候选卡】\n")[1] || "").split("\n")[1] || "";
    const wanted = line2.replace(/^2\.\s*【[^】]+】/, "").trim();
    ok(String(e.draws[0]["卡面"]) === wanted, "投的正是第 2 张候选",
        "答 2 → 投「" + e.draws[0]["卡面"] + "」，候选第 2 张是「" + wanted + "」");
    ok(String(e.draws[0]["模式"]) === "择卡", "模式记为择卡", String(e.draws[0]["模式"]));
    e.stop();
}

section("择卡 · 不许弃权与降级");
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setScript(() => "0");
    for (let i = 0; i < 4; i++) await beat(e);
    ok(e.draws.length > 0, "答 0 不再是弃权，照样投卡", "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["模式"] || "").indexOf("降级") >= 0),
        "0 号越界，按无效答复降级盲抽", e.draws.map(x => x["模式"]).join("/"));
    const u = e.calls[0].user;
    ok(!/0\. 此刻不投卡/.test(u), "候选末尾不再有 0 号出口");
    e.stop();
}
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setScript(() => "99");
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "编号越界时降级盲抽，不停摆", "投出 " + e.draws.length + " 张");
    ok(e.draws.every(x => String(x["模式"]).indexOf("降级") >= 0), "如实记为降级",
        e.draws.map(x => x["模式"]).join("/"));
    ok(e.draws.every(x => String(x["卡池"]).indexOf("NSFW·") !== 0), "降级时照样不给 NSFW");
    e.stop();
}
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    e.setFail(true);
    for (let i = 0; i < 3; i++) await beat(e);
    ok(e.draws.length > 0, "DS 挂掉时降级盲抽", "投出 " + e.draws.length + " 张");
    const line = e.doc.querySelector("#adr044-cd-status-line");
    ok(line && /小眼睛没应答时随机给的/.test(line.textContent), "状态行照样出声");
    e.stop();
}

section("择卡 · 面板与自检");
{
    const e = await bootPick({ n: 1, mode: "pickcard" });
    const opts2 = Array.from(e.doc.querySelector("#adr044-cd-mode").options).map(o => o.value);
    ok(opts2.join(",") === "blind,pick,pickcard", "模式下拉三档齐全", opts2.join(","));
    ok(e.st().cdMode === "pickcard", "档位落进设置", String(e.st().cdMode));
    tapFast(e.win, e.doc.querySelector("#adr044-cd-selfcheck"));
    await tick(300);
    const sc = e.doc.querySelector("#adr044-cd-selfcheck-out").textContent || "";
    ok(/模式：择卡/.test(sc), "自检报出择卡", sc.slice(0, 120));
    e.stop();
}

console.log("\n════════════════════════════════");
console.log("通过 " + PASS + " · 失败 " + FAIL);
if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
console.log("════════════════════════════════");
process.exit(FAIL ? 1 : 0);

})().catch(e => { console.error("测试崩溃：", e); process.exit(2); });
