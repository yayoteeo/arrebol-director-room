// 复选框外观回归：使用本机无头浏览器验证真实 CSS 层叠，不请求任何 API。
// ADR_THEME_BROWSER 指向 Chromium / Edge；可选 ADR_CHECKBOX_SCREENSHOT 保存桌面预览。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const source = fs.readFileSync('index.js', 'utf8');
const start = source.indexOf('    function adrDThemeMode(');
const end = source.indexOf('    function adr048BindPopupPanel(', start);
assert.ok(start >= 0 && end > start);
const helpers = source.slice(start, end);

function fixture() {
    const rows = (prefix, cls) => `
        <label class="${cls}"><input id="${prefix}-off" type="checkbox">启用自动抽卡</label>
        <label class="${cls}"><input id="${prefix}-on" type="checkbox" checked>开启抽卡 API 流式输出</label>
        <label class="${cls}"><input id="${prefix}-disabled" type="checkbox" disabled>暂不可用的选项</label>
        <label class="${cls}"><input id="${prefix}-disabled-on" type="checkbox" checked disabled>暂不可用的已选选项</label>
        <details class="adrx-drawer" open><summary>进阶设置</summary>
            <label class="${cls}"><input id="${prefix}-advanced" type="checkbox" checked>读取 Anima 历史总结</label>
            <label class="${cls}"><input id="${prefix}-long" type="checkbox">读取用户消息；关闭时只读取角色消息，正文标签筛选与排除规则仍然保持生效。</label>
        </details>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
        /* 复现酒馆会参与层叠的原生复选框规则：尺寸、外描边及 ::before 勾选。 */
        :root{--mainFontSize:16px;--grey5020a:#8884;--SmartThemeBorderColor:#aaa;--SmartThemeBodyColor:#222;--SmartThemeShadowColor:#777;--SmartThemeCheckboxTickColor:#fff;--SmartThemeQuoteColor:#729b91}
        input[type='checkbox']{appearance:none;outline:1px solid var(--grey5020a);position:relative;width:var(--mainFontSize);height:var(--mainFontSize);overflow:hidden;border-radius:3px;border:1px solid var(--SmartThemeBorderColor);background-color:var(--SmartThemeBodyColor);box-shadow:inset 0 0 2px var(--SmartThemeShadowColor);cursor:pointer;transform:translateY(-.075em);flex-shrink:0;place-content:center;filter:brightness(1.2);display:grid}
        input[type='checkbox']::before{content:'';width:.65em;height:.65em;transform:scale(0);box-shadow:inset 1em 1em var(--SmartThemeCheckboxTickColor);transform-origin:bottom left;clip-path:polygon(14% 44%,0 65%,50% 100%,100% 16%,80% 0%,43% 62%)}
        input[type='checkbox']:checked::before{transform:scale(1)}
        input[type='checkbox']:disabled{color:grey;cursor:not-allowed}
    </style><style>${fs.readFileSync('style.css', 'utf8')}</style><style id="native-skin"></style>
    <style>
        *,*::before,*::after{transition:none!important;animation:none!important}
        body{margin:0;padding:24px;background:#eef0f5;font-family:system-ui,sans-serif}
        #rm_extensions_block{padding:16px;border-radius:16px}
        .inline-drawer-content{display:block!important}
        body.ui-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}
        body.ui-preview #adr048-popup-panel{position:static!important;display:block!important;inset:auto!important;width:auto!important;height:auto!important;padding:0!important;background:transparent!important;backdrop-filter:none!important}
        body.ui-preview #adr048-popup-shell{width:100%!important;max-width:100%!important;max-height:none!important;margin:0!important;transform:none!important}
        body.ui-preview #adr048-popup-body{max-height:none!important}
        body.ui-preview #send_textarea,body.ui-preview #native-check,body.ui-preview #results{display:none}
        @media(max-width:600px){body.ui-preview{grid-template-columns:minmax(0,1fr);padding:12px;gap:16px}}
    </style></head><body>
    <div id="rm_extensions_block"><div id="adr044-drawer"><div class="inline-drawer"><div class="inline-drawer-header"><b>扩展抽屉 · 复选项</b></div><div class="inline-drawer-content"><div class="adr044-box"><div class="adr044-page"><details class="adrx-module" open><summary>抽卡设置</summary>${rows('drawer', 'adr044-check')}</details></div></div></div></div></div></div>
    <textarea id="send_textarea"></textarea><input id="native-check" type="checkbox" checked>
    <div id="adr048-popup-panel" data-open="1"><div id="adr048-popup-shell"><div id="adr048-popup-head"><span>悬浮窗 · 抽卡设置</span></div><div id="adr048-popup-body"><div class="adr048-page"><details class="adr048-section adrx-module" open><summary class="adr048-summary">抽卡选项</summary>${rows('popup', 'adr048-check')}<div class="adr048-actions"><button id="adr044-cd-generate" type="button">思考生成卡库</button></div></details></div></div></div></div>
    <pre id="results"></pre><script>
    const state={themeMode:'dawn'};
    function settings(){return state} function rootDoc(){return document} function rootWin(){return window}
    function adr048SetImportant(el,key,value){el.style.setProperty(key,value,'important')}
    function save(key,value){state[key]=value} function saveNow(){} function adrDSetAllById(){}
    ${helpers}
    function applySkin(mode){
        const dark=mode==='tavern-dark';
        document.querySelector('#native-skin').textContent=':root{--SmartThemeBodyColor:'+(dark?'#eee':'#222')+';--SmartThemeBlurTintColor:'+(dark?'#24282e':'#f4f5f6')+';--SmartThemeBorderColor:#888;--SmartThemeQuoteColor:#729b91} #rm_extensions_block{background:'+(dark?'#24282e':'#f4f5f6')+';color:'+(dark?'#eee':'#222')+'} #send_textarea{background:'+(dark?'#30343a':'#fff')+';color:'+(dark?'#eee':'#222')+'}';
        state.themeMode=mode.startsWith('tavern-')?'tavern':mode;
        adr048ApplyPanelTheme();
    }
    function snapshot(){
        const report={};
        document.querySelectorAll('input[type="checkbox"]').forEach(el=>{
            const s=getComputedStyle(el),r=el.getBoundingClientRect(),label=el.closest('label'),ls=label&&getComputedStyle(label);
            report[el.id]={width:r.width,height:r.height,appearance:s.appearance,radius:s.borderRadius,shadow:s.boxShadow,filter:s.filter,transform:s.transform,background:s.backgroundImage,fill:s.backgroundColor,margin:s.margin,before:getComputedStyle(el,'::before').content,after:getComputedStyle(el,'::after').content,checked:el.checked,disabled:el.disabled,cursor:s.cursor,label:ls&&{shadow:ls.boxShadow,transform:ls.transform,border:ls.borderTopColor,opacity:ls.opacity,gap:ls.columnGap}};
        });
        return report;
    }
    try{
        const themes={};
        for(const mode of ['dawn','dusk','tavern-light','tavern-dark']){applySkin(mode);themes[mode]=snapshot()}
        const interactions={};
        for(const prefix of ['drawer','popup']){
            const off=document.getElementById(prefix+'-off'),disabled=document.getElementById(prefix+'-disabled');
            let changes=0;off.addEventListener('change',()=>changes++);
            off.closest('label').click();const on=off.checked;off.click();
            disabled.click();off.focus();
            interactions[prefix]={on,off:off.checked,changes,disabled:disabled.checked,focused:document.activeElement===off,outline:getComputedStyle(off).outlineWidth,outlineStyle:getComputedStyle(off).outlineStyle,focusVisible:off.matches(':focus-visible'),tabIndex:off.tabIndex};
        }
        applySkin('dawn');document.activeElement.blur();document.body.classList.add('ui-preview');
        // 仅调整测试预览的摆放，方便并排检查；不改复选框及其标签样式。
        for(const id of ['adr048-popup-panel','adr048-popup-shell']){
            const el=document.getElementById(id);
            for(const [key,value] of Object.entries({position:'relative',inset:'auto',display:'block',width:'100%',height:'auto','min-height':'0','max-height':'none','max-width':'100%',margin:'0',transform:'none'}))el.style.setProperty(key,value,'important');
        }
        document.getElementById('results').textContent=JSON.stringify({themes,interactions});
    }catch(error){document.getElementById('results').textContent=JSON.stringify({error:error.stack||String(error)})}
    </script></body></html>`;
}

