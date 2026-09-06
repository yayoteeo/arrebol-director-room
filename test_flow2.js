// 端到端流程测试：在 jsdom 里真跑 index.js，喂一个仿酒馆上下文，
// 用真实 DOM 事件与真实 ST 事件走完四条链路：
//   点芯片 / 拨仓库开关 / 换下拉 / 一张卡在耳边的完整生命周期。
// 只断言单元行为会漏掉 return 之后的死代码——这一课是这个插件自己上的。
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync("index.js", "utf8");
const SET_KEY = "arrebol-d-final-v1040-stable-settings";
const META_KEY = "arrebol_d_cd";
const EP_KEY = "ARREBOL_D_CARD_DRAWER";

let PASS = 0, FAIL = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { PASS++; console.log("  ✓ " + name); }
    else { FAIL++; failures.push(name); console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n── " + t + " ──"); }
const tick = ms => new Promise(r => setTimeout(r, ms));

function build(opts) {
    opts = opts || {};
    const dom = new JSDOM("<!doctype html><html><body></body></html>",
        { url: "https://example.org/", pretendToBeVisual: true, runScripts: "outside-only" });
    const win = dom.window;
    win.top = win;

    const chat = [];
    const prompts = {};
    const extensionSettings = {};
    const chatMetadata = {};
    const handlers = {};

    if (opts.settings) extensionSettings[SET_KEY] = opts.settings;

    function addRound() {                       // 一问一答＝一楼
        chat.push({ is_user: true, mes: "用户说话" });
        chat.push({ is_user: false, mes: "<content>助手正文，第 " + (chat.length + 1) + " 段。</content>" });
    }
    for (let i = 0; i < (opts.rounds || 6); i++) addRound();

    const context = {
        extensionSettings, chatMetadata, chat,
        chatId: "flow-test-chat",
        getCurrentChatId: () => "flow-test-chat",
        saveSettingsDebounced() {}, saveSettings() {},
        saveMetadataDebounced() {}, saveMetadata() {},
        setExtensionPrompt(k, v) { prompts[k] = { value: v }; },
        extensionPrompts: prompts,
        extensionPromptTypes: { IN_CHAT: 1 },
        extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: s => s,
        eventSource: { on(t, f) { (handlers[t] = handlers[t] || []).push(f); } },
        event_types: {
            APP_READY: "app_ready", MESSAGE_RECEIVED: "message_received",
            MESSAGE_SENT: "message_sent", CHAT_CHANGED: "chat_changed"
        }
    };
    win.SillyTavern = { getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error() {} };
    win.fetch = () => Promise.reject(new Error("no network in test"));
    win.eval(SRC);

    function emit(t) { (handlers[t] || []).forEach(f => { try { f(); } catch (e) {} }); }
    const env = {
        win, doc: win.document, context, prompts, chat, addRound, emit,
        st: () => extensionSettings[SET_KEY],
        meta: () => chatMetadata[META_KEY],
        float: () => (prompts[EP_KEY] ? String(prompts[EP_KEY].value || "") : ""),
        killPoll() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); win.__arrebolDAutoTriggerPoll = null; } catch (e) {} },
        stop() { try { win.clearInterval(win.__arrebolDAutoTriggerPoll); } catch (e) {} dom.window.close(); }
    };
    return env;
}

