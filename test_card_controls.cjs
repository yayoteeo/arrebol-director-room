// 抽卡流式、命名预设、真实手动投卡与自动调度回归。所有 HTTP 都是假接口。
// 需要 jsdom（与其他 UI 测试相同）；运行：node --test test_card_controls.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('index.js', 'utf8');
const SETTINGS = 'arrebol-d-final-v1040-stable-settings';
const EP = 'ARREBOL_D_CARD_DRAWER';
const hooks = `
    // 仅注入测试副本；生产代码不暴露这些接口，也不启动轮询。
    window.__cardControls = {
        settings: settings, state: adrCdChatState, saveState: adrCdSaveChatState,
        presetList: adrCdAiPresets, presetConfig: adrCdAiPresetConfig,
        presetText: adrCdAiPresetText, storePreset: adrCdStoreAiPresetText,
        applyPreset: adrCdApplyAiPreset, savePreset: adrCdSaveAiPresetAs,
        deletePreset: adrCdDeleteAiPreset, sync: syncType,
        poolBody: adrCdBuildPoolBody, cardBody: adrCdBuildCardBody,
        generationBody: adrCdBuildLibraryGenerationBody,
        pool: adrCdPickPoolViaDS, card: adrCdPickCardViaDS, fulfilled: adrCdAskFulfilled,
        request: adrCdRequestApi, body: adrCdChoiceBody,
        manual: adrCdManualDraw, auto: adrCdAutoCheck, draw: adrCdPerformDraw,
        generation: adrCdGenerateLibrary, preview: adrCdPreviewSelection,
        generationPreview: adrCdPreviewLibraryGeneration,
        isDrawing: function () { return adrCdDrawRunning; },
        isPreviewing: function () { return adrCdSelectionPreviewRunning; },
        shiftBaseline: adrCdShiftBaselineDown,
        render: function (twins) {
            document.body.innerHTML = '<div id="adr044-drawer">' + adrCdPageHTML() + '</div>'
                + (twins ? '<div id="adr048-popup-panel"><div id="adr048-popup-body">' + adrCd048PageHTML() + '</div></div>' : '');
            adrCdBindControls(); bindDirect(); adrDInstallAllButtonFallback(); adrDInstallTwinMirror();
        },
        renderAll: function () {
            document.body.innerHTML = drawerHTML() + adr048PanelHTML();
            adrCdBindControls(); bindDirect(); adrDInstallAllButtonFallback(); adrDInstallTwinMirror();
            adrxInstallDrawerMemory(); adrxInstallExpanders(); adrDRefreshAllFieldsFromSettings();
        },
        refreshFields: adrDRefreshAllFieldsFromSettings, loadEditor: adrCdLoadEditor,
        openBig: adrxOpenBigEditor, closeBig: adrxCloseBigEditor,
        startLive: adrDBeginLiveOutput, writeLive: adrDWriteLiveOutput, endLive: adrDEndLiveOutput,
        runDirector: run, manualInject: adrDRequestManualInject,
        setDirectorBody: function (fn) { adrDBuildApiBody = fn; },
        setRound: function (n) { adrDAssistantRoundCount = function () { return n; }; },
        readRecent: recentContentBlocks,
        setRecent: function (fn) { recentContentBlocks = fn; },
        setSummary: function (fn) { adrDReadAnimaHistory = fn; },
        setPrecise: function (fn) { buildPreciseContext = fn; },
        setPreviewStats: function (fn) { adrDPreviewStats = fn; }
    };
    adrDPreviewStats = async function () { return '本地测试统计'; };
})();`;
assert.match(source, /    wait\(\);\s*\}\)\(\);\s*$/);
const instrumented = source.replace(/    wait\(\);\s*\}\)\(\);\s*$/, hooks);
const POOLS = [{ slot: 'common', menuName: '通用·回声', poolName: '回声', cards: ['纸条露出一角', '门外传来脚步'] }];
const CARDS = [{ slot: 'common', pool: '通用·回声', card: '纸条露出一角' }, { slot: 'common', pool: '通用·回声', card: '门外传来脚步' }];
function json(text) { return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) }; }
function delta(value) { return 'data: ' + JSON.stringify({ choices: [{ delta: value }] }) + '\n\n'; }
function sseResponse(pieces) {
    const bytes = new TextEncoder().encode(pieces.join(''));
    let offset = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
        if (offset >= bytes.length) return { done: true };
        const value = bytes.slice(offset, offset += 7); // 包括 UTF-8 多字节/JSON 跨块
        return { done: false, value };
    } }) } };
}
function setup(t, overrides = {}) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://tests.invalid/', pretendToBeVisual: true, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const win = dom.window;
    const calls = [], logs = [], prompts = {};
    const context = {
        chatId: 'chat-a', chat: [], chatMetadata: {},
        getCurrentChatId() { return this.chatId; },
        extensionSettings: { [SETTINGS]: {
            masterEnabled: true, cdEnabled: true, cdAutoDraw: true, cdMode: 'pick', cdN: 5,
            cdLifeMode: 'stay', activeTab: 'cd', animaHistoryEnabled: false,
            cdApiEndpoint: 'https://api.invalid/v1', cdModel: 'test-model',
            cdLibraries: { '测试库': '## 回声\n纸条露出一角\n门外传来脚步' },
            cdLibHomes: { '测试库': 'common' },
            cdSlotDefaults: { story: [], common: ['测试库'], nsfw: [] },
            cdSlotOnDefaults: { story: false, common: true, nsfw: false },
            ...overrides
        } },
        saveSettingsDebounced() {}, saveSettings() {}, saveMetadataDebounced() {}, saveMetadata() {},
        extensionPrompts: prompts,
        setExtensionPrompt(key, text) { prompts[key] = { value: text }; },
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: value => value,
        eventSource: { on() {} }, event_types: {}
    };
    win.SillyTavern = { getContext: () => context };
    win.TextDecoder = TextDecoder;
    win.TextEncoder = TextEncoder;
    win.confirm = () => true;
    win.console = { log() {}, warn(...a) { logs.push(a); }, error(...a) { logs.push(a); }, info() {}, debug() {} };
    let respond = () => json('通用·回声');
    win.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return respond(options, calls.at(-1).body);
    };
    win.eval(instrumented);
    const api = win.__cardControls;
    api.setRound(0);
    api.setRecent(async () => '前文\n\n---\n\n最新一楼');
    api.setPrecise(async () => '当前角色及世界设定');
    let summaryReads = 0;
    const summary = 'ANIMA_BEGIN\n' + '完整的历史总结不应被另行截断。'.repeat(600) + '\nANIMA_END';
    api.setSummary(async () => { summaryReads++; return { text: summary }; });
    return {
        win, doc: win.document, api, context, calls, logs, prompts, summary,
        st: api.settings(), reads: () => summaryReads,
        response: fn => { respond = fn; },
        render: twins => api.render(twins),
        input(id, value, type = 'input') {
            const el = win.document.getElementById(id); assert.ok(el, id);
            if (el.type === 'checkbox') el.checked = value; else el.value = value;
            el.dispatchEvent(new win.Event(type, { bubbles: true }));
            return el;
        },
        click(id) {
            const el = win.document.getElementById(id); assert.ok(el, id);
            el.__adrDLastAcceptedTapAt = 0;
            el.__adrDLastTouchEndAt = 0;
            el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
        },
        async settle(predicate = () => !api.isDrawing() && !api.isPreviewing()) {
            for (let i = 0; i < 100; i++) {
                await new Promise(resolve => setImmediate(resolve));
                if (predicate()) return;
            }
            assert.fail('异步按钮未完成');
        }
    };
}

