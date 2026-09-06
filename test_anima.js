const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync("index.js", "utf8");
const helpers = source.slice(source.indexOf("    function adrDAnimaHistoryLimit("), source.indexOf("    function adrDGetExtraInstruction("));
const prompt = source.slice(source.indexOf("    async function buildPrompt("), source.indexOf("    function parseResponse("));
const preview = source.slice(source.indexOf("    async function runPrecisePreview("), source.indexOf("    function installProbeGlobals("));

function entry(chatId, content, history, extra) {
    return {
        enabled: false,
        content,
        extra: Object.assign({ createdBy: "anima_summary", source_file: chatId, history }, extra)
    };
}

function fixture() {
    return [
        entry("chat.jsonl", "<10_2>最新总结</10_2><10_1>较新总结\n第二行</10_1>", [
            { unique_id: "10_2", batch_id: 10, slice_id: 2, range_start: 20, range_end: 29 },
            { unique_id: "10_1", batch_id: 10, slice_id: 1 }
        ]),
        entry("chat.jsonl", "<2>旧格式总结</2>", [{ index: 2, range_start: 0, range_end: 9 }]),
        entry("another-chat", "<99>其他聊天秘密</99>", [{ index: 99 }]),
        entry("chat.jsonl", "<100>普通世界书</100>", [{ index: 100 }], { createdBy: "other" })
    ];
}

function build(options = {}) {
    const state = { animaHistoryEnabled: true, animaHistoryLimit: 20, contentTagNames: "content" };
    const context = { chatId: "chat.jsonl" };
    const calls = [];
    const nodes = [{ textContent: "" }, { textContent: "" }];
    const events = new Map();
    const listeners = new Map();
    const timers = new Map();
    const intervals = [];
    let timerId = 0;
    const document = {
        hidden: false,
        querySelectorAll: () => nodes,
        addEventListener: (name, handler) => listeners.set(name, handler)
    };
    context.event_types = { WORLDINFO_UPDATED: "worldinfo_updated", WORLDINFO_SETTINGS_UPDATED: "worldinfo_settings_updated", CHAT_CHANGED: "chat_id_changed" };
    context.eventSource = { on: (name, handler) => events.set(name, handler) };
    const helper = {
        getChatWorldbookName: async target => { calls.push(["binding", target]); return "chat-book"; },
        getWorldbook: async name => { calls.push(["read", name]); return fixture(); }
    };
    Object.assign(helper, options.helper);
    const sandbox = {
        settings: () => state,
        ctx: () => context,
        adrDChatKey: () => context.chatId,
        rootWin: () => ({ TavernHelper: helper }),
        rootDoc: () => document,
        setTimeout: handler => { timers.set(++timerId, handler); return timerId; },
        clearTimeout: timer => timers.delete(timer),
        setInterval: (handler, delay) => { intervals.push({ handler, delay }); return intervals.length; },
        window: {},
        console: { warn() {} },
        esc: value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])),
        activeRange: () => 10,
        adrDExtraInstructionBlock: () => "一次性需求",
        buildPreciseContext: () => "角色卡和手动补充",
        adrDDirectorLogBlock: () => "导演日志",
        adrCdHistoryBlock: () => "投卡史",
        recentContentBlocks: async () => "最近正文",
        syncAll() {},
        currentType: () => "emotion",
        setPreview: (type, text) => { sandbox.previewText = text; },
        status() {},
        setButtons() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(helpers + prompt + preview, sandbox);
    async function flushTimers() {
        const pending = Array.from(timers.values());
        timers.clear();
        for (const handler of pending) await handler();
        await new Promise(setImmediate);
    }
    return { sandbox, state, context, calls, helper, nodes, events, listeners, intervals, timers, document, flushTimers };
}

function buildChatReader(messages) {
    const instance = build();
    instance.context.chat = messages;
    instance.sandbox.adrDGetFullChatMessagesForRead = async () => messages;
    const localReader = source.slice(source.indexOf("    function cleanMessage("), source.indexOf("    function syncShared("));
    const fullReader = source.slice(source.indexOf("    function adrDContentTagNames("), source.indexOf("    async function buildPreciseContext("));
    vm.runInContext(localReader + fullReader, instance.sandbox);
    return instance;
}

function buildFirstMessageContext(messages) {
    const instance = buildChatReader(messages);
    instance.sandbox.adrDGetTavernHelper = () => instance.helper;
    instance.sandbox.getCurrentCharacterObject = () => ({
        name: "角色", description: "角色卡描述保留", first_mes: "卡片默认开场不能发送",
        data: { first_mes: "内层默认开场也不能发送" }
    });
    instance.sandbox.extractCharacterBookText = () => "世界书保留";
    instance.sandbox.extractPersonaText = () => "用户人设保留";
    vm.runInContext(
        source.slice(source.indexOf("    function asCleanText("), source.indexOf("    function extractCharacterBookText("))
        + source.slice(source.indexOf("    async function buildPreciseContext("), source.indexOf("    function adrDAnimaHistoryLimit("))
        + source.slice(source.indexOf("    function extractContentBlocksFromText("), source.indexOf("    function contentBlocksProbe(")),
        instance.sandbox
    );
    return instance;
}

test("首条消息来自当前聊天第零楼，实时跟随编辑和聊天切换，绝不回退角色卡开场", async () => {
    const { sandbox, context } = buildFirstMessageContext([
        { name: "角色", mes: "<content>当前选中的开场</content>" },
        { name: "角色", mes: "<content>后续消息</content>" }
    ]);
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        assert.match(text, /【当前聊天首条消息】\n\[角色｜楼层 0\]\n当前选中的开场/);
        assert.match(text, /角色卡描述保留/);
        assert.doesNotMatch(text, /卡片默认开场|内层默认开场/);
    }
    context.chat[0].mes = "<content>编辑后的首条</content>";
    assert.match(await sandbox.buildPreciseContext(), /编辑后的首条/);
    assert.doesNotMatch(await sandbox.buildPreciseContext(), /当前选中的开场/);
    context.chat = [{ name: "新角色", mes: "<content>另一聊天的首条</content>" }];
    assert.match(await sandbox.buildPreciseContext(), /另一聊天的首条/);
    context.chat = [];
    assert.doesNotMatch(await sandbox.buildPreciseContext(), /首条消息|默认开场/);
    sandbox.getCurrentCharacterObject = () => null;
    context.chat = [{ name: "群聊角色", message: "<content>无角色卡也能读取</content>" }];
    assert.match(await sandbox.buildPreciseContext(), /无角色卡也能读取/);
});