function tap(win, el) {
    ["pointerdown", "touchstart", "mousedown"].forEach(t =>
        el.dispatchEvent(new win.Event(t, { bubbles: true })));
    el.dispatchEvent(new win.Event("click", { bubbles: true }));
}
function setCheck(win, el, val) {
    ["pointerdown", "touchstart"].forEach(t => el.dispatchEvent(new win.Event(t, { bubbles: true })));
    el.checked = val;
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
function setSelect(win, el, val) {
    el.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
    el.value = val;
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
}

async function boot(opts) {
    const e = build(opts);
    e.win.document.dispatchEvent(new e.win.Event("DOMContentLoaded"));
    await tick(2400);
    return e;
}

(async function main() {

// ===================== 1. 面板与新档位 =====================
section("面板渲染 · 新档位在场");
const e1 = await boot();
{
    const d = e1.doc;
    ok(!!d.querySelector("#adr048-popup-panel"), "面板已挂载");
    const sel = d.querySelector("#adr044-cd-lifemode");
    ok(!!sel, "「这张卡在耳边待多久」下拉存在");
    const vals = sel ? Array.from(sel.options).map(o => o.value).join(",") : "";
    ok(vals === "half,once,stay", "三档齐全：半衰期／只说一次／常驻", vals);
    ok(sel && sel.value === "half", "默认仍是半衰期（老用户语义不变）", sel && sel.value);
    ok(!d.querySelector("#adr044-cd-halflife"), "旧的半衰期勾选框已被下拉取代");
    ok(!!d.querySelector("#adr044-cd-slot-status"), "三仓库写入回执行已加入");
    ok(!!d.querySelector("#adr044-cd-autodone"), "DS 兑现判定勾选框保留");
    const note = d.querySelector("#adr044-cd-lifemode-note");
    ok(note && /半衰期/.test(note.textContent), "档位说明随档位渲染", note && note.textContent.slice(0, 30));
}

// ===================== 2. 芯片一次点击即生效 =====================
section("芯片 · 一次点击即生效");
{
    const d = e1.doc;
    const row = d.querySelector("#adr044-cd-slot-common");
    ok(!!row, "通用库芯片行存在");
    const chip = row.querySelector('[data-adrcd-lib="通用"]');
    ok(!!chip, "出厂示例卡库「通用」渲染成芯片");
    const before = chip.classList.contains("on");
    tap(e1.win, chip);
    await tick(80);
    const after = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]');
    ok(!!after, "重画后同名芯片仍在");
    ok(after.classList.contains("on") !== before, "一次点击就翻转了点亮状态（不必点两三下）",
        "before=" + before + " after=" + after.classList.contains("on"));
    ok(!!e1.meta(), "这一下已写进 chat_metadata 存档");
    const stat = d.querySelector("#adr044-cd-slot-status").textContent;
    ok(/✓/.test(stat), "回执行报告了写入结果", stat);
}

// ===================== 3. 按下记名兜底 =====================
section("芯片兜底 · 按下与 click 之间被重画");
{
    const d = e1.doc;
    const row = d.querySelector("#adr044-cd-slot-common");
    const chip = row.querySelector('[data-adrcd-lib="通用"]');
    const wasOn = chip.classList.contains("on");
    ["pointerdown", "touchstart"].forEach(t =>
        chip.dispatchEvent(new e1.win.Event(t, { bubbles: true })));
    // 模拟整行在按下之后被重画：click 的 target 退化成容器，名字取不到
    row.dispatchEvent(new e1.win.Event("click", { bubbles: true }));
    await tick(80);
    const now = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]');
    ok(now && now.classList.contains("on") !== wasOn,
        "target 退化到容器时，用按下时记住的名字兜底成功（旧版这一下会白丢）",
        "wasOn=" + wasOn + " now=" + (now && now.classList.contains("on")));
}

// ===================== 4. 仓库开关 =====================
section("仓库开关 · 一次拨动即写入");
{
    const d = e1.doc;
    const box = d.querySelector("#adr044-cd-slot-on-nsfw");
    ok(!!box, "NSFW 库开关存在");
    const want = !box.checked;
    setCheck(e1.win, box, want);
    await tick(80);
    ok(e1.meta() && e1.meta().slotOn.nsfw === want, "开关状态已落进存档",
        JSON.stringify(e1.meta() && e1.meta().slotOn));
    ok(box.checked === want, "视觉状态没被后台刷新拨回去");
    ok(/✓/.test(d.querySelector("#adr044-cd-slot-status").textContent), "开关也有写入回执");
}

// ===================== 5. 芯片点亮顺手开格子后，开关刷得动 =====================
section("勾选框不上打字锁 · 后台仍刷得动它");
{
    const d = e1.doc;
    const box = d.querySelector("#adr044-cd-slot-on-common");
    setCheck(e1.win, box, false);
    await tick(80);
    // 点亮一张芯片会顺手把这一格打开；此时开关必须跟着变亮
    const chip = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]');
    if (chip.classList.contains("on")) { tap(e1.win, chip); await tick(1700); }
    tap(e1.win, d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="通用"]'));
    await tick(1700);
    const box2 = d.querySelector("#adr044-cd-slot-on-common");
    ok(box2.checked === true && e1.meta().slotOn.common === true,
        "点亮芯片顺手开格子后，开关视觉与存档一致（focus 锁没把它焊死）",
        "checked=" + box2.checked + " meta=" + e1.meta().slotOn.common);
}