test('生成卡库按钮只显示文字，抽屉与悬浮窗一致且保留真实按钮语义', t => {
    const e = setup(t); e.render(true);
    const buttons = e.doc.querySelectorAll('[id="adr044-cd-generate"]');
    assert.equal(buttons.length, 2);
    buttons.forEach(button => {
        assert.equal(button.textContent, '思考生成卡库');
        assert.equal(button.type, 'button');
    });
});

test('旧抽卡预设保留，三类版本独立，名称正确转义且切换持久化', t => {
    const e = setup(t, { cdPreset: '原来的生成卡库规则' });
    e.render(true);
    assert.equal(e.api.presetText('generate'), '原来的生成卡库规则');
    for (const kind of ['generate', 'pool', 'card']) {
        const cfg = e.api.presetConfig(kind), id = 'adr044-cd-ai-' + kind;
        const old = e.api.presetText(kind);
        e.input(id + '-name', kind + ' v2 <img src=x onerror=alert(1)>');
        e.click(id + '-save');
        e.input(cfg.editor, kind + ' 的新规则');
        assert.equal(e.api.presetList(kind).length, 2);
        assert.equal(e.api.presetText(kind), kind + ' 的新规则');
        e.input(id + '-select', '默认', 'change');
        assert.equal(e.api.presetText(kind), old);
        e.input(id + '-select', kind + ' v2 <img src=x onerror=alert(1)>', 'change');
        assert.equal(e.api.presetText(kind), kind + ' 的新规则');
        assert.equal(e.doc.querySelectorAll('img').length, 0);
        const saved = JSON.parse(JSON.stringify(e.st));
        assert.equal(saved[cfg.bank].length, 2);
        assert.equal(saved[cfg.current], kind + ' v2 <img src=x onerror=alert(1)>');
        e.click(id + '-delete');
        assert.equal(e.api.presetList(kind).length, 1);
    }
    assert.equal(e.calls.length, 0);
});

test('预设不限制版本数，刷新读取不会反复保存或丢失内容', t => {
    const e = setup(t);
    e.render();
    for (let i = 0; i < 25; i++) {
        e.input('adr044-cd-ai-pool-name', '版本 ' + i);
        e.api.savePreset('pool');
    }
    assert.equal(e.api.presetList('pool').length, 26);
    e.api.storePreset('pool', '持久化正文');
    e.api.applyPreset('pool', '默认');
    e.api.applyPreset('pool', '版本 24');
    assert.equal(e.st.cdPoolPreset, '持久化正文');
    e.render();
    assert.equal(e.doc.getElementById('adr044-cd-pool-preset').value, '持久化正文');
});

for (const stream of [false, true]) {
    test(`择池/择卡/兑现共享流式开关=${stream}，自定义预设进入真实请求`, async t => {
        const e = setup(t, { cdStreamEnabled: stream, cdReplyTokens: 3000 });
        e.api.storePreset('pool', '我的择池规则');
        e.api.storePreset('card', '我的择卡规则');
        e.response((options, body) => {
            const answer = body.messages[0].content.includes('我的择池规则') ? '通用·回声' : body.messages[0].content.includes('我的择卡规则') ? '2' : '是';
            return stream ? sseResponse([delta({ reasoning_content: '不作为正文发送的思考' }), delta({ content: answer }), 'data: [DONE]\n\n']) : json(answer);
        });
        assert.equal(await e.api.pool(POOLS, e.api.state()), '通用·回声');
        assert.equal(await e.api.card(CARDS, e.api.state()), 2);
        assert.equal(await e.api.fulfilled('纸条露出一角'), true);
        assert.equal(e.calls.length, 3);
        assert.match(e.calls[0].body.messages[0].content, /我的择池规则/);
        assert.match(e.calls[1].body.messages[0].content, /我的择卡规则/);
        e.calls.forEach(call => {
            assert.equal(call.body.stream, stream);
            assert.equal(call.body.max_tokens, 3000);
            assert.equal(call.body.model, 'test-model');
        });
    });
}

