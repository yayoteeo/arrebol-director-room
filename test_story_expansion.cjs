// 分幕与基调回归：node --test test_story_expansion.cjs；仅使用 Node 内置模块和虚构聊天。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('index.js', 'utf8');
const SETTINGS = 'arrebol-d-final-v1040-stable-settings';
const EP = 'ARREBOL_D_CARD_DRAWER';
const hooks = `
    window.__story = {
        settings: settings, state: adrCdChatState, save: adrCdSaveChatState,
        normalize: adrCdNormExpand, parse: adrCdParseExpandJson,
        stepText: adrCdExpandStepText, render: adrCdExpandRenderList,
        html: adrCdExpandListHTML, history: adrCdExpandHistoryBlock,
        ai: adrCdExpandOnAiMessage, user: adrCdExpandOnUserMessage,
        next: adrCdExpandNext, prev: adrCdExpandPrev, stop: adrCdExpandStop,
        edit: adrCdExpandEditStep, action: adrCdExpandStepAction,
        replan: adrCdExpandReplan, expand: adrCdExpandCard,
        wanted: adrCdExpandWanted, request: adrDChatCompletionText,
        draw: adrCdPerformDraw, auto: adrCdAutoCheck, lifecycle: adrCdAdvanceLifecycle,
        restore: adrCdRestoreFloat, close: adrCdCloseCard,
        store: adrDToneStore, storeTone: adrDSaveToneToStore, deleteTone: adrDDeleteToneFromStore,
        tone: adrDChatTone, setTone: adrDSetChatTone, toneBlock: adrDToneBlock,
        toneSystem: adrDToneSystemLine, toneHtml: adrDToneBlockHTML,
        directorBody: adrDBuildApiBody,
        setRound: function (n) { adrDAssistantRoundCount = function () { return n; }; },
        setPrecise: function (fn) { buildPreciseContext = fn; },
        setRecent: function (fn) { recentContentBlocks = fn; },
        setExpand: function (fn) { adrCdExpandCard = fn; },
        setSummary: function (fn) { adrDReadAnimaHistory = fn; }
    };
})();`;
assert.match(source, /    wait\(\);\s*\}\)\(\);\s*$/);
const instrumented = source.replace(/    wait\(\);\s*\}\)\(\);\s*$/, hooks);
const plain = value => JSON.parse(JSON.stringify(value));
const steps = () => [
    { name: '雨声', text: '雨点落在窗台。' },
    { name: '伞', text: '门边只剩下一把伞。' },
    { name: '放晴', text: '街角的云散开了。' }
];
const expansion = () => ({ on: true, finished: false, steps: steps(), cursor: 0, served: 0, used: false, per: 1, analysis: '分析：接续雨天。', card: '雨天出门', t: 100 });
const result = () => ({ ...expansion(), warnings: [] });
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function setup(overrides = {}) {
    const storage = new Map(), metas = new Map([['chat-a', {}]]), prompts = {}, calls = [];
    const panels = [];
    const document = {
        activeElement: null,
        querySelector: () => null,
        querySelectorAll: selector => selector === '#adr044-cd-expand-panel' ? panels : [],
        createElement: () => ({ textContent: '', get innerHTML() {
            return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        } })
    };
    const context = {
        chatId: 'chat-a', chat: [], chatMetadata: metas.get('chat-a'),
        getCurrentChatId() { return this.chatId; },
        extensionSettings: { [SETTINGS]: {
            masterEnabled: true, cdEnabled: true, cdExpandEnabled: true,
            cdExpandN: 3, expandApiEndpoint: 'https://expand.invalid/v1', expandModel: 'fake-model',
            cdMode: 'blind', cdN: 5, cdLifeMode: 'stay',
            cdLibraries: { '测试': '## 雨天\n雨天出门' }, cdLibHomes: { '测试': 'common' },
            cdSlotDefaults: { story: [], common: ['测试'], nsfw: [] },
            cdSlotOnDefaults: { story: false, common: true, nsfw: false },
            ...overrides
        } },
        saveSettingsDebounced() {}, saveSettings() {}, saveMetadataDebounced() {}, saveMetadata() {},
        extensionPrompts: prompts,
        setExtensionPrompt(key, text, position, depth) { prompts[key] = { value: text, depth }; },
        extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 },
        substituteParams: text => text
    };
    const window = { document, localStorage: {
        getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
    } };
    let responder = () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ steps: steps() }) } }] }) });
    const sandbox = {
        window, document, SillyTavern: { getContext: () => context },
        console: { log() {}, warn() {}, error() {} },
        AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout,
        fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return responder(url, options); }
    };
    vm.runInNewContext(instrumented, sandbox, { filename: 'index.js' });
    const api = window.__story;
    api.setRound(10);
    api.setPrecise(async () => '当前角色设定');
    api.setRecent(async () => '此刻雨落在窗边');
    api.setSummary(async () => ({ text: '' }));
    function start(changes = {}) {
        const state = api.state();
        Object.assign(state, {
            floatCard: '雨天出门', floatStage: 'active', lastDrawAt: 10, lastAutoAttemptAt: 10,
            history: [{ card: '雨天出门', slot: 'common', floor: 10, t: 100, status: 'live' }],
            expand: expansion(), ...changes
        });
        if (state.expand) state.floatText = api.stepText(state.expand, state.expand.cursor);
        api.save(state);
        api.restore('test');
        return api.state();
    }
    return {
        api, context, window, document, prompts, calls, start,
        settings: api.settings(), state: () => plain(api.state()),
        prompt: () => prompts[EP]?.value || '',
        response: fn => { responder = fn; },
        addPanel() {
            const attrs = {};
            const el = { innerHTML: '', contains: target => target && target.panel === el,
                getAttribute: name => attrs[name] ?? null, setAttribute: (name, value) => { attrs[name] = String(value); } };
            panels.push(el); return el;
        },
        switchChat(key) { if (!metas.has(key)) metas.set(key, {}); context.chatId = key; context.chatMetadata = metas.get(key); }
    };
}