test("关闭首条额外注入不删除正常范围内的聊天，也不跳过空首条去找后续消息", async () => {
    const { sandbox, state, context } = buildFirstMessageContext([
        { name: "角色", mes: "<content>正常范围内首楼</content>" }
    ]);
    state.includeFirstMessage = false;
    assert.doesNotMatch(await sandbox.buildPreciseContext(), /首条消息|正常范围内首楼|默认开场/);
    assert.match(await sandbox.recentContentBlocks(10), /正常范围内首楼/);
    state.includeFirstMessage = true;
    context.chat = [{ mes: "" }, { name: "角色", mes: "<content>不能冒充首条</content>" }];
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
});

test("首条独立开关允许隐藏首楼及无正文标签开场，保留排除与用户开关，不截断", async () => {
    const { sandbox, state, context } = buildFirstMessageContext([
        { name: "角色", mes: "<content>首楼<note>不读取</note>正文</content>" }
    ]);
    state.excludedContentTagNames = "note";
    assert.match(await sandbox.extractCurrentChatFirstMessage(), /首楼正文/);
    assert.doesNotMatch(await sandbox.extractCurrentChatFirstMessage(), /不读取/);
    context.chat[0].is_user = true;
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
    state.includeUserMessages = true;
    context.chat[0].mes = "用户首条<note>用户隐藏内容</note>";
    assert.match(await sandbox.extractCurrentChatFirstMessage(), /用户首条/);
    assert.doesNotMatch(await sandbox.extractCurrentChatFirstMessage(), /用户隐藏内容/);
    sandbox.activeRange = () => "unhidden";
    for (const flag of ["is_system", "is_hidden"]) {
        context.chat[0][flag] = true;
        assert.match(await sandbox.extractCurrentChatFirstMessage(), /用户首条/);
        delete context.chat[0][flag];
    }
    context.chat[0].is_user = false;
    context.chat[0].mes = "无正文标签的角色开场<note>需要排除</note>";
    assert.match(await sandbox.extractCurrentChatFirstMessage(), /无正文标签的角色开场/);
    assert.doesNotMatch(await sandbox.extractCurrentChatFirstMessage(), /需要排除/);
    context.chat[0].mes = "<note><content>不能通过回退恢复排除内容</content></note>";
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
    state.contentTagNames = "";
    const longText = "完整首条".repeat(1000) + "最后一句";
    context.chat[0].mes = longText;
    assert.ok((await sandbox.extractCurrentChatFirstMessage()).endsWith(longText));
});

test("首楼通过助手实时读取第零楼全部隐藏状态，不使用旧缓存或局部聊天首项", async () => {
    const { sandbox, state, context, helper } = buildFirstMessageContext([
        { message_id: 80, name: "角色", mes: "局部聊天首项不是真首条" }
    ]);
    let content = "真实首楼";
    let requests = 0;
    helper.getChatMessages = async (range, options) => {
        requests++;
        assert.equal(range, "0");
        assert.equal(options.hide_state, "all");
        assert.equal(options.include_swipes, false);
        return [{ message_id: 0, name: "角色", message: content, is_system: true }];
    };
    sandbox.activeRange = () => "unhidden";
    assert.match(await sandbox.buildPreciseContext(), /真实首楼/);
    content = "首楼重选后的版本";
    assert.match(await sandbox.buildPreciseContext(), /首楼重选后的版本/);
    assert.equal(requests, 2);
    state.includeFirstMessage = false;
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
    assert.equal(requests, 2);
    state.includeFirstMessage = true;
    helper.getChatMessages = async () => { throw new Error("助手不可用"); };
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
    context.chat = [{ name: "角色", mes: "当前聊天首楼回退" }];
    assert.match(await sandbox.extractCurrentChatFirstMessage(), /当前聊天首楼回退/);
    helper.getChatMessages = async () => [];
    assert.equal(await sandbox.extractCurrentChatFirstMessage(), "");
    helper.getChatMessages = async () => {
        context.chatId = "different-chat";
        return [{ message_id: 0, message: "过期首楼" }];
    };
    await assert.rejects(sandbox.buildPreciseContext(), /切换了聊天/);
});

test("首条注入开关默认开启，关闭和开启均保存到备份并接入双面板同步", () => {
    const { sandbox, state } = build();
    for (const checkClass of ["adr044-check", "adr048-check"]) {
        assert.match(sandbox.adrDChatReadControls(state, checkClass), /id="adr044-include-first-message" checked/);
    }
    const control = { checked: false };
    let backup;
    sandbox.qForm = id => id === "adr044-include-first-message" ? control : null;
    sandbox.adrDSaveLocalBackup = value => { backup = JSON.parse(JSON.stringify(value)); };
    vm.runInContext(
        source.slice(source.indexOf("    function save(key, val) {"), source.indexOf("    // v1.9.29：状态行内存暂存"))
        + source.slice(source.indexOf("    function syncShared("), source.indexOf("    function syncType(")), sandbox);
    for (const enabled of [false, true]) {
        control.checked = enabled;
        sandbox.syncShared();
        assert.equal(state.includeFirstMessage, enabled);
        assert.equal(backup.includeFirstMessage, enabled);
        assert.equal(/id="adr044-include-first-message" checked/.test(sandbox.adrDChatReadControls(backup, "adr044-check")), enabled);
    }
    assert.ok(source.includes('includeFirstMessage: true'));
    assert.ok(source.includes('adrDSetAllById("adr044-include-first-message", "", st.includeFirstMessage !== false)'));
    assert.ok(source.includes('save("includeFirstMessage", !!control.checked)'));
});

test("格式兼容、数值排序、最近切片限制，以及当前聊天隔离", () => {
    const { sandbox } = build();
    const result = sandbox.adrDFormatAnimaHistory(fixture(), "chat.jsonl", 2);
    assert.equal(result.total, 3);
    assert.equal(result.count, 2);
    assert.match(result.text, /较新总结\n第二行/);
    assert.ok(result.text.indexOf("较新总结") < result.text.indexOf("最新总结"));
    assert.match(result.text, /【总结 10_2｜楼层 20–29】\n最新总结/);
    assert.doesNotMatch(result.text, /旧格式总结|其他聊天秘密|普通世界书/);
    const all = sandbox.adrDFormatAnimaHistory(fixture(), "chat.jsonl", 0);
    assert.equal(all.count, 3);
    assert.ok(all.text.indexOf("旧格式总结") < all.text.indexOf("较新总结"));
});