test('流式开启但服务商返回 JSON 仍可用；异常/只有思考会报错，解释文字不是编号', async t => {
    const e = setup(t, { cdStreamEnabled: true });
    assert.equal(await e.api.pool(POOLS, e.api.state()), '通用·回声');
    e.response(() => sseResponse([delta({ reasoning_content: '只有思考' }), 'data: [DONE]\n\n']));
    await assert.rejects(e.api.card(CARDS, e.api.state()), /未返回有效正文/);
    e.response(() => sseResponse([delta({ content: '1' }), 'data: {"error":{"message":"中途故障"}}\n\n']));
    await assert.rejects(e.api.card(CARDS, e.api.state()), /中途故障/);
    e.response(() => json('我选 1，因为更合适'));
    await assert.rejects(e.api.card(CARDS, e.api.state()), /答复无效/);
});

test('四条路径仅在中控开启时读取/发送完整 Anima，关闭后不读不发', async t => {
    const e = setup(t);
    async function bodies() {
        const list = [await e.api.poolBody(POOLS, e.api.state()), await e.api.cardBody(CARDS, e.api.state()), await e.api.generationBody()];
        e.response(() => json('否'));
        await e.api.fulfilled('事件');
        list.push(e.calls.at(-1).body);
        return list.map(body => body.messages.map(m => m.content).join('\n'));
    }
    let all = await bodies();
    assert.equal(e.reads(), 0);
    all.forEach(text => assert.doesNotMatch(text, /ANIMA_BEGIN|ANIMA_END/));
    e.st.animaHistoryEnabled = true;
    all = await bodies();
    assert.equal(e.reads(), 4);
    all.forEach(text => assert.ok(text.includes(e.summary), '应包含未截断的完整总结'));
    e.st.animaHistoryEnabled = false;
    all = await bodies();
    assert.equal(e.reads(), 4);
    all.forEach(text => assert.doesNotMatch(text, /ANIMA_BEGIN|ANIMA_END/));
});

test('预设试运行实际按钮可见输出，未配 API 也能预览，不扣费不投卡', async t => {
    const e = setup(t, { cdApiEndpoint: '' });
    e.render();
    e.click('adr044-cd-preview-pool');
    await e.settle();
    assert.match(e.doc.getElementById('adr044-cd-selection-preview').value, /卡池名单/);
    e.click('adr044-cd-preview-card');
    await e.settle();
    assert.match(e.doc.getElementById('adr044-cd-selection-preview').value, /候选卡/);
    e.click('adr044-cd-gen-local');
    await e.settle(() => /试运行完成/.test(e.doc.getElementById('adr044-cd-gen-status').textContent));
    assert.match(e.doc.getElementById('adr044-cd-gen-preview').value, /系统预设/);
    assert.equal(e.calls.length, 0);
    assert.equal(e.api.state().history.length, 0);
});

test('手动择池按钮只调用一次 API 并真实投放；不改变自动模式', async t => {
    const e = setup(t, { cdAutoDraw: false, cdMode: 'blind', cdStreamEnabled: true });
    e.render();
    e.api.setRound(4);
    e.response(() => sseResponse([delta({ content: '通用·回声' }), 'data: [DONE]\n\n']));
    e.click('adr044-cd-draw-pool');
    await e.settle();
    assert.equal(e.calls.length, 1);
    assert.equal(e.st.cdMode, 'blind');
    assert.equal(e.api.state().lastDrawAt, 4);
    assert.equal(e.api.state().lastAutoAttemptAt, 4);
    assert.equal(e.api.state().history.length, 1);
    assert.ok(e.prompts[EP].value.includes(e.api.state().floatCard));
    assert.match(e.doc.getElementById('adr044-cd-draw-output').textContent, /已投放/);
    e.response(() => json('1'));
    e.click('adr044-cd-draw-card');
    await e.settle();
    assert.equal(e.calls.length, 2);
    assert.equal(e.api.state().history.at(-1).mode, '择卡');
});

test('免费试抽不投卡；手动盲抽投卡但零 API；仅手动档没有隐藏的兑现调用', async t => {
    const e = setup(t, { cdAutoDraw: false, cdAutoDone: true, cdLifeMode: 'half' });
    e.render();
    e.click('adr044-cd-preview-draw');
    await e.settle();
    assert.equal(e.api.state().history.length, 0);
    e.click('adr044-cd-draw-blind');
    await e.settle();
    assert.equal(e.api.state().history.length, 1);
    e.api.setRound(50);
    await e.api.auto(50, 'message_received', false);
    assert.equal(e.api.state().floatStage, 'faded');
    assert.equal(e.calls.length, 0);
});

test('自动 N=50 在第50楼调用，轮询/重复事件不重复扣费，手动成功重设间隔', async t => {
    const e = setup(t, { cdN: 50 });
    await e.api.auto(0, 'message_received', false);
    assert.equal(e.api.state().lastAutoAttemptAt, 0);
    e.api.setRound(49);
    await e.api.auto(49, 'message_received', false);
    assert.equal(e.calls.length, 0);
    e.api.setRound(50);
    await e.api.auto(50, 'message_received', false);
    await e.api.auto(50, 'poll', false);
    assert.equal(e.calls.length, 1);
    e.api.setRound(55);
    await e.api.manual('blind');
    e.api.setRound(104);
    await e.api.auto(104, 'message_received', false);
    assert.equal(e.calls.length, 1);
    e.api.setRound(105);
    await e.api.auto(105, 'message_received', false);
    assert.equal(e.calls.length, 2);
});