test('分幕按回复位推进：重抽与用户连发不多算，走完结案并重置抽卡基准线', () => {
    const h = setup(); h.start();
    h.api.user(); assert.equal(h.state().expand.cursor, 0);
    h.api.ai(); h.api.ai(); h.api.user();
    assert.equal(h.state().expand.cursor, 1);
    h.api.user(); assert.equal(h.state().expand.cursor, 1);
    assert.match(h.prompt(), /门边只剩下一把伞/);
    assert.doesNotMatch(h.prompt(), /街角的云散开/);
    assert.equal(h.prompts[EP].depth, 0);
    h.api.ai(); h.api.user(); h.api.ai(); h.api.setRound(13); h.api.user();
    assert.equal(h.state().expand.finished, true);
    assert.equal(h.state().expand.on, false);
    assert.equal(h.state().floatStage, 'done');
    assert.equal(h.state().history.at(-1).status, 'done');
    assert.equal(h.state().lastDrawAt, 13);
    assert.equal(h.prompt(), '');
});

test('每幕多轮按完整回复计数，暂停期间的收发消息不消耗回复位', () => {
    const h = setup(); h.start({ expand: { ...expansion(), per: 2 } });
    h.api.ai(); h.api.user(); assert.equal(h.state().expand.served, 1);
    h.api.ai();
    const state = h.api.state(); state.paused = true; h.api.save(state); h.api.restore('pause');
    h.api.user(); h.api.ai();
    assert.equal(h.state().expand.cursor, 0);
    assert.equal(h.state().expand.served, 1);
    assert.equal(h.state().expand.used, true);
    state.paused = false; h.api.save(state); h.api.user();
    assert.equal(h.state().expand.cursor, 1);
});

test('暂停或总开关关闭时，AI 回复不能把尚未注入的幕标为已演', () => {
    const h = setup(); h.start({ paused: true }); h.api.ai();
    assert.equal(h.state().expand.used, false);
    const state = h.api.state(); state.paused = false; h.api.save(state);
    h.settings.masterEnabled = false; h.api.restore('off');
    h.api.edit(0, 'text', '新写的雨声。', true); h.api.next();
    assert.equal(h.prompt(), '');
});