test("无效记录与跨聊天切片不会进入上下文", () => {
    const { sandbox } = build();
    const entries = [null, {}, entry("chat.jsonl", "<1>错误来源</1><2> </2><3>缺少结尾", [
        null, {}, { index: 1, source_file: "other" }, { index: 2 }, { index: 3 }, { index: 4 }
    ])];
    assert.equal(sandbox.adrDFormatAnimaHistory(entries, "chat.jsonl", 0).count, 0);
    assert.equal(sandbox.adrDFormatAnimaHistory(null, "chat.jsonl", 0).count, 0);
});

test("条数默认值、零和非法输入归一化", () => {
    const { sandbox } = build();
    for (const value of [undefined, null, "", -1, "bad", Infinity]) {
        assert.equal(sandbox.adrDAnimaHistoryLimit(value), 20);
    }
    assert.equal(sandbox.adrDAnimaHistoryLimit("0"), 0);
    assert.equal(sandbox.adrDAnimaHistoryLimit("3.9"), 3);
});

test("关闭时不调用接口，缺少接口或聊天时安全降级", async () => {
    const { sandbox, state, calls, context } = build();
    state.animaHistoryEnabled = false;
    assert.equal((await sandbox.adrDReadAnimaHistory()).text, "");
    assert.equal(calls.length, 0);
    state.animaHistoryEnabled = true;
    sandbox.rootWin = () => ({});
    assert.match((await sandbox.adrDReadAnimaHistory()).status, /TavernHelper/);
    context.chatId = "";
    assert.match((await sandbox.adrDReadAnimaHistory()).status, /先打开聊天/);
});

test("读取绑定世界书，禁用总结仍可读，API 仅进行只读调用", async () => {
    const { sandbox, calls } = build();
    const result = await sandbox.adrDReadAnimaHistory();
    assert.match(result.text, /旧格式总结/);
    assert.match(result.status, /3 \/ 3/);
    assert.deepEqual(calls, [["binding", "current"], ["read", "chat-book"]]);
});

test("缺失绑定时只读同名已有世界书，不自动创建或迁移", async () => {
    const { sandbox, calls } = build({ helper: {
        getChatWorldbookName: () => null,
        getWorldbookNames: () => ["chat", "unrelated"]
    } });
    assert.match((await sandbox.adrDReadAnimaHistory()).text, /最新总结/);
    assert.deepEqual(calls, [["read", "chat"]]);
});

test("无存档、旧分支与读取异常给出状态而不阻断分析", async () => {
    const { sandbox, helper } = build();
    helper.getChatWorldbookName = () => null;
    assert.match((await sandbox.adrDReadAnimaHistory()).status, /没有绑定世界书/);
    helper.getChatWorldbookName = () => "book";
    helper.getWorldbook = () => [entry("old-chat", "<1>旧分支</1>", [{ index: 1 }])];
    assert.match((await sandbox.adrDReadAnimaHistory()).status, /迁移/);
    helper.getWorldbook = async () => { throw new Error("测试读取失败"); };
    assert.match((await sandbox.adrDReadAnimaHistory()).status, /测试读取失败/);
    assert.match(await sandbox.buildPrompt("emotion", ""), /最近正文/);
});

test("读取时切换聊天丢弃总结并取消此次提示词构建", async () => {
    const { sandbox, helper, context } = build();
    helper.getWorldbook = async () => { context.chatId = "new-chat"; return fixture(); };
    const result = await sandbox.adrDReadAnimaHistory();
    assert.equal(result.text, "");
    assert.match(result.status, /聊天已切换/);
    context.chatId = "chat.jsonl";
    await assert.rejects(sandbox.buildPrompt("emotion", ""), /聊天已切换/);
});

test("双导演都收到总结，关闭后保持原上下文", async () => {
    const { sandbox, state } = build();
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        assert.match(text, /Anima 历史总结/);
        assert.match(text, /一次性需求/);
        assert.match(text, /角色卡和手动补充/);
        assert.match(text, /导演日志/);
        assert.ok(text.indexOf("最新总结") < text.indexOf("【最近 10 轮正文"));
        if (type === "plot") assert.match(text, /投卡史/);
    }
    state.animaHistoryEnabled = false;
    assert.doesNotMatch(await sandbox.buildPrompt("plot", ""), /Anima|最新总结/);
});

test("预览仅展示前置用语和总结，不包含读取状态或统计", async () => {
    const { sandbox, state } = build();
    state.animaHistoryPrefix = "请参考这些历史资料";
    await sandbox.runPrecisePreview();
    assert.doesNotMatch(sandbox.previewText, /读取状态|检查于|已从世界书|3 \/ 3|最近 3 条|共 3 条/);
    assert.match(sandbox.previewText, /最新总结/);
    assert.match(sandbox.previewText, /【Anima 历史总结】\n请参考这些历史资料\n\n以下是历史剧情资料/);
});

test("双导演的前置用语位于总结标题下第一行，整个总结块紧贴聊天正文之前", async () => {
    const { sandbox, state } = build();
    state.animaHistoryPrefix = "先阅读历史总结。\n再结合最近对话。";
    sandbox.recentContentBlocks = async () => "用户：你好\n角色：好久不见";
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        const history = await sandbox.adrDReadAnimaHistory();
        assert.ok(history.text.startsWith("【Anima 历史总结】\n" + state.animaHistoryPrefix + "\n\n以下是历史剧情资料"));
        assert.ok(history.text.indexOf(state.animaHistoryPrefix) < history.text.indexOf("【总结"));
        assert.doesNotMatch(text, /读取状态|检查于|已从世界书|最近 3 条|共 3 条/);
        assert.ok(text.includes(history.text + "\n\n【最近 10 轮正文｜精准读取】\n用户：你好\n角色：好久不见"));
        assert.ok(text.indexOf("导演日志") < text.indexOf(state.animaHistoryPrefix));
        if (type === "plot") assert.ok(text.indexOf("投卡史") < text.indexOf(state.animaHistoryPrefix));
        assert.equal(text.split(state.animaHistoryPrefix).length - 1, 1);
    }
});

test("空前置用语不增加空块，无总结或关闭时不单独发送前置用语", async () => {
    const { sandbox, state, helper } = build();
    state.animaHistoryPrefix = " \n ";
    assert.ok((await sandbox.adrDReadAnimaHistory()).text.startsWith("【Anima 历史总结】\n以下是历史剧情资料"));
    state.animaHistoryPrefix = "不应单独发送的前置用语";
    state.animaHistoryEnabled = false;
    assert.doesNotMatch(await sandbox.buildPrompt("emotion", ""), /不应单独发送/);
    state.animaHistoryEnabled = true;
    helper.getWorldbook = () => [];
    assert.doesNotMatch(await sandbox.buildPrompt("emotion", ""), /不应单独发送/);
    helper.getWorldbook = () => { throw new Error("读取失败"); };
    assert.doesNotMatch(await sandbox.buildPrompt("plot", ""), /不应单独发送/);
});