test('自动失败且无安全降级池时，同一拍不重试付费；下一拍才再调用', async t => {
    const e = setup(t, {
        cdN: 2, cdLibraries: { 私库: '## 单池\n测试卡' }, cdLibHomes: { 私库: 'nsfw' },
        cdSlotDefaults: { story: [], common: [], nsfw: ['私库'] },
        cdSlotOnDefaults: { story: false, common: false, nsfw: true }
    });
    e.render();
    e.response(() => { throw new Error('模拟接口故障'); });
    await e.api.auto(0, 'message_received', false);
    e.api.setRound(2);
    await e.api.auto(2, 'message_received', false);
    assert.match(e.doc.getElementById('adr044-cd-draw-output').textContent, /模拟接口故障/);
    await e.api.auto(2, 'poll', false);
    await e.api.auto(3, 'message_received', false);
    assert.equal(e.calls.length, 1);
    assert.equal(e.api.state().history.length, 0);
    e.api.setRound(4);
    await e.api.auto(4, 'message_received', false);
    assert.equal(e.calls.length, 2);
});

test('自动开关实时同步双面板；重开从当前楼计时，不改卡龄', async t => {
    const e = setup(t, { cdAutoDraw: false });
    e.render(true);
    const state = e.api.state(); state.lastDrawAt = 2; state.lastAutoAttemptAt = 2; e.api.saveState(state);
    e.api.setRound(20);
    e.input('adr044-cd-auto-draw', true, 'change');
    assert.equal(e.st.cdAutoDraw, true);
    assert.equal(e.api.state().lastDrawAt, 2);
    assert.equal(e.api.state().lastAutoAttemptAt, 20);
    e.input('adr044-cd-stream', true, 'change');
    assert.equal(e.st.cdStreamEnabled, true);
    for (const node of e.doc.querySelectorAll('#adr044-cd-stream')) assert.equal(node.checked, true);
    e.api.shiftBaseline(3, 17);
    assert.equal(e.api.state().lastDrawAt, 0);
    assert.equal(e.api.state().lastAutoAttemptAt, 17);
});

test('暂停/总开关禁用时手动与自动都不请求；处理中连点只有一次调用', async t => {
    const e = setup(t);
    let state = e.api.state(); state.paused = true; e.api.saveState(state);
    await e.api.manual('pick'); await e.api.auto(50, 'message_received', false);
    assert.equal(e.calls.length, 0);
    state.paused = false; e.api.saveState(state); e.st.masterEnabled = false;
    await e.api.manual('pick'); assert.equal(e.calls.length, 0);
    e.st.masterEnabled = true;
    let release;
    e.response(() => new Promise(resolve => { release = () => resolve(json('通用·回声')); }));
    const first = e.api.manual('pick');
    await e.settle(() => !!release);
    await e.api.manual('pick');
    assert.equal(e.calls.length, 1);
    release(); await first;
    assert.equal(e.api.state().history.length, 1);
});

test('请求途中切聊天，不注入新聊天、不降级盲抽，也不覆盖新会话状态', async t => {
    const e = setup(t);
    let release;
    e.response(() => new Promise(resolve => { release = () => resolve(json('通用·回声')); }));
    const draw = e.api.manual('pick');
    await e.settle(() => !!release);
    e.context.chatId = 'chat-b'; e.context.chatMetadata = {};
    release(); await draw;
    assert.equal(e.api.state().history.length, 0);
    assert.equal(e.api.state().floatCard, '');
    assert.ok(!e.prompts[EP] || !e.prompts[EP].value);
});

test('API 等待过程中关闭自动投卡，返回结果不再自动注入', async t => {
    const e = setup(t, { cdN: 1 });
    await e.api.auto(0, 'message_received', false);
    let release;
    e.response(() => new Promise(resolve => { release = () => resolve(json('通用·回声')); }));
    e.api.setRound(1);
    const draw = e.api.auto(1, 'message_received', false);
    await e.settle(() => !!release);
    e.st.cdAutoDraw = false;
    release(); await draw;
    assert.equal(e.api.state().history.length, 0);
});

for (const stream of [false, true]) {
    test(`AI 卡库生成遵守流式=${stream}，显示内容但不自动保存卡库`, async t => {
        const e = setup(t, { cdStreamEnabled: stream });
        e.render();
        const text = '## 线索\n旧信封被放回了桌面\n门缝下露出半张纸条';
        e.response(() => stream ? sseResponse([delta({ reasoning_content: '思考' }), delta({ content: text }), 'data: [DONE]\n\n']) : json(text));
        const before = JSON.stringify(e.st.cdLibraries);
        await e.api.generation();
        assert.equal(e.calls.length, 1);
        assert.equal(e.calls[0].body.stream, stream);
        assert.equal(e.doc.getElementById('adr044-cd-gen-preview').value, text);
        assert.equal(e.doc.getElementById('adr044-cd-lib-editor').value, text);
        assert.equal(JSON.stringify(e.st.cdLibraries), before);
        assert.match(e.doc.getElementById('adr044-cd-gen-status').textContent, /已生成/);
    });
}

