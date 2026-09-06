const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync("index.js", "utf8");
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
}

function build(options = {}) {
    const database = options.database || {};
    const state = Object.assign({
        apiRetryCount: 2, autoTriggerEmotion: true, autoTriggerPlot: false,
        streamEnabled: false, emotionModel: "emotion-model", plotModel: "plot-model",
        emotionPreset: "完整情感预设", plotPreset: "完整统筹预设",
        emotionApiEndpoint: "https://example.invalid/v1", emotionApiKey: "secret-key-not-in-preview"
    }, options.settings);
    const context = { chatId: "chat" };
    const calls = [], statuses = [], scheduled = [], runs = [], errors = [];
    const baseline = { emotion: { base: 0 }, plot: { base: 0 } };
    let clock = 1000000;
    let count = 30;
    let succeeds = false;
    let timerId = 0;
    const sandbox = {
        settings: () => state, ctx: () => context, adrDChatKey: () => context.chatId,
        Date: class extends Date { static now() { return clock; } },
        console: { log() {}, warn() {}, error(...details) { errors.push(details); } },
        prefixOf: type => type, labelOf: type => type, processing: false, aborter: null,
        EMOTION_PRESET: "出厂情感预设", PLOT_PRESET: "出厂统筹预设",
        activeRange: () => "unhidden", adrDReadRangeLabel: () => "当前未隐藏楼层",
        adrDExtraInstructionBlock: (type, extra) => extra ? "一次性需求：" + extra : "",
        adrDGetExtraInstruction: () => "临时指令必须保留",
        buildPreciseContext: () => "角色卡\n世界书\n用户人设\n手动补充",
        adrDReadAnimaHistory: async () => ({ text: "【Anima 历史总结】\n前置用语\n\n完整历史总结" }),
        adrDDirectorLogBlock: () => "导演日志", adrCdHistoryBlock: () => "投卡史",
        recentContentBlocks: async () => "[角色｜楼层 36]\n" + "完整角色正文".repeat(1500) + "正文末尾",
        syncAll() {}, setButtons() {}, status: (type, text) => statuses.push({ type, text }),
        setPreview: (type, text) => { sandbox.preview = { type, text }; },
        adrDAutoRetryByBeat: {}, adrDAutoFailureReportedByBeat: {}, adrDAbortWasManual: false,
        ADR_D_AUTO_RETRY_DELAYS: [45000, 90000, 120000, 180000],
        adrDTypeOf: type => type === "plot" ? "plot" : "emotion",
        adrDNormAutoItem: value => value || null, adrDNormLogList: value => value || [],
        adrDNormGraze: value => !!value,
        adrDChatState: () => sandbox.adrDNormalizeChatState(database[context.chatId]),
        adrDSaveChatState: value => { database[context.chatId] = JSON.parse(JSON.stringify(sandbox.adrDNormalizeChatState(value))); return true; },
        adrDToast() {}, adrDScheduleAutoTriggerCheck: reason => scheduled.push(reason),
        adrDAutoTriggerRunning: false, adrDAutoTriggerAgainReason: "", adrDGenStreaming: false,
        adrDMasterEnabled: () => true, adrDCountReady: () => true, adrDChatKeyReady: () => true,
        adrDInStartupAutoGrace: () => false, adrCdActive: () => false,
        adrDRefreshFullAssistantRoundCount: async () => count, adrDAssistantRoundCount: () => count,
        adrDUpdateAutoCounters() {}, adrCdAutoCheck: async () => {}, autoTriggerRange: () => 10,
        adrDGetAutoState: type => baseline[type], adrDPeekAutoState: type => baseline[type],
        adrDSetAutoBaseline: (type, value) => { baseline[type].base = value; },
        adrDAdvanceAutoBaseline: (type, value) => { baseline[type].base = value; },
        adrDShouldAlignDirtyBaselineOnFirstPassiveCheck: () => false,
        saveNow() {}, adrDPersistAutoBaselineFields() {}, adrDAutoTriggerPopup() {},
        run: async (type, extra, settings) => { runs.push({ type, extra, settings }); return succeeds; },
        chatUrl: endpoint => endpoint + "/chat/completions", AbortController,
        ADR_D_STREAM_IDLE_MS: 120000,
        setTimeout: () => ++timerId, clearTimeout() {},
        adrDStreamCollector: () => {
            let text = "";
            return { push: chunk => { text += chunk; }, end() {}, mode: () => "json", raw: () => text, reasoningChars: () => 0 };
        },
        adrDReadBody: async (response, callback) => callback(await response.text()),
        parseResponse: data => data.choices[0].message.content,
        fetch: async (url, init) => {
            calls.push({ url, init });
            return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "分析完成" } }] }) };
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(
        section("    function adrDAutoBeatKey(", "    function currentType(")
        + section("    function adrDNormalizeChatState(", "    // 旧 LS 四把钥匙")
        + section("    async function buildPrompt(", "    function parseResponse(")
        + section("    async function adrDBuildApiBody(", "    function setButtons(")
        + section("    async function adrDPreviewStats(", "    function pushModel(")
        + section("    function adrDShouldSchedulePendingAutoRetry(", "    function adrDPersistAutoBaselineFields(")
        + section("    async function adrDCheckAutoTrigger(", "    // v1.16.3：删楼不罚楼"), sandbox);
    return {
        sandbox, state, context, database, calls, statuses, scheduled, runs, errors, baseline,
        advance: amount => { clock += amount; }, setCount: value => { count = value; }, setSuccess: value => { succeeds = value; }
    };
}