test("保存按钮调用设置与备份保存，并将原文同步回两套面板", async () => {
    const { sandbox, state } = build();
    const saves = source.slice(source.indexOf("    function save(key, val) {"), source.indexOf("    // v1.9.29：状态行内存暂存"));
    let backup;
    let mirrored;
    sandbox.qForm = id => id === "adr044-anima-history-prefix" ? { value: "保存的前置用语\n第二行" } : null;
    sandbox.adrDSaveLocalBackup = settings => { backup = JSON.parse(JSON.stringify(settings)); };
    sandbox.adrDSetAllById = (id, value) => { mirrored = { id, value }; };
    sandbox.adrDToast = () => {};
    vm.runInContext(saves, sandbox);
    sandbox.adrDSaveAnimaHistoryPrefix();
    assert.equal(state.animaHistoryPrefix, "保存的前置用语\n第二行");
    assert.equal(backup.animaHistoryPrefix, state.animaHistoryPrefix);
    assert.deepEqual(mirrored, { id: "adr044-anima-history-prefix", value: state.animaHistoryPrefix });
    assert.ok((await sandbox.adrDReadAnimaHistory()).text.startsWith("【Anima 历史总结】\n" + backup.animaHistoryPrefix));
    sandbox.qForm = () => ({ value: "" });
    sandbox.adrDSaveAnimaHistoryPrefix();
    assert.equal(backup.animaHistoryPrefix, "");
});

test("预览读取期间切换聊天不会把旧总结写入新聊天预览", async () => {
    const { sandbox, context } = build();
    sandbox.recentContentBlocks = async () => { context.chatId = "new-chat"; return "新聊天正文"; };
    await sandbox.runPrecisePreview();
    assert.equal(sandbox.previewText, undefined);
});

test("每次读取最新存档，不沿用之前的总结缓存", async () => {
    const { sandbox, helper } = build();
    assert.match((await sandbox.adrDReadAnimaHistory()).text, /最新总结/);
    helper.getWorldbook = () => [entry("chat.jsonl", "<1>编辑后的总结</1>", [{ index: 1 }])];
    const result = await sandbox.adrDReadAnimaHistory();
    assert.match(result.text, /编辑后的总结/);
    assert.doesNotMatch(result.text, /最新总结/);
});

test("两套面板共用控件并接入保存与镜像同步", () => {
    const { sandbox } = build();
    for (const checkClass of ["adr044-check", "adr048-check"]) {
        assert.ok(source.includes('adrDAnimaHistoryControls(st, "' + checkClass + '")'));
        const html = sandbox.adrDAnimaHistoryControls({ animaHistoryEnabled: true, animaHistoryLimit: 0 }, checkClass);
        assert.match(html, /id="adr044-anima-history-enabled" checked/);
        assert.match(html, /<small class="adr-anima-history-status" role="status">/);
        assert.match(html, /id="adr044-anima-history-limit"[^>]*value="0"/);
        assert.match(html, /id="adr044-anima-history-prefix"/);
        assert.match(html, /id="adr044-anima-history-save"/);
        const escapedHtml = sandbox.adrDAnimaHistoryControls({ animaHistoryPrefix: '</textarea><script>"测试"</script>' }, checkClass);
        assert.ok(escapedHtml.includes('&lt;/textarea&gt;&lt;script&gt;&quot;测试&quot;&lt;/script&gt;'));
        assert.doesNotMatch(escapedHtml, /<script>/);
    }
    assert.ok(source.includes('save("animaHistoryEnabled", !!animaHistory.checked)'));
    assert.ok(source.includes('save("animaHistoryLimit", adrDAnimaHistoryLimit(animaLimit.value))'));
    assert.ok(source.includes('adrDSetAllById("adr044-anima-history-enabled", "", !!st.animaHistoryEnabled)'));
    assert.ok(source.includes('adrDSetAllById("adr044-anima-history-limit", String(adrDAnimaHistoryLimit(st.animaHistoryLimit)))'));
    assert.ok(source.includes('save("animaHistoryPrefix", animaPrefix.value || "")'));
    assert.ok(source.includes('"adr044-anima-history-prefix": "animaHistoryPrefix"'));
    assert.ok(source.includes('adrDSetAllById("adr044-anima-history-prefix", st.animaHistoryPrefix || "")'));
    assert.ok(source.includes('ids["adr044-anima-history-save"] = function () { adrDSaveAnimaHistoryPrefix(); }'));
    assert.ok(source.includes('if (id === "adr044-anima-history-save")'));
});

test("开关旁小字同步显示两套面板的状态、条数和检查时间", async () => {
    const { sandbox, nodes, helper } = build();
    await sandbox.adrDRefreshAnimaStatus();
    assert.match(nodes[0].textContent, /3 \/ 3.*检查于/);
    assert.equal(nodes[0].textContent, nodes[1].textContent);
    const html = sandbox.adrDAnimaHistoryControls(sandbox.settings(), "adr044-check");
    assert.match(html, /3 \/ 3/);
    helper.getWorldbook = () => { throw new Error("状态检查读取失败"); };
    await sandbox.adrDRefreshAnimaStatus();
    assert.match(nodes[0].textContent, /状态检查读取失败/);
    assert.doesNotMatch(nodes[0].textContent, /3 \/ 3/);
});

test("世界书更新事件合并刷新，发送时重新读取而不是复用检查结果", async () => {
    const { sandbox, helper, events, nodes, timers, flushTimers, calls } = build();
    sandbox.adrDInstallAnimaHistoryWatcher();
    await flushTimers();
    assert.match(nodes[0].textContent, /3 \/ 3/);
    helper.getWorldbook = () => [entry("chat.jsonl", "<1>更新后的总结</1>", [{ index: 1 }])];
    events.get("worldinfo_updated")();
    events.get("worldinfo_updated")();
    assert.equal(timers.size, 1);
    assert.match(nodes[0].textContent, /正在检查/);
    await flushTimers();
    assert.match(nodes[0].textContent, /1 \/ 1/);
    helper.getWorldbook = name => { calls.push(["fresh-read", name]); return [entry("chat.jsonl", "<1>同条数再次改写的最新总结</1>", [{ index: 1 }])]; };
    const text = await sandbox.buildPrompt("emotion", "");
    assert.match(text, /同条数再次改写的最新总结/);
    assert.doesNotMatch(text, /更新后的总结|检查于|已从世界书/);
    assert.ok(calls.some(call => call[0] === "fresh-read"));
});