for (const animaEnabled of [false, true]) {
    for (const stream of [false, true]) {
        test('卡库生成发送顺序：设定 → Anima → 正文，要求/数量收尾；Anima=' + animaEnabled + '，流式=' + stream, async t => {
            const e = setup(t, { animaHistoryEnabled: animaEnabled, cdStreamEnabled: stream, cdImportSlot: 'story' });
            e.render(true);
            const precise = '角色卡原文\n世界书原文\n用户人设原文';
            const recent = '上一轮聊天正文\n\n---\n\n当前一轮聊天正文';
            const request = '围绕失踪的旧信生成线索卡\n只写尚未完成的事件';
            e.api.setPrecise(async () => precise);
            e.api.setRecent(async () => recent);
            e.input('adr044-cd-gen-prompt', request);
            e.input('adr044-cd-gen-pools', '2');
            e.input('adr044-cd-gen-cards', '4');

            assert.equal(await e.api.generationPreview(), true);
            assert.equal(e.calls.length, 0, '试运行不调用 API');
            const preview = e.doc.getElementById('adr044-cd-gen-preview').value;
            const systemHeading = '【系统预设 · system】\n';
            const userHeading = '\n\n【发送上下文 · user】\n';
            const userStart = preview.indexOf(userHeading);
            assert.ok(userStart > preview.indexOf(systemHeading));
            const systemText = preview.slice(preview.indexOf(systemHeading) + systemHeading.length, userStart);
            const userText = preview.slice(userStart + userHeading.length);
            const headings = ['【角色卡、世界书与人设】'];
            const context = ['【角色卡、世界书与人设】\n' + precise];
            if (animaEnabled) {
                headings.push('【Anima 历史总结 · 仅作为卡库生成的历史背景】');
                context.push('【Anima 历史总结 · 仅作为卡库生成的历史背景】\n' + e.summary);
                assert.ok(userText.includes(e.summary), 'Anima 总结完整保留，不新增截断');
            } else {
                assert.doesNotMatch(userText, /Anima|ANIMA_BEGIN|ANIMA_END/);
            }
            headings.push('【当前聊天最近正文】', '【生成要求】', '【数量】');
            context.push('【当前聊天最近正文】\n' + recent);
            assert.deepEqual(userText.match(/^【[^】]+】$/gm), headings);
            assert.ok(userText.startsWith(context.join('\n\n') + '\n\n【生成要求】'), '角色设定、Anima、聊天正文相邻且依次发送');
            assert.ok(userText.endsWith('【生成要求】\n' + request + '\n\n【数量】\n生成 2 个卡池，每个卡池约 4 张卡，共约 8 张。'), '要求和数量是最后两段');
            assert.match(systemText, /不要输出除卡池标题和卡面以外的任何内容/);

            const generated = '## 旧信\n一只未拆开的信封出现在窗沿';
            e.response(() => stream ? sseResponse([delta({ content: generated }), 'data: [DONE]\n\n']) : json(generated));
            await e.api.generation();
            assert.equal(e.calls.length, 1);
            const body = e.calls[0].body;
            assert.equal(body.stream, stream);
            assert.deepEqual(body.messages, [{ role: 'system', content: systemText }, { role: 'user', content: userText }], '正式请求与试运行预览顺序及内容完全一致');
            assert.equal(e.reads(), animaEnabled ? 2 : 0, '中控关闭时既不读也不发送 Anima');
        });
    }
}

test('卡库生成没有背景资料时省略空段，生成要求和数量仍位于末尾', async t => {
    const e = setup(t, { animaHistoryEnabled: true }); e.render();
    e.api.setPrecise(async () => '');
    e.api.setRecent(async () => '');
    e.api.setSummary(async () => ({ text: '' }));
    const body = await e.api.generationBody();
    const text = body.messages[1].content;
    assert.deepEqual(text.match(/^【[^】]+】$/gm), ['【生成要求】', '【数量】']);
    assert.ok(text.endsWith('【数量】\n生成 3 个卡池，每个卡池约 5 张卡，共约 15 张。'));
});

for (const stream of [false, true]) {
    test('卡库生成按中控完整读取长正文，试运行与实际请求均无额外截断；流式=' + stream, async t => {
        const e = setup(t, { range: '50', cdN: 1, cdStreamEnabled: stream });
        e.api.renderAll();
        e.input('adr044-range', 'custom', 'change');
        e.input('adr044-custom', '1');
        e.input('adr044-include-user-messages', true, 'change');
        e.input('adr044-content-tags', '');
        e.input('adr044-excluded-content-tags', 'private');
        assert.equal(e.st.range, 'custom');
        assert.equal(Number(e.st.customRange), 1);
        const user = 'USER_BEGIN\n' + '用户的长正文。'.repeat(1000) + '\nUSER_END';
        const character = 'CHAT_BEGIN\n' + '角色的长正文。'.repeat(1500) + '\nCHAT_END';
        const precise = 'PRECISE_BEGIN\n' + '角色世界书及人设背景。'.repeat(700) + '\nPRECISE_END';
        e.context.chat = [
            { is_user: true, mes: '范围之外的用户楼层' },
            { name: '角色', mes: '范围之外的角色楼层' },
            { is_user: true, mes: '<private>用户不应发送的内容</private>' + user },
            { name: '角色', mes: character + '<private>角色不应发送的内容</private>' }
        ];
        e.api.setRecent(e.api.readRecent);
        e.api.setPrecise(async () => precise);
        assert.equal(await e.api.generationPreview(), true);
        assert.equal(e.calls.length, 0);
        const preview = e.doc.getElementById('adr044-cd-gen-preview').value;
        const userHeading = '\n\n【发送上下文 · user】\n';
        assert.ok(preview.includes(userHeading));
        const content = preview.slice(preview.indexOf(userHeading) + userHeading.length);
        assert.ok(content.includes('【角色卡、世界书与人设】\n' + precise), '中控已组装的背景资料不再被卡库生成截至 5000 字符');
        assert.ok(content.includes('【当前聊天最近正文】\n[用户｜楼层 2]\n' + user + '\n\n---\n\n[角色｜楼层 3]\n' + character), '保留选中楼层全文，不沿用单条 1200/2500 或合计 6000 字符上限');
        assert.doesNotMatch(content, /范围之外|不应发送的内容|【目标仓库】/);
        const generated = '## 旧信\n一只未拆开的信封出现在窗沿';
        e.response(() => stream ? sseResponse([delta({ content: generated }), 'data: [DONE]\n\n']) : json(generated));
        await e.api.generation();
        assert.equal(e.calls.length, 1);
        assert.equal(e.calls[0].body.messages[1].content, content, '试运行和实际请求使用同一份完整上下文');
        assert.equal(e.calls[0].body.stream, stream);
    });
}