test('当前幕输入即时保存并更新注入，临时清空不删幕也不挪动后续索引', () => {
    const h = setup(); h.start();
    h.api.edit(0, 'text', '', false);
    assert.equal(h.state().expand.steps.length, 3);
    assert.equal(h.state().expand.steps[0].text, steps()[0].text);
    h.api.edit(0, 'text', '窗外响起新的雨声。', false);
    assert.match(h.prompt(), /窗外响起新的雨声/);
    assert.match(h.state().floatText, /窗外响起新的雨声/);
    h.api.edit(0, 'text', '   ', true);
    assert.equal(h.state().expand.steps[0].text, '窗外响起新的雨声。');
});

test('追加、删除非当前幕或改上一幕标题后，注入总数、序号和衔接一起更新', () => {
    const h = setup(); h.start({ expand: { ...expansion(), cursor: 1, used: true } });
    h.api.action('add', -1); assert.match(h.prompt(), /第 2\/4 幕/);
    h.api.edit(0, 'name', '骤雨', true); assert.match(h.prompt(), /上一幕已经演过：骤雨/);
    h.api.action('del', 0);
    assert.match(h.prompt(), /第 1\/3 幕/);
    assert.doesNotMatch(h.prompt(), /上一幕已经演过/);
    assert.match(h.prompt(), /门边只剩下一把伞/);
    assert.equal(h.state().expand.used, true);
    h.api.action('down', 0);
    assert.equal(h.state().expand.cursor, 1);
    assert.match(h.prompt(), /第 2\/3 幕/);
    assert.match(h.prompt(), /门边只剩下一把伞/);
});

test('分幕按钮保有焦点时也更新列表；输入框编辑时不重建，切聊后不保留旧表单', () => {
    const h = setup(); h.start(); const el = h.addPanel();
    h.api.render(h.api.state());
    h.document.activeElement = { panel: el, tagName: 'BUTTON' };
    h.api.action('add', -1);
    assert.match(el.innerHTML, /第 4 幕/);
    const html = el.innerHTML;
    h.document.activeElement = { panel: el, tagName: 'TEXTAREA' };
    h.api.edit(0, 'text', '保留光标', false); h.api.render(h.api.state());
    assert.equal(el.innerHTML, html);
    h.switchChat('chat-b'); h.api.render(h.api.state());
    assert.equal(el.innerHTML, '');
});

test('重新展开的迟到结果不覆盖途中编辑的分幕，也不覆盖后来换上的卡', async () => {
    for (const change of [
        h => h.api.edit(1, 'text', '用户刚改好的下一幕', true),
        h => h.start({ floatCard: '另一张卡', expand: { ...expansion(), card: '另一张卡', t: 200 } }),
        h => h.api.stop(),
        h => { h.settings.masterEnabled = false; h.api.restore('off'); }
    ]) {
        const h = setup(); h.start(); const pending = deferred();
        h.api.setExpand(() => pending.promise);
        const task = h.api.replan(); change(h); const before = h.state();
        pending.resolve({ ...result(), steps: [{ name: '迟到', text: '不能覆盖的新计划' }], t: 999 });
        await task;
        assert.deepEqual(h.state(), before);
    }
});

test('重新展开成功保留当前卡身份，重复点击只请求一次，完成后可再次请求', async () => {
    const h = setup(); h.start(); let calls = 0; const pending = deferred();
    h.api.setExpand(() => { calls++; return pending.promise; });
    const task = h.api.replan(); await h.api.replan(); assert.equal(calls, 1);
    pending.resolve({ ...result(), steps: [{ name: '重新', text: '新的展开' }, steps()[2]], t: 200 });
    await task;
    assert.equal(h.state().expand.steps.length, 2);
    assert.match(h.prompt(), /新的展开/);
    assert.equal(h.state().floatCard, '雨天出门');
    h.api.setExpand(async () => { calls++; return result(); }); await h.api.replan();
    assert.equal(calls, 2);
});

test('重新展开遵守开关与 NSFW 外发许可，未许可不请求展开 API', async () => {
    const h = setup();
    h.start({ floatCard: '受限仓卡片', history: [{ card: '受限仓卡片', slot: 'nsfw', floor: 10, t: 100, status: 'live' }] });
    let calls = 0; h.api.setExpand(async () => { calls++; return result(); });
    await h.api.replan(); assert.equal(calls, 0);
    h.settings.cdExpandNsfw = true; await h.api.replan(); assert.equal(calls, 1);
    h.settings.cdExpandEnabled = false; await h.api.replan(); assert.equal(calls, 1);
});