// ===================== 6. 下拉弹开期间不被改写 =====================
section("下拉 · 原生 picker 弹开期间免疫刷新");
{
    const d = e1.doc;
    const sel = d.querySelector("#adr044-cd-edit-select");
    ok(!!sel, "正在编辑下拉存在");
    const beforeHTML = sel.innerHTML;
    sel.dispatchEvent(new e1.win.Event("pointerdown", { bubbles: true }));   // picker 弹开
    d.querySelector("#adr044-cd-lib-name").value = "测试库甲";
    d.querySelector("#adr044-cd-lib-editor").value = "## 池甲\n卡一\n卡二";
    tap(e1.win, d.querySelector("#adr044-cd-lib-save"));                     // 期间发生一次刷新
    await tick(120);
    ok(sel.innerHTML === beforeHTML,
        "弹开期间这一个下拉的 DOM 没被改写（旧版 1.5s 窗口一过就把 picker 掐掉）");
    sel.dispatchEvent(new e1.win.Event("change", { bubbles: true }));        // 落定，交还短窗口
    await tick(1700);
    d.querySelector("#adr044-cd-lib-name").value = "测试库乙";
    d.querySelector("#adr044-cd-lib-editor").value = "## 池乙\n卡三";
    tap(e1.win, d.querySelector("#adr044-cd-lib-save"));
    await tick(120);
    const sel2 = d.querySelector("#adr044-cd-edit-select");
    ok(Array.from(sel2.options).some(o => o.value === "测试库乙"),
        "picker 关掉之后选项照常更新（长免疫不会变成永久失效）",
        Array.from(sel2.options).map(o => o.value).join("/"));
}
e1.stop();

// ===================== 7. 一张卡的完整生命周期 =====================
async function lifeRun(mode, N) {
    const e = await boot({ rounds: 4 });
    e.killPoll();          // 只让 MESSAGE_RECEIVED 驱动节拍，排除轮询重排造成的抖动
    const d = e.doc;

    setSelect(e.win, d.querySelector("#adr044-cd-lifemode"), mode);
    const nEl = d.querySelector("#adr044-cd-n");
    nEl.value = String(N);
    nEl.dispatchEvent(new e.win.Event("input", { bubbles: true }));
    nEl.dispatchEvent(new e.win.Event("change", { bubbles: true }));

    // 建一副库并点亮到通用格
    d.querySelector("#adr044-cd-lib-name").value = "剧本";
    d.querySelector("#adr044-cd-lib-editor").value =
        "## 池\n卡一：山下寡妇来还药钱\n卡二：鹦鹉复述了一段密谈\n卡三：簪子出现在当铺\n卡四：夜里有人叩门三下\n卡五：药铺换了新掌柜";
    tap(e.win, d.querySelector("#adr044-cd-lib-save"));
    await tick(120);
    let chip = d.querySelector('#adr044-cd-slot-common [data-adrcd-lib="剧本"]');
    if (chip && !chip.classList.contains("on")) { tap(e.win, chip); await tick(120); }
    // 只留通用一格，抽卡结果可预期
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-story"), false);
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-nsfw"), false);
    setCheck(e.win, d.querySelector("#adr044-cd-slot-on-common"), true);
    setCheck(e.win, d.querySelector("#adr044-cd-enabled"), true);
    await tick(120);

    async function beat() {          // 走一楼：新增一轮 → 发事件 → 等自动检查落定
        e.addRound();
        e.emit("message_received");
        await tick(4600);
    }
    await beat();                    // 第一拍只对齐基准线，不投卡
    return { e, d, beat };
}

section("生命周期 · 半衰期（N=4，半衰期 2 楼）");
{
    const { e, d, beat } = await lifeRun("half", 4);
    ok(e.st().cdLifeMode === "half" && e.st().cdHalfLife === true,
        "cdLifeMode=half，旧字段 cdHalfLife 镜像为 true", e.st().cdLifeMode + "/" + e.st().cdHalfLife);
    for (let i = 0; i < 4; i++) await beat();            // 到点投卡
    ok(!!e.meta().floatCard, "第 N 楼投出了一张卡", String(e.meta().floatCard).slice(0, 16));
    ok(e.meta().floatStage === "active" && e.float().length > 0, "刚投出＝必须发生，耳边有稿",
        e.meta().floatStage + " len=" + e.float().length);
    const activeText = e.float();
    await beat(); await beat();                          // 挂满半衰期
    ok(e.meta().floatStage === "faded", "挂过半衰期后降级为背景", e.meta().floatStage);
    ok(e.float().length > 0 && e.float() !== activeText,
        "背景档仍然挂在耳边，但换了信封（这正是 Gemini 会继续复述的那一段）");
    e.stop();
}