for (const viewport of ['1440,980', '390,844']) {
    test('真实浏览器复选框：主题、原生样式隔离与交互；视口=' + viewport, { skip: !process.env.ADR_THEME_BROWSER }, () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-checkbox-'));
        const file = path.join(directory, 'checkbox.html');
        fs.writeFileSync(file, fixture(), 'utf8');
        const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--user-data-dir=' + path.join(directory, 'profile'), '--window-size=' + viewport, '--virtual-time-budget=1500', '--dump-dom'];
        if (process.env.ADR_CHECKBOX_SCREENSHOT && viewport.startsWith('1440')) args.push('--screenshot=' + process.env.ADR_CHECKBOX_SCREENSHOT);
        args.push(pathToFileURL(file).href);
        const result = spawnSync(process.env.ADR_THEME_BROWSER, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
        assert.equal(result.status, 0, String(result.error || result.stderr));
        const match = result.stdout.match(/<pre id="results"[^>]*>([^<]+)<\/pre>/);
        assert.ok(match, result.stderr + result.stdout.slice(-1500));
        const report = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        assert.equal(report.error, undefined);
        for (const [mode, controls] of Object.entries(report.themes)) {
            for (const [id, c] of Object.entries(controls)) {
                if (id === 'native-check') {
                    assert.equal(c.width, 16, '扩展外原生尺寸和伪元素保持原样');
                    assert.notEqual(c.before, 'none');
                    assert.notEqual(c.transform, 'none');
                    continue;
                }
                const message = mode + ' / ' + id;
                assert.equal(c.width, 20, message);
                assert.equal(c.height, 20, message);
                assert.equal(c.appearance, 'none', message);
                assert.equal(c.radius, '6px', message);
                assert.equal(c.shadow, 'none', message);
                assert.equal(c.filter, 'none', message);
                assert.equal(c.transform, 'none', message);
                assert.equal(c.margin, '0px', message);
                assert.equal(c.before, 'none', message);
                assert.equal(c.after, 'none', message);
                if (c.checked) assert.match(c.background, /^url\("data:image\/svg\+xml,/, message);
                else assert.equal(c.background, 'none', message);
                assert.doesNotMatch(c.background, /gradient/, message);
                assert.equal(c.label.shadow, 'none', message);
                assert.equal(c.label.transform, 'none', message);
                assert.equal(c.label.border, 'rgba(0, 0, 0, 0)', message);
                assert.equal(c.label.gap, '10px', message);
                if (c.disabled) {
                    assert.equal(c.cursor, 'not-allowed', message);
                    assert.equal(c.label.opacity, '0.5', message);
                }
            }
        }
        for (const [panel, interaction] of Object.entries(report.interactions)) {
            const { outline, outlineStyle, ...behavior } = interaction;
            assert.deepEqual(behavior, { on: true, off: false, changes: 2, disabled: false, focused: true, focusVisible: true, tabIndex: 0 }, panel);
            assert.ok(parseFloat(outline) >= 2, '焦点环至少 2px：' + panel);
            assert.notEqual(outlineStyle, 'none', panel);
        }
    });
}