test('展开收集上下文期间切换聊天时取消，不混用另一聊天正文、不发 HTTP', async () => {
    const h = setup(); const pending = deferred(); let recentReads = 0;
    h.api.setPrecise(() => pending.promise);
    h.api.setRecent(async () => { recentReads++; return '另一个聊天'; });
    const task = h.api.expand('雨天出门');
    h.switchChat('chat-b'); pending.resolve('旧聊天设定');
    await assert.rejects(task, error => error.adrCdCanceled === true);
    assert.equal(recentReads, 0);
    assert.equal(h.calls.length, 0);
});

test('分幕与基调按聊天隔离，切回时恢复原进度及 depth 0 注入', () => {
    const h = setup(); h.start(); h.api.next(); h.api.setTone('轻松日常', '自定');
    h.switchChat('chat-b'); assert.equal(h.state().expand, null); assert.equal(h.api.tone(), null);
    h.api.setTone('悬疑', '另一条'); h.start({ expand: { ...expansion(), per: 2 } });
    h.switchChat('chat-a'); h.api.restore('switch');
    assert.equal(h.state().expand.cursor, 1); assert.equal(h.api.tone().text, '轻松日常');
    assert.match(h.prompt(), /第 2\/3 幕/); assert.equal(h.prompts[EP].depth, 0);
});

test('解析分析段里的花括号、代码围栏及兼容条数，注入只包含当前幕', () => {
    const h = setup();
    const parsed = h.api.parse('【分析】先看 {此刻}。\n【步骤】\n```json\n' + JSON.stringify({ steps: steps() }) + '\n```', 3);
    assert.deepEqual(plain(parsed.steps), steps()); assert.match(parsed.analysis, /先看 \{此刻\}/);
    assert.equal(h.api.parse(JSON.stringify({ steps: steps() }), 2).steps.length, 2);
    assert.equal(h.api.parse(JSON.stringify({ steps: steps() }), 4).warnings.length, 1);
    assert.throws(() => h.api.parse('{"steps":[]}', 3), /一幕都没/);
    assert.throws(() => h.api.parse('{"steps":[', 3), /没有可解析/);
    const text = h.api.stepText(expansion(), 0);
    assert.match(text, /雨点落在窗台/); assert.doesNotMatch(text, /只剩下一把伞|街角的云/);
});

test('基调仓自定义条目与删除出厂条目持久化，清空聊天基调不复活旧值', () => {
    const h = setup(); h.api.store(); h.api.deleteTone('轻松日常');
    assert.equal(Object.hasOwn(h.api.store(), '轻松日常'), false);
    h.api.storeTone('自定', '只写日常'); h.api.setTone(h.api.store().自定, '自定');
    assert.match(h.api.toneBlock(), /只写日常/); assert.match(h.api.toneSystem(), /第一要义/);
    h.api.setTone('', ''); assert.equal(h.api.toneBlock(), ''); assert.equal(h.api.toneSystem(), '');
    assert.equal(h.api.store().自定, '只写日常');
});

test('基调仓允许特殊名称且不把继承属性当成仓内条目', () => {
    const h = setup();
    assert.equal(h.api.deleteTone('toString'), false);
    h.api.storeTone('__proto__', '作为普通名字保存');
    assert.equal(Object.hasOwn(h.api.store(), '__proto__'), true);
    assert.equal(h.api.store().__proto__, '作为普通名字保存');
});

test('展开请求使用独立 API 与温度，读取上下文后不被新设置改写本次参数', async () => {
    const h = setup({ cdExpandPer: 2, cdExpandTemp: 0.4, expandPreset: '本次提示词' });
    h.api.setTone('基调测试', '自定');
    const pending = deferred(); h.api.setPrecise(() => pending.promise);
    const task = h.api.expand('雨天出门');
    h.settings.cdExpandPer = 4; h.settings.cdExpandTemp = 1.7; h.settings.expandPreset = '下一次提示词';
    pending.resolve('当前角色设定'); const info = await task;
    assert.equal(info.per, 2);
    assert.equal(h.calls[0].body.temperature, 0.4);
    assert.equal(h.calls[0].body.messages[0].content, '本次提示词');
    assert.match(h.calls[0].body.messages[1].content, /基调测试/);
    assert.equal(h.calls[0].url, 'https://expand.invalid/v1/chat/completions');
});