test("试运行按真实换行展示完整 system/user 内容，与正式发送一致且不泄露 API Key", async () => {
    const { sandbox, calls, statuses } = build();
    for (const type of ["emotion", "plot"]) {
        assert.equal(await sandbox.localTest(type), true);
        const text = sandbox.preview.text;
        const expected = await sandbox.adrDBuildApiBody(type, sandbox.adrDGetExtraInstruction(type));
        const systemHeading = "【系统预设 · system】\n";
        const userHeading = "\n\n【发送上下文 · user】\n";
        const systemStart = text.indexOf(systemHeading) + systemHeading.length;
        const userStart = text.indexOf(userHeading);
        assert.ok(systemStart >= systemHeading.length && userStart > systemStart);
        assert.equal(text.slice(systemStart, userStart), expected.messages[0].content);
        assert.equal(text.slice(userStart + userHeading.length), expected.messages[1].content);
        assert.doesNotMatch(text, /模型：|温度：|流式接收：|字数：|Token：/);
        const characters = expected.messages.reduce((total, message) => total + Array.from(message.content).length, 0);
        assert.ok(statuses.at(-1).text.includes("试运行完成 ✓｜字数：" + characters));
        assert.match(statuses.at(-1).text, /Token：约 \d+（本地粗估）/);
        assert.match(text, /临时指令必须保留/);
        assert.match(text, /角色卡\n世界书\n用户人设\n手动补充/);
        assert.match(text, /【Anima 历史总结】\n前置用语\n\n完整历史总结/);
        assert.match(text, /导演日志/);
        if (type === "plot") assert.match(text, /投卡史/);
        assert.match(text, /正文末尾/);
        assert.ok(expected.messages[1].content.length > 8000);
        assert.doesNotMatch(text, /\\n/);
        assert.doesNotMatch(text, /secret-key-not-in-preview/);
        assert.equal(sandbox.adrDGetExtraInstruction(type), "临时指令必须保留");
    }
    assert.equal(calls.length, 0);
    const body = await sandbox.adrDBuildApiBody("emotion", "临时指令必须保留");
    assert.equal(await sandbox.callAPI("emotion", "临时指令必须保留"), "分析完成");
    assert.equal(calls[0].init.body, JSON.stringify(body));
    assert.doesNotMatch(calls[0].init.body, /试运行预览|字数：|Token：|模型：|温度：|流式接收：/);
});

test("试运行保留原文的引号、标签和字面反斜杠，不进行二次反转义", async () => {
    const { sandbox, state, calls } = build();
    const preset = '第一段\n\n第二段 "引号" <content>原文</content>\n字面量：\\n 和 C:\\new\\test';
    state.emotionPreset = preset;
    state.streamEnabled = true;
    assert.equal(await sandbox.localTest("emotion"), true);
    assert.ok(sandbox.preview.text.includes("【系统预设 · system】\n" + preset + "\n\n【发送上下文 · user】"));
    assert.doesNotMatch(sandbox.preview.text, /流式接收：/);
    assert.equal(calls.length, 0);
});

test("字数仅统计完整消息正文，token 使用酒馆分词器并明确标为估算", async () => {
    const { sandbox, context, calls } = build();
    const seen = [];
    context.getTokenCountAsync = async (text, padding) => {
        seen.push({ text, padding });
        return text === "中😀\n" ? 5 : 2;
    };
    const body = { model: "不统计模型参数", temperature: 0.6, stream: true, messages: [
        { role: "system", content: "中😀\n" }, { role: "user", content: "abcd" }
    ] };
    const original = JSON.stringify(body);
    assert.equal(await sandbox.adrDPreviewStats(body), "字数：7｜Token：约 7（酒馆分词器估算）");
    assert.deepEqual(seen, [{ text: "中😀\n", padding: 0 }, { text: "abcd", padding: 0 }]);
    assert.equal(JSON.stringify(body), original);
    assert.equal(calls.length, 0);
});