for (const range of ['10', '50', 'custom', 'unhidden']) {
    test('卡库生成的回看范围完全跟随中控：' + range + '，不受投卡间隔影响', async t => {
        const e = setup(t, { range, customRange: 3, cdN: 1 }); e.render();
        e.context.chat = Array.from({ length: 55 }, (_, i) => ({ name: '角色', mes: '正文编号' + i + '结束' }));
        e.context.chat[1].is_hidden = true;
        e.context.chat[2].is_system = true;
        e.api.setRecent(e.api.readRecent);
        e.api.setPrecise(async () => '');
        const first = range === 'unhidden' ? 0 : 55 - (range === 'custom' ? 3 : Number(range));
        const expected = Array.from({ length: 55 - first }, (_, i) => first + i)
            .filter(i => range !== 'unhidden' || (i !== 1 && i !== 2));
        for (const interval of [1, 50]) {
            e.input('adr044-cd-n', String(interval));
            const body = await e.api.generationBody();
            const actual = Array.from(body.messages[1].content.matchAll(/正文编号(\d+)结束/g), match => Number(match[1]));
            assert.deepEqual(actual, expected, '中控指定的楼层应全部读取且不超出范围，投卡间隔=' + interval);
        }
    });
}

test('卡库生成取消截断后仍遵守中控的用户消息开关、正文标签和排除标签', async t => {
    const e = setup(t, { range: '10' });
    e.api.renderAll();
    e.input('adr044-content-tags', 'story');
    e.input('adr044-excluded-content-tags', 'private');
    e.context.chat = [
        { is_user: true, mes: '用户原文<private>用户私密段</private>' },
        { name: '角色', mes: '正文标签之外<story>标签内正文<private>角色私密段</private>完整结尾</story>' }
    ];
    e.api.setRecent(e.api.readRecent);
    e.api.setPrecise(async () => '');
    let content = (await e.api.generationBody()).messages[1].content;
    assert.match(content, /标签内正文完整结尾/);
    assert.doesNotMatch(content, /用户原文|正文标签之外|私密段/);
    e.input('adr044-include-user-messages', true, 'change');
    content = (await e.api.generationBody()).messages[1].content;
    assert.match(content, /用户原文/);
    assert.doesNotMatch(content, /正文标签之外|私密段/);
});

test('保存/导入归属不再发送给 AI，仍能在确认保存后挂入本地仓库', async t => {
    const e = setup(t); e.render(true);
    const select = e.doc.getElementById('adr044-cd-import-slot');
    assert.match(select.previousElementSibling.textContent, /仅本地使用，不发送给 AI/);
    let expected;
    for (const slot of ['', 'story', 'common', 'nsfw']) {
        e.input('adr044-cd-import-slot', slot, 'change');
        assert.equal(e.st.cdImportSlot, slot);
        const messages = JSON.stringify((await e.api.generationBody()).messages);
        assert.doesNotMatch(messages, /【目标仓库】|这是专属剧情库|这是通用库|这是 NSFW 库|用户尚未指定仓库/);
        if (expected === undefined) expected = messages;
        else assert.equal(messages, expected, '本地归属不能改变发送给 AI 的要求');
    }
    e.input('adr044-cd-import-slot', 'story', 'change');
    const generated = '## 门外\n门缝里多了一张尚未展开的纸';
    e.response(() => json(generated));
    await e.api.generation();
    assert.equal(e.calls.length, 1);
    assert.equal(JSON.stringify(e.calls[0].body.messages), expected);
    const name = e.doc.getElementById('adr044-cd-lib-name').value;
    assert.ok(name);
    assert.equal(e.st.cdLibraries[name], undefined, '生成不自动保存');
    e.click('adr044-cd-lib-save');
    assert.equal(e.st.cdLibraries[name], generated);
    assert.equal(e.st.cdLibHomes[name], 'story');
    assert.ok(e.api.state().slots.story.includes(name));
});

test('抽卡请求有空闲超时及总时限，超时会中止而不是永久锁住按钮', async t => {
    const e = setup(t);
    e.response(options => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new e.win.DOMException('aborted', 'AbortError')));
    }));
    await assert.rejects(e.api.request(e.api.body('系统', ['输入']), '测试', { idleMs: 15, hardMs: 100 }), /请求超时/);
    await assert.rejects(e.api.request(e.api.body('系统', ['输入']), '测试', { idleMs: 100, hardMs: 15 }), /请求超时/);
    assert.ok(e.calls.every(call => call.options.signal.aborted));
});

test('生成试运行在统计期间切换聊天时不显示旧聊天内容，按钮恢复', async t => {
    const e = setup(t);
    e.render();
    let release;
    e.api.setPreviewStats(() => new Promise(resolve => { release = () => resolve('统计完成'); }));
    const preview = e.api.generationPreview();
    await e.settle(() => !!release);
    e.context.chatId = 'chat-b'; e.context.chatMetadata = {};
    release();
    assert.equal(await preview, false);
    assert.match(e.doc.getElementById('adr044-cd-gen-preview').value, /聊天已切换/);
    assert.equal(e.doc.getElementById('adr044-cd-gen-local').disabled, false);
    assert.equal(e.calls.length, 0);
});


function controlledStream() {
    const queue = [], readers = [];
    let started = false;
    function deliver(item) { if (readers.length) readers.shift()(item); else queue.push(item); }
    return {
        push: value => deliver({ done: false, value: new TextEncoder().encode(value) }),
        close: () => deliver({ done: true }),
        fail: message => deliver({ error: new Error(message) }),
        started: () => started,
        response(signal) {
            if (signal) signal.addEventListener('abort', () => deliver({ error: new Error('请求中止') }), { once: true });
            return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
                started = true;
                const item = queue.length ? queue.shift() : await new Promise(resolve => readers.push(resolve));
                if (item.error) throw item.error;
                return item;
            } }) } };
        }
    };
}