section("生命周期 · 只说一次（N=4，只挂一层）");
{
    const { e, d, beat } = await lifeRun("once", 4);
    ok(e.st().cdLifeMode === "once" && e.st().cdHalfLife === true,
        "cdLifeMode=once，cdHalfLife 镜像为 true（旧读法不会误判成常驻）",
        e.st().cdLifeMode + "/" + e.st().cdHalfLife);
    const note = d.querySelector("#adr044-cd-lifemode-note").textContent;
    ok(/只说一次/.test(note) && /留白 3 楼/.test(note),
        "说明按当前 N 算出留白楼数（N=4 → 空 3 楼）", note);

    for (let i = 0; i < 4; i++) await beat();
    ok(!!e.meta().floatCard && e.meta().floatStage === "active" && e.float().length > 0,
        "第 N 楼照常投卡，耳边挂上", e.meta().floatStage + " len=" + e.float().length);
    const card = e.meta().floatCard;

    await beat();                                        // 只说一次：这一层过完就撤
    ok(e.meta().floatStage === "done", "只挂一层之后自动撤下", e.meta().floatStage);
    ok(e.float() === "", "耳边真的空了（注入通道清零，模型不会再听见第二遍）",
        "len=" + e.float().length);
    const h = (e.meta().history || []).slice(-1)[0];
    ok(h && h.status === "once", "投卡史记成「只说了一次」，不冒充已兑现", h && h.status);

    await beat(); await beat();                          // 空窗期
    ok(e.float() === "" && e.meta().floatStage === "done",
        "空窗期内耳边保持空白，没有偷偷复活");
    ok(e.meta().floatCard === card, "卡面留档可查（投卡史与面板都读得到）");

    await beat();                                        // 正好落在下一个投卡点（F+4，N=4）
    ok(e.meta().floatStage === "active" && e.float().length > 0,
        "隔满 N 楼后照常给新卡，节奏没被这一档打乱", e.meta().floatStage);
    ok(e.meta().floatCard !== card, "换的是新卡，不是同一张again", String(e.meta().floatCard).slice(0, 16));
    e.stop();
}

section("生命周期 · 常驻（N=4，永不降级）");
{
    const { e, beat } = await lifeRun("stay", 4);
    ok(e.st().cdLifeMode === "stay" && e.st().cdHalfLife === false,
        "cdLifeMode=stay，cdHalfLife 镜像为 false（等价旧版关掉半衰期）",
        e.st().cdLifeMode + "/" + e.st().cdHalfLife);
    for (let i = 0; i < 4; i++) await beat();
    ok(e.meta().floatStage === "active", "投出后是必须发生", e.meta().floatStage);
    await beat(); await beat(); await beat();
    ok(e.meta().floatStage === "active" && e.float().length > 0,
        "挂过半衰期也不降级，一直挂到下一张（旧版关掉半衰期就是这个行为）", e.meta().floatStage);
    e.stop();
}

// ===================== 8. 旧存档迁移 =====================
section("旧存档迁移");
{
    const a = await boot({ rounds: 2, settings: { cdHalfLife: false } });
    const s = a.doc.querySelector("#adr044-cd-lifemode");
    ok(s && s.value === "stay", "1.19.4 老存档 cdHalfLife=false → 落到「常驻」", s && s.value);
    a.stop();

    const b = await boot({ rounds: 2, settings: { cdHalfLife: true } });
    const s2 = b.doc.querySelector("#adr044-cd-lifemode");
    ok(s2 && s2.value === "half", "1.19.4 老存档 cdHalfLife=true → 落到「半衰期」", s2 && s2.value);
    b.stop();

    const c = await boot({ rounds: 2, settings: {} });
    const s3 = c.doc.querySelector("#adr044-cd-lifemode");
    ok(s3 && s3.value === "half", "全新账号默认「半衰期」", s3 && s3.value);
    c.stop();
}

console.log("\n════════════════════════════════");
console.log("通过 " + PASS + " · 失败 " + FAIL);
if (failures.length) console.log("失败项：\n  - " + failures.join("\n  - "));
console.log("════════════════════════════════");
process.exit(FAIL ? 1 : 0);

})().catch(e => { console.error("测试崩溃：", e); process.exit(2); });