test("分词器不可用、返回异常或超时均使用本地粗估，不重试且不阻塞试运行", async () => {
    const { sandbox, context, calls } = build();
    const body = { messages: [{ role: "user", content: "中文abcd" }] };
    for (const counter of [undefined, async () => { throw new Error("分词器失败"); }, async () => NaN, async () => 0]) {
        context.getTokenCountAsync = counter;
        assert.equal(await sandbox.adrDPreviewStats(body), "字数：6｜Token：约 3（本地粗估）");
    }
    let attempts = 0;
    context.getTokenCountAsync = () => { attempts++; return new Promise(() => {}); };
    sandbox.setTimeout = (handler, delay) => {
        assert.equal(delay, 2000);
        queueMicrotask(handler);
        return 1;
    };
    assert.equal(await sandbox.adrDPreviewStats(body), "字数：6｜Token：约 3（本地粗估）");
    assert.equal(attempts, 1);
    assert.equal(calls.length, 0);
});

test("分词统计期间切换聊天，不把旧预览写入新聊天", async () => {
    const { sandbox, context, calls } = build();
    sandbox.preview = { text: "保留旧预览" };
    context.getTokenCountAsync = async () => { context.chatId = "new-chat"; return 10; };
    assert.equal(await sandbox.localTest("plot"), false);
    assert.equal(sandbox.preview.text, "保留旧预览");
    assert.equal(sandbox.processing, false);
    assert.equal(calls.length, 0);
});

test("未配置 API 也可试运行，切换聊天失败不会发送或覆盖已有结果", async () => {
    const { sandbox, state, context, calls } = build();
    state.emotionApiEndpoint = "";
    state.emotionModel = "";
    assert.equal(await sandbox.localTest("emotion"), true);
    const previous = sandbox.preview.text;
    sandbox.recentContentBlocks = async () => { context.chatId = "other-chat"; return "另一聊天"; };
    assert.equal(await sandbox.localTest("emotion"), false);
    assert.equal(sandbox.preview.text, previous);
    assert.equal(sandbox.processing, false);
    assert.equal(calls.length, 0);
    sandbox.processing = true;
    assert.equal(await sandbox.localTest("emotion"), false);
    assert.equal(sandbox.processing, true);
});

test("网络失败的手动调用只发送一次，没有内部无限重试循环", async () => {
    const { sandbox, state } = build();
    state.apiRetryCount = 10;
    let requests = 0;
    sandbox.fetch = async () => { requests++; throw new TypeError("网络失败"); };
    await assert.rejects(sandbox.callAPI("emotion", ""), /网络失败/);
    assert.equal(requests, 1);
});

test("真实自动调度遵守退避和 2 次重试上限，新增楼层不会无限重发", async () => {
    const instance = build();
    const { sandbox, runs, database, errors } = instance;
    await sandbox.adrDCheckAutoTrigger("new-message");
    assert.equal(runs.length, 1);
    assert.equal(sandbox.adrDShouldSchedulePendingAutoRetry(), false);
    for (let event = 0; event < 10; event++) await sandbox.adrDCheckAutoTrigger("message-received");
    assert.equal(runs.length, 1);
    instance.advance(45000);
    assert.equal(sandbox.adrDShouldSchedulePendingAutoRetry(), true);
    await sandbox.adrDCheckAutoTrigger("poll");
    assert.equal(runs.length, 2);
    instance.advance(90000);
    await sandbox.adrDCheckAutoTrigger("poll");
    assert.equal(runs.length, 3);
    assert.equal(database.chat.retry.emotion.stopped, true);
    for (let event = 0; event < 20; event++) {
        instance.advance(200000);
        instance.setCount(50 + event);
        await sandbox.adrDCheckAutoTrigger("new-message");
    }
    assert.equal(runs.length, 3);
    assert.equal(sandbox.adrDShouldSchedulePendingAutoRetry(), false);
    assert.deepEqual(errors, []);
});

test("零次重试只请求一次，刷新与基准变化不解除暂停，手动恢复才能开启新一轮", async () => {
    const original = build({ settings: { apiRetryCount: 0 } });
    await original.sandbox.adrDCheckAutoTrigger("initial");
    assert.equal(original.runs.length, 1);
    const reloaded = build({ database: original.database, settings: { apiRetryCount: 0 } });
    reloaded.baseline.emotion.base = 1;
    await reloaded.sandbox.adrDCheckAutoTrigger("reload");
    assert.equal(reloaded.runs.length, 0);
    reloaded.sandbox.adrDResumeAutoRetries();
    await reloaded.sandbox.adrDCheckAutoTrigger("resume");
    assert.equal(reloaded.runs.length, 1);
    assert.equal(reloaded.database.chat.retry.emotion.attempts, 1);
    assert.deepEqual(reloaded.errors, []);
});

test("请求前保存次数，页面在请求中途重载也不能重置额度", () => {
    const first = build({ settings: { apiRetryCount: 0 } });
    const key = first.sandbox.adrDAutoBeatKey("emotion", 0, 10);
    assert.equal(first.sandbox.adrDBeginAutoRetryAttempt(key), true);
    const reloaded = build({ database: first.database, settings: { apiRetryCount: 0 } });
    assert.equal(reloaded.sandbox.adrDAutoRetryAllowed(key), false);
    assert.equal(reloaded.sandbox.adrDBeginAutoRetryAttempt(key), false);
});

test("服务器聊天状态未保存时采用更新的本地重试镜像，恢复操作也不会被旧状态覆盖", async () => {
    const mirror = {};
    function attachMirror(instance) {
        instance.sandbox.ADR_D_META_LS_KEY = "mirror";
        instance.sandbox.adrDReadJsonLS = () => mirror;
        instance.sandbox.adrDSaveChatState = state => {
            mirror[instance.context.chatId] = JSON.parse(JSON.stringify(instance.sandbox.adrDNormalizeChatState(state)));
            return true;
        };
    }
    const original = build({ settings: { apiRetryCount: 0 } });
    attachMirror(original);
    await original.sandbox.adrDCheckAutoTrigger("initial");
    assert.equal(original.database.chat, undefined);
    assert.equal(mirror.chat.retry.emotion.stopped, true);
    const reloaded = build({ settings: { apiRetryCount: 0 } });
    attachMirror(reloaded);
    await reloaded.sandbox.adrDCheckAutoTrigger("reload");
    assert.equal(reloaded.runs.length, 0);
    reloaded.sandbox.adrDResumeAutoRetries();
    await reloaded.sandbox.adrDCheckAutoTrigger("resume");
    assert.equal(reloaded.runs.length, 1);
    assert.equal(mirror.chat.retry.emotion.stopped, true);
});

test("双导演独立限额，成功清除本轮计数，暂停状态不串到其他聊天", async () => {
    const instance = build({ settings: { apiRetryCount: 0, autoTriggerPlot: true } });
    const { sandbox, database, runs, context } = instance;
    await sandbox.adrDCheckAutoTrigger("initial");
    assert.equal(runs.length, 2);
    assert.equal(database.chat.retry.emotion.stopped, true);
    assert.equal(database.chat.retry.plot.stopped, true);
    context.chatId = "other-chat";
    await sandbox.adrDCheckAutoTrigger("other-chat");
    assert.equal(runs.length, 4);
    context.chatId = "chat";
    sandbox.adrDResumeAutoRetries();
    instance.setSuccess(true);
    await sandbox.adrDCheckAutoTrigger("success");
    assert.equal(database.chat.retry.emotion, null);
    assert.equal(database.chat.retry.plot, null);
    assert.equal(database["other-chat"].retry.emotion.stopped, true);
});

test("手动停止当前自动请求后不再补发，旧聊天的失败结果不写入新聊天", () => {
    const { sandbox, database, context } = build();
    const key = sandbox.adrDAutoBeatKey("emotion", 0, 10);
    sandbox.adrDBeginAutoRetryAttempt(key);
    sandbox.adrDAbortWasManual = true;
    sandbox.adrDNoteAutoRetryResult(key, false);
    assert.equal(sandbox.adrDAutoRetryAllowed(key), false);
    assert.equal(database.chat.retry.emotion.stopped, true);
    context.chatId = "new-chat";
    sandbox.adrDNoteAutoRetryResult(key, false);
    assert.equal(database["new-chat"], undefined);
});

test("重试配置限制为 0–10，两套面板和按钮入口均接入", () => {
    const { sandbox } = build();
    assert.equal(sandbox.adrDGetApiRetryCount(0), 0);
    assert.equal(sandbox.adrDGetApiRetryCount("3.9"), 3);
    assert.equal(sandbox.adrDGetApiRetryCount(999), 10);
    for (const value of ["", null, undefined, -1, "bad"]) assert.equal(sandbox.adrDGetApiRetryCount(value), 2);
    assert.equal(source.split('+ adrDApiRetryControls(st, "adr044-actions")').length - 1, 1);
    assert.equal(source.split('+ adrDApiRetryControls(st, "adr048-actions")').length - 1, 1);
    assert.ok(source.includes('ids["adr044-api-retry-resume"]'));
    assert.ok(source.includes('if (id === "adr044-api-retry-resume")'));
    assert.ok(source.includes('adrDSetAllById("adr044-api-retry-count", String(adrDGetApiRetryCount(st.apiRetryCount)))'));
});