test('真实分段生成：结束前编辑器/双面板/放大窗同步，草稿手改也不会覆盖旧库', async t => {
    const e = setup(t, { cdStreamEnabled: true });
    e.api.renderAll();
    const original = JSON.stringify(e.st.cdLibraries);
    const stream = controlledStream();
    e.response(options => stream.response(options.signal));
    const result = e.api.generation();
    await e.settle(stream.started);
    const editor = e.doc.getElementById('adr044-cd-lib-editor');
    e.api.openBig(editor);
    stream.push(delta({ reasoning_content: '思考不可作为卡面' }));
    await e.settle(() => /模型思考中/.test(e.doc.getElementById('adr044-cd-gen-status').textContent));
    assert.doesNotMatch(editor.value, /思考不可作为卡面/);
    const first = '## 线索\n门口出现一封';
    stream.push(delta({ content: first }));
    await e.settle(() => editor.value === first);
    const big = e.doc.querySelector('.adrx-editor-ta');
    assert.equal(big.value, first);
    assert.equal(big.readOnly, true);
    for (const field of e.doc.querySelectorAll('#adr044-cd-lib-editor')) {
        assert.equal(field.value, first); assert.equal(field.readOnly, true);
        assert.equal(field.closest('details').open, true);
    }
    assert.equal(e.doc.getElementById('adr044-cd-lib-save').disabled, true);
    assert.equal(JSON.stringify(e.st.cdLibraries), original);
    e.api.refreshFields();
    assert.equal(editor.value, first, '后台刷新不能把正在流式输出的正文刷回旧库');
    stream.push(delta({ content: '旧信\n有人敲了两下门' }));
    const full = first + '旧信\n有人敲了两下门';
    await e.settle(() => big.value === full);
    assert.equal(JSON.stringify(e.st.cdLibraries), original);
    stream.push('data: [DONE]\n\n'); stream.close(); await result;
    assert.equal(editor.readOnly, false);
    assert.equal(big.readOnly, false);
    assert.equal(e.doc.getElementById('adr044-cd-lib-save').disabled, false);
    assert.equal(e.doc.getElementById('adr044-cd-edit-select').value, '');
    e.api.closeBig();
    e.input('adr044-cd-lib-editor', full + '\n补一张手改卡');
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(JSON.stringify(e.st.cdLibraries), original, '未确认保存的生成草稿不得自动覆写已有卡库');
    e.click('adr044-cd-lib-save');
    assert.ok(Object.values(e.st.cdLibraries).some(text => text.includes('补一张手改卡')));
    assert.equal(e.st.cdLibraries['测试库'], JSON.parse(original)['测试库']);
});

test('流式中断保留已收到的卡库草稿，解除只读/按钮锁定且不保存', async t => {
    const e = setup(t, { cdStreamEnabled: true });
    e.api.renderAll();
    const original = JSON.stringify(e.st.cdLibraries), stream = controlledStream();
    e.response(options => stream.response(options.signal));
    const task = e.api.generation();
    await e.settle(stream.started);
    stream.push(delta({ content: '## 草稿\n只收到这一半' }));
    await e.settle(() => /只收到这一半/.test(e.doc.getElementById('adr044-cd-lib-editor').value));
    stream.fail('网络中断'); await task;
    assert.match(e.doc.getElementById('adr044-cd-gen-status').textContent, /网络中断/);
    assert.match(e.doc.getElementById('adr044-cd-lib-editor').value, /只收到这一半/);
    assert.equal(e.doc.getElementById('adr044-cd-lib-editor').readOnly, false);
    assert.equal(e.doc.getElementById('adr044-cd-generate').disabled, false);
    assert.equal(JSON.stringify(e.st.cdLibraries), original);
});

for (const type of ['emotion', 'plot']) {
    test(type + ' 的流式结果结束前进入普通/放大编辑器，半份内容不保存、不允许注入', async t => {
        const e = setup(t, {
            activeTab: type, streamEnabled: true, autoInjectEmotion: false, autoInjectPlot: false,
            [type + 'ApiEndpoint']: 'https://director.invalid/v1', [type + 'Model']: 'stream-test', [type + 'Preview']: '上一份完整稿'
        });
        e.api.renderAll();
        e.api.setDirectorBody(async () => ({ model: 'stream-test', stream: true, messages: [] }));
        const stream = controlledStream(); e.response(options => stream.response(options.signal));
        const task = e.api.runDirector(type, '');
        await e.settle(stream.started);
        const editor = e.doc.getElementById('adr044-' + type + '-preview');
        e.api.openBig(editor);
        stream.push(delta({ content: '新的建议前半段' }));
        await e.settle(() => editor.value === '新的建议前半段');
        assert.equal(e.doc.querySelector('.adrx-editor-ta').value, editor.value);
        assert.equal(e.doc.querySelector('.adrx-editor-ta').readOnly, true);
        assert.equal(e.st[type + 'Preview'], '上一份完整稿');
        e.api.sync(type); e.api.refreshFields();
        assert.equal(e.st[type + 'Preview'], '上一份完整稿');
        assert.equal(editor.value, '新的建议前半段');
        assert.equal(e.api.manualInject(type), false);
        stream.push(delta({ content: '，接着是后半段' }));
        await e.settle(() => /后半段/.test(editor.value));
        stream.push('data: [DONE]\n\n'); stream.close();
        assert.equal(await task, true);
        assert.equal(e.st[type + 'Preview'], editor.value);
        assert.equal(e.doc.querySelector('.adrx-editor-ta').readOnly, false);
        assert.match(editor.value, /后半段/);
    });
}