test("定时检查每三秒兜底，关闭不访问世界书，重新开启和返回页面会刷新", async () => {
    const { sandbox, state, helper, calls, intervals, listeners, events, nodes, flushTimers, document } = build();
    state.animaHistoryEnabled = false;
    sandbox.adrDInstallAnimaHistoryWatcher();
    sandbox.adrDInstallAnimaHistoryWatcher();
    await flushTimers();
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].delay, 3000);
    assert.equal(events.size, 3);
    intervals[0].handler();
    assert.equal(calls.length, 0);
    assert.match(nodes[0].textContent, /未开启/);
    state.animaHistoryEnabled = true;
    listeners.get("change")({ target: { id: "adr044-anima-history-enabled" } });
    await flushTimers();
    assert.match(nodes[0].textContent, /3 \/ 3/);
    state.animaHistoryLimit = 1;
    listeners.get("input")({ target: { id: "adr044-anima-history-limit" } });
    await flushTimers();
    assert.match(nodes[0].textContent, /1 \/ 3/);
    helper.getWorldbook = () => [];
    intervals[0].handler();
    await new Promise(setImmediate);
    assert.match(nodes[0].textContent, /没有属于当前聊天/);
    document.hidden = false;
    listeners.get("visibilitychange")();
    assert.match(nodes[0].textContent, /正在检查/);
    await flushTimers();
});

test("更新发生在读取过程中时丢弃旧状态并重新检查，不叠加轮询请求", async () => {
    const { sandbox, helper, nodes } = build();
    let finishOldRead;
    let readCount = 0;
    helper.getWorldbook = () => {
        readCount++;
        return new Promise(resolve => { finishOldRead = resolve; });
    };
    const pending = sandbox.adrDRefreshAnimaStatus();
    await new Promise(setImmediate);
    await sandbox.adrDRefreshAnimaStatus();
    assert.equal(readCount, 1);
    helper.getWorldbook = () => [entry("chat.jsonl", "<1>新总结</1>", [{ index: 1 }])];
    sandbox.adrDScheduleAnimaStatusRefresh();
    finishOldRead(fixture());
    await pending;
    await new Promise(setImmediate);
    assert.match(nodes[0].textContent, /1 \/ 1/);
    assert.doesNotMatch(nodes[0].textContent, /3 \/ 3/);
});

test("切换聊天立即清除旧状态，旧请求返回后不会覆盖新聊天", async () => {
    const { sandbox, helper, context, nodes, events, flushTimers } = build();
    sandbox.adrDInstallAnimaHistoryWatcher();
    await flushTimers();
    let finishOldRead;
    helper.getWorldbook = () => new Promise(resolve => { finishOldRead = resolve; });
    const pending = sandbox.adrDRefreshAnimaStatus();
    await new Promise(setImmediate);
    context.chatId = "new-chat";
    helper.getWorldbook = () => [entry("new-chat", "<1>新聊天总结</1>", [{ index: 1 }])];
    events.get("chat_id_changed")();
    assert.match(nodes[0].textContent, /正在检查/);
    finishOldRead(fixture());
    await pending;
    await new Promise(setImmediate);
    assert.match(nodes[0].textContent, /1 \/ 1/);
    assert.doesNotMatch(nodes[0].textContent, /3 \/ 3/);
});

test("默认只读最近 N 条角色消息，用户消息不占名额且在标签提取前过滤", async () => {
    const { sandbox } = buildChatReader([
        { name: "角色甲", mes: "<content>更早的角色消息</content>" },
        { is_user: true, mes: "<content>用户的带标签消息</content>" },
        { name: "角色甲", mes: "<content>角色消息一</content>" },
        { role: "USER", message: "<content>用户的角色字段消息</content>" },
        { name: "角色乙", role: "assistant", message: "<content>角色消息二</content>" },
        { is_user: true, mes: "最后的用户消息" },
        { role: "system", message: "<content>纯系统通知</content>" }
    ]);
    const text = await sandbox.recentContentBlocks(2);
    assert.match(text, /角色消息一/);
    assert.match(text, /角色消息二/);
    assert.ok(text.indexOf("角色消息一") < text.indexOf("角色消息二"));
    assert.doesNotMatch(text, /更早的|用户|纯系统通知/);
});

test("开启用户读取恢复混合消息，关闭后立即生效且不沿用上次正文", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "<content>角色开场</content>" },
        { is_user: true, mes: "用户原文" },
        { name: "角色", mes: "<content>角色回复</content>" },
        { role: "user", message: "<content>用户标签正文</content>" }
    ]);
    state.includeUserMessages = true;
    const mixed = await sandbox.recentContentBlocks(2);
    assert.match(mixed, /\[用户｜楼层 1\]\n用户原文/);
    assert.match(mixed, /\[用户｜楼层 3\]\n用户标签正文/);
    assert.match(mixed, /角色开场/);
    assert.match(mixed, /角色回复/);
    state.includeUserMessages = false;
    const characters = await sandbox.recentContentBlocks(2);
    assert.doesNotMatch(characters, /用户/);
    assert.match(characters, /角色开场/);
    assert.match(characters, /角色回复/);
});

test("全量读取失败后的回退、整层正文和本地测试均遵守角色过滤", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "无标签角色正文<!--ARREBOL_DIRECTOR_START-->旧导演稿<!--ARREBOL_DIRECTOR_END-->" },
        { is_user: true, mes: "用户输入不应回退读入" },
        { name: "角色", is_system: true, mes: "隐藏的真实角色正文" },
        { role: "USER", mes: "角色字段标识的用户输入" }
    ]);
    state.contentTagNames = "*";
    sandbox.adrDGetFullChatMessagesForRead = async () => { throw new Error("全量接口不可用"); };
    const text = await sandbox.recentContentBlocks(2);
    assert.match(text, /无标签角色正文/);
    assert.match(text, /隐藏的真实角色正文/);
    assert.doesNotMatch(text, /用户输入|旧导演稿/);
    assert.doesNotMatch(sandbox.recentChat(2), /用户输入|旧导演稿/);
    state.includeUserMessages = true;
    assert.match(sandbox.recentChat(2), /用户输入/);
});

test("双导演和精准预览只收角色聊天，前置用语与已有总结仍保留", async () => {
    const { sandbox, state, helper } = buildChatReader([
        { is_user: true, mes: "<content>用户聊天原文秘密</content>" },
        { name: "角色", mes: "<content>角色当前正文</content>" }
    ]);
    state.animaHistoryPrefix = "自定义前置用语";
    helper.getWorldbook = () => [entry("chat.jsonl", "<1>总结中已有的用户相关剧情</1>", [{ index: 1, range_start: 0, range_end: 10 }])];
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        assert.match(text, /角色当前正文/);
        assert.match(text, /自定义前置用语/);
        assert.match(text, /总结中已有的用户相关剧情/);
        assert.doesNotMatch(text, /用户聊天原文秘密/);
        assert.match(text, /【总结 1｜楼层 0–10】/);
    }
    await sandbox.runPrecisePreview();
    assert.match(sandbox.previewText, /角色当前正文/);
    assert.doesNotMatch(sandbox.previewText, /用户聊天原文秘密/);
    assert.match(sandbox.previewText, /【总结 1｜楼层 0–10】/);
});

test("只有用户消息时返回空正文，不为填补上下文重新读入用户消息", async () => {
    const { sandbox } = buildChatReader([{ is_user: true, mes: "仅有的用户输入" }]);
    assert.equal(await sandbox.recentContentBlocks(10), "");
    assert.equal(sandbox.recentChat(10), "");
    const text = await sandbox.buildPrompt("emotion", "");
    assert.doesNotMatch(text, /仅有的用户输入|用户消息会作为上下文保留/);
    assert.match(text, /未提取到符合读取设置的正文/);
});

test("用户消息开关默认关闭，两套面板同步并将勾选与关闭状态保存到备份", () => {
    const { sandbox, state } = build();
    for (const checkClass of ["adr044-check", "adr048-check"]) {
        const html = sandbox.adrDChatReadControls(state, checkClass);
        assert.match(html, /id="adr044-include-user-messages"/);
        assert.doesNotMatch(html, /id="adr044-include-user-messages" checked/);
        assert.ok(source.includes('adrDChatReadControls(st, "' + checkClass + '")'));
    }
    const control = { checked: true };
    let backup;
    sandbox.qForm = id => id === "adr044-include-user-messages" ? control : null;
    sandbox.adrDSaveLocalBackup = settings => { backup = JSON.parse(JSON.stringify(settings)); };
    const saves = source.slice(source.indexOf("    function save(key, val) {"), source.indexOf("    // v1.9.29：状态行内存暂存"));
    const sync = source.slice(source.indexOf("    function syncShared("), source.indexOf("    function syncType("));
    vm.runInContext(saves + sync, sandbox);
    sandbox.syncShared();
    assert.equal(state.includeUserMessages, true);
    assert.equal(backup.includeUserMessages, true);
    assert.match(sandbox.adrDChatReadControls(backup, "adr044-check"), / checked/);
    control.checked = false;
    sandbox.syncShared();
    assert.equal(backup.includeUserMessages, false);
    assert.ok(source.includes('includeUserMessages: false'));
    assert.ok(source.includes('adrDSetAllById("adr044-include-user-messages", "", !!st.includeUserMessages)'));
    assert.ok(source.includes('save("includeUserMessages", !!control.checked)'));
});

test("正文中的多种嵌套排除标签连同内容删除，保留前后正文", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: '<content>开头<status kind="panel > detail">状态<status>同名嵌套</status>状态尾</status>中间<note><think>交叉类型嵌套</think>注释</note><STATUS/>结尾</content>' }
    ]);
    state.excludedContentTagNames = "status，note, think";
    const text = await sandbox.recentContentBlocks(1);
    assert.equal(text, "[角色｜楼层 0]\n开头中间结尾");
    assert.equal(sandbox.adrDRemoveExcludedContent('正文<note>未闭合的排除内容'), "正文");
    state.excludedContentTagNames = "";
    assert.match(await sandbox.recentContentBlocks(1), /同名嵌套/);
});

test("先排除外层标签，避免误读其中嵌套的 content；标签名称精确匹配", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: '<note><content>不应读入的伪正文</content></note><content>真正正文<meta.v1>排除字段</meta.v1><metaXv1>保留字段</metaXv1><notebook>保留的不同标签</notebook></content>' }
    ]);
    state.excludedContentTagNames = "note, meta.v1";
    const text = await sandbox.recentContentBlocks(1);
    assert.doesNotMatch(text, /伪正文|排除字段/);
    assert.match(text, /真正正文/);
    assert.match(text, /保留字段/);
    assert.match(text, /保留的不同标签/);
});

test("整层和用户原文兜底不会恢复排除内容，诊断采用同一排除规则", async () => {
    const { sandbox, state } = buildChatReader([
        { is_user: true, mes: "用户可读<note>用户排除内容</note>" },
        { name: "角色", mes: "角色可读<note>角色排除内容</note>" }
    ]);
    state.includeUserMessages = true;
    state.contentTagNames = "*";
    state.excludedContentTagNames = "note";
    assert.equal(await sandbox.recentContentBlocks(1), "[用户｜楼层 0]\n用户可读\n\n---\n\n[角色｜楼层 1]\n角色可读");
    const probe = source.slice(source.indexOf("    function extractContentBlocksFromText("), source.indexOf("    function contentBlocksProbe("));
    vm.runInContext(probe, sandbox);
    assert.equal(sandbox.extractContentBlocksFromText("<content>保留<note>排除</note></content>").join(""), "<content>保留</content>");
});

test("未隐藏模式不限楼层数量，兼容两种隐藏标记并遵守用户消息开关", async () => {
    const messages = Array.from({ length: 120 }, (_, index) => ({ name: "角色", mes: "<content>正文编号" + index + "结束</content>" }));
    messages[0].is_hidden = true;
    messages[1].is_system = true;
    messages.push({ is_user: true, mes: "未隐藏的用户输入" });
    const { sandbox, state } = buildChatReader(messages);
    const text = await sandbox.recentContentBlocks("unhidden");
    assert.equal((text.match(/\[角色｜楼层 \d+\]/g) || []).length, 118);
    assert.match(text, /正文编号2结束/);
    assert.match(text, /正文编号119结束/);
    assert.doesNotMatch(text, /正文编号0结束|正文编号1结束|未隐藏的用户输入/);
    state.includeUserMessages = true;
    assert.match(await sandbox.recentContentBlocks("unhidden"), /未隐藏的用户输入/);
    assert.equal((await sandbox.recentContentBlocks(1)).split("---").length, 2);
});

test("未隐藏模式保留长正文全文，不沿用固定轮数的单条截断", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "角".repeat(3000) + "角色完整结尾" },
        { is_user: true, mes: "用".repeat(1500) + "用户完整结尾" }
    ]);
    state.contentTagNames = "*";
    state.includeUserMessages = true;
    const unlimited = await sandbox.recentContentBlocks("unhidden");
    assert.match(unlimited, /角色完整结尾/);
    assert.match(unlimited, /用户完整结尾/);
    const limited = await sandbox.recentContentBlocks(1);
    assert.doesNotMatch(limited, /角色完整结尾|用户完整结尾/);
});

test("未隐藏模式每次新查助手，楼数不变时隐藏和取消隐藏立即生效", async () => {
    const { sandbox, helper } = buildChatReader([]);
    const getter = source.slice(source.indexOf("    async function adrDGetFullChatMessagesForRead("), source.indexOf("    function adrDAssistantRoundCount("));
    sandbox.adrDGetTavernHelper = () => helper;
    sandbox.adrDFullCountCache = { messages: [{ name: "角色", message: "<content>不应复用的旧缓存</content>" }] };
    vm.runInContext(getter, sandbox);
    let hidden = true;
    let reads = 0;
    helper.getLastMessageId = () => 1;
    helper.getChatMessages = (range, options) => {
        reads++;
        assert.equal(range, "0-1");
        assert.equal(options.hide_state, "all");
        assert.equal(options.include_swipes, false);
        return [
            { name: "角色", role: "assistant", message: "<content>动态楼层</content>", is_hidden: hidden },
            { name: "角色", role: "assistant", message: "<content>始终显示的楼层</content>", is_hidden: false }
        ];
    };
    assert.doesNotMatch(await sandbox.recentContentBlocks("unhidden"), /动态楼层|旧缓存/);
    hidden = false;
    assert.match(await sandbox.recentContentBlocks("unhidden"), /动态楼层/);
    hidden = true;
    assert.doesNotMatch(await sandbox.recentContentBlocks("unhidden"), /动态楼层/);
    assert.equal(reads, 3);
});

test("助手失败的未隐藏模式只回退当前聊天，不读缓存；空聊天不请求非法楼层", async () => {
    const { sandbox, context, helper } = buildChatReader([
        { name: "角色", mes: "<content>当前可见正文</content>" },
        { name: "角色", mes: "<content>当前隐藏正文</content>", is_system: true }
    ]);
    const getter = source.slice(source.indexOf("    async function adrDGetFullChatMessagesForRead("), source.indexOf("    function adrDAssistantRoundCount("));
    sandbox.adrDGetTavernHelper = () => helper;
    vm.runInContext(getter, sandbox);
    helper.getChatMessages = () => { throw new Error("助手不可用"); };
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "[角色｜楼层 0]\n当前可见正文");
    context.chat[0].is_system = true;
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "");
    helper.getLastMessageId = () => -1;
    helper.getChatMessages = () => { assert.fail("空聊天不应请求楼层"); };
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "");
});

test("新模式与嵌套排除在双导演和预览中一致，固定轮数仍保持原有读取范围", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "<content>已隐藏正文</content>", is_system: true },
        { name: "角色", mes: "<content>可见正文<note>排除内容</note></content>" }
    ]);
    const range = source.slice(source.indexOf("    function activeRange("), source.indexOf("    function autoTriggerRange("));
    vm.runInContext(range, sandbox);
    state.range = "unhidden";
    state.excludedContentTagNames = "note";
    assert.equal(sandbox.activeRange(), "unhidden");
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        assert.match(text, /全部未隐藏楼层正文/);
        assert.match(text, /可见正文/);
        assert.doesNotMatch(text, /已隐藏正文|排除内容|最近 unhidden|NaN/);
    }
    await sandbox.runPrecisePreview();
    assert.match(sandbox.previewText, /全部未隐藏楼层正文/);
    assert.doesNotMatch(sandbox.previewText, /已隐藏正文|排除内容/);
    state.range = "custom";
    state.customRange = 2;
    assert.equal(sandbox.activeRange(), 2);
    assert.match(await sandbox.recentContentBlocks(sandbox.activeRange()), /已隐藏正文/);
});

test("缺少隐藏标记的正常角色消息不会被助手严格筛选误删", async () => {
    const { sandbox, helper, state } = buildChatReader([]);
    const messages = [
        { name: "角色", mes: "<content>没有隐藏标记的角色正文</content>" },
        { name: "用户", is_user: true, is_system: false, mes: "用户原文" },
        { name: "角色", is_system: true, mes: "<content>确实隐藏的角色正文</content>" }
    ];
    const getter = source.slice(source.indexOf("    async function adrDGetFullChatMessagesForRead("), source.indexOf("    function adrDAssistantRoundCount("));
    sandbox.adrDGetTavernHelper = () => helper;
    vm.runInContext(getter, sandbox);
    helper.getLastMessageId = () => messages.length - 1;
    helper.getChatMessages = (range, options) => messages.filter(message => {
        return options.hide_state === "all" || (options.hide_state === "hidden") === message.is_system;
    }).map(message => ({
        name: message.name,
        role: message.is_user ? "user" : "assistant",
        is_hidden: message.is_system,
        message: message.mes
    }));
    const text = await sandbox.recentContentBlocks("unhidden");
    assert.match(text, /没有隐藏标记的角色正文/);
    assert.doesNotMatch(text, /用户原文|确实隐藏的角色正文/);
    messages[0].is_system = true;
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "");
    delete messages[0].is_system;
    state.includeUserMessages = true;
    const restored = await sandbox.recentContentBlocks("unhidden");
    assert.match(restored, /没有隐藏标记的角色正文/);
    assert.match(restored, /用户原文/);
    assert.doesNotMatch(restored, /确实隐藏的角色正文/);
    assert.equal(Object.hasOwn(messages[0], "is_system"), false);
});

test("消息名字旁标原始 message_id，切换用户读取和过滤隐藏楼层不重新编号", async () => {
    const { sandbox, state } = buildChatReader([
        { message_id: 0, name: "角色甲", message: "<content>开场</content>" },
        { message_id: 10, name: "角色甲", is_hidden: true, message: "<content>隐藏楼层</content>" },
        { message_id: 11, name: "玩家", role: "user", message: "玩家输入" },
        { message_id: "42", name: "角色乙", message: "<content>最新回复</content>" }
    ]);
    const characters = await sandbox.recentContentBlocks("unhidden");
    assert.match(characters, /\[角色甲｜楼层 0\]\n开场/);
    assert.match(characters, /\[角色乙｜楼层 42\]\n最新回复/);
    assert.doesNotMatch(characters, /楼层 10|楼层 11|隐藏楼层|玩家输入/);
    assert.equal(await sandbox.recentContentBlocks(1), "[角色乙｜楼层 42]\n最新回复");
    state.includeUserMessages = true;
    const mixed = await sandbox.recentContentBlocks("unhidden");
    assert.match(mixed, /\[玩家（用户）｜楼层 11\]\n玩家输入/);
    assert.match(mixed, /\[角色乙｜楼层 42\]/);
    assert.equal(sandbox.adrDMessageReadLabel({ message_id: 0 }, 9, false), "[角色｜楼层 0]");
    assert.equal(sandbox.adrDMessageReadLabel({ message_id: "" }, 9, false), "[角色｜楼层 9]");
    for (const type of ["emotion", "plot"]) {
        const text = await sandbox.buildPrompt(type, "");
        assert.match(text, /\[玩家（用户）｜楼层 11\]/);
        assert.match(text, /\[角色乙｜楼层 42\]/);
    }
    await sandbox.runPrecisePreview();
    assert.match(sandbox.previewText, /\[玩家（用户）｜楼层 11\]/);
    assert.match(sandbox.previewText, /\[角色乙｜楼层 42\]/);
});

test("没有 message_id 时保留原始聊天索引，排除内容与用户消息不改变后续楼层号", async () => {
    const { sandbox, state } = buildChatReader([
        { is_user: true, name: "玩家", mes: "早先输入" },
        { name: "角色", is_system: true, mes: "<content>隐藏正文</content>" },
        { name: "角色", mes: "<note>排除整段</note>" },
        { name: "角色", mes: "<content>保留正文</content>" },
        { is_user: true, name: "玩家", mes: "当前输入" }
    ]);
    state.excludedContentTagNames = "note";
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "[角色｜楼层 3]\n保留正文");
    assert.match(sandbox.recentChat("unhidden"), /\[角色｜楼层 3\]/);
    state.includeUserMessages = true;
    const mixed = await sandbox.recentContentBlocks("unhidden");
    assert.match(mixed, /\[角色｜楼层 3\]/);
    assert.match(mixed, /\[玩家（用户）｜楼层 4\]/);
});

test("Anima 总结恢复有效来源范围，零楼层正常显示，缺失或无效范围不臆造", () => {
    const { sandbox } = build();
    const entries = [entry("chat.jsonl", "<1>零楼层总结</1><2>缺少范围</2><3>字符串范围</3><4>倒置范围</4><5>空范围</5>", [
        { index: 1, range_start: 0, range_end: 0 },
        { index: 2 },
        { index: 3, range_start: "20", range_end: "29" },
        { index: 4, range_start: 9, range_end: 2 },
        { index: 5, range_start: "", range_end: null }
    ])];
    const result = sandbox.adrDFormatAnimaHistory(entries, "chat.jsonl", 0);
    assert.match(result.text, /【总结 1｜楼层 0–0】/);
    assert.match(result.text, /【总结 2】\n缺少范围/);
    assert.match(result.text, /【总结 3｜楼层 20–29】/);
    assert.match(result.text, /【总结 4】\n倒置范围/);
    assert.match(result.text, /【总结 5】\n空范围/);
    assert.doesNotMatch(result.text, /undefined|NaN|null/);
});

test("正文标签留空、未设置或填星号均整层读取，不再优先挑 content", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "标签外开头<content>标签内正文</content><note>应排除内容</note>标签外结尾" }
    ]);
    state.excludedContentTagNames = "note";
    for (const value of ["", "  ", undefined, "*", "content,*"]) {
        state.contentTagNames = value;
        const text = await sandbox.recentContentBlocks("unhidden");
        assert.match(text, /标签外开头<content>标签内正文<\/content>标签外结尾/);
        assert.doesNotMatch(text, /应排除内容/);
    }
    state.contentTagNames = "content";
    assert.equal(await sandbox.recentContentBlocks("unhidden"), "[角色｜楼层 0]\n标签内正文");
});

test("自定义正文标签可以不包含 content，并支持中英文逗号", async () => {
    const { sandbox, state } = buildChatReader([
        { name: "角色", mes: "<content>不应读取</content><story>剧情正文</story><对白>对话正文</对白>" }
    ]);
    state.contentTagNames = "story，对白";
    const text = await sandbox.recentContentBlocks(1);
    assert.match(text, /剧情正文/);
    assert.match(text, /对话正文/);
    assert.doesNotMatch(text, /不应读取/);
});

test("清空正文标签会保存空值，重新加载控件不会强制补回 content", () => {
    const { sandbox, state } = buildChatReader([]);
    let backup;
    sandbox.qForm = id => id === "adr044-content-tags" ? { value: "" } : null;
    sandbox.adrDSaveLocalBackup = settings => { backup = JSON.parse(JSON.stringify(settings)); };
    const saves = source.slice(source.indexOf("    function save(key, val) {"), source.indexOf("    // v1.9.29：状态行内存暂存"));
    const sync = source.slice(source.indexOf("    function syncShared("), source.indexOf("    function syncType("));
    vm.runInContext(saves + sync, sandbox);
    sandbox.syncShared();
    assert.equal(state.contentTagNames, "");
    assert.equal(backup.contentTagNames, "");
    assert.equal(sandbox.adrDContentTagNames().length, 0);
    assert.equal(sandbox.adrDContentTagWholeFloorEnabled(), true);
    assert.ok(source.includes('contentTagNames: ""'));
    assert.equal(source.split('placeholder="留空读取整层"').length - 1, 2);
    assert.ok(source.includes('adrDSetAllById("adr044-content-tags", st.contentTagNames || "")'));
});

test("排除标签和不限量范围保存到备份，两套面板提供相同选项并安全回填", () => {
    const { sandbox, state } = build();
    const controls = {
        "adr044-range": { value: "unhidden" },
        "adr044-excluded-content-tags": { value: " note, status " }
    };
    let backup;
    sandbox.qForm = id => controls[id] || null;
    sandbox.adrDSaveLocalBackup = settings => { backup = JSON.parse(JSON.stringify(settings)); };
    const saves = source.slice(source.indexOf("    function save(key, val) {"), source.indexOf("    // v1.9.29：状态行内存暂存"));
    const sync = source.slice(source.indexOf("    function syncShared("), source.indexOf("    function syncType("));
    vm.runInContext(saves + sync, sandbox);
    sandbox.syncShared();
    assert.equal(state.range, "unhidden");
    assert.equal(backup.range, "unhidden");
    assert.equal(backup.excludedContentTagNames, "note, status");
    assert.match(sandbox.adrDContentExclusionControls(backup), /value="note, status"/);
    assert.match(sandbox.adrDContentExclusionControls({ excludedContentTagNames: '<note>"' }), /&lt;note&gt;&quot;/);
    controls["adr044-excluded-content-tags"].value = "";
    sandbox.syncShared();
    assert.equal(backup.excludedContentTagNames, "");
    assert.equal(source.split('opt(st.range, "unhidden", "当前未隐藏楼层")').length - 1, 2);
    assert.equal(source.split('+ adrDContentExclusionControls(st)').length - 1, 2);
    assert.ok(source.includes('adrDSetAllById("adr044-excluded-content-tags", st.excludedContentTagNames || "")'));
});