test('只读预览放大后仍只读，关闭不会派发修改事件；普通编辑未提交文字不被后台刷掉', t => {
    const e = setup(t); e.api.renderAll();
    const readonly = e.doc.getElementById('adr044-cd-gen-preview');
    readonly.value = '只读预览'; let inputs = 0;
    readonly.addEventListener('input', () => inputs++);
    e.api.openBig(readonly);
    assert.equal(e.doc.querySelector('.adrx-editor-ta').readOnly, true);
    e.doc.querySelector('.adrx-editor-ok').click();
    assert.equal(inputs, 0);
    const editable = e.doc.getElementById('adr044-cd-preset');
    e.api.openBig(editable);
    const big = e.doc.querySelector('.adrx-editor-ta');
    big.value = '用户还没有提交的新文字'; big.dispatchEvent(new e.win.Event('input'));
    e.api.refreshFields();
    assert.equal(big.value, '用户还没有提交的新文字');
});

test('输出自动跟随底部，但用户向上阅读时不强拉回末尾', t => {
    const e = setup(t); e.render();
    const editor = e.doc.getElementById('adr044-cd-gen-preview');
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, get: () => 1000 });
    Object.defineProperty(editor, 'clientHeight', { configurable: true, get: () => 200 });
    editor.scrollTop = 800;
    const live = e.api.startLive(editor.id, '第一段');
    assert.equal(editor.scrollTop, 1000);
    editor.scrollTop = 100;
    e.api.writeLive(live, '第一段，第二段');
    assert.equal(editor.scrollTop, 100);
    e.api.endLive(live);
});

test('三个大类下每个模块都可折叠，默认只展开常用区，双面板同步并记住状态', async t => {
    const e = setup(t); e.api.renderAll();
    for (const root of ['#adr044-drawer', '#adr048-popup-panel']) {
        const modules = e.doc.querySelectorAll(root + ' details.adrx-module');
        assert.equal(modules.length, 15);
        assert.equal([...modules].filter(node => node.open).length, 3);
        for (const module of modules) assert.ok(module.querySelector(':scope > summary'), module.outerHTML);
    }
    const selector = '[data-drawer-id="cd-generation"]';
    const section = e.doc.querySelector('#adr048-popup-panel ' + selector);
    section.querySelector('summary').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok([...e.doc.querySelectorAll(selector)].every(node => node.open));
    assert.equal(JSON.parse(e.win.localStorage.getItem('arrebol_d_ui_drawer_state_v1'))['cd-generation'], true);
    e.api.renderAll();
    assert.ok([...e.doc.querySelectorAll(selector)].every(node => node.open));
    e.doc.querySelector('#adr044-drawer ' + selector + ' > summary').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok([...e.doc.querySelectorAll(selector)].every(node => !node.open));
    e.api.renderAll();
    assert.ok([...e.doc.querySelectorAll(selector)].every(node => !node.open));
});

test('生成期间切换聊天，即使编辑器仍有焦点也清掉旧聊天的半份草稿', async t => {
    const e = setup(t, { cdStreamEnabled: true }); e.api.renderAll();
    const original = JSON.stringify(e.st.cdLibraries);
    const editor = e.doc.getElementById('adr044-cd-lib-editor'); editor.focus();
    const stream = controlledStream(); e.response(options => stream.response(options.signal));
    const task = e.api.generation(); await e.settle(stream.started);
    stream.push(delta({ content: '## 旧聊天的临时草稿\n这一半不应进入新聊天' }));
    await e.settle(() => /这一半/.test(editor.value));
    assert.equal(e.doc.activeElement, editor);
    e.context.chatId = 'chat-b'; e.context.chatMetadata = {};
    stream.push(delta({ content: '\n还在发送的旧聊天内容' }));
    await task;
    for (const node of e.doc.querySelectorAll('#adr044-cd-lib-editor')) {
        assert.doesNotMatch(node.value, /旧聊天|这一半/);
        assert.equal(node.readOnly, false);
    }
    assert.match(e.doc.getElementById('adr044-cd-gen-preview').value, /聊天已切换/);
    assert.equal(JSON.stringify(e.st.cdLibraries), original);
    assert.notEqual(e.doc.getElementById('adr044-cd-edit-select').value, '');
});

for (const failure of ['network', 'sse-error']) {
    test('导演流式 ' + failure + ' 不能把半份稿当完成，恢复旧稿并解锁放大编辑器', async t => {
        const e = setup(t, {
            activeTab: 'emotion', streamEnabled: true, autoInjectEmotion: false,
            emotionApiEndpoint: 'https://director.invalid/v1', emotionModel: 'test', emotionPreview: '上一份完整稿'
        });
        e.api.renderAll();
        e.api.setDirectorBody(async () => ({ model: 'test', stream: true, messages: [] }));
        const stream = controlledStream(); e.response(options => stream.response(options.signal));
        const task = e.api.runDirector('emotion', ''); await e.settle(stream.started);
        const editor = e.doc.getElementById('adr044-emotion-preview'); e.api.openBig(editor);
        stream.push(delta({ content: '这是不完整的新稿' }));
        await e.settle(() => editor.value === '这是不完整的新稿');
        if (failure === 'network') stream.fail('网络中断');
        else { stream.push('data: {"error":{"message":"上游流式中断"}}\n\n'); stream.close(); }
        assert.equal(await task, false);
        assert.equal(editor.value, '上一份完整稿');
        assert.equal(e.st.emotionPreview, '上一份完整稿');
        assert.equal(e.doc.querySelector('.adrx-editor-ta').value, '上一份完整稿');
        assert.equal(e.doc.querySelector('.adrx-editor-ta').readOnly, false);
        assert.equal(e.doc.getElementById('adr044-emotion-generate').disabled, false);
    });
}