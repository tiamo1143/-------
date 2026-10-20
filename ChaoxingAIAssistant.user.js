// ==UserScript==
// @name         学习通 AI 问答助手
// @namespace    local.chaoxing-ai
// @version      2.7.0
// @description  学习通页面常驻可拖拽悬浮窗，三个页签：日志 / 答题记录 / 脚本配置。自动播放任务点视频、播完自动跳下一节；并支持「自动答题」——进入章节测验/作业/考试页自动识别题目、调用大模型作答并填入（兼容新版作业页/旧版内嵌作业、支持连线题/排序题、提交阈值与低于阈值自动暂存；支持 DeepSeek/豆包/通义千问/智谱GLM/Kimi/硅基流动 等一键切换）。「脚本配置」把大模型 / 自动答题 / 挂机三块合并在一页，顶部提供「正常模式 / 仅视频 / 仅答题」一键模式切换；「答题记录」逐题展示题干、选项与已填入的答案。作答采用 temperature=0 确定性输出、单选题选项乱序去偏、可选「答案复核」（备用模型独立作答交叉验证、不一致时仲裁），并把课程/章节背景注入提示词以提高正确率。备用模型可独立选择其它厂商（自带接口地址与 Key）；模型标签带消耗档位彩色小字（免费/超低/低/中/高/超高）。
// @match        *://*.chaoxing.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @require      https://scriptcat.org/lib/668/2.0/TyprMd5.js
// @resource     Table https://www.forestpolice.org/ttf/2.0/table.json
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const isTop = window === window.top;
  // 页面真实 window：脚本带 @grant 时跑在沙箱里，页面自己挂的全局（如作业页的 btnBlueSubmit、UEditor 的 UE）
  // 只能通过 unsafeWindow 取到，否则拿到的永远是 undefined。
  const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

  // 防止重复注入
  if (window.__cxAiInjected__) return;
  window.__cxAiInjected__ = true;

  const STORE_KEY = 'cx_ai_settings';
  const UI_KEY = 'cx_ai_ui';

  // ---------- 服务商预设 ----------
  // 说明：models 只是常用示例，输入框可手改成任意模型名；各家的免费额度/模型名常变，以官网为准。
  const PROVIDERS = [
    {
      id: 'glm', name: '智谱 GLM（glm-4.7-flash 免费）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: ['glm-4.7-flash', 'glm-4-flash-250414', 'glm-4-flash', 'glm-4.7-flashx', 'glm-4.5-air', 'glm-4.6', 'glm-4.7'],
      cost: { 'glm-4.7-flash': 'free', 'glm-4-flash-250414': 'free', 'glm-4-flash': 'free', 'glm-4.7-flashx': 'low', 'glm-4.5-air': 'mid', 'glm-4.6': 'high', 'glm-4.7': 'high' },
      tip: '推荐默认：glm-4.7-flash 是当前免费模型（200K 上下文，输入/输出/缓存均免费），注册拿到 Key 即可零成本调用。glm-4-flash-250414、glm-4-flash 也是免费版；带 FlashX/Plus 后缀及 glm-4.5-air / glm-4.6 / glm-4.7 一般为收费。免费政策以官网为准。'
    },
    {
      id: 'doubao', name: '豆包·火山方舟（新用户免费额度）',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      models: ['doubao-seed-1-6-flash-250615', 'doubao-1-5-lite-32k-250115', 'doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'],
      cost: { 'doubao-seed-1-6-flash-250615': 'ultra-low', 'doubao-1-5-lite-32k-250115': 'ultra-low', 'doubao-seed-1-6-250615': 'mid', 'doubao-1-5-pro-32k-250115': 'mid' },
      tip: '字节跳动豆包。新用户一般有免费赠送额度（非永久，以官网为准）。模型名也可填控制台里的「推理接入点 ID」（ep- 开头）。'
    },
    {
      id: 'qwen', name: '通义千问·百炼（新用户免费额度）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      models: ['qwen-turbo', 'qwen-plus', 'qwen3-max', 'qwen-max'],
      cost: { 'qwen-turbo': 'ultra-low', 'qwen-plus': 'low', 'qwen3-max': 'high', 'qwen-max': 'high' },
      tip: '阿里云百炼。新用户有免费额度（非永久，以官网为准），qwen-turbo 最便宜。'
    },
    {
      id: 'siliconflow', name: '硅基流动 SiliconFlow（含免费模型）',
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      models: ['Qwen/Qwen3-8B', 'Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'],
      cost: { 'Qwen/Qwen3-8B': 'free', 'Qwen/Qwen2.5-7B-Instruct': 'free', 'THUDM/glm-4-9b-chat': 'free', 'deepseek-ai/DeepSeek-V3': 'mid', 'deepseek-ai/DeepSeek-R1': 'high' },
      tip: '模型聚合市场，标了「免费」的模型可零成本调用（有调用频率限制，以官网为准）。'
    },
    {
      id: 'deepseek', name: 'DeepSeek（官方 API 收费）',
      baseUrl: 'https://api.deepseek.com/chat/completions',
      models: ['deepseek-v4.1-flash', 'deepseek-chat', 'deepseek-reasoner'],
      cost: { 'deepseek-v4.1-flash': 'ultra-low', 'deepseek-chat': 'low', 'deepseek-reasoner': 'mid' },
      tip: '官方直连，无免费额度、按量计费（单价低）。deepseek-v4.1-flash 为最新旗舰（Flash 档，速度快、单价超低）；deepseek-chat 通用别名，deepseek-reasoner 带推理思考。注意：其「网页版」不是 API，本脚本无法直接用。'
    },
    {
      id: 'kimi', name: 'Kimi·月之暗面',
      baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0905-preview'],
      cost: { 'moonshot-v1-8k': 'low', 'moonshot-v1-32k': 'mid', 'kimi-k2-0905-preview': 'mid' },
      tip: '长上下文见长，需充值。'
    },
    {
      id: 'openrouter', name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      models: ['deepseek/deepseek-chat-v3.1:free', 'qwen/qwen3-8b:free'],
      cost: { 'deepseek/deepseek-chat-v3.1:free': 'free', 'qwen/qwen3-8b:free': 'free' },
      tip: '国际聚合站，模型名带 :free 后缀的通常可免费调用，需要能访问外网。'
    },
    {
      id: 'ollama', name: '本地 Ollama',
      baseUrl: 'http://localhost:11434/v1/chat/completions',
      models: ['qwen2.5:7b', 'llama3.1:8b'],
      cost: { 'qwen2.5:7b': 'free', 'llama3.1:8b': 'free' },
      tip: '本机部署，不花钱，Key 随便填。注意浏览器可能拦截本地 http 请求。'
    },
    {
      id: 'custom', name: '自定义',
      baseUrl: '', models: [],
      tip: '自己填任意 OpenAI 兼容的接口地址与模型名。'
    }
  ];
  const DEFAULT_PROVIDER = 'glm';
  const DEFAULT_PROVIDER_OBJ = PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER);

  // settings 结构：{ provider, baseUrl, model, apiKey, fallback:{model,baseUrl,apiKey}, cache:{服务商id:{...}}, auto:{...}, answer:{...} }
  const DEFAULTS = {
    provider: DEFAULT_PROVIDER,
    baseUrl: DEFAULT_PROVIDER_OBJ.baseUrl,
    model: DEFAULT_PROVIDER_OBJ.models[0],
    apiKey: '',
    fallback: { provider: '', model: '', baseUrl: '', apiKey: '' }, // 备用模型：provider 为空=跟随主服务商；model 为空=不启用
    cache: {},
    auto: { autoplay: false, nextChapter: false, rate: 1, jumpOnUnanswered: false, muted: true },
    answer: { enabled: false, autoSubmit: false, review: false, interval: 1, skipAnswered: true, threshold: 85 }
  };
  // ui 结构：窗口位置 / 尺寸 / 是否收起 / 是否隐藏
  const UI_DEFAULTS = { left: null, top: null, width: 380, height: 520, minimized: false, hidden: false };

  function loadSettings() {
    const s = Object.assign({}, DEFAULTS);
    try {
      const raw = GM_getValue(STORE_KEY, '');
      if (raw) Object.assign(s, JSON.parse(raw));
    } catch (e) { /* 配置损坏则回落到默认 */ }
    if (!PROVIDERS.some((p) => p.id === s.provider)) s.provider = DEFAULT_PROVIDER;
    s.cache = (s.cache && typeof s.cache === 'object') ? Object.assign({}, s.cache) : {};
    s.fallback = Object.assign({}, DEFAULTS.fallback, (s.fallback && typeof s.fallback === 'object') ? s.fallback : {});
    s.auto = Object.assign({}, DEFAULTS.auto, (s.auto && typeof s.auto === 'object') ? s.auto : {});
    s.answer = Object.assign({}, DEFAULTS.answer, (s.answer && typeof s.answer === 'object') ? s.answer : {});
    // 老配置里可能没有 threshold，或存成了非数字；这里统一洗成 0~100 的数字，避免 NaN 让阈值判断失效
    const th = Number(s.answer.threshold);
    s.answer.threshold = isNaN(th) ? DEFAULTS.answer.threshold : Math.max(0, Math.min(100, th));
    return s;
  }
  function saveSettings() {
    GM_setValue(STORE_KEY, JSON.stringify(settings));
  }

  let settings = loadSettings();

  let ui = Object.assign({}, UI_DEFAULTS);
  try { Object.assign(ui, JSON.parse(GM_getValue(UI_KEY, '{}'))); } catch (e) { /* 忽略 */ }

  let uiTimer = null;
  function saveUi(patch) {
    if (patch) Object.assign(ui, patch);
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => GM_setValue(UI_KEY, JSON.stringify(ui)), 250);
  }

  function getProvider(id) { return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1]; }

  // ---------- 日志（同时写面板日志区和浏览器控制台） ----------
  // 参考 pp助手：日志是首页主视图，分级着色、实时计数、自动滚动、可复制/清空。
  let logBox = null;
  let logStatEl = null;
  let logTabEl = null;
  let logAutoScroll = true;
  const LOG_MAX = 200; // 面板里最多保留多少条：**超过就自动清空**，避免长时间挂机把面板撑爆、越滚越卡
  const logStats = { total: 0, err: 0, warn: 0 };

  function refreshLogMeta() {
    if (logStatEl) {
      logStatEl.textContent = `共 ${logStats.total} 条 · 错误 ${logStats.err} · 警告 ${logStats.warn}`;
    }
    if (logTabEl) logTabEl.classList.toggle('has-err', logStats.err > 0);
  }

  function log(msg, type) {
    const level = type === 'err' ? 'err' : type === 'warn' ? 'warn' : type === 'ok' ? 'ok' : 'info';
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = `[${t}] ${msg}`;
    console.log('[学习通AI]', line);
    logStats.total++;
    if (level === 'err') logStats.err++;
    if (level === 'warn') logStats.warn++;
    refreshLogMeta();
    if (!logBox) return;
    const div = document.createElement('div');
    div.className = 'cxai-log-line ' + level;
    div.textContent = line;
    logBox.appendChild(div);
    // 条数超过上限 → 整块清空（不是逐条丢最旧）。挂机跑久了日志会到几百上千条，
    // 一次性清掉比每来一条就 removeChild 省事，也保证面板里永远只有「最近这一段」。
    // 清空后补一条提示并保留触发清空的那行，免得用户以为日志凭空没了。
    if (logBox.childElementCount > LOG_MAX) {
      logBox.innerHTML = '';
      const tip = document.createElement('div');
      tip.className = 'cxai-log-line warn';
      tip.textContent = `[${t}] 日志已超过 ${LOG_MAX} 条，自动清空（更早的内容不再保留）`;
      logBox.appendChild(tip);
      logBox.appendChild(div);
    }
    if (logAutoScroll) logBox.scrollTop = logBox.scrollHeight;
  }

  // 写日志的通用提示：顶层直接写面板；iframe 里同时把文案转发给顶层，避免只出现在 console
  function notice(text, type) {
    log(text, type);
    if (window.top !== window) {
      try { window.top.postMessage({ __cxAiAnswer: 1, href: location.href, text }, '*'); } catch (e) { /* 忽略 */ }
    }
  }

  // 复制全部日志到剪贴板（供反馈排查用）
  function copyLogs() {
    if (!logBox) return;
    const text = Array.prototype.map.call(logBox.querySelectorAll('.cxai-log-line'), (d) => d.textContent).join('\n');
    const done = () => log('日志已复制到剪贴板（共 ' + logStats.total + ' 条）', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) {
      log('复制失败，请手动选择日志文本', 'err');
    }
  }


  // ===== 媒体挂机核心：顶层窗口与各 iframe 都会执行 =====
  // 学习通常把视频放进 iframe（有时还是跨源的子域），顶层窗口读不到，
  // 所以每个 frame 里也跑一遍，各自驱动本节点里的播放器。

  // 本节点内所有可读的 document（主文档 + 同源子 iframe，最多 4 层）
  // 只用于找「下一节」按钮（它可能在被嵌的同源页面里），不参与媒体统计
  function collectDocs() {
    const docs = [];
    (function walk(doc, depth) {
      if (!doc || depth > 4) return;
      docs.push(doc);
      let frames = [];
      try { frames = doc.querySelectorAll('iframe'); } catch (e) { return; }
      frames.forEach((f) => {
        try { const d = f.contentDocument; if (d) walk(d, depth + 1); } catch (e) { /* 跨源跳过 */ }
      });
    })(document, 0);
    return docs;
  }

  // 只统计本 document 自己直接包含的媒体元素，不递归子 iframe：
  // 否则同一个 <video> 会被顶层和沿途每一层 frame 各数一遍（实测会数成 6 个）。
  // 每个 frame 只报自己那一份，顶层再汇总，才不会重复计数。
  function ownMedia() {
    let els = [];
    try { els = document.querySelectorAll('video,audio'); } catch (e) { return []; }
    return Array.prototype.slice.call(els);
  }

  const mediaDur = (m) => (isFinite(m.duration) && m.duration > 1 ? m.duration : 0);
  const isFinished = (m) => m.ended || (mediaDur(m) > 0 && m.currentTime >= mediaDur(m) - 1.5);
  const hasSrc = (m) => !!(m.currentSrc || m.src || (m.querySelector && m.querySelector('source')));

  // 学习通对「已完成的视频任务点」会在页面 DOM 上打标记（pp助手 同款判据）：
  //   1) 任务点容器（常是承载视频 iframe 的祖先）带 class="ans-job-finished"；
  //   2) 任务点图标 .ans-job-icon 的 aria-label 含「已完成」。
  // 页面刷新/切回已完成章节时 <video> 会被重置成 currentTime=0，只看视频元素会把它误判成「没播完」而重播，
  // 所以先查这些 DOM 标记：命中即视为该任务点已完成——不再播放、也不再计入未完成。
  function taskDone(m) {
    try {
      // 视频元素所在文档内向上找
      let el = m;
      for (let i = 0; el && i < 10; i++) {
        if (el.classList && el.classList.contains('ans-job-finished')) return true;
        try {
          const icon = (el.classList && el.classList.contains('ans-job-icon')) ? el : el.querySelector('.ans-job-icon');
          if (icon && (icon.getAttribute('aria-label') || '').indexOf('已完成') >= 0) return true;
        } catch (e) { /* 忽略 */ }
        el = el.parentElement;
      }
      // 视频常被放进 iframe：跨到承载它的 <iframe> 所在父文档再向上找一次（同源才拿得到 frameElement）
      let frameEl = null;
      try { frameEl = m.ownerDocument && m.ownerDocument.defaultView && m.ownerDocument.defaultView.frameElement; } catch (e) { frameEl = null; }
      if (frameEl) {
        let p = frameEl;
        for (let i = 0; p && i < 10; i++) {
          if (p.classList && p.classList.contains('ans-job-finished')) return true;
          p = p.parentElement;
        }
        try {
          const icon = (frameEl.closest && frameEl.closest('.ans-job-icon')) ||
            (frameEl.parentElement && frameEl.parentElement.querySelector('.ans-job-icon'));
          if (icon && (icon.getAttribute('aria-label') || '').indexOf('已完成') >= 0) return true;
        } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }
  // 「这个媒体对应的任务点算不算已完成」：真的播完了，或被学习通标记为已完成
  const doneMedia = (m) => isFinished(m) || taskDone(m);
  // 还没播完的任务点：没结束、没被标记完成、且确实有源。注意时长还没读出来（NaN）也算，
  // 否则 preload=none 的播放器永远等不到 play()，这正是"不自动播放"的原因。
  const unfinished = (m) => !doneMedia(m) && hasSrc(m);
  const clampRate = (r) => Math.min(4, Math.max(1, Number(r) || 1));

  // 媒体元素是不是真的画在页面上。学习通的视频模块（video.js）常留隐藏副本，
  // 那些副本不该被计数、更不该被自动播放——这就是 pp助手「只认真正的任务点」的思路
  function hasBox(m) {
    try {
      if (m.offsetWidth > 1 && m.offsetHeight > 1) return true;
      const rs = m.getClientRects();
      for (let i = 0; i < rs.length; i++) {
        if (rs[i].width > 1 && rs[i].height > 1) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }
  // 计入「未完成任务点」的媒体：没播完、有源，且要么显示着、要么已经播过/正在播
  const countable = (m) => unfinished(m) && (hasBox(m) || m.currentTime > 0 || !m.paused);

  // 一行描述，扫描时打印用，便于定位到底是哪几个元素
  function describeMedia(m) {
    let cls = '';
    try { cls = (m.getAttribute('class') || '').split(' ')[0]; } catch (e) { /* 忽略 */ }
    let sz = '?';
    try { sz = m.offsetWidth + 'x' + m.offsetHeight; } catch (e) { /* 忽略 */ }
    return `${m.tagName}${cls ? '.' + cls : ''} ${sz} dur=${m.duration} ${m.paused ? 'paused' : 'playing'} t=${Number(m.currentTime || 0).toFixed(1)} taskDone=${taskDone(m) ? 1 : 0}`;
  }

  // 识别到未完成的任务点后，先等 3 秒再起播：给页面与播放器留出加载/就绪时间，避免刚进页面 play() 就失败
  const PLAY_DELAY_MS = 3000;
  const firstSeenUnfinishedAt = new WeakMap(); // 每个媒体首次被识别为「未完成」的时间

  // 暂停本文档内所有正在播的媒体（跨 frame 发牌收回许可 / 调试用）
  function pauseOwnMedias() {
    ownMedia().forEach((m) => { try { if (!m.paused) m.pause(); } catch (e) { /* 播放器可能已销毁 */ } });
  }

  // 播放第一个没播完的媒体（优先播真正显示出来的那个），返回被播的那个
  function playFirstUnfinished(medias, rate) {
    const all = medias.filter(unfinished);
    if (!all.length) return null;
    const shown = all.filter(countable);
    const target = shown.length ? shown[0] : all[0];
    const now = Date.now();
    if (!firstSeenUnfinishedAt.has(target)) firstSeenUnfinishedAt.set(target, now);
    // 只拦「需要起播」的（已在播的不受影响）；未满 3 秒就先返回等下一轮
    if (target.paused && now - firstSeenUnfinishedAt.get(target) < PLAY_DELAY_MS) return null;
    // 同文档单播：起播前先暂停本文档内其他未完成的媒体（video.js 隐藏副本 / 同页两个 video 场景）
    all.forEach((m) => { if (m !== target && !m.paused) { try { m.pause(); } catch (e) { /* 忽略 */ } } });
    try {
      if (target.playbackRate !== rate) target.playbackRate = rate;
      if (target.paused) {
        // 「自动播放时静音」开关：只在起播时设置——已在播的不动，用户在播放器手动开的音量不被抢
        if (settings.auto.muted) target.muted = true;
        const p = target.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (target.muted) return;
            target.muted = true;
            log('浏览器拦截了自动播放，已改为静音播放（可在播放器里手动开声音）', 'err');
            const p2 = target.play();
            if (p2 && typeof p2.catch === 'function') p2.catch(() => {});
          });
        }
      }
    } catch (e) { /* 播放器可能已销毁 */ }
    return target;
  }

  // ---- 视频弹题（播放中途插入的小题）：本地点掉 + 恢复播放 ----
  // 弹题不影响任务点完成，不值得调大模型；且弹层会接管视频 frame，顶层若误判「无媒体有题目」
  // 会按「答题页完成」自动跳下一节——所以这里本地点掉并回报弹题状态防跳。
  // 识别用「弹层容器 + 内含题目特征」的组合判据（学习通弹层 class 多次改版，不硬编码单一选择器）；
  // 所有点击都限定在弹层容器内，绝不碰弹层外的页面按钮。
  const POPQUIZ_LAYER_SEL = '.popups-box, .expopups, .popups-container, .popups, .maskDiv, [class*="popup"][class*="box"]';
  const POPQUIZ_TIP_RX = /答对后|继续播放|继续学习|本题将在|回答正确|回答错误/;
  let popQuizSeenAt = 0; // 最近一次见到弹层的时间：恢复播放只在此后 60s 内生效，避免干扰正常起播节奏

  // 节点是否在弹层容器内（答题引擎用它把弹层里的题排除掉，交给糊答器本地点，不烧模型额度）
  function inPopLayer(el) {
    try { return !!(el.closest && el.closest(POPQUIZ_LAYER_SEL)); } catch (e) { return false; }
  }

  // 找当前弹题层：弹层容器可见，且里面有题目/选项结构或结果提示文案
  function detectPopQuiz() {
    let layers = [];
    try { layers = Array.prototype.slice.call(document.querySelectorAll(POPQUIZ_LAYER_SEL)); } catch (e) { return null; }
    for (const layer of layers) {
      if (isHiddenDeep(layer)) continue;
      if (layer.querySelector('.TiMu, .questionLi, .Zy_TItle, ul[class*="Option"], [class*="before-after"], .answerBg') ||
          POPQUIZ_TIP_RX.test(String(layer.textContent || ''))) {
        return layer;
      }
    }
    return null;
  }

  // 糊答一轮：优先点「继续播放/关闭」类收尾按钮；有结果提示就等下一轮；否则选第一个可见选项并点弹层内的提交按钮。
  // 返回弹层是否仍存在。
  let popQuizActedAt = 0; // 动作节流：≥1.5s 才点下一次，防止连点重复提交
  function handlePopQuiz() {
    const layer = detectPopQuiz();
    if (!layer) return false;
    popQuizSeenAt = Date.now();
    const now = Date.now();
    const act = now - popQuizActedAt > 1500;
    // ① 已出结果提示：点「继续播放 / 关闭」类按钮恢复视频
    const btns = layer.querySelectorAll('a, .btn, button, [onclick]');
    for (const b of btns) {
      const t = String(b.textContent || '').trim();
      if (/^(继续播放|继续学习|继续观看|关闭|知道了|确定|继续)$/.test(t)) {
        if (act) { popQuizActedAt = now; clickOption(b); log('视频弹题已糊答，点击「' + t + '」恢复视频', 'ok'); }
        return true;
      }
    }
    if (POPQUIZ_TIP_RX.test(String(layer.textContent || ''))) return true; // 有提示但按钮没渲染好，等下一轮
    if (!act) return true;
    // ② 未作答：点弹层里第一个可见且未选中的选项（糊弄，不追求正确）
    const opts = layer.querySelectorAll('[class*="before-after"], .Zy_ulTop li, .Zy_ulBottom li, .answerBg, .TiMu li, [class*="Option"] li');
    for (const o of opts) {
      try {
        if (isHiddenDeep(o)) continue;
        if (!isOptSelected(o)) { popQuizActedAt = now; clickChoice(o); break; }
      } catch (e) { /* 忽略 */ }
    }
    // ③ 点弹层内的提交按钮（只认弹层容器内的，绝不碰页面级按钮）
    for (const b of btns) {
      const t = String(b.textContent || '').trim();
      if (/^(提交|提交答案)$/.test(t) || (b.classList && b.classList.contains('btnSubmit'))) {
        popQuizActedAt = now;
        clickOption(b);
        log('视频弹题已自动选答并提交（糊答，不影响任务点完成）', 'ok');
        break;
      }
    }
    return true;
  }

  // 弹层关闭后把被弹题暂停的视频拉起来（只恢复「播到一半被暂停」的：currentTime>0 且未完成）
  function resumeMidVideo() {
    if (!popQuizSeenAt || Date.now() - popQuizSeenAt > 60000) return;
    ownMedia().forEach((m) => {
      try {
        if (m.paused && !m.ended && hasSrc(m) && m.currentTime > 0 && !doneMedia(m)) {
          if (settings.auto.muted) m.muted = true; // 与自动播放静音开关保持一致
          const p = m.play();
          if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放策略拦截时静默 */ });
        }
      } catch (e) { /* 忽略 */ }
    });
  }

  // ===== 自动答题核心（顶层窗口与各 iframe 都会执行，各管自己文档里的题目）=====
  // 借鉴 pp助手：章节测验题目在 .TiMu、作业/考试在 .questionLi；按题型分别点选/写入，最后可选自动提交。
  // 答案全部来自「脚本配置」里配置的大模型，不依赖任何第三方题库服务器。

  const TYPE_MAP = {
    '单选题': '0', 'A1型题': '0', 'A1A2型题': '0',
    '多选题': '1', 'X型题': '1',
    '填空题': '2', '听力填空': '2', '听力对话填空': '2', '完形填空': '2', '短文填空': '2', '选词填空': '2',
    '判断题': '3',
    '简答题': '4', '名词解释': '5', '论述题': '6', '计算题': '7', '排序题': '13', '连线题': '11'
  };
  const TYPE_NAME = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题', '4': '简答题', '5': '名词解释', '6': '论述题', '7': '计算题', '11': '连线题', '13': '排序题' };
  const JUDGE_TRUE = /(^|[,，])(是|对|正确|确定|√|对的|是的|正确的|true|t|yes|1)([,，]|$)/i;
  const JUDGE_FALSE = /(^|[,，])(非|否|错|错误|×|x|错的|不对|不正确的|不正确|不是|false|f|no|0)([,，]|$)/i;

  function stripTags(html) {
    if (html == null) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => {
    try { if (el.getClientRects().length) return true; } catch (e) { /* 忽略 */ }
    return !!(el.offsetWidth || el.offsetHeight || el.offsetParent);
  };
  const qnorm = (s) => stripTags(s).replace(/\s+/g, '').toLowerCase();

  // ---- 以下 4 个解析工具移植自 PP助手 v3.5.0 答案解析层 ----
  // 全角转半角 + 去 HTML 标签 + 去标点 + 去空白 + 转小写：比 qnorm 更彻底，仅用于选择题选项匹配，不改 qnorm（连线/下拉匹配不受影响）
  function normalizeAnsText(input) {
    let s = String(input == null ? '' : input);
    s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
    s = s.replace(/<[^>]*>/g, ' ');
    return s
      .replace(/[，。！？；：""''、（）【】〈〉《》,.\-!?;:'"()\[\]<>]/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  // 识别「ABD」这类字母型答案：1~8 个大写字母且严格升序（BAD/CAD 这类单词不升序，不会被误判）
  function isPlainLetterAnswer(input) {
    const t = String(input == null ? '' : input).trim().replace(/[,，.。．、 #/\\|]/g, '').toUpperCase();
    if (!/^[A-Z]{1,8}$/.test(t)) return false;
    for (let i = 1; i < t.length; i++) {
      if (t.charCodeAt(i) <= t.charCodeAt(i - 1)) return false;
    }
    return true;
  }

  // 字符串型答案拆分：JSON 数组 → 7 种分隔符（=== # --- ### | ; ；）→ 整串单答案
  const ANSWER_SEPARATORS = ['===', '#', '---', '###', '|', ';', '；'];
  function splitAnswerText(answer) {
    if (answer == null) return [];
    if (Array.isArray(answer)) return answer.map((a) => String(a).trim()).filter(Boolean);
    const raw = String(answer).trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((a) => String(a).trim()).filter(Boolean);
      } catch (e) { /* 非法 JSON 按普通字符串继续 */ }
    }
    for (const sep of ANSWER_SEPARATORS) {
      if (raw.includes(sep)) return raw.split(sep).map((p) => p.trim()).filter(Boolean);
    }
    return [raw];
  }

  // 编辑距离相似度（用于「模型返回选项原文」但和目标不完全一致时兜底匹配）
  function similarity(a, b) {
    if (!a || !b) return 0;
    const m = a.length; const n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) dp.push([i].concat(new Array(n).fill(0)));
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
          dp[i][j - 1] + 1,
          dp[i - 1][j] + 1
        );
      }
    }
    const d = dp[m][n];
    return Math.round(((Math.max(m, n) - d) / Math.max(m, n)) * 100);
  }

  // 把模型给的答案（可能是字母 A/B/C、字母组合 ABD、选项原文、带 A. 前缀的原文）匹配到第几个选项，找不到返回 -1
  // 匹配链（移植 PP v3.5.0）：单字母 → qnorm 精确 → 剥前缀精确 → 全角/标点归一化精确 → 编辑距离兜底（精确优先，模糊只做最后手段）
  function matchOptionIndex(answer, options) {
    const raw = String(answer == null ? '' : answer).trim();
    if (!raw || !options || !options.length) return -1;
    // ① 单字母按序号定位（模型返回 A/B/C）
    if (raw.length === 1) {
      const c = raw.toLowerCase();
      if (c >= 'a' && c <= 'z') {
        const i = c.charCodeAt(0) - 97;
        if (i >= 0 && i < options.length) return i;
      }
    }
    // ② qnorm 精确匹配（原有逻辑）
    const a = qnorm(raw);
    for (let i = 0; i < options.length; i++) {
      if (qnorm(options[i].text) === a) return i;
    }
    // ③ 剥前缀后精确匹配（模型返回「A.选项原文」而页面选项无前缀）
    const stripped = stripOptionMark(raw);
    if (stripped && stripped !== raw) {
      const sa = qnorm(stripped);
      for (let i = 0; i < options.length; i++) {
        if (qnorm(stripOptionMark(options[i].text)) === sa) return i;
      }
    }
    // ④ 全角/标点/富文本归一化后精确匹配（PP v3.5.0 第三级）
    const na = normalizeAnsText(stripped);
    if (na) {
      for (let i = 0; i < options.length; i++) {
        if (normalizeAnsText(options[i].text) === na) return i;
      }
    }
    // ⑤ 编辑距离兜底：双方统一用 normalizeAnsText 归一化后比较，阈值仍为 60
    let best = -1; let bestScore = 0;
    for (let i = 0; i < options.length; i++) {
      const s = similarity(na, normalizeAnsText(options[i].text));
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return bestScore >= 60 ? best : -1;
  }

  function isOptSelected(el) {
    try {
      if (el.getAttribute('aria-checked') === 'true') return true;
      if (el.classList.contains('cur') || el.classList.contains('selected')) return true;
      const s = el.querySelector('span.num_option, span.num_option_dx, span[data], a.cur, a.selected');
      if (s && (s.classList.contains('cur') || s.classList.contains('selected'))) return true;
      if (el.querySelector('.onChecked, .check_answer, .check_answer_dx')) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }
  // 是否已作答（对齐 pp助手：选择题看选项选中态；填空/简答看文本域、填空框与 .InpDIV；连线/排序看下拉框）
  function isQuestionAnswered(q) {
    if (q.options.length && q.options.some((o) => isOptSelected(o.el))) return true;
    const fields = q.node.querySelectorAll('textarea, input.Py_tk, .InpDIV');
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const v = (f.classList && f.classList.contains('InpDIV')) ? String(f.innerHTML || '') : String(f.value || '');
      if (v.trim()) return true;
    }
    if (q.type === '11' || q.type === '13') {
      const sels = q.node.querySelectorAll('select.dept_select');
      if (sels.length) {
        let all = true;
        sels.forEach((s) => { if (!String(s.value || '').trim()) all = false; });
        return all;
      }
    }
    return false;
  }
  function clickEl(el) {
    try { el.click(); } catch (e) { /* 忽略 */ }
  }
  // 选项/按钮要点「按下-抬起-点击」一整套事件，学习通的组件才认（对齐 pp助手 的 clickOption）；
  // 只调 .click() 时，部分页面（尤其作业页）选不中。
  function clickOption(el) {
    if (!el) return;
    try {
      if (el.focus) el.focus();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e) { clickEl(el); }
  }
  // 点一下选项并返回「点击后是否处于选中态」。
  // pp助手 实际用的是 optionElement.click()，而有的版式只认完整的 mousedown/mouseup/click。
  // 两边都不能盲信：整套事件发过去，若页面同时在 mousedown 与 click 上切换，会被切两次而互相抵消。
  // 所以这里先发整套事件，再看选中态有没有变化；没变化就退回普通 click（对齐 pp助手），最后再兜底点内部可点子节点。
  async function clickChoice(el) {
    if (!el) return false;
    const before = isOptSelected(el);
    clickOption(el);
    await sleep(180);
    let now = isOptSelected(el);
    if (now === before) {
      clickEl(el);
      await sleep(150);
      now = isOptSelected(el);
    }
    if (now === before) {
      let alt = null;
      try { alt = el.querySelector('a,label,input'); } catch (e) { alt = null; }
      if (alt && alt !== el) {
        clickOption(alt);
        await sleep(150);
        now = isOptSelected(el);
      }
    }
    return now;
  }

  // ---- 题目抓取：一个容器 = 一道题，兼容三类 DOM（学习通改版过多次）----
  //  · 章节测验（iframe 模块）：题干 .fontLabel、题型 .newZy_TItle、选项 [class*="before-after"] 的 .fl.after
  //  · 作业页（/work/doHomeWorkNew、旧版 api/work）：题干 .Zy_TItle（含「（单选题）」题号头）、选项 .Zy_ulTop/.Zy_ulBottom 的 li
  //  · 新版作业/考试：题干 h3、题型 .colorShallow 或容器上的 typename 属性、选项 .answerBg 的 .answer_p
  // 一次只认「真正有内容」的那组选项，避免抓到隐藏模板或另一种版式留下的空壳。
  const OPTION_SOURCES = [
    { sel: '[class*="before-after"]', inner: '.fl.after' }, // 章节测验
    { sel: '.answerBg', inner: '.answer_p' },               // 新版作业 / 考试
    { sel: '.Zy_ulTop li, .Zy_ulBottom li', inner: '' }     // 作业页（选项自带「A.」前缀，抓完再剥掉）
  ];
  // 去掉选项开头的「A.」「A、」「A）」等字母标记：题面里 A/B/C 由我们按顺序生成，留着反而对不上
  // 正则对齐 PP v3.5.0 stripOptionPrefix：补全角逗号、半角逗号、中括号「A,」「A，」「A]」「A】」等版式
  const stripOptionMark = (t) => String(t || '').replace(/^[A-Ha-h]\s*[.、．，,)）:：\]】]\s*/, '').trim();

  function pickOptions(node) {
    for (let i = 0; i < OPTION_SOURCES.length; i++) {
      const src = OPTION_SOURCES[i];
      let els = [];
      try { els = node.querySelectorAll(src.sel); } catch (e) { els = []; }
      if (!els.length) continue;
      const out = [];
      for (let k = 0; k < els.length; k++) {
        const el = els[k];
        const p = src.inner ? (el.querySelector(src.inner) || el) : el;
        const t = stripOptionMark(stripTags(p && p.innerHTML != null ? p.innerHTML : (p ? p.textContent : '')));
        if (t) out.push({ text: t, el });
      }
      if (out.length) return out;
    }
    return [];
  }

  function extractOne(node, kind) {
    // 题干：按页面类型依次尝试
    let raw = '';
    const fl = node.querySelector('.fontLabel');
    if (fl) raw = stripTags(fl.innerHTML);
    if (!raw) {
      const h3 = node.querySelector('h3');
      if (h3) {
        const cs = node.querySelector('.colorShallow');
        raw = h3.textContent.replace(cs ? cs.textContent : '', '');
      }
    }
    if (!raw) {
      const zt = node.querySelector('.Zy_TItle');
      if (zt) raw = stripTags(zt.innerHTML);
    }
    if (!raw) raw = stripTags(node.textContent);

    // 题型：收集所有可能的题型文案，逐个映射（作业页的题型藏在题号头「（单选题）」里）
    const cands = [];
    const nz = node.querySelector('.newZy_TItle'); if (nz) cands.push(stripTags(nz.innerHTML));
    const cs2 = node.querySelector('.colorShallow'); if (cs2) cands.push(stripTags(cs2.textContent));
    const ty = node.getAttribute('typename'); if (ty) cands.push(ty);
    const mt = raw.match(/[（(]\s*([^（()）]{1,8}题)\s*[)）]/);
    if (mt) cands.push(mt[1]);
    cands.push(raw.slice(0, 12));
    let type = '';
    for (let i = 0; i < cands.length && !type; i++) {
      const key = String(cands[i] || '').replace(/[\[\]【】（）()\s]/g, '');
      if (key) type = TYPE_MAP[key];
    }

    const title = stripTags(raw)
      .replace(/（[\d.]+分）/g, '')
      .replace(/[（(]\s*[^（()）]{1,8}题\s*[)）]/g, '') // 去掉题干里的题型标记
      .replace(/^\d+\s*[.、．]\s*/, '')
      .replace(/_{2,}/g, '＿＿') // 保留空位：把连续下划线统一成「＿＿」占位，模型需要知道空在哪、有几个（原先是删掉，导致填空题干残缺）
      .trim();

    const options = pickOptions(node);

    if (!type) {
      // 兜底：按容器里存在的控件反过来猜题型（排序题用 .sortQuesSelect，连线题用 select.dept_select）
      if (node.querySelector('.sortQuesSelect')) type = '13';
      else if (node.querySelector('select.dept_select')) type = '11';
      else if (node.querySelector('textarea, input.Py_tk')) type = '2';
      else if (options.some((o) => JUDGE_TRUE.test(o.text) || JUDGE_FALSE.test(o.text))) type = '3';
      else type = '0';
    }

    // 填空题空位数：优先数可见填空控件（最可靠），数不到再靠提示词里的下划线占位数兜底。
    // 必须放在题型兜底判定之后：textarea 兜底猜成填空的题也要拿到空数
    let blanks = 0;
    if (String(type) === '2') {
      try {
        let vis = 0;
        node.querySelectorAll('textarea, input.Py_tk, .Py_tk input, input[type="text"]').forEach((f) => { if (isVisible(f)) vis++; });
        blanks = vis;
      } catch (e) { blanks = 0; }
      if (!blanks) blanks = (title.match(/＿＿/g) || []).length;
    }
    return { node, kind, type: String(type), title, options, blanks };
  }

  // 本脚本自己注入的面板不是题目，必须排除，否则「按控件分组」这类兜底策略会把它当成题
  function isOwnNode(el) {
    try { return !!(el.closest && el.closest('#cxai-win, #cxai-ball')); } catch (e) { return false; }
  }
  // 学习通作业页是 AJAX 换页：切作业时旧作业的 DOM 只是被隐藏、并没有移除。
  // 这类残留节点不该被当成当前题目（否则会把上一份作业又答一遍）。
  // 判据要便宜：题目页动辄 50 题，而这里每轮轮询都会对每个候选节点跑一遍，
  // 所以先用「有没有布局盒」这一个廉价条件兜住绝大多数情况（display:none 的自身与任一祖先都会让后代没有盒子）。
  function isHiddenDeep(el) {
    try {
      if (el.hidden) return true;
      if (el.getAttribute && (el.getAttribute('aria-hidden') === 'true' || el.getAttribute('hidden') != null)) return true;
      if (!el.getClientRects().length && !el.offsetParent) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  // 同一页常有「外壳容器 + 每题目容器」两层：例如新版作业页 /mooc-ans/mooc2/work/dowork 里，
  // 一个 class="fanyaMarking TiMu" 的批阅外壳包着全部 50 道 .questionLi。
  // 外壳若被当成一道题，就会「只找到 1 题」且选项数是全页之和——所以合并两类选择器的结果，
  // 再丢掉「自身内部还包着别的题目容器」的外壳，只保留最内层真正的一道题。
  function collectQuestionNodes(doc) {
    let all = [];
    try { Array.prototype.forEach.call(doc.querySelectorAll('.TiMu, .questionLi'), (n) => all.push(n)); } catch (e) { all = []; }
    return all.filter((n) => !all.some((o) => o !== n && n.contains && n.contains(o)));
  }

  function scanQuestions(doc) {
    const nodes = collectQuestionNodes(doc);
    if (!nodes.length) return { kind: null, list: [] };
    // kind 只用于日志区分：有 .questionLi 就按「新版作业/考试」，否则按「章节测验/作业页」
    let kind = 'zj';
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].classList && nodes[i].classList.contains('questionLi')) { kind = 'zy'; break; }
    }
    const list = [];
    nodes.forEach((n) => {
      try {
        if (isOwnNode(n) || isHiddenDeep(n)) return;
        if (inPopLayer(n)) return; // 视频弹层里的题交给糊答器本地点掉，不调大模型
        const q = extractOne(n, kind);
        if (!q.title && !q.options.length) return; // 题干和选项都空的壳子（占位/残留），不算题
        list.push(q);
      } catch (e) { /* 单题出错不影响其它 */ }
    });
    return { kind: list.length ? kind : null, list };
  }

  // ---- 字体解密（超星部分题目用 font-cxsecret 自定义字体加密，直接抓文本会是乱码）----
  // 字体映射按「页面这份字体的 base64」缓存：
  //   · 同一份字体只算一次（那段 19968~40870 的字形遍历很重，不能每次都跑）；
  //   · 换了一份新字体就重算——旧版用一个「只执行一次」的布尔开关，遇到作业页 AJAX 换页加载的
  //     第二份加密字体就再也不解密了，题面会一直是乱码。
  let fontMatchCache = null; // { key: 字体 base64, map: { 码位: 真字 } }
  function decodeCipherFont(doc) {
    try {
      let tipStyle = null;
      const styles = doc.querySelectorAll('style');
      for (let i = 0; i < styles.length; i++) {
        if ((styles[i].textContent || '').includes('font-cxsecret')) { tipStyle = styles[i]; break; }
      }
      if (!tipStyle) return false;
      if (typeof Typr === 'undefined' || typeof md5 === 'undefined') return false;
      const m = (tipStyle.textContent || '').match(/base64,([\w\W]+?)'/);
      if (!m) return false;
      let match;
      if (fontMatchCache && fontMatchCache.key === m[1]) {
        match = fontMatchCache.map;
      } else {
        const data = window.atob(m[1]);
        const buf = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) buf[i] = data.charCodeAt(i);
        const font = Typr.parse(buf)[0];
        const table = JSON.parse(GM_getResourceText('Table'));
        match = {};
        for (let code = 19968; code < 40870; code++) {
          let g = Typr.U.codeToGlyph(font, code);
          if (!g) continue;
          g = Typr.U.glyphToPath(font, g);
          match[code] = table[md5(JSON.stringify(g)).slice(24)];
        }
        fontMatchCache = { key: m[1], map: match };
      }
      const els = doc.querySelectorAll('.font-cxsecret');
      els.forEach((el) => {
        let html = el.innerHTML;
        Object.keys(match).forEach((k) => {
          const v = match[k];
          if (!v) return;
          html = html.replace(new RegExp(String.fromCharCode(Number(k)), 'g'), String.fromCharCode(v));
        });
        el.innerHTML = html;
        el.classList.remove('font-cxsecret');
      });
      return els.length > 0;
    } catch (e) {
      return false;
    }
  }

  // ---- 提示词与解析 ----
  // 系统提示：强调「先排除再作答」「不确定也要给出最可能答案」——空返回=不填入，比错答更糟；
  // 并用一行式示例约束各题型的输出格式，减少格式跑偏导致的解析失败。
  const SYS_PROMPT = '你是超星学习通的答题专家。作答规则：\n' +
    '1. 先逐个分析选项、排除干扰项，再确定最终答案；\n' +
    '2. 即使不确定，也必须给出你认为最可能的答案，绝不允许空答；\n' +
    '3. 多选题要把所有正确选项都选全；判断题答案只能是「对」或「错」；填空题按空位先后顺序作答，answer 项数必须与空数一致；\n' +
    '4. 只输出一个 JSON 对象，禁止输出解释或其它内容。\n' +
    '输出示例：单选 {"answer":["B"]}；多选 {"answer":["A","C"]}；判断 {"answer":["对"]}；填空 {"answer":["第一空","第二空"]}。';

  // 页面标题通常含课程/章节信息，作为背景注入：超星题目多出自本章内容，模型有背景后更准
  function pageContext() {
    let t = '';
    try { t = (window.top && window.top.document && window.top.document.title) || document.title || ''; }
    catch (e) { t = document.title || ''; } // 跨源 iframe 读不到顶层标题时退回本页
    t = String(t).replace(/\s+/g, ' ').trim().slice(0, 80);
    return t ? `课程/页面背景：${t}（若与题目无关请忽略）` : '';
  }
  // 各题型的输出格式要求（主作答与仲裁共用）；填空题带空数时用动态示例，强制返回 N 项
  function answerFmt(q) {
    if (q.type === '0' || q.type === '1') return '{"answer":["A"]}（用选项字母，多选给多个字母）';
    if (q.type === '3') return '{"answer":["对"]}（只能是 对 或 错）';
    if (q.type === '2') {
      if (q.blanks > 1) {
        const items = [];
        for (let i = 0; i < q.blanks; i++) items.push(`"第${i + 1}空答案"`);
        return `{"answer":[${items.join(',')}]}（必须正好 ${q.blanks} 项，按空位顺序）`;
      }
      return '{"answer":["答案"]}（有几个空就返回几项）';
    }
    if (q.type === '11') return '{"answer":["第1行应选匹配项的原文","第2行应选匹配项的原文"]}（按左侧各行从上到下的顺序，给出每行右侧应选的选项原文）';
    if (q.type === '13') return '{"answer":["A","C","B"]}（按正确先后顺序给出选项字母）';
    return '{"answer":["作答内容"]}';
  }
  // 填空题的空数说明：注入到主作答与仲裁的消息里，让模型明确空位数量与顺序
  const blankNote = (q) => (q && q.type === '2' && q.blanks > 0)
    ? `（本题共 ${q.blanks} 个空，题干中"＿＿"即空位；请按空位先后顺序作答，answer 数组必须正好 ${q.blanks} 项）`
    : '';
  function buildAnswerMessages(q, ctx) {
    let body = `题型：${TYPE_NAME[q.type] || '选择题'}\n题干：${q.title}\n${blankNote(q)}`;
    if (blankNote(q)) body += '\n';
    if (ctx) body += ctx + '\n';
    if (q.options.length) {
      body += '选项：\n' + q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n') + '\n';
      if (q.type === '1') body += '（多选题：可能有多个正确答案，请把所有正确选项都选上）\n';
    }
    if (q.type === '11' || q.type === '13') {
      body += '（这道题的各行内容与可选项都写在题干里了，请按行顺序作答）\n';
    }
    body += `\n请只返回 JSON，格式如：${answerFmt(q)}`;
    return [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: body }];
  }
  // 主备模型答案不一致时的仲裁提示：把两个候选答案摆出来让模型独立裁决
  function buildTiebreakMessages(q, ctx, candA, candB) {
    let body = `题型：${TYPE_NAME[q.type] || '选择题'}\n题干：${q.title}\n${blankNote(q)}`;
    if (blankNote(q)) body += '\n';
    if (ctx) body += ctx + '\n';
    if (q.options.length) {
      body += '选项：\n' + q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n') + '\n';
    }
    body += `两位助手的候选答案：甲=${JSON.stringify(candA)}，乙=${JSON.stringify(candB)}。\n` +
      `请独立分析题干与选项，从两个候选中选出更正确的一个（若两个都不对也可给出你认为更正确的其它答案），只输出 JSON。\n` +
      `格式如：${answerFmt(q)}`;
    return [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: body }];
  }
  // 两组答案是否等价（去空白、统一大写、排序后比较，兼容 ["A","C"] 与 ["c","a"]）
  function answersEqual(a, b) {
    const norm = (x) => x.map((s) => String(s).trim().toUpperCase()).sort().join('|');
    return norm(a) === norm(b);
  }

  function parseAnswerJson(text, keepWhole) {
    let t = String(text == null ? '' : text).trim();
    const m = t.match(/[{[][\s\S]*[}\]]/);
    if (m) t = m[0];
    let obj;
    try { obj = JSON.parse(t); } catch (e) {
      // 兜底：模型可能直接返回「答案：A」这类纯文本
      const mm = t.match(/answer["'\s:：]*\[?["']?([^"'\]]+)/i);
      if (mm) obj = { answer: [mm[1]] };
      else return null;
    }
    let arr = obj && (obj.answer != null ? obj.answer : (obj.ans != null ? obj.ans : obj.answers));
    if (arr == null) return null;
    if (!Array.isArray(arr)) {
      // 字符串型答案先按 7 种分隔符拆分（移植 PP v3.5.0：模型偶尔返回 "A|B|C"、"A#B#C" 而非数组）。
      // 填空题 keepWhole=true 时不拆：单空答案 "TCP;UDP" 会被误拆，交给 normalizeBlankAnswer 按空数处理
      arr = (typeof arr === 'string' && !keepWhole) ? splitAnswerText(arr) : [arr];
    }
    return arr.map((x) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') return String(x.answer != null ? x.answer : (x.text != null ? x.text : JSON.stringify(x)));
      return String(x);
    }).map((s) => s.trim()).filter((s) => s);
  }

  // 识别「第一空：A 第二空：B」「第1空 A 第2空 B」这类带空位标记的答案：标记数 ≥2 才拆，防止误伤正文里的数字编号
  function splitBlankMarked(s) {
    const t = String(s == null ? '' : s).trim();
    const marks = t.match(/第\s*[一二三四五六七八九十\d]+\s*空\s*[:：]?/g);
    if (!marks || marks.length < 2) return null;
    const parts = t.split(/第\s*[一二三四五六七八九十\d]+\s*空\s*[:：]?/)
      .map((x) => x.trim().replace(/[；;、|，,]+$/, '').trim())
      .filter(Boolean);
    return parts.length >= 2 ? parts : null;
  }

  // 填空题答案校正（空数已知时才生效）：挤压项拆开 / 碎片项合并，让项数对齐页面空数
  function normalizeBlankAnswer(arr, blanks) {
    if (!Array.isArray(arr) || !arr.length || !blanks || blanks < 1) return arr;
    // 模型把多个空的答案挤在一项里（"第一空：A；第二空：B"）→ 先按空位标记拆，再按分隔符拆
    if (arr.length === 1 && blanks > 1) {
      const parts = splitBlankMarked(arr[0]) || splitAnswerText(arr[0]);
      // 拆出项数在合理范围（不超过空数的 2 倍）才采用，防止把含分隔符的单空内容拆碎
      if (parts.length > 1 && parts.length <= blanks * 2) return parts;
    }
    // 单空却返回多项（模型把一个答案拆碎/给同义词）→ 合并回一项，保留全部信息
    if (blanks === 1 && arr.length > 1) return [arr.join('；')];
    return arr;
  }

  // 连线题（11）/排序题（13）：给下拉框设值，并同步 chosen 这类美化控件的显示
  async function fillSelectQuestion(q, answers) {
    const sel = q.type === '11'
      ? 'select.dept_select'
      : '.sortQuesSelect select, .sortQuesSelect .dept_select, select.dept_select';
    let sels = [];
    try { sels = q.node.querySelectorAll(sel); } catch (e) { sels = []; }
    if (!sels.length) return false;
    let done = 0;
    for (let i = 0; i < sels.length; i++) {
      const s = sels[i];
      let v = answers[i] != null ? String(answers[i]).trim() : '';
      if (!v) continue;
      if (q.type === '13') v = v.toUpperCase();
      // option 的 value 未必等于答案原文（连线题答案是中文项），先在 option 里按文本找一次
      let applied = false;
      try {
        const opts = s.options || [];
        for (let k = 0; k < opts.length; k++) {
          if (qnorm(opts[k].textContent) === qnorm(v)) { s.value = opts[k].value; applied = true; break; }
        }
        if (!applied) for (let k = 0; k < opts.length; k++) {
          if (String(opts[k].value) === v) { s.value = opts[k].value; applied = true; break; }
        }
      } catch (e) { /* 忽略 */ }
      if (!applied) { try { s.value = v; applied = true; } catch (e) { /* 忽略 */ } }
      if (!applied) continue;
      try { s.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* 忽略 */ }
      try {
        const box = s.nextElementSibling;
        if (box && box.classList && box.classList.contains('chosen-container')) {
          const t = box.querySelector('.chosen-single span');
          if (t) t.textContent = v;
          box.querySelectorAll('.chosen-results li').forEach((li) => {
            li.classList.toggle('result-selected', String(li.textContent).trim() === v);
          });
        }
      } catch (e) { /* 忽略 */ }
      done++;
      await sleep(150);
    }
    // 排序题往往还会把答案拼进一个隐藏 input，一并写上
    if (q.type === '13') {
      try {
        const inp = q.node.querySelector('input[name^="answer"]');
        if (inp) inp.value = answers.join('');
      } catch (e) { /* 忽略 */ }
    }
    return done > 0;
  }

  // ---- 按题型把答案填回页面 ----
  async function fillQuestion(q, answers) {
    if (q.type === '0' || q.type === '1') {
      // 模型返回「ABD」「A, B, D」「A、B、D」这类字母组合时拆成单字母（移植 PP v3.5.0 isPlainLetterAnswer；
      // 仅选择题分支，填空的 CAD/API 等缩写不受影响。isPlainLetterAnswer 自带分隔符清洗，天然兼容逗号/顿号版式）
      const tokens = [];
      for (let i = 0; i < answers.length; i++) {
        const a = String(answers[i] == null ? '' : answers[i]).trim();
        if (a.length > 1 && isPlainLetterAnswer(a)) {
          const clean = a.toUpperCase().replace(/[^A-Z]/g, '');
          for (const ch of clean) tokens.push(ch);
        } else {
          tokens.push(answers[i]);
        }
      }
      const idxs = [];
      tokens.forEach((a) => {
        const i = matchOptionIndex(a, q.options);
        if (i >= 0 && idxs.indexOf(i) < 0) idxs.push(i);
      });
      if (!idxs.length) return false;
      if (q.type === '1') {
        // 多选题：先取消「已选但不该选」的错误项
        for (let i = 0; i < q.options.length; i++) {
          if (idxs.indexOf(i) < 0 && isOptSelected(q.options[i].el)) await clickChoice(q.options[i].el);
        }
        await sleep(300);
      }
      let ok = 0;
      for (const i of idxs) {
        const el = q.options[i].el;
        if (isOptSelected(el)) { ok++; continue; }
        if (await clickChoice(el)) ok++;
      }
      return ok > 0;
    }
    if (q.type === '3') {
      const a = String(answers[0] || '');
      let wantTrue = null;
      if (JUDGE_TRUE.test(a)) wantTrue = true;
      else if (JUDGE_FALSE.test(a)) wantTrue = false;
      if (wantTrue === null) return false;
      for (const o of q.options) {
        // 新版考试页的判断题是 span[data='true'|'false']
        let ds = null;
        try { ds = o.el.querySelector && o.el.querySelector('span[data]'); } catch (e) { ds = null; }
        if (ds) {
          const v = String(ds.getAttribute('data') || '').toLowerCase();
          if ((wantTrue && (v === 'true' || v === '1')) || (!wantTrue && (v === 'false' || v === '0'))) {
            return isOptSelected(o.el) ? true : await clickChoice(o.el);
          }
        }
        const aria = (o.el.getAttribute && o.el.getAttribute('aria-label')) || '';
        const isTrue = JUDGE_TRUE.test(o.text) || /正确选择|对选择/.test(aria);
        const isFalse = JUDGE_FALSE.test(o.text) || /错误选择|错选择/.test(aria);
        if ((wantTrue && isTrue) || (!wantTrue && isFalse)) {
          return isOptSelected(o.el) ? true : await clickChoice(o.el);
        }
      }
      return false;
    }
    if (q.type === '11' || q.type === '13') return fillSelectQuestion(q, answers);

    // 填空（2）/简答（4）/论述（6）/计算（7）等主观题：文本域 / 填空输入框 / UEditor
    const fields = [];
    q.node.querySelectorAll('textarea').forEach((e) => fields.push(e));
    if (q.type === '2') {
      q.node.querySelectorAll('input.Py_tk, .Py_tk input, input[type="text"]').forEach((e) => {
        if (fields.indexOf(e) < 0) fields.push(e);
      });
    }
    if (!fields.length) return false;
    let wrote = 0;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      // 缺答案的空留空，绝不拿 answers[0] 重复填（两空题模型只回 1 项时，原先会把同一个答案填满所有空，全错）
      const val = String(answers[i] != null ? answers[i] : '');
      if (!val) continue;
      if (f.tagName === 'INPUT') {
        try {
          f.value = val;
          f.dispatchEvent(new Event('input', { bubbles: true }));
          f.dispatchEvent(new Event('change', { bubbles: true }));
          wrote++;
        } catch (e) { /* 忽略 */ }
        continue;
      }
      try {
        // 学习通填空题要先点一下填空容器，编辑框才会被激活（对齐 pp助手 的 .InpDIV 处理）
        const box = f.closest('.blankItemDiv') || f.parentElement;
        const inp = (box && box.querySelector) ? box.querySelector('.InpDIV') : null;
        if (inp && !inp.__cxaiClicked) { inp.__cxaiClicked = 1; clickEl(inp); await sleep(250); }
        const ue = (pageWin.UE && pageWin.UE.getEditor) ? pageWin.UE.getEditor(f.id || f.name) : null;
        if (ue && typeof ue.setContent === 'function') {
          if (ue.body === null) {
            await new Promise((r) => { try { ue.addListener('ready', r); } catch (e) { /* 忽略 */ } setTimeout(r, 1500); });
          }
          ue.setContent('<p>' + val + '</p>');
          try { ue.fireEvent('contentChange'); } catch (e) { /* 忽略 */ }
          wrote++;
          continue;
        }
      } catch (e) { /* 无 UEditor，走 textarea */ }
      f.value = val;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
      wrote++;
    }
    return wrote > 0;
  }

  // ---- 提交 / 暂存按钮 ----
  // 作业页常同时有「保存(暂存)」与「提交」两个按钮，二者语义不同（pp助手 也是把 btnBlueSubmit 与 noSubmit 分开调的），
  // 所以这里按文案分两档匹配，绝不复用同一个正则。
  const SUBMIT_RX = /^(提交|交卷|提交答案|提交试卷|立即提交|确认提交)/;
  const SAVE_RX = /^(保存|保存答案|暂存)/;

  // 按按钮文字找第一个可见按钮（排除本脚本面板里的按钮）
  function findBtnByText(doc, rx) {
    let cands = [];
    try { cands = doc.querySelectorAll('button, a, div, span, input[type=button], input[type=submit]'); } catch (e) { cands = []; }
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      if (isOwnNode(el)) continue; // 面板里的「保存配置」也以「保存」开头，别被当成页面按钮
      const t = (el.innerText || el.value || '').trim();
      if (!t || t.length > 12 || !isVisible(el)) continue;
      if (rx.test(t)) return el;
    }
    return null;
  }

  // 提交按钮：先认「提交」类，都没有才退而求其次用「保存」（只存不交总好过完全不动）
  function findSubmitBtn(doc) {
    const sels = ['.submit-btn', '#submitBtn', '.btnBlueSubmit', '#btnBlueSubmit', '.subLanding', 'a.submit-btn', '.cx_submit'];
    for (let i = 0; i < sels.length; i++) {
      let el = null;
      try { el = doc.querySelector(sels[i]); } catch (e) { el = null; }
      if (el && isVisible(el) && !isOwnNode(el)) return el;
    }
    return findBtnByText(doc, SUBMIT_RX) || findBtnByText(doc, SAVE_RX);
  }

  // 暂存（保存草稿）按钮：只认「保存/暂存」类，绝不拿提交按钮顶上
  function findSaveBtn(doc) {
    const sels = ['.save-btn', '#saveBtn', '.btnSave', '#btnSave', '.noSubmit', '.cx_save', '.subLanding'];
    for (let i = 0; i < sels.length; i++) {
      let el = null;
      try { el = doc.querySelector(sels[i]); } catch (e) { el = null; }
      if (el && isVisible(el) && !isOwnNode(el) && SAVE_RX.test((el.innerText || el.value || '').trim())) return el;
    }
    return findBtnByText(doc, SAVE_RX);
  }

  // ---- 提交后弹出的「确认提交」弹窗 ----
  // 学习通点提交/交卷后弹的确认框：标题「提示」、正文「确认提交?」、按钮「取消 / 提交」（实测）。
  // 做法：先按弹窗正文里的提示语（确认提交?/确定提交?…）定位到弹窗，再点其中的「提交/确定/确认」按钮；
  // 并排除原先的提交按钮本身，避免重复提交。另留一条兜底：只有「确定/确认」的普通弹窗也能点。
  const confirmClickedEls = new WeakSet();
  const CONFIRM_MSG = /确认提交|确定提交|确认要提交|是否要提交|是否提交|确认交卷|确认保存|确认要交卷/;
  const CONFIRM_BTN = /^(确定|确\s*定|确认|确\s*认|提交|交卷|保存|继续|继续提交|确定提交|确认提交|好的|是|ok)$/i;
  const PLAIN_OK_BTN = /^(确定|确\s*定|确认|确\s*认|好的|是|ok)$/i; // 兜底只认「确定/确认」，绝不认「提交」以免误触

  function inDialogBox(el) {
    let p = el;
    for (let i = 0; i < 5 && p && p.nodeType === 1; i++) {
      const cls = (p.className && String(p.className)) || '';
      const id = p.id || '';
      if (/dialog|confirm|conform|alert|modal|pop|layer|mask|notice|message|window/i.test(cls + ' ' + id)) return true;
      try { if (getComputedStyle(p).position === 'fixed') return true; } catch (e) { /* 忽略 */ }
      p = p.parentElement;
    }
    return false;
  }
  // 在给定范围内找文本命中 rx 的可点击元素（排除 exclude，同一个元素只点一次）
  // 命中多个时优先选「原生可点击且最内层」的那个（避免选中只包了一层的外层 div，点了不生效）
  function pickButtonIn(scope, rx, exclude, filter) {
    let cands = [];
    try { cands = scope.querySelectorAll('button, a, div, span, input[type=button], input[type=submit]'); } catch (e) { cands = []; }
    let best = null; let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      if (el === exclude || isOwnNode(el)) continue; // 排除目标按钮本身，也排除本脚本面板里的按钮
      const t = (el.innerText || el.value || '').trim();
      if (!t || t.length > 8 || !rx.test(t)) continue;
      if (confirmClickedEls.has(el) || !isVisible(el)) continue;
      if (filter && !filter(el)) continue;
      const tag = el.tagName.toLowerCase();
      const native = (tag === 'button' || tag === 'a' || tag === 'input') ? 0 : 1;
      const score = native * 10 + (el.children ? el.children.length : 0);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  function findConfirmBtn(doc, exclude) {
    // 1) 按正文提示语定位弹窗本体：文案很短且含「确认提交?」之类的元素，再向上找承载确认按钮的容器
    let nodes = [];
    try { nodes = doc.querySelectorAll('div,section,article,p'); } catch (e) { nodes = []; }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (isOwnNode(n) || !isVisible(n)) continue;
      let txt = '';
      try { txt = (n.textContent || '').trim(); } catch (e) { continue; }
      if (!txt || txt.length > 60 || !CONFIRM_MSG.test(txt)) continue;
      let p = n;
      for (let k = 0; k < 6 && p && p.nodeType === 1 && p !== doc.body; k++) {
        const b = pickButtonIn(p, CONFIRM_BTN, exclude);
        if (b) return b;
        p = p.parentElement;
        // 一旦向上走出弹窗（容器文案过长）就停，避免把范围扩到整页、误点页面上的其它「提交/保存」按钮
        let up = '';
        try { up = (p && p.textContent || '').trim(); } catch (e) { up = ''; }
        if (up.length > 200) break;
      }
    }
    // 2) 兜底：普通的「确定/确认」弹窗（不认「提交」，避免误点提交按钮重复提交）
    return pickButtonIn(doc, PLAIN_OK_BTN, exclude, inDialogBox);
  }
  // 提交确认的等待参数
  const CONFIRM_POLL_MS = 500;          // 轮询间隔
  const CONFIRM_NO_DIALOG_MS = 6000;    // 提交后多久没出现确认弹窗，就视为「没有弹窗」
  const CONFIRM_CLICK_GRACE_MS = 2000;  // 点到「确认」后，再等这么久（冷却）才允许跳下一节
  const CONFIRM_TOTAL_MS = 12000;       // 总的等待上限
  let confirmWatcherPromise = null;
  // 需要扫描的文档：本 frame 的 document，外加同源的顶层 document（弹窗偶尔渲染在顶层）
  function confirmDocs() {
    const docs = [document];
    try {
      const t = window.top;
      if (t && t !== window && t.document && t.document !== document) docs.push(t.document);
    } catch (e) { /* 跨源，忽略 */ }
    return docs;
  }
  // 提交后自动点「确认提交」弹窗；返回 Promise，等「点完确认 + 冷却」或超时才 resolve。
  // 改成可等待是为了让提交/确认期间答题流程一直处于 busy：挂机就不会抢着跳下一节，避免新页面盖掉提交按钮。
  function watchSubmitConfirm(exclude) {
    if (confirmWatcherPromise) return confirmWatcherPromise;
    log('已点击提交，若弹出「确认提交」窗口将自动点确认…');
    broadcastAnswerBusy(true); // iframe 里广播给顶层，等确认期间不跳转
    const start = Date.now();
    let clicks = 0;
    let graceTimer = null;
    confirmWatcherPromise = new Promise((resolve) => {
      const finish = () => {
        clearInterval(timer);
        clearTimeout(graceTimer);
        confirmWatcherPromise = null;
        broadcastAnswerBusy(false);
        resolve();
      };
      const timer = setInterval(() => {
        if (clicks >= 3 || Date.now() - start > CONFIRM_TOTAL_MS) { finish(); return; }
        const docs = confirmDocs();
        let hit = null;
        for (let i = 0; i < docs.length; i++) {
          hit = findConfirmBtn(docs[i], exclude);
          if (hit) break;
        }
        if (hit) {
          confirmClickedEls.add(hit);
          clicks++;
          try {
            hit.click();
            markSubmitted(); // 双保险：点到确认即置位「已提交」，防止随后页面重载导致丢失
            log('已自动点击「确认提交」弹窗', 'ok');
            setAnswerStatus('已自动确认提交');
          } catch (e) { /* 忽略 */ }
          // 每次点到确认都重置冷却：等最后一次确认后再过 2 秒才允许跳转
          clearTimeout(graceTimer);
          graceTimer = setTimeout(finish, CONFIRM_CLICK_GRACE_MS);
          return;
        }
        // 一直没等到弹窗，达到「无弹窗」时限就结束，避免白白拖住答题流程
        if (clicks === 0 && Date.now() - start > CONFIRM_NO_DIALOG_MS) finish();
      }, CONFIRM_POLL_MS);
    });
    return confirmWatcherPromise;
  }
  // 手动点「提交/交卷/保存」按钮时同样自动确认：用捕获阶段监听任意这类点击
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || isOwnNode(el)) return; // 本脚本面板上的点击（如「保存配置」）不参与提交确认监听
    const t = String(el.innerText || el.value || '').trim();
    if (t.length <= 12 && /^(提交|交卷|保存|提交答案|保存答案|提交试卷|确定提交|确认提交)/.test(t)) watchSubmitConfirm(el);
  }, true);

  // ---- 总控状态（顶层读自己的，同时收 iframe 的回报；一并写入首页日志）----
  const answerState = { running: false, runningAt: 0, kind: null, found: 0, done: 0, lastLogged: '', tried: new Set() };

  // 「已处理过的题目签名」持久化到 sessionStorage（按页面归一化 key 归类）。
  // purpose：学习通提交后常把测验所在 iframe 重载一次，脚本随之重新注入、内存里的 tried 被清空，
  // 于是同一套题会被再抓一遍；持久化后重注入时读回，命中就不再重复作答。
  const SIG_STORE_KEY = 'cxai_tried_sigs_v1';
  // 易变的一次性令牌/签名类参数：enc、openc、v、随机数等，刷新后可能变，不能拿来做去重键
  const VOLATILE_PARAM = /^(enc|openc|token|sign|signature|t|ts|_t|_|time|timestamp|nonce|rand|random|rt|v|ver|version|sid|session|crossid)$/i;
  // 归一化页面 key：origin+pathname + 稳定参数（剔除上面的易变 token 与超长签名串），
  // 这样同一章节在带不带令牌的情况下都能命中同一条记录，又不至于把不同章节混为一谈。
  function pageKey() {
    try {
      const u = new URL(location.href);
      const kept = [];
      u.searchParams.forEach((val, name) => {
        if (VOLATILE_PARAM.test(name)) return;
        if (String(val).length > 40) return; // 超长串多半是签名/令牌
        kept.push(name.toLowerCase() + '=' + val);
      });
      kept.sort();
      return u.origin + u.pathname + (kept.length ? '?' + kept.join('&') : '');
    } catch (e) {
      return location.href; // 非法 URL（如 about:blank / javascript:）时退化为原始 href
    }
  }
  function sigStore() {
    try { return JSON.parse(sessionStorage.getItem(SIG_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function loadTriedSigs() {
    const list = sigStore()[pageKey()];
    return Array.isArray(list) ? list : [];
  }
  function saveTriedSig(sig) {
    if (!sig) return;
    try {
      const all = sigStore();
      const key = pageKey();
      const list = Array.isArray(all[key]) ? all[key] : [];
      if (list.indexOf(sig) < 0) list.push(sig);
      all[key] = list;
      sessionStorage.setItem(SIG_STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }
  function clearTriedSigs() {
    try {
      const all = sigStore();
      delete all[pageKey()];
      sessionStorage.setItem(SIG_STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }
  // 结构指纹：只取「题型 + 选项数」，不碰题干/选项文字。
  // 原因：超星的加密字体（font-cxsecret）每次加载的映射都随机变，题面文字会变，
  // 用文字做去重键在页面重载后必然对不上——这正是「提交后又重抓一遍」的真正原因。
  function sigOf(kind, list) {
    return kind + '|' + list.length + '|' + list.map((q) => q.type + ':' + q.options.length).join(',');
  }

  // 「本页/本章节已提交」标记：提交成功后在 sessionStorage 里置位，本页不再二次扫描。
  // 同源 frame 共享 sessionStorage，故用章节 id（knowledgeid/chapterId）归类，跨 frame、跨令牌变化都能命中。
  const SUBMITTED_STORE_KEY = 'cxai_submitted_v1';
  function chapterKey() {
    try {
      const p = new URL(location.href).searchParams;
      let id = '', cid = '', clz = '';
      p.forEach((v, k) => {
        const n = k.toLowerCase();
        if (n === 'knowledgeid' || n === 'chapterid') id = v;
        else if (n === 'courseid') cid = v;
        else if (n === 'clazzid') clz = v;
      });
      if (id || (cid && clz)) return `c=${cid}&z=${clz}&k=${id}`;
    } catch (e) { /* 忽略 */ }
    return pageKey();
  }
  function submittedStore() {
    try { return JSON.parse(sessionStorage.getItem(SUBMITTED_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function markSubmitted() {
    try {
      const all = submittedStore();
      all[chapterKey()] = Date.now();
      sessionStorage.setItem(SUBMITTED_STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }
  function isSubmitted() {
    return !!submittedStore()[chapterKey()];
  }
  function clearSubmitted() {
    try {
      const all = submittedStore();
      delete all[chapterKey()];
      sessionStorage.setItem(SUBMITTED_STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 忽略 */ }
  }

  // 跨 frame 单实例锁：同一页/同一章节只允许一个 frame 实例作答，避免多 frame 重复抓题/重复提交。
  // （pp助手 的做法是「iframe 里非 answerQuestion2 直接 return」；我们不改架构，用共享锁达到同样效果。）
  // 同源 frame 共享 sessionStorage；持锁者带心跳刷新，挂掉后 30 秒自动失效。
  const ANSWER_LOCK_KEY = 'cxai_answer_lock_v1';
  const LOCK_STALE_MS = 30000;
  const frameId = Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  function lockStore() {
    try { return JSON.parse(sessionStorage.getItem(ANSWER_LOCK_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  // 本页的锁是否被「别的 frame」正持有着（且未过期）
  function lockHeldByOther() {
    try {
      const cur = lockStore()[chapterKey()];
      return !!(cur && cur.owner !== frameId && Date.now() - (cur.at || 0) < LOCK_STALE_MS);
    } catch (e) { return false; }
  }
  function tryAcquireLock(force) {
    try {
      const all = lockStore();
      const key = chapterKey();
      const cur = all[key];
      if (!force && cur && cur.owner !== frameId && Date.now() - (cur.at || 0) < LOCK_STALE_MS) return false;
      all[key] = { owner: frameId, at: Date.now() };
      sessionStorage.setItem(ANSWER_LOCK_KEY, JSON.stringify(all));
      return true;
    } catch (e) { return true; } // 存储不可用时退化为「不锁」，保持原行为
  }
  function refreshLock() {
    try {
      const all = lockStore();
      const key = chapterKey();
      if (all[key] && all[key].owner === frameId) {
        all[key].at = Date.now();
        sessionStorage.setItem(ANSWER_LOCK_KEY, JSON.stringify(all));
      }
    } catch (e) { /* 忽略 */ }
  }
  function releaseLock() {
    try {
      const all = lockStore();
      const key = chapterKey();
      if (all[key] && all[key].owner === frameId) {
        delete all[key];
        sessionStorage.setItem(ANSWER_LOCK_KEY, JSON.stringify(all));
      }
    } catch (e) { /* 忽略 */ }
  }

  // 按文案粗略判断日志级别，供答题/挂机状态并入首页日志时着色
  function levelOf(text) {
    if (/失败|错误|出错|无法|没找到|未找到|未匹配|缺少|异常|拦截/.test(text)) return 'err';
    if (/已播完|全部播完|完成|成功|已开启|解密|正常/.test(text)) return 'ok';
    return 'info';
  }

  function setAnswerStatus(text, found, done) {
    if (found != null) answerState.found = found;
    if (done != null) answerState.done = done;
    if (text && text !== answerState.lastLogged) {
      answerState.lastLogged = text;
      log(text, levelOf(text));
    }
    if (window.top !== window) {
      try {
        window.top.postMessage({ __cxAiAnswer: 1, href: location.href, text, found: answerState.found, done: answerState.done, busy: answerState.running }, '*');
      } catch (e) { /* 忽略 */ }
    }
  }

  // 把「是否正在作答」广播给顶层，供挂机在跳转前判断本页题目答完没（跨源 iframe 也通）
  function broadcastAnswerBusy(busy) {
    if (window.top === window) return;
    try { window.top.postMessage({ __cxAiAnswer: 1, href: location.href, busy: !!busy }, '*'); } catch (e) { /* 忽略 */ }
  }

  // 旧版作业页（iframe src 含 api/work）把「暂存/提交/确认」做成了页面函数，
  // 直接调用它们最稳（对齐 pp助手 的 noSubmit / btnBlueSubmit / submitCheckTimes）。
  function isApiWorkPage() {
    try { return /\/api\/work/i.test(location.href); } catch (e) { return false; }
  }

  // 考试页（/exam-ans/、/exam/test、exam/preview）在「逐题模式」下页面只渲染当前一题，
  // 脚本若「答完一题就自动交卷」等于毁卷；整卷预览模式同样不适合自动交卷。
  // 对齐 pp助手（它的考试逻辑也从不自动提交，只提示「请自行检查后提交试卷」）。
  function isExamPage() {
    try { return /\/exam-ans\/|\/exam\/test|exam\/preview/i.test(location.href); } catch (e) { return false; }
  }

  // 学习通提交时可能抛 alert：alert 是同步且模态的，会把挂在 await 上的整条流程卡死。
  // 对齐 pp助手 的 iframeWindow.alert = () => {}，但把内容转进日志，而不是直接吞掉让用户不知情。
  function mutePageAlert() {
    try {
      if (typeof unsafeWindow === 'undefined' || !unsafeWindow) return; // 没拿到真实页面 window 就别改，改了也没用
      if (unsafeWindow.__cxaiAlertMuted) return;
      unsafeWindow.alert = function (msg) {
        notice('页面提示（已拦截阻塞弹窗）：' + String(msg == null ? '' : msg).slice(0, 120), 'warn');
      };
      unsafeWindow.__cxaiAlertMuted = 1;
    } catch (e) { /* 忽略 */ }
  }

  // 「暂存答案」兜底（对齐 pp助手 的 noSubmit）：只在「提交失败 / 找不到提交按钮 / 完成率低于阈值」时用，
  // 不参与正常提交流程——先暂存再提交只会多一次状态变更与出错机会，对分数没有任何额外好处。
  //   · 旧版内嵌作业页有现成函数 noSubmit()；
  //   · 其他作业页退化为点「保存/暂存」按钮。
  // 返回是否真的暂存成功。
  async function saveDraft() {
    if (isExamPage()) return false; // 考试页不做任何自动提交/暂存
    if (typeof pageWin.noSubmit === 'function') {
      try { await pageWin.noSubmit(); return true; } catch (e) { /* 退化为点按钮 */ }
    }
    const btn = findSaveBtn(document);
    if (!btn) return false;
    clickOption(btn);
    return true;
  }

  // DOM 按钮提交（新版作业页 / 章节测验 / 考试页）
  async function submitByButton() {
    const btn = findSubmitBtn(document);
    if (!btn) {
      // 连提交/保存按钮都没找到 → 尽力暂存，别让答案白填
      const saved = await saveDraft();
      log(saved ? '答题完成，但没找到提交按钮，已改为暂存答案（请手动提交）' : '答题完成，但没找到提交/保存按钮，请手动提交', saved ? 'warn' : 'err');
      setAnswerStatus(saved ? '未找到提交按钮，已暂存答案' : '作答完成，但未找到提交按钮（请手动提交）');
      return;
    }
    log('自动提交已开启，3 秒后点击提交/保存…');
    await sleep(3000);
    try {
      // 提交按钮同样用完整事件序列（对齐 pp助手 对 .submit-btn 用 clickOption 的做法）
      clickOption(btn);
      log('已点击提交/保存', 'ok');
      setAnswerStatus('已点击提交/保存');
      // 先落盘「已提交」标记：确认点击可能触发 iframe 重载、脚本上下文被销毁，
      // await 永远等不回来，所以必须在点击提交后立刻置位（否则重载后会再抓一遍）。
      markSubmitted();
      // 再等「确认提交」弹窗点完 + 冷却；期间答题流程保持 busy，挂机不会抢跳下一节
      await watchSubmitConfirm(btn);
      log('本页已标记为「已提交」，刷新后不会重复作答', 'ok');
    } catch (e) {
      log('点击提交失败：' + e.message, 'err');
      // 保险丝：提交这一步失败时兜底暂存，避免答案白填
      if (await saveDraft()) log('已改为暂存答案，避免白填', 'warn');
    }
  }

  // 提交总入口：rate 为本轮「作答完成率(%)」
  async function doSubmit(rate) {
    // 考试页一律不自动提交：逐题模式下只能看到当前一题，自动交卷风险太大
    if (isExamPage()) {
      log('本页是考试页，已跳过自动提交（逐题/预览模式下自动交卷风险太大）；答案已填入，请自行检查后提交', 'warn');
      setAnswerStatus('考试页不自动提交');
      return;
    }
    // 提交前先挡住页面的阻塞型 alert，避免整条流程被弹窗卡住
    mutePageAlert();
    const threshold = Math.max(0, Math.min(100, Number(settings.answer.threshold)));
    const hasThreshold = !isNaN(threshold);
    // 完成率低于阈值：暂存答案（把答案存住），不提交，避免低分卷被交上去（对齐 pp助手 的「正确阈值」）
    if (hasThreshold && rate != null && rate < threshold) {
      const saved = await saveDraft();
      log(`作答完成率 ${rate}% 低于提交阈值 ${threshold}%，${saved ? '已暂存未提交' : '未找到暂存入口，未自动提交'}（请核对后手动提交）`, 'warn');
      setAnswerStatus(`低于提交阈值，${saved ? '已暂存' : '未提交'}`);
      return;
    }
    // 旧版作业：优先用页面自带的提交函数（DOM 按钮常常藏在样式后面点不动）
    if (isApiWorkPage() && typeof pageWin.btnBlueSubmit === 'function') {
      log('自动提交已开启，3 秒后调用作业页内置提交…');
      await sleep(3000);
      try {
        await pageWin.btnBlueSubmit();
        markSubmitted();
        await sleep(1500);
        if (typeof pageWin.submitCheckTimes === 'function') await pageWin.submitCheckTimes();
        log('已调用作业页内置提交并确认', 'ok');
        setAnswerStatus('已自动提交');
      } catch (e) {
        log('调用作业页内置提交失败：' + e.message + '，改用提交按钮重试', 'err');
        await submitByButton();
      }
      return;
    }
    await submitByButton();
  }

  async function runAutoAnswer(manual) {
    if (answerState.running) return;
    if (!settings.baseUrl || !settings.model || (!settings.apiKey && settings.provider !== 'ollama')) {
      log('自动答题缺少模型配置，请到「脚本配置」填写 API Key / 接口 / 模型', 'err');
      setAnswerStatus('缺少模型配置，无法作答');
      return;
    }
    // 跨 frame 单实例锁：本页/本章节只允许一个实例作答，避免多 frame 重复抓题、重复提交。
    // 手动点「立即作答」时强制接管锁；自动流程若锁被别人持有则静默跳过（在调用前已用 lockHeldByOther 预判）。
    if (!tryAcquireLock(manual)) {
      log('本页已有另一个窗口正在作答，跳过以避免重复', 'warn');
      return;
    }
    answerState.running = true;
    answerState.runningAt = Date.now();
    broadcastAnswerBusy(true);
    const lockHeartbeat = setInterval(refreshLock, 5000);
    try {
      // 先解密超星加密字体（font-cxsecret）：作业/测验题面常被加密，不先解密抓到的题干和选项就是乱码，
      // 模型也答不对。必须在抓题之前做（旧版顺序反了，是「抓不到题/答不对」的一大原因）。
      const enc = document.querySelector('.font-cxsecret');
      if (enc) {
        const ok = decodeCipherFont(document);
        if (!ok) log('检测到超星加密字体题目，未能解密：请安装/启用「超新星字体解密」脚本', 'err');
        else log('已解密超星加密字体题目', 'ok');
      }
      const { kind, list } = scanQuestions(document);
      if (!kind || !list.length) {
        setAnswerStatus(manual ? '本页没找到题目' : '');
        if (manual) log('本页没找到题目：可点「抓题诊断」看页面里都有哪些容器', 'warn');
        return;
      }
      answerState.tried.add(sigOf(kind, list)); // 立刻标记，避免同实例轮询重复触发
      answerState.kind = kind;
      log(`自动答题：发现 ${list.length} 道题目（${kind === 'zj' ? '章节测验/作业页' : '新版作业/考试'}）`, 'ok');
      setAnswerStatus(`发现 ${list.length} 道题目，开始作答…`, list.length, 0);
      const ctx = pageContext(); // 课程/章节背景注入 prompt，提高正确率
      const reviewOn = !!settings.answer.review && fallbackReady();
      if (settings.answer.review && !fallbackReady()) log('已开启「答案复核」但未配置备用模型，本次不复核', 'warn');
      let done = 0;
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (settings.answer.skipAnswered && isQuestionAnswered(q)) { done++; continue; }
        if (!q.title) { log(`第 ${i + 1} 题的题干为空（版式未识别），已跳过`, 'warn'); continue; }
        setAnswerStatus(`正在作答第 ${i + 1}/${list.length} 题：${q.title.slice(0, 30)}…`, list.length, done);
        // 单选题选项乱序去偏：大模型普遍偏爱前排选项（A/B），打乱后发问、收到字母再映射回真实选项
        let askQ = q;
        let remap = null;
        if (q.type === '0' && q.options.length > 2) {
          const idx = q.options.map((_, k) => k);
          for (let s = idx.length - 1; s > 0; s--) {
            const rr = Math.floor(Math.random() * (s + 1));
            [idx[s], idx[rr]] = [idx[rr], idx[s]];
          }
          if (idx.some((v, k) => v !== k)) { // 打乱后与原顺序相同则不折腾
            remap = idx; // remap[展示序] = 真实序
            askQ = Object.assign({}, q, { options: idx.map((k2) => q.options[k2]) });
          }
        }
        let raw;
        try {
          const r = await askWithFallback(buildAnswerMessages(askQ, ctx));
          if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + errText(r.res));
          raw = readAnswer(r.res);
          if (!raw) throw new Error('空返回');
        } catch (e) {
          log(`第 ${i + 1} 题请求失败：${e.message}`, 'err');
          emitRecord(Object.assign(baseRec(q, kind), { status: 'err', reason: '请求失败：' + e.message }));
          continue;
        }
        let ans = parseAnswerJson(raw, q.type === '2'); // 填空题不盲拆字符串，交给 normalizeBlankAnswer 按空数处理
        if (!ans) {
          log(`第 ${i + 1} 题未能解析出答案：${String(raw).slice(0, 60)}`, 'err');
          emitRecord(Object.assign(baseRec(q, kind), { status: 'err', reason: '无法解析模型返回：' + String(raw).slice(0, 40) }));
          continue;
        }
        if (remap) {
          // 展示顺序的字母 → 真实选项的字母（非字母内容原样放行）
          const unshuffle = (a) => {
            const t = String(a).trim();
            if (!/^[A-Ja-j]$/.test(t)) return a;
            const si = t.toUpperCase().charCodeAt(0) - 65;
            return (si >= 0 && si < remap.length) ? String.fromCharCode(65 + remap[si]) : a;
          };
          ans = ans.map(unshuffle);
        }
        // 答案复核：备用模型独立作答同一题，交叉验证；不一致时把两个候选交给主模型仲裁
        let reviewNote = '';
        if (reviewOn) {
          try {
            const v = await askReview(buildAnswerMessages(q, ctx));
            const vAns = v.ok ? parseAnswerJson(readAnswer(v.res)) : null;
            if (vAns && !answersEqual(vAns, ans)) {
              log(`第 ${i + 1} 题主备模型不一致（主 ${ans.join('、')} / 备 ${vAns.join('、')}），发起仲裁`, 'warn');
              const tb = await askWithFallback(buildTiebreakMessages(q, ctx, ans, vAns));
              if (tb.ok) {
                const tAns = parseAnswerJson(readAnswer(tb.res));
                if (tAns && !answersEqual(tAns, ans)) {
                  reviewNote = `主备分歧，仲裁后改采 ${tAns.join('、')}`;
                  ans = tAns;
                }
              }
            }
          } catch (e2) { /* 复核失败不影响正常作答 */ }
        }
        // 填空题答案校正：空数已知时拆分挤压项/合并碎片项，让项数对齐页面空数（主答/复核/仲裁三条路径统一在此校正）
        if (q.type === '2') ans = normalizeBlankAnswer(ans, q.blanks);
        // 单题填入失败不能中断整卷：之前一处抛错会让后面的题全部漏答
        let ok = false;
        let fillErr = '';
        try {
          ok = await fillQuestion(q, ans);
        } catch (e) {
          fillErr = e.message;
          log(`第 ${i + 1} 题填入时出错：${e.message}`, 'err');
        }
        log(`第 ${i + 1} 题${ok ? '已填入' : '未匹配到选项'}：${ans.join('、').slice(0, 40)}${reviewNote ? '（' + reviewNote + '）' : ''}`, ok ? 'ok' : 'err');
        emitRecord(Object.assign(baseRec(q, kind), {
          answer: ans.join('、'),
          status: ok ? 'ok' : 'warn',
          reason: ok ? reviewNote : ((fillErr ? '填入出错：' + fillErr : '未匹配到选项/控件，未填入') + (reviewNote ? '；' + reviewNote : ''))
        }));
        if (ok) done++;
        await sleep(Math.max(0.3, Number(settings.answer.interval) || 1) * 1000);
      }
      const rate = list.length ? Math.round((done / list.length) * 100) : 0;
      const tail = settings.answer.autoSubmit ? '，准备提交' : '，请自行核对后提交';
      log(`作答完成：${done}/${list.length} 题已填（完成率 ${rate}%）${tail}`, done === list.length ? 'ok' : 'warn');
      setAnswerStatus(`作答完成：${done}/${list.length} 题已填（${rate}%）${tail}`, list.length, done);
      // 只要真填过题就把本题签名持久化：页面重载/脚本重注入后不再重复抓同一套题
      if (done > 0) saveTriedSig(sigOf(kind, list));
      if (settings.answer.autoSubmit) await doSubmit(rate);
    } finally {
      clearInterval(lockHeartbeat);
      answerState.running = false;
      answerState.runningAt = 0;
      broadcastAnswerBusy(false);
      releaseLock();
    }
  }

  // 每个 frame 一个轮询：发现「有未作答题目」且本页尚未处理过就自动作答
  let answerTimerStarted = false;
  function startAnswerEngine() {
    if (answerTimerStarted) return;
    answerTimerStarted = true;
    // 重注入时先读回本页已作答过的签名（如提交后 iframe 重载），避免同一套题被再抓一遍
    loadTriedSigs().forEach((s) => answerState.tried.add(s));
    let submittedSkipLogged = false;
    setInterval(() => {
      if (!settings.answer.enabled || answerState.running) return;
      // 本页/本章节已提交过就不再扫描题目（不依赖题干文字，最可靠地挡住「提交后又重抓一遍」）
      if (isSubmitted()) {
        if (!submittedSkipLogged) { submittedSkipLogged = true; log('本页已提交过，跳过自动作答'); }
        return;
      }
      const { kind, list } = scanQuestions(document);
      if (!kind || !list.length) return;
      const unanswered = list.filter((q) => !isQuestionAnswered(q));
      if (!unanswered.length) return;
      const sig = sigOf(kind, list);
      if (answerState.tried.has(sig)) return;
      // 别的 frame 正在作答本页 → 静默让给它（不刷日志），避免多实例重复抓题
      if (lockHeldByOther()) return;
      // 去重标记与单实例锁的获取都在 runAutoAnswer 内完成，抢锁失败时本轮不标记、下轮再试
      runAutoAnswer(false);
    }, 2500);
  }

  // ---- 抓题诊断：抓不到题时点一下，把「页面里都有哪些候选容器」打进日志，便于按真实 DOM 补选择器 ----
  function diagQuestions() {
    log('—— 抓题诊断开始 ——', 'warn');
    log(`本窗口：${window.top === window ? '顶层窗口' : 'iframe'}｜${location.href.slice(0, 120)}`);
    const probes = ['.TiMu', '.questionLi', '.question-item', '.Zy_TItle', '.fontLabel', '.answerBg', '[class*="before-after"]', '.newZy_TItle', '.colorShallow', '.answer_p', 'textarea', 'input.Py_tk', '.InpDIV', '.font-cxsecret'];
    const docs = collectDocs();
    let blank = 0;
    docs.forEach((d) => {
      let url = '';
      try { url = d.location.href; } catch (e) { url = ''; }
      if (!url || url === 'about:blank') { blank++; return; } // javascript: 写出来的空 iframe，读不到东西，跳过不刷屏
      log(`文档：${d === document ? '本窗口' : ''} ${url.slice(0, 100)}`);
      probes.forEach((s) => {
        let n = -1;
        try { n = d.querySelectorAll(s).length; } catch (e) { n = -2; }
        if (n !== 0) log(`    ${s} → ${n < 0 ? '查询失败' : n}`);
      });
      const nodes = collectQuestionNodes(d);
      let usable = 0;
      nodes.forEach((n) => { try { if (!isOwnNode(n) && !isHiddenDeep(n)) usable++; } catch (e) { /* 忽略 */ } });
      log(`    ★ 题目容器（已去外壳）合计 ${nodes.length} 个，可用 ${usable} 个`);
      const parsed = [];
      nodes.forEach((n) => {
        try {
          if (isOwnNode(n) || isHiddenDeep(n)) return;
          parsed.push({ n, q: extractOne(n, n.classList.contains('questionLi') ? 'zy' : 'zj') });
        } catch (e) { /* 忽略 */ }
      });
      const hist = {};
      parsed.forEach((p) => { const t = TYPE_NAME[p.q.type] || p.q.type; hist[t] = (hist[t] || 0) + 1; });
      log(`    题型分布：${Object.keys(hist).map((k) => `${k}×${hist[k]}`).join('，') || '（无）'}`);
      parsed.slice(0, 20).forEach((p, i) => {
        let cls = '';
        try { cls = p.n.getAttribute('class') || ''; } catch (e) { /* 忽略 */ }
        log(`      #${i + 1} class="${cls}" → ${TYPE_NAME[p.q.type] || p.q.type}｜选项 ${p.q.options.length} 个｜题干「${p.q.title.slice(0, 24)}」`);
      });
      if (parsed.length > 20) log(`      …（其余 ${parsed.length - 20} 题未列出）`);
    });
    if (blank) log(`  （另有 ${blank} 个 about:blank 空 iframe 已跳过）`);
    document.querySelectorAll('iframe').forEach((f, i) => {
      const src = f.getAttribute('src') || '';
      if (!src || src.indexOf('javascript:') === 0) return; // 空/脚本 iframe 不用看
      let inner = null;
      try { inner = f.contentDocument; } catch (e) { inner = null; }
      log(`  iframe #${i + 1} ${inner ? '（同源，已并入上面的文档列表）' : '（跨源，读不到内容）'} ${src.slice(0, 100)}`);
    });
    log('—— 抓题诊断结束（若候选全是 0，请把这段日志复制反馈）——', 'warn');
  }

  // ===== 答题记录：逐题记录「题干 / 选项 / 填入的答案 / 结果」 =====
  // 顶层窗口持有列表 UI；iframe 里作答的题目用 postMessage 把记录回传给顶层统一渲染，
  // 避免每个 iframe 各存一份、用户看不到全貌。
  const answerRecords = [];
  const RECORDS_MAX = 300;                      // 最多保留多少条，超出丢最旧
  const RECORDS_STORE_KEY = 'cxai_records_v1';  // 存 sessionStorage：同一标签页内刷新后仍能回看
  let recordsBox = null;
  let recordsStatEl = null;
  let recordsCountEl = null;
  let recSeq = 0;                               // 记录序号（只增不减，删旧的不影响编号）
  let recSaveTimer = null;

  function fmtRecTime(ts) {
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }); } catch (e) { return ''; }
  }
  // 一条记录的基础字段：题型 / 题干 / 选项都来自抓题结果，answer / status / reason 由作答流程补
  function baseRec(q, kind) {
    return {
      no: 0, time: Date.now(), href: String(location.href || '').slice(0, 120), kind,
      type: TYPE_NAME[q.type] || q.type || '未知题型',
      title: q.title || '', options: q.options.map((o) => o.text),
      answer: '', status: 'ok', reason: ''
    };
  }
  function loadRecords() {
    try {
      const arr = JSON.parse(sessionStorage.getItem(RECORDS_STORE_KEY) || '[]');
      if (Array.isArray(arr)) {
        arr.forEach((r) => {
          if (!r || r.title == null) return;
          answerRecords.push(r);
          recSeq = Math.max(recSeq, Number(r.no) || 0);
        });
      }
    } catch (e) { /* 存储损坏则忽略 */ }
  }
  function persistRecords() {
    clearTimeout(recSaveTimer);
    recSaveTimer = setTimeout(() => {
      try { sessionStorage.setItem(RECORDS_STORE_KEY, JSON.stringify(answerRecords)); } catch (e) { /* 忽略 */ }
    }, 400);
  }
  function updateRecordsMeta() {
    if (recordsStatEl) recordsStatEl.textContent = `共 ${answerRecords.length} 条作答记录`;
    if (recordsCountEl) {
      recordsCountEl.textContent = answerRecords.length ? String(answerRecords.length) : '';
      recordsCountEl.classList.toggle('show', answerRecords.length > 0);
    }
  }
  // 用 createElement + textContent 构建，避免题干里的 HTML 字符被当成标签注入
  function recNode(rec) {
    const box = document.createElement('div');
    box.className = 'cxai-rec';
    const head = document.createElement('div');
    head.className = 'cxai-rec-h';
    const no = document.createElement('span'); no.className = 'cxai-rec-no'; no.textContent = '#' + (rec.no || '?');
    const type = document.createElement('span'); type.className = 'cxai-rec-type'; type.textContent = rec.type || '题目';
    const time = document.createElement('span'); time.className = 'cxai-rec-time'; time.textContent = fmtRecTime(rec.time);
    const st = document.createElement('span');
    st.className = 'cxai-rec-st ' + (rec.status === 'ok' ? 'ok' : rec.status === 'err' ? 'err' : 'warn');
    st.textContent = rec.status === 'ok' ? '已填入' : rec.status === 'err' ? '失败' : '未匹配';
    head.append(no, type, time, st);
    box.appendChild(head);
    const qt = document.createElement('div'); qt.className = 'cxai-rec-q'; qt.textContent = rec.title || '（题干为空）';
    box.appendChild(qt);
    if (rec.options && rec.options.length) {
      const op = document.createElement('div'); op.className = 'cxai-rec-opts';
      op.textContent = rec.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('   ');
      box.appendChild(op);
    }
    const an = document.createElement('div'); an.className = 'cxai-rec-a';
    an.textContent = '填入答案：';
    const b = document.createElement('b'); b.textContent = rec.answer || '（未填入）';
    an.appendChild(b);
    box.appendChild(an);
    if (rec.reason) {
      const rs = document.createElement('div'); rs.className = 'cxai-rec-r'; rs.textContent = '说明：' + rec.reason;
      box.appendChild(rs);
    }
    return box;
  }
  function renderAllRecords() {
    if (recordsBox) {
      recordsBox.innerHTML = '';
      answerRecords.forEach((r) => recordsBox.appendChild(recNode(r)));
    }
    updateRecordsMeta();
  }
  function addRecord(rec) {
    rec.time = rec.time || Date.now();
    if (!rec.no) rec.no = ++recSeq;
    answerRecords.push(rec);
    while (answerRecords.length > RECORDS_MAX) answerRecords.shift();
    if (recordsBox) {
      while (recordsBox.childElementCount >= RECORDS_MAX) recordsBox.removeChild(recordsBox.firstElementChild);
      recordsBox.appendChild(recNode(rec));
    }
    updateRecordsMeta();
    persistRecords();
  }
  // iframe 里作答的题：记录下来并回传给顶层；顶层自己作答的直接入库
  function emitRecord(rec) {
    if (window.top === window) { addRecord(rec); return; }
    try { window.top.postMessage({ __cxAiRecord: 1, rec: rec }, '*'); } catch (e) { /* 忽略 */ }
  }
  function copyRecords() {
    if (!answerRecords.length) { log('暂无答题记录可复制', 'warn'); return; }
    const text = answerRecords.map((r) => {
      const opts = (r.options && r.options.length)
        ? '\n' + r.options.map((o, i) => `   ${String.fromCharCode(65 + i)}. ${o}`).join('\n')
        : '';
      return `【${fmtRecTime(r.time)}】[${r.type}] ${r.title}${opts}\n   填入答案：${r.answer || '（未填入）'}${r.reason ? '（' + r.reason + '）' : ''}`;
    }).join('\n\n');
    const done = () => log('答题记录已复制到剪贴板（共 ' + answerRecords.length + ' 条）', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  // 非顶层窗口：不建任何 UI（避免出现多个悬浮窗），
  // 只驱动本节点里的播放器，并把状态用 postMessage 回报给顶层窗口（跨源也通）
  if (!isTop) {
    // 刚注入时先清一次顶层的「正在作答」标记：若本 frame 是被重载出来的，
    // 旧实例可能来不及广播 busy=false 就没了，会让顶层误以为还在作答而一直不跳转。
    broadcastAnswerBusy(false);
    // 播放许可（顶层发牌制）：顶层每轮选出全局唯一播放者并广播许可，未持牌的 frame 必须暂停，
    // 防止一页多个视频任务点（多个 iframe）同时播放触发学习通异常。
    // 默认不受控（gotPermitMsg=false 时行为同旧版），收到第一条许可消息后才进入受控模式——兼容顶层尚未注入/未升级的情况。
    let mediaPermit = true;
    let gotPermitMsg = false;
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.__cxAiPermit == null) return;
      gotPermitMsg = true;
      mediaPermit = !!d.grant;
      if (!mediaPermit) pauseOwnMedias(); // 许可被收回：立刻停播
    });
    setInterval(() => {
      const medias = ownMedia();
      // 弹题糊答：弹层在就本地点掉，弹层刚关闭就把播到一半的视频拉起来
      const popQuizOn = handlePopQuiz();
      if (!popQuizOn) resumeMidVideo();
      const hasUnfinished = medias.filter(unfinished).length > 0;
      // popQuizOn 时不起播：弹题没答完视频不应在弹层底下继续响，弹层点掉后由 resumeMidVideo 恢复
      if (settings.auto.autoplay && hasUnfinished && !popQuizOn && (!gotPermitMsg || mediaPermit)) {
        playFirstUnfinished(medias, clampRate(settings.auto.rate));
      } else if (gotPermitMsg && !mediaPermit && hasUnfinished) {
        pauseOwnMedias(); // 双保险：未持牌的每轮再压一次（防止播放器自动恢复播放）
      }
      try {
        window.top.postMessage({
          __cxAiFrame: 1,
          href: location.href,
          left: medias.filter(countable).length,
          total: medias.length,
          done: medias.filter(doneMedia).length,
          popquiz: popQuizOn ? 1 : 0, // 弹层仍在处理中：顶层据此禁止自动跳下一节
          info: medias.slice(0, 5).map(describeMedia)
        }, '*');
      } catch (e) { /* 忽略 */ }
    }, 1500);
    startAnswerEngine(); // iframe 里也可能装着测验/作业题目，同样自动作答
    return;
  }

  // ---------- 样式 ----------
  GM_addStyle(`
    #cxai-win{position:fixed;top:80px;right:24px;z-index:2147483601;width:380px;height:520px;
      min-width:290px;min-height:200px;max-width:94vw;max-height:90vh;background:#fff;border-radius:12px;
      box-shadow:0 12px 34px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;resize:both;
      font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:13px;color:#1f2937;}
    #cxai-win.min{height:auto!important;resize:none;}
    #cxai-win.min .cxai-body{display:none;}
    .cxai-head{padding:8px 10px 8px 12px;background:#2563eb;color:#fff;display:flex;align-items:center;
      justify-content:space-between;gap:8px;cursor:move;user-select:none;}
    .cxai-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;}
    .cxai-badge{font-size:11px;font-weight:400;background:rgba(255,255,255,.22);padding:1px 8px;border-radius:10px;}
    .cxai-hbtns{display:flex;gap:4px;}
    .cxai-hbtn{width:22px;height:22px;padding:0;border:none;border-radius:6px;background:rgba(255,255,255,.16);
      color:#fff;font-size:14px;line-height:1;cursor:pointer;}
    .cxai-hbtn:hover{background:rgba(255,255,255,.36);}
    .cxai-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
    .cxai-tabs{display:flex;flex:0 0 auto;border-bottom:1px solid #eee;}
    .cxai-tab{position:relative;flex:1;padding:9px 0;text-align:center;cursor:pointer;font-size:13px;color:#666;
      border-bottom:2px solid transparent;}
    .cxai-tab.active{color:#2563eb;border-bottom-color:#2563eb;font-weight:600;}
    .cxai-tab.has-err{color:#dc2626;}
    .cxai-tab.has-err.active{border-bottom-color:#dc2626;}
    .cxai-tab .cxai-dot{display:none;position:absolute;top:5px;right:15%;width:6px;height:6px;border-radius:50%;background:#dc2626;}
    .cxai-tab.has-err .cxai-dot{display:block;}
    .cxai-pane{flex:1;overflow-y:auto;padding:12px;display:none;flex-direction:column;gap:9px;}
    .cxai-pane.active{display:flex;}
    .cxai-label{font-size:12px;color:#6b7280;margin-bottom:4px;}
    .cxai-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;
      font-size:13px;font-family:inherit;background:#fff;color:#1f2937;}
    .cxai-input:focus{outline:none;border-color:#2563eb;}
    .cxai-btn{padding:9px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;
      cursor:pointer;font-family:inherit;}
    .cxai-btn:disabled{background:#93c5fd;cursor:not-allowed;}
    .cxai-ghost{background:#f3f4f6;color:#374151;}
    #cxai-log{flex:1;overflow-y:auto;background:#0f172a;border-radius:8px;padding:9px;min-height:160px;
      font-size:12px;line-height:1.65;font-family:ui-monospace,Menlo,monospace;}
    .cxai-log-line{padding:1px 6px;border-left:3px solid transparent;white-space:pre-wrap;word-break:break-word;}
    .cxai-log-line.info{color:#cbd5e1;}
    .cxai-log-line.ok{color:#4ade80;}
    .cxai-log-line.warn{color:#fbbf24;border-left-color:#fbbf24;}
    .cxai-log-line.err{color:#f87171;border-left-color:#f87171;background:rgba(248,113,113,.08);}
    .cxai-row{display:flex;gap:8px;}
    .cxai-meta{font-size:12px;color:#888;line-height:1.6;}
    .cxai-check{display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;cursor:pointer;}
    .cxai-check input{width:auto;margin:0;}
    .cxai-tip{font-size:12px;color:#6b7280;line-height:1.6;background:#f8fafc;border-radius:8px;padding:8px 10px;}
    .cxai-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}
    .cxai-chip{padding:4px 10px;border:1px solid #d1d5db;border-radius:14px;background:#f9fafb;color:#374151;
      font-size:12px;font-family:inherit;line-height:1.6;cursor:pointer;}
    .cxai-chip:hover{border-color:#2563eb;color:#2563eb;}
    .cxai-chip.active{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}
  /* 模型消耗档位小标签（跟在模型名后面）：免费/超低/低/中/高/超高 */
  .cxai-chip-cost{display:inline-block;margin-left:5px;font-size:10px;line-height:14px;padding:0 4px;border-radius:6px;color:#fff;vertical-align:1px;}
  .cxai-cost-free{background:#16a34a;}
  .cxai-cost-ulow{background:#4ade80;}
  .cxai-cost-low{background:#0d9488;}
  .cxai-cost-mid{background:#2563eb;}
  .cxai-cost-high{background:#ea580c;}
  .cxai-cost-uhigh{background:#dc2626;}
    #cxai-ball{position:fixed;right:22px;bottom:26px;z-index:2147483600;width:52px;height:52px;border-radius:50%;
      background:#2563eb;color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer;
      box-shadow:0 4px 14px rgba(0,0,0,.3);display:none;}
    #cxai-ball:hover{background:#1d4ed8;}
    /* 脚本配置：一页多段，用分隔标题把「大模型 / 自动答题 / 挂机」分开 */
    .cxai-cfghead{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#1f2937;
      background:#f8fafc;border:1px solid #eef2f6;border-radius:10px;padding:10px 12px;}
    .cxai-cfgicon{font-size:17px;line-height:1;}
    .cxai-sec{font-size:12px;font-weight:600;color:#2563eb;border-bottom:1px solid #e5e7eb;padding:4px 0 6px;margin-top:10px;
      display:flex;align-items:center;gap:6px;}
    .cxai-sec:first-child{margin-top:0;}
    .cxai-secic{font-size:13px;line-height:1;}
    /* 模式设置：三选一分段按钮（选中蓝底白字，未选白底灰边） */
    .cxai-seg{display:flex;gap:8px;margin-top:8px;}
    .cxai-seg-btn{flex:1;padding:9px 0;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;
      font-size:13px;font-family:inherit;cursor:pointer;}
    .cxai-seg-btn:hover{border-color:#2563eb;color:#2563eb;}
    .cxai-seg-btn.active{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}
    /* 答题记录：页签上的条数徽标 + 记录卡片 */
    .cxai-tab .cxai-count{display:none;margin-left:4px;background:#2563eb;color:#fff;border-radius:9px;font-size:10px;padding:0 5px;line-height:15px;vertical-align:middle;}
    .cxai-tab .cxai-count.show{display:inline-block;}
    #rec-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;min-height:120px;}
    .cxai-rec{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;background:#fafafa;}
    .cxai-rec-h{display:flex;align-items:center;gap:6px;margin-bottom:5px;flex-wrap:wrap;}
    .cxai-rec-no{font-weight:600;color:#2563eb;font-size:12px;}
    .cxai-rec-type{font-size:11px;background:#eef2ff;color:#4338ca;border-radius:8px;padding:1px 7px;}
    .cxai-rec-time{font-size:11px;color:#9ca3af;}
    .cxai-rec-st{font-size:11px;border-radius:8px;padding:1px 7px;margin-left:auto;}
    .cxai-rec-st.ok{background:#dcfce7;color:#166534;}
    .cxai-rec-st.warn{background:#fef3c7;color:#92400e;}
    .cxai-rec-st.err{background:#fee2e2;color:#991b1b;}
    .cxai-rec-q{font-size:12px;color:#1f2937;line-height:1.6;word-break:break-word;}
    .cxai-rec-opts{font-size:12px;color:#6b7280;line-height:1.6;margin-top:4px;word-break:break-word;}
    .cxai-rec-a{font-size:12px;color:#166534;margin-top:5px;word-break:break-word;}
    .cxai-rec-a b{color:#15803d;}
    .cxai-rec-r{font-size:11px;color:#b45309;margin-top:3px;word-break:break-word;}
    .cxai-recs-empty{font-size:12px;color:#9ca3af;text-align:center;padding:18px 0;}
  `);

  // ---------- 构建悬浮窗 ----------
  const win = document.createElement('div');
  win.id = 'cxai-win';
  win.innerHTML = `
    <div class="cxai-head" id="cxai-head">
      <div class="cxai-title">学习通 AI<span class="cxai-badge" id="cxai-badge">—</span></div>
      <div class="cxai-hbtns">
        <button class="cxai-hbtn" id="cxai-min" title="收起为标题条">—</button>
        <button class="cxai-hbtn" id="cxai-hide" title="隐藏（右下角小球可召回）">×</button>
      </div>
    </div>

    <div class="cxai-body">
      <div class="cxai-tabs">
        <div class="cxai-tab active" data-tab="log">日志<span class="cxai-dot"></span></div>
        <div class="cxai-tab" data-tab="records">答题记录<span class="cxai-count" id="cxai-rec-count"></span></div>
        <div class="cxai-tab" data-tab="config">脚本配置</div>
      </div>

      <div class="cxai-pane active" id="pane-log">
        <div class="cxai-row">
          <button class="cxai-btn cxai-ghost" id="log-clear" style="padding:6px 12px;font-size:12px;">清空</button>
          <button class="cxai-btn cxai-ghost" id="log-copy" style="padding:6px 12px;font-size:12px;">复制全部</button>
          <button class="cxai-btn cxai-ghost" id="log-scroll" style="padding:6px 12px;font-size:12px;">暂停滚动</button>
        </div>
        <div class="cxai-meta" id="log-stat">共 0 条 · 错误 0 · 警告 0</div>
        <div id="cxai-log"></div>
      </div>

      <div class="cxai-pane" id="pane-records">
        <div class="cxai-row">
          <button class="cxai-btn cxai-ghost" id="rec-clear" style="padding:6px 12px;font-size:12px;">清空记录</button>
          <button class="cxai-btn cxai-ghost" id="rec-copy" style="padding:6px 12px;font-size:12px;">复制全部</button>
        </div>
        <div class="cxai-meta" id="rec-stat">共 0 条作答记录</div>
        <div id="rec-list"></div>
      </div>

      <div class="cxai-pane" id="pane-config">
        <div class="cxai-cfghead"><span class="cxai-cfgicon">✨</span>答题配置</div>

        <div class="cxai-sec"><span class="cxai-secic">⚙️</span>模式设置</div>
        <div class="cxai-seg" id="mode-seg">
          <button class="cxai-seg-btn" data-mode="normal">正常模式</button>
          <button class="cxai-seg-btn" data-mode="video">仅视频</button>
          <button class="cxai-seg-btn" data-mode="answer">仅答题</button>
        </div>
        <div class="cxai-meta" id="mode-tip">正常模式＝挂机与答题全开；仅视频＝只挂机不答题；仅答题＝只答题不挂机。三个子开关也可在下方单独微调。</div>

        <div class="cxai-sec"><span class="cxai-secic">⚙️</span>大模型配置</div>
        <div>
          <div class="cxai-label">服务商（切换后自动填好接口和常用模型，仍可手改）</div>
          <select class="cxai-input" id="set-provider"></select>
        </div>
        <div>
          <div class="cxai-label">模型名（也可点下面的标签一键切换）</div>
          <input class="cxai-input" id="set-model" list="cxai-model-list" placeholder="glm-4.7-flash" />
          <datalist id="cxai-model-list"></datalist>
          <div class="cxai-chips" id="set-model-chips"></div>
          <div class="cxai-meta">标签末尾的彩色小字为消耗档位（免费 / 超低 / 低 / 中 / 高 / 超高），悬停可看完整说明；档位为相对参考，以各官网刊例为准。</div>
        </div>
        <div>
          <div class="cxai-label">接口地址（OpenAI 兼容 /chat/completions）</div>
          <input class="cxai-input" id="set-base" placeholder="https://open.bigmodel.cn/api/paas/v4/chat/completions" />
        </div>
        <div>
          <div class="cxai-label">API Key（Bearer Token）</div>
          <input class="cxai-input" type="password" id="set-key" placeholder="sk-..." />
        </div>
        <div class="cxai-label" style="margin-top:6px;border-top:1px solid #e5e7eb;padding-top:8px;">备用模型（可选）· 主模型被限流或失败时自动降级</div>
        <div>
          <div class="cxai-label">备用服务商（默认跟随主服务商，也可独立选其它厂商）</div>
          <select class="cxai-input" id="set-fb-provider"></select>
        </div>
        <div>
          <div class="cxai-label">备用模型名（留空 = 不使用备用模型）</div>
          <input class="cxai-input" id="set-fb-model" placeholder="例如 glm-4-flash-250414" />
          <div class="cxai-chips" id="set-fb-model-chips"></div>
        </div>
        <div>
          <div class="cxai-label">备用接口地址（留空则沿用上面的）</div>
          <input class="cxai-input" id="set-fb-base" placeholder="可选：留空沿用上面的接口" />
        </div>
        <div>
          <div class="cxai-label">备用 API Key（留空则沿用上面的）</div>
          <input class="cxai-input" type="password" id="set-fb-key" placeholder="可选：留空沿用上面的 Key" />
        </div>
        <div class="cxai-tip" id="set-tip"></div>
        <div class="cxai-row">
          <button class="cxai-btn" id="set-save" style="flex:1;">保存配置</button>
          <button class="cxai-btn cxai-ghost" id="set-test" style="flex:0 0 auto;padding:9px 14px;">测试连接</button>
        </div>
        <div class="cxai-meta" id="set-status"></div>
        <div class="cxai-meta">每个服务商的 Key / 接口 / 模型会各自记住，来回切换不用重填。Key 只保存在本机脚本存储里。</div>
        <div class="cxai-meta">「测试连接」直接用上面框里当前填的值发一条最短请求，不用先保存。</div>

        <div class="cxai-sec"><span class="cxai-secic">⚙️</span>自动答题</div>
        <label class="cxai-check"><input type="checkbox" id="ans-enabled" /> 自动答题（进入章节测验 / 作业 / 考试页自动识别题目并作答）</label>
        <label class="cxai-check"><input type="checkbox" id="ans-submit" /> 作答完成后自动提交 / 保存</label>
        <label class="cxai-check"><input type="checkbox" id="ans-review" /> 答案复核（备用模型独立作答再交叉验证，不一致时仲裁；更准但每题多 1~2 次请求，需先配置备用模型）</label>
        <label class="cxai-check"><input type="checkbox" id="ans-skip" /> 跳过已作答的题目</label>
        <div>
          <div class="cxai-label">每题之间的间隔（秒）</div>
          <input class="cxai-input" id="ans-interval" type="number" min="0.3" step="0.1" />
        </div>
        <div>
          <div class="cxai-label">提交阈值（作答完成率 %，低于则不自动提交、改为暂存）</div>
          <input class="cxai-input" id="ans-threshold" type="number" min="0" max="100" step="1" />
        </div>
        <div class="cxai-row">
          <button class="cxai-btn" id="ans-run" style="flex:1;">立即抓题作答</button>
          <button class="cxai-btn cxai-ghost" id="ans-diag" style="flex:0 0 auto;padding:9px 12px;">抓题诊断</button>
        </div>
        <div class="cxai-tip">兼容作业页（新版独立作业页 /work/doHomeWorkNew 与旧版内嵌作业 api/work，旧版会优先调用页面自带的提交函数）、章节测验与新考试页；支持单选 / 多选 / 判断 / 填空 / 简答 / 连线 / 排序。题目字体若被超星加密（font-cxsecret）会先自动解密再抓题，失败会在日志提示。「自动提交」默认关闭；开了之后，遇到「完成率低于提交阈值」「提交失败」「找不到提交按钮」这三种情况都会自动改为「暂存（保存草稿）」，避免答案白填。章节测验在 iframe 里、作业/考试在独立页，故本脚本在每个 frame 都会跑一遍。作答进度与结果都输出到「日志」页签，逐题记录见「答题记录」页签；抓不到题时点「抓题诊断」，日志会列出页面里的候选容器。</div>

        <div class="cxai-sec"><span class="cxai-secic">⚙️</span>挂机任务点</div>
        <label class="cxai-check"><input type="checkbox" id="auto-play" /> 自动播放本页任务点的视频 / 音频</label>
        <label class="cxai-check"><input type="checkbox" id="auto-muted" /> 自动播放时静音（起播不带声音，可在播放器手动开；也能绕过浏览器自动播放拦截）</label>
        <label class="cxai-check"><input type="checkbox" id="auto-next" /> 本页任务点播完后自动点「下一节」</label>
        <label class="cxai-check"><input type="checkbox" id="auto-jump-unanswered" /> 本页有题目但未开启自动答题时，仍自动跳下一节（可能跳过未作答的测验）</label>
        <div>
          <div class="cxai-label">播放倍速（超过 1x 有被学习通判无效、清空进度的风险）</div>
          <select class="cxai-input" id="auto-rate">
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
        </div>
        <div class="cxai-row">
          <button class="cxai-btn cxai-ghost" id="auto-next-now" style="flex:1;">立即跳下一节</button>
          <button class="cxai-btn cxai-ghost" id="auto-scan" style="flex:1;">重新扫描任务点</button>
        </div>
        <div class="cxai-meta">只管视频/音频任务点：章节测验、文档等其它任务点不参与判断，也不会被自动作答。只驱动真实的播放器，不伪造进度上报；倍速过高或长时间挂机仍有被判无效的可能。播放进度与状态输出到「日志」页签。</div>
      </div>
    </div>
  `;
  document.body.appendChild(win);

  const ball = document.createElement('button');
  ball.id = 'cxai-ball';
  ball.textContent = 'AI';
  ball.title = '打开学习通 AI 助手';
  document.body.appendChild(ball);

  const head = win.querySelector('#cxai-head');
  const badge = win.querySelector('#cxai-badge');
  const tabs = win.querySelectorAll('.cxai-tab');
  const panes = {
    log: win.querySelector('#pane-log'),
    records: win.querySelector('#pane-records'),
    config: win.querySelector('#pane-config')
  };
  logBox = win.querySelector('#cxai-log');
  logStatEl = win.querySelector('#log-stat');
  logTabEl = win.querySelector('.cxai-tab[data-tab="log"]');
  // 答题记录：顶层窗口才持有列表 UI；iframe 里的作答通过 postMessage 回传到这里渲染
  recordsBox = win.querySelector('#rec-list');
  recordsStatEl = win.querySelector('#rec-stat');
  recordsCountEl = win.querySelector('#cxai-rec-count');
  loadRecords();
  renderAllRecords();

  function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    Object.keys(panes).forEach((k) => panes[k].classList.toggle('active', k === name));
  }
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- 悬浮窗：显示 / 收起 / 拖动 / 尺寸记忆 ----------
  function setVisible(show) {
    ui.hidden = !show;
    win.style.display = show ? 'flex' : 'none';
    ball.style.display = show ? 'none' : 'block';
    if (show && ui.left != null) reclamp();
    saveUi();
  }
  function setMinimized(min) {
    ui.minimized = min;
    win.classList.toggle('min', min);
    saveUi();
  }
  function reclamp() {
    if (ui.left == null) return;
    win.style.left = clampX(win.offsetLeft) + 'px';
    win.style.top = clampY(win.offsetTop) + 'px';
  }
  function clampX(x) { return Math.max(0, Math.min(x, window.innerWidth - win.offsetWidth)); }
  function clampY(y) { return Math.max(0, Math.min(y, window.innerHeight - 40)); }

  function applyUi() {
    if (ui.width) win.style.width = ui.width + 'px';
    if (ui.height) win.style.height = ui.height + 'px';
    if (ui.left == null) {
      win.style.left = 'auto';
      win.style.right = '24px';
    } else {
      win.style.right = 'auto';
      win.style.left = clampX(ui.left) + 'px';
      win.style.top = clampY(ui.top == null ? 80 : ui.top) + 'px';
    }
    if (ui.top != null && ui.left == null) win.style.top = clampY(ui.top) + 'px';
    win.classList.toggle('min', !!ui.minimized);
    setVisible(!ui.hidden);
  }

  // 拖动（按住标题栏）
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cxai-hbtn')) return;
    const r = win.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    win.style.left = Math.max(0, Math.min(drag.left + dx, window.innerWidth - win.offsetWidth)) + 'px';
    win.style.top = Math.max(0, Math.min(drag.top + dy, window.innerHeight - 40)) + 'px';
    win.style.right = 'auto';
  });
  head.addEventListener('pointerup', () => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (wasClick) {
      if (win.classList.contains('min')) setMinimized(false);
      return;
    }
    saveUi({ left: win.offsetLeft, top: win.offsetTop });
  });
  head.addEventListener('pointercancel', () => { drag = null; });

  win.querySelector('#cxai-min').addEventListener('click', () => {
    const next = !win.classList.contains('min');
    setMinimized(next);
    log(next ? '浮窗已收起为标题条' : '浮窗已展开');
  });
  win.querySelector('#cxai-hide').addEventListener('click', () => setVisible(false));
  ball.addEventListener('click', () => setVisible(true));

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (win.classList.contains('min') || ui.hidden) return;
      saveUi({ width: win.offsetWidth, height: win.offsetHeight });
    }).observe(win);
  }
  window.addEventListener('resize', () => { if (!ui.hidden) reclamp(); });

  // ---------- 设置区逻辑 ----------
  const providerSel = win.querySelector('#set-provider');
  const modelInput = win.querySelector('#set-model');
  const modelList = win.querySelector('#cxai-model-list');
  const modelChipsEl = win.querySelector('#set-model-chips');
  const baseInput = win.querySelector('#set-base');
  const keyInput = win.querySelector('#set-key');
  const fbProviderSel = win.querySelector('#set-fb-provider');
  const fbModelInput = win.querySelector('#set-fb-model');
  const fbModelChipsEl = win.querySelector('#set-fb-model-chips');
  const fbBaseInput = win.querySelector('#set-fb-base');
  const fbKeyInput = win.querySelector('#set-fb-key');
  const tipEl = win.querySelector('#set-tip');
  const setStatus = win.querySelector('#set-status');

  // 模型消耗档位：chip 上显示彩色短字，悬停显示完整档位（相对参考，以官网刊例为准）
  const COST_LABEL = { free: '免费', 'ultra-low': '超低', low: '低', mid: '中', high: '高', 'ultra-high': '超高' };
  const COST_FULL = { free: '免费模型', 'ultra-low': '超低消耗型', low: '低消耗型', mid: '中等消耗', high: '高消耗', 'ultra-high': '超高消耗型' };
  const COST_CLASS = { free: 'free', 'ultra-low': 'ulow', low: 'low', mid: 'mid', high: 'high', 'ultra-high': 'uhigh' };
  function modelCost(pid, m) {
    const p = getProvider(pid);
    return (p && p.cost && p.cost[m]) || '';
  }
  // 备用模型当前归属的服务商：未独立选择时跟随主服务商
  function fbProviderId() { return settings.fallback.provider || settings.provider; }

  PROVIDERS.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    providerSel.appendChild(o);
  });

  // 把当前服务商的预设模型渲染成一排「点一下即切换」的标签；当前正在用的那个高亮。
  // 每个标签末尾追加消耗档位彩色小字（pid 决定查哪家厂商的档位表，主/备用可不同厂商）
  function renderModelChips(box, models, current, onPick, pid) {
    if (!box) return;
    box.innerHTML = '';
    if (!models || !models.length) return;
    const provId = pid || settings.provider;
    models.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cxai-chip' + (m === current ? ' active' : '');
      b.textContent = m;
      const cost = modelCost(provId, m);
      if (cost) {
        const s = document.createElement('span');
        s.className = 'cxai-chip-cost cxai-cost-' + (COST_CLASS[cost] || 'mid');
        s.textContent = COST_LABEL[cost] || '';
        b.appendChild(s);
      }
      const full = COST_FULL[cost] ? `消耗档位：${COST_FULL[cost]}（相对参考，以官网刊例为准）` : '';
      b.title = (full ? full + ' · ' : '') + (m === current ? '当前正在使用的模型' : '点击切换到该模型');
      b.addEventListener('click', () => onPick(m));
      box.appendChild(b);
    });
  }

  // 点标签 = 立即把该模型写入配置并保存生效（只改模型名，不动接口地址与 Key）
  function pickModel(m) {
    if (!m || m === modelInput.value) return;
    modelInput.value = m;
    settings.model = m;
    cacheCurrent();
    saveSettings();
    renderModelChips(modelChipsEl, getProvider(settings.provider).models, m, pickModel, settings.provider);
    setStatus.textContent = '已切换模型：' + m;
    setStatus.style.color = '#166534';
    log(`已切换模型：${m}（${getProvider(settings.provider).name}）`, 'ok');
  }
  function pickFallbackModel(m) {
    if (!m || m === fbModelInput.value) return;
    fbModelInput.value = m;
    settings.fallback.model = m;
    saveSettings();
    renderModelChips(fbModelChipsEl, getProvider(fbProviderId()).models, m, pickFallbackModel, fbProviderId());
    setStatus.textContent = '已设置备用模型：' + m;
    setStatus.style.color = '#166534';
    log(`备用模型设为：${m}（${getProvider(fbProviderId()).name}）`, 'ok');
  }

  // 备用服务商下拉：首项「跟随主服务商」，其余与主服务商列表一致
  function fillFbProviderSel() {
    fbProviderSel.innerHTML = '';
    const oFollow = document.createElement('option');
    oFollow.value = '';
    oFollow.textContent = '跟随主服务商（默认）';
    fbProviderSel.appendChild(oFollow);
    PROVIDERS.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      fbProviderSel.appendChild(o);
    });
    fbProviderSel.value = settings.fallback.provider || '';
  }
  fbProviderSel.addEventListener('change', () => {
    const id = fbProviderSel.value;
    settings.fallback.provider = id;
    const p = getProvider(id || settings.provider);
    if (id) {
      // 地址为空、或仍是某厂商的默认地址时，自动换成新厂商的默认接口；手填过的自定义地址不覆盖
      const curUrl = String(fbBaseInput.value || '').trim();
      const isDefaultOrEmpty = !curUrl || PROVIDERS.some((x) => x.baseUrl && x.baseUrl === curUrl);
      if (isDefaultOrEmpty && p.baseUrl) fbBaseInput.value = p.baseUrl;
      settings.fallback.baseUrl = fbBaseInput.value.trim();
    } else {
      // 改回「跟随主服务商」：清空独立地址与 Key，恢复沿用主模型配置的语义
      fbBaseInput.value = '';
      settings.fallback.baseUrl = '';
      fbKeyInput.value = '';
      settings.fallback.apiKey = '';
    }
    saveSettings();
    renderModelChips(fbModelChipsEl, p.models, settings.fallback.model || '', pickFallbackModel, id || settings.provider);
    log(id ? `备用服务商已切换：${p.name}（备用接口 ${settings.fallback.baseUrl || '沿用主配置'}）` : '备用服务商已改回「跟随主服务商」');
  });

  function fillSettings() {
    const p = getProvider(settings.provider);
    providerSel.value = p.id;
    baseInput.value = settings.baseUrl;
    modelInput.value = settings.model;
    keyInput.value = settings.apiKey;
    fillFbProviderSel();
    const fp = getProvider(fbProviderId());
    fbModelInput.value = settings.fallback.model || '';
    fbBaseInput.value = settings.fallback.baseUrl || '';
    fbKeyInput.value = settings.fallback.apiKey || '';
    tipEl.textContent = p.tip;
    badge.textContent = p.name;
    modelList.innerHTML = '';
    p.models.forEach((m) => {
      const o = document.createElement('option');
      o.value = m;
      modelList.appendChild(o);
    });
    renderModelChips(modelChipsEl, p.models, settings.model, pickModel, p.id);
    renderModelChips(fbModelChipsEl, fp.models, settings.fallback.model || '', pickFallbackModel, fp.id);
  }

  // 手填模型名时，标签高亮跟着输入框走（只重绘高亮，不保存）
  modelInput.addEventListener('input', () => {
    renderModelChips(modelChipsEl, getProvider(settings.provider).models, modelInput.value.trim(), pickModel, settings.provider);
  });
  fbModelInput.addEventListener('input', () => {
    renderModelChips(fbModelChipsEl, getProvider(fbProviderId()).models, fbModelInput.value.trim(), pickFallbackModel, fbProviderId());
  });

  // 把当前输入值存进该服务商的独立记忆里
  function cacheCurrent() {
    settings.cache[settings.provider] = {
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey
    };
  }

  function applyProvider(id, silent) {
    const p = getProvider(id);
    cacheCurrent();
    settings.provider = p.id;
    const c = settings.cache[p.id] || {};
    settings.baseUrl = c.baseUrl || p.baseUrl;
    settings.model = c.model || (p.models[0] || '');
    settings.apiKey = c.apiKey || '';
    fillSettings();
    saveSettings();
    if (!silent) log(`已切换服务商：${p.name}（模型 ${settings.model || '未填'}）`);
  }

  providerSel.addEventListener('change', () => applyProvider(providerSel.value));

  win.querySelector('#set-save').addEventListener('click', () => {
    const url = baseInput.value.trim();
    if (!/^https?:\/\//.test(url)) {
      setStatus.textContent = '接口地址需以 http:// 或 https:// 开头';
      setStatus.style.color = '#dc2626';
      return;
    }
    const fbUrl = fbBaseInput.value.trim();
    if (fbUrl && !/^https?:\/\//.test(fbUrl)) {
      setStatus.textContent = '备用接口地址需以 http:// 或 https:// 开头（留空则沿用主接口）';
      setStatus.style.color = '#dc2626';
      return;
    }
    settings.baseUrl = url;
    settings.model = modelInput.value.trim();
    settings.apiKey = keyInput.value.trim();
    settings.fallback = {
      provider: settings.fallback.provider || '', // 备用服务商独立选择，保存时不丢
      model: fbModelInput.value.trim(),
      baseUrl: fbUrl,
      apiKey: fbKeyInput.value.trim()
    };
    cacheCurrent();
    saveSettings();
    fillSettings();
    setStatus.textContent = '已保存 ✓';
    setStatus.style.color = '#166534';
    log(`配置已保存：${getProvider(settings.provider).name} / ${settings.model}，接口 ${settings.baseUrl}${fallbackReady() ? `，备用模型 ${settings.fallback.model}` : ''}`);
  });

  // ---------- 调用大模型 ----------
  // 底层请求：成功与否都 resolve({ ok, status, cost, res })，网络错误 / 超时直接 reject
  function rawChat(opts) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      GM_xmlhttpRequest({
        method: 'POST',
        url: opts.url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (opts.apiKey || 'none')
        },
        data: JSON.stringify({
          model: opts.model,
          stream: false,
          temperature: 0, // 答题要确定性输出：接口默认温度(0.7~1)会让同一道题两次作答结果不同
          messages: opts.messages
        }),
        responseType: 'json',
        timeout: opts.timeout || 60000,
        onload(res) {
          const cost = ((Date.now() - start) / 1000).toFixed(1);
          const ok = res.status >= 200 && res.status < 300;
          resolve({ ok, status: res.status, cost, res });
        },
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('超时'))
      });
    });
  }

  // 响应体里是否提示「访问量过大 / 被限流」等可重试的繁忙信息
  function isBusyRes(res) {
    return /访问量|请求量|稍后重试|繁忙|排队|限流|并发|overload|rate\s*limit|too\s*many|1305/i.test(errText(res));
  }
  // 退避秒数：2、5、10、15（带点随机，避免多个请求同刻齐发）
  function retryWait(i) {
    const seq = [0, 2, 5, 10, 15, 20];
    return Math.round((seq[Math.min(i, seq.length - 1)] || 15) + Math.random() * 2);
  }
  // 带自动重试的请求：遇到「访问量过大 / 429 / 5xx / 超时 / 网络错误」会退避重试
  async function requestChat(opts) {
    const tries = Math.max(1, Number(opts.retries) || 3);
    let last = null;
    for (let i = 1; i <= tries; i++) {
      let r = null;
      try {
        r = await rawChat(opts);
      } catch (e) {
        // 网络错误 / 超时
        last = e;
        if (i >= tries) throw e;
        const wait = retryWait(i);
        notice(`第 ${i}/${tries} 次请求失败（${e.message}），${wait} 秒后重试…`, 'warn');
        await sleep(wait * 1000);
        continue;
      }
      if (r.ok) return r;
      last = r;
      const busy = isBusyRes(r.res);
      const retryable = r.status === 429 || r.status >= 500 || busy;
      if (i >= tries || !retryable) return r;
      const wait = retryWait(i);
      notice(`接口繁忙${busy ? '（访问量过大）' : `（HTTP ${r.status}）`}，${wait} 秒后重试（第 ${i + 1}/${tries} 次）…`, 'warn');
      await sleep(wait * 1000);
    }
    if (last && last.status != null) return last;
    throw last || new Error('请求失败');
  }

  // 备用模型是否已配置（填了模型名才算开启）
  function fallbackReady() {
    return !!(settings.fallback && String(settings.fallback.model || '').trim());
  }
  // 先问主模型；若被限流/5xx/网络错误，且配了备用模型，则自动降级再问一次
  async function askWithFallback(messages) {
    let primary = null;
    try {
      const r = await requestChat({ url: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, messages });
      if (r.ok || !fallbackReady()) return r;
      // 只有「可重试」的失败才降级（限流/服务端错误），随手错误（如 401/400）降级也没用
      const busy = isBusyRes(r.res);
      if (!(busy || r.status === 429 || r.status >= 500)) return r;
      primary = r;
    } catch (e) {
      if (!fallbackReady()) throw e;
      primary = e;
    }
    const f = settings.fallback;
    const fbModel = String(f.model).trim();
    const fbUrl = (f.baseUrl && f.baseUrl.trim()) || settings.baseUrl;
    const fbKey = (f.apiKey && f.apiKey.trim()) || settings.apiKey;
    notice(`主模型（${settings.model}）失败，自动降级到备用模型 ${fbModel}…`, 'warn');
    try {
      const r2 = await requestChat({ url: fbUrl, apiKey: fbKey, model: fbModel, messages });
      if (r2.ok) { notice(`备用模型 ${fbModel} 作答成功`, 'ok'); return r2; }
      return r2;
    } catch (e2) {
      if (primary && primary.status != null) throw new Error(`主模型 HTTP ${primary.status}，备用模型 ${e2.message}`);
      throw e2;
    }
  }

  // 「答案复核」：不走降级逻辑，直接用备用模型独立作答同一题，与主模型答案交叉验证
  async function askReview(messages) {
    const f = settings.fallback;
    const fbUrl = (f.baseUrl && f.baseUrl.trim()) || settings.baseUrl;
    const fbKey = (f.apiKey && f.apiKey.trim()) || settings.apiKey;
    return requestChat({ url: fbUrl, apiKey: fbKey, model: String(f.model).trim(), messages });
  }

  // 从响应里取出回答正文
  function readAnswer(res) {
    try {
      const data = res.response && typeof res.response === 'object' ? res.response : JSON.parse(res.responseText);
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      return (msg && msg.content) || '';
    } catch (e) {
      return '';
    }
  }

  // 从失败响应里取出可读的错误信息。
  // 注意：请求用了 responseType:'json'，而各家接口的错误体基本都是 JSON——此时 GM 给的是已解析的
  // res.response，res.responseText 往往为空。旧写法只读 responseText，于是「401 Invalid API key」
  // 这类真正的原因会被吞成「无返回内容」，限流判断（isBusyRes）也因此失效。
  function errText(res) {
    let data = null;
    try {
      data = (res.response && typeof res.response === 'object') ? res.response : JSON.parse(res.responseText || '');
    } catch (e) { data = null; }
    if (data) {
      const err = data.error;
      const m = (err && (typeof err === 'string' ? err : (err.message || err.code))) || data.message || data.msg;
      if (m) return String(m);
    }
    const raw = res.responseText || (data ? JSON.stringify(data) : '');
    return String(raw).slice(0, 200) || '无返回内容';
  }

  // ---------- 测试连接 ----------
  const testBtn = win.querySelector('#set-test');
  testBtn.addEventListener('click', async () => {
    const url = baseInput.value.trim();
    const model = modelInput.value.trim();
    const key = keyInput.value.trim();
    if (!/^https?:\/\//.test(url)) {
      setStatus.textContent = '接口地址需以 http:// 或 https:// 开头';
      setStatus.style.color = '#dc2626';
      return;
    }
    if (!model) {
      setStatus.textContent = '请先填写模型名';
      setStatus.style.color = '#dc2626';
      return;
    }
    testBtn.disabled = true;
    setStatus.textContent = '测试中…';
    setStatus.style.color = '#6b7280';
    log(`测试连接：${url} · ${model} …`);
    try {
      const r = await requestChat({
        url,
        apiKey: key,
        model,
        timeout: 30000,
        messages: [{ role: 'user', content: '你好，只回复两个字：正常' }]
      });
      if (r.ok) {
        const a = readAnswer(r.res);
        setStatus.textContent = `连接正常 ✓ HTTP ${r.status}｜耗时 ${r.cost}s｜模型回：${a.slice(0, 40) || '(空)'}`;
        setStatus.style.color = '#166534';
        log(`测试成功：HTTP ${r.status}，耗时 ${r.cost}s，返回 ${a.length} 字`, 'ok');
      } else {
        const msg = errText(r.res);
        setStatus.textContent = `失败 HTTP ${r.status}：${msg.slice(0, 120)}`;
        setStatus.style.color = '#dc2626';
        log(`测试失败 HTTP ${r.status}：${msg}`, 'err');
      }
    } catch (e) {
      setStatus.textContent = `失败：${e.message}（检查网络、接口地址，或浏览器是否拦截跨域）`;
      setStatus.style.color = '#dc2626';
      log(`测试失败：${e.message}`, 'err');
    } finally {
      testBtn.disabled = false;
    }
  });

  // ---------- 日志区逻辑（首页主视图） ----------
  win.querySelector('#log-clear').addEventListener('click', () => {
    logBox.innerHTML = '';
    logStats.total = 0;
    logStats.err = 0;
    logStats.warn = 0;
    log('日志已清空');
  });

  win.querySelector('#log-copy').addEventListener('click', copyLogs);

  const logScrollBtn = win.querySelector('#log-scroll');
  logScrollBtn.addEventListener('click', () => {
    logAutoScroll = !logAutoScroll;
    logScrollBtn.textContent = logAutoScroll ? '暂停滚动' : '恢复滚动';
    if (logAutoScroll) logBox.scrollTop = logBox.scrollHeight;
    log(logAutoScroll ? '日志已恢复自动滚动' : '日志已暂停滚动（可自由翻看历史）');
  });

  // ---------- 答题记录区逻辑 ----------
  // 接收各 iframe 用 postMessage 回传的作答记录（跨源也通），并入本窗口的列表
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || !d.__cxAiRecord || !d.rec) return;
    addRecord(d.rec);
  });
  win.querySelector('#rec-clear').addEventListener('click', () => {
    answerRecords.length = 0;
    if (recordsBox) recordsBox.innerHTML = '';
    try { sessionStorage.removeItem(RECORDS_STORE_KEY); } catch (e) { /* 忽略 */ }
    updateRecordsMeta();
    log('答题记录已清空');
  });
  win.querySelector('#rec-copy').addEventListener('click', copyRecords);

  // ---------- 挂机：自动播放任务点 + 播完自动下一节 ----------
  // 只驱动页面里真实的播放器（video/audio）；下一节按钮选择顺序参考 pp助手。
  const autoPlayChk = win.querySelector('#auto-play');
  const autoMutedChk = win.querySelector('#auto-muted');
  const autoNextChk = win.querySelector('#auto-next');
  const autoJumpUnansweredChk = win.querySelector('#auto-jump-unanswered');
  const autoRateSel = win.querySelector('#auto-rate');

  // 挂机状态也并入首页日志：只在「状态真正变化」时记录，且过滤进度百分比这类高频细节，避免刷屏
  let lastAutoStatus = '';
  function setAutoStatus(text) {
    const key = text.replace(/，当前进度 \d+%|（视频加载中）/g, '');
    if (key === lastAutoStatus) return;
    lastAutoStatus = key;
    if (text) log(text, levelOf(text));
  }

  // 各 iframe 用 postMessage 回报的媒体状态（跨源 frame 里也跑着我们的脚本）
  const frameReports = new Map();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || !d.__cxAiFrame) return;
    frameReports.set(e.source, {
      left: d.left || 0,
      total: d.total || 0,
      done: d.done || 0,
      href: d.href || '',
      info: d.info || [],
      at: Date.now()
    });
  });
  // 汇总各 frame 回报的「计入数 / 媒体总数 / 已播完数」，6s 没上报的视为该 frame 已失效
  function frameStat() {
    let left = 0;
    let total = 0;
    let done = 0;
    let popquiz = 0;
    const now = Date.now();
    frameReports.forEach((r, src) => {
      if (now - r.at > 6000) { frameReports.delete(src); return; }
      left += r.left;
      total += r.total;
      done += r.done;
      popquiz += r.popquiz ? 1 : 0;
    });
    return { left, total, done, popquiz };
  }

  // ---- 播放发牌（顶层发牌制）：全局只允许一个视频在播 ----
  // 学习通章节页把多个视频任务点竖排成多个 iframe，各 frame 里的脚本自治起播会同时播放、触发学习通异常。
  // 顶层每轮汇总后选出唯一播放者并向下广播许可：优先顶层自己的视频，否则给第一个「还有未完成」的 iframe 回报。
  // 返回获牌者的 contentWindow（null = 牌在顶层自己手里）。
  function issueMediaPermit() {
    const now = Date.now();
    const alive = [];
    frameReports.forEach((r, src) => {
      if (now - r.at > 6000) { frameReports.delete(src); return; } // 清失效回报，防止残留快照抢牌
      alive.push(src);
    });
    let grantSrc = null;
    for (const src of alive) {
      if ((frameReports.get(src).left || 0) > 0) { grantSrc = src; break; }
    }
    // 定向发牌：frameReports 的 key（e.source）是窗口引用，无论 iframe 嵌套多深都能触达（DOM 遍历只能到第一层）
    alive.forEach((src) => {
      try { src.postMessage({ __cxAiPermit: 1, grant: src === grantSrc }, '*'); } catch (e) { /* 忽略 */ }
    });
    // 兜底：第一层 DOM iframe 里还没回报过的（刚注入/无媒体）也发一份 deny，尽早进入受控模式
    document.querySelectorAll('iframe').forEach((f) => {
      let cw = null;
      try { cw = f.contentWindow; } catch (e) { return; }
      if (!cw || alive.indexOf(cw) >= 0) return;
      try { cw.postMessage({ __cxAiPermit: 1, grant: false }, '*'); } catch (e) { /* 忽略 */ }
    });
    return grantSrc;
  }

  const notifiedFinished = new WeakSet();
  let doneStreak = 0; // 连续几次轮询都「全部播完」，避免刚结束就跳转
  let lastJumpAt = 0; // 上次跳转时间，防抖
  let everFinished = 0; // 是否真见过某个视频播完，避免把隐藏副本的误判当成"播完了"
  let everHadMedia = false; // 本页是否出现过媒体：之后归零多半是视频弹层接管 frame，不能按纯题目页跳转

  // ---- 挂机与自动答题的协调：本页（含同源子页 / iframe 回报）还有题目没答完时，先别跳下一节 ----
  let frameAnswerBusy = false;
  let frameAnswerBusyAt = 0;
  let frameAnswerFound = 0;
  let frameAnswerSettledAt = 0; // 最近一次收到「作答完成」的时间
  let lastAnswerHref = location.href; // 换页时重置上面的跨 frame 答题状态

  function answerBusyNow() {
    if (answerState.running) {
      // 兜底：本实例作答卡死超过 5 分钟就视为已结束，避免永久挡住跳转
      if (answerState.runningAt && Date.now() - answerState.runningAt > 300000) {
        answerState.running = false;
        answerState.runningAt = 0;
      } else {
        return true;
      }
    }
    return frameAnswerBusy && (Date.now() - frameAnswerBusyAt < 120000);
  }
  // 本页（主文档 + 同源子 iframe，或跨源 iframe 的回报）里有没有题目
  function pageHasQuiz() {
    const docs = collectDocs();
    for (let i = 0; i < docs.length; i++) {
      try { if (docs[i].querySelector('.TiMu') || docs[i].querySelector('.questionLi')) return true; } catch (e) { /* 忽略 */ }
    }
    return frameAnswerFound > 0;
  }
  // 本页题目是否已被自动答题处理过（本窗口的引擎跑完，或收到过 iframe 的「作答完成」）
  function quizHandledForPage() {
    if (frameAnswerSettledAt) return true;
    return String(answerState.lastLogged || '').indexOf('作答完成') >= 0;
  }
  // 自动答题会不会真的跑（开关开着且大模型配置齐全）
  function answerWillRun() {
    return !!settings.answer.enabled && !!settings.baseUrl && !!settings.model &&
      (!!settings.apiKey || settings.provider === 'ollama');
  }
  // 自动跳转前的守卫：正在作答 / 本页有题目但还没作答完成 → 先别跳
  // 「本页有题目」这一条：仅当自动答题会跑时才强等；若不会跑（未开启/未配置），
  // 且开启了「有题目也照样跳」开关，则放行。
  function jumpBlocked() {
    if (answerBusyNow()) return 'answering';
    if (confirmWatcherPromise) return 'submitting'; // 本窗口正在等「确认提交」弹窗，别跳走
    if (pageHasQuiz() && !quizHandledForPage()) {
      if (!answerWillRun() && settings.auto.jumpOnUnanswered) return null;
      return 'quiz';
    }
    return null;
  }

  // 只看视频/音频任务点：章节测验、文档等其他任务点不参与判断
  function autoLoop() {
    const autoPlay = settings.auto.autoplay;
    if (!autoPlay && !settings.auto.nextChapter) {
      setAutoStatus('自动播放未开启');
      return;
    }

    // 换页了就重置跨 frame 的答题状态，避免上一节的残留影响判断
    if (location.href !== lastAnswerHref) {
      lastAnswerHref = location.href;
      frameAnswerBusy = false;
      frameAnswerBusyAt = 0;
      frameAnswerFound = 0;
      frameAnswerSettledAt = 0;
      everHadMedia = false;
    }

    // 顶层自身文档也可能直接挂着视频弹层（视频不在 iframe 的版式）：同样本地点掉、恢复播放
    if (handlePopQuiz()) { doneStreak = 0; resumeMidVideo(); }

    const medias = ownMedia();
    const frames = frameStat();
    const ownUnfinished = medias.filter(unfinished);
    // 本页曾出现过媒体（自己文档或 iframe 回报）：之后媒体归零多半是视频弹层接管了 frame，
    // 不能按「纯题目页」走答完跳转——这是弹题被误判跳下一节的主要路径
    if (medias.length || frames.total) everHadMedia = true;
    if (!medias.length && !frames.total) {
      // 视频弹题期间：弹层会接管视频 frame 使媒体回报归零，顶层极易在这里误判成「纯题目页」
      // 而按「答完进下一节」跳走——必须先拦下，等糊答器点完弹层、视频恢复再说
      if (everHadMedia || frames.popquiz || handlePopQuiz()) {
        doneStreak = 0;
        setAutoStatus('视频弹题处理中，暂不跳转…');
        resumeMidVideo();
        return;
      }
      // 本页没有任何视频/音频任务点：可能是纯文本页或章节测验页
      if (!settings.auto.nextChapter) {
        setAutoStatus('本页没找到视频/音频任务点（自动下一节未开启）');
        return;
      }
      if (!pageHasQuiz()) {
        setAutoStatus('本页没有视频任务点也没有题目，不自动跳转');
        doneStreak = 0;
        return;
      }
      // 有题目：必须「先自动答题 + 自动提交」，完成后再跳下一节（别把提交冲掉）
      const blocked = jumpBlocked();
      if (blocked) {
        setAutoStatus(blocked === 'submitting'
          ? '正在提交/确认中，等提交完成后再跳转下一节…'
          : answerWillRun()
            ? '本页为题目内容，等待自动答题并提交完成后再跳转下一节…'
            : '本页有题目且未开启自动答题，暂不自动跳转（可在「脚本配置·挂机任务点」里开「有题目也照样跳」）');
        doneStreak = 0;
        return;
      }
      doneStreak++;
      setAutoStatus('本页题目已作答完成，准备前往下一节…');
      if (doneStreak >= 2) goNext(false);
      return;
    }

    medias.forEach((m) => {
      if (isFinished(m) && !notifiedFinished.has(m)) {
        notifiedFinished.add(m);
        log('一个视频任务点已播放结束');
      } else if (taskDone(m) && !notifiedFinished.has(m)) {
        notifiedFinished.add(m);
        log('一个视频任务点已被学习通标记为完成，跳过播放');
      }
    });
    if (medias.some(doneMedia) || frames.done) everFinished = 1;

    // 发牌：全局只允许一个视频在播（顶层自己的视频优先，否则给第一个「还有未完成」的 iframe）
    const frameGranted = autoPlay ? issueMediaPermit() : null;
    // 手里有没播完的就先推进播放（不按可见性过滤挑，保证一定能播起来）；牌给了 iframe 时顶层自身不播
    if (autoPlay && ownUnfinished.length && !frameGranted) playFirstUnfinished(medias, clampRate(settings.auto.rate));
    else if (autoPlay && frameGranted) pauseOwnMedias(); // 牌在 iframe 手里：顶层自身的视频也停掉，保证全局单播

    const shown = ownUnfinished.filter(countable);
    const left = shown.length + frames.left;
    if (left > 0) {
      doneStreak = 0;
      if (!autoPlay) {
        setAutoStatus(`还有 ${left} 个视频任务点未播完（自动播放未开启）`);
        return;
      }
      const target = shown.length ? shown[0] : null;
      const dur = target ? mediaDur(target) : 0;
      const pct = target && dur ? Math.round((target.currentTime / dur) * 100) : -1;
      const prog = pct >= 0 ? '，当前进度 ' + pct + '%' : '（视频加载中）';
      setAutoStatus(`播放中：还剩 ${left} 个视频任务点${prog}，倍速 ${clampRate(settings.auto.rate)}x`);
      return;
    }

    // 计入的都播完了，但一只视频也没真正结束过 → 多半是没加载/没播起来，先别跳
    if (!everFinished) {
      doneStreak = 0;
      const extra = ownUnfinished.length ? `；另有 ${ownUnfinished.length} 个没显示出来的元素被忽略` : '';
      setAutoStatus(`还没检测到视频真正播放结束，暂不跳转${extra}`);
      return;
    }

    // 弹层还挂着（弹题在视频 frame 内、video 未被销毁的场景）：先点掉弹层再考虑跳转
    if (frames.popquiz) {
      doneStreak = 0;
      setAutoStatus('视频弹题处理中，暂不跳转…');
      return;
    }

    // 视频任务点全部播完：先判断是否被「作答/提交」拦住。
    // 先判断再打印，避免「已播完 ↔ 等作答」两条状态来回翻转刷屏。
    if (settings.auto.nextChapter) {
      const blocked = jumpBlocked();
      if (blocked) {
        doneStreak = 0;
        setAutoStatus(blocked === 'submitting'
          ? '正在提交/确认中，等提交完成后再跳转下一节…'
          : answerWillRun()
            ? '本页还有题目未答完/正在自动作答，等答完并提交后再跳转下一节…'
            : '本页有题目且未开启自动答题，暂不自动跳转（可在「脚本配置·挂机任务点」里开「有题目也照样跳」）');
        return;
      }
      doneStreak++;
      setAutoStatus('本页视频任务点已全部播完（自动下一节已开启）');
      if (doneStreak >= 2) goNext(false);
    } else {
      doneStreak++;
      setAutoStatus('本页视频任务点已全部播完（自动下一节未开启）');
    }
  }

  // 找「下一节 / 下一章」按钮：顺序参考 pp助手，主文档 + 同源 iframe 都找
  function findNextBtn() {
    const sels = ['#prevNextFocusNext', '.jb_btn.jb_btn_92.fr.fs14.nextChapter', '#nextBtn', '.nextChapter'];
    const docs = collectDocs();
    for (let i = 0; i < sels.length; i++) {
      for (let j = 0; j < docs.length; j++) {
        let el = null;
        try { el = docs[j].querySelector(sels[i]); } catch (e) { el = null; }
        if (el && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  function goNext(manual) {
    if (!manual && Date.now() - lastJumpAt < 8000) return; // 防抖，避免连续点
    if (!manual) {
      // 兜底守卫：本页还有题目没答完或正在自动作答时，绝不自动跳转（避免冲掉自动提交）
      const blocked = jumpBlocked();
      if (blocked) {
        doneStreak = 0;
        setAutoStatus('本页还有题目未答完，暂不跳转下一节…');
        return;
      }
    }
    const btn = findNextBtn();
    if (!btn) {
      setAutoStatus('本页任务点已播完，但没找到「下一节」按钮');
      log('没找到「下一节」按钮，可能本页就是最后一节', 'err');
      return;
    }
    lastJumpAt = Date.now();
    doneStreak = 0;
    everFinished = 0;
    log('本页任务点已播完，正在前往下一节…', 'ok');
    btn.click();
  }

  autoPlayChk.checked = !!settings.auto.autoplay;
  autoMutedChk.checked = settings.auto.muted !== false; // 默认静音（旧配置无此字段时按默认 true）
  autoNextChk.checked = !!settings.auto.nextChapter;
  autoRateSel.value = String(clampRate(settings.auto.rate));

  autoPlayChk.addEventListener('change', () => {
    settings.auto.autoplay = autoPlayChk.checked;
    saveSettings();
    log(settings.auto.autoplay ? '自动播放已开启' : '自动播放已关闭');
    doneStreak = 0;
    refreshModeSeg();
    if (settings.auto.autoplay) autoLoop();
  });
  autoMutedChk.addEventListener('change', () => {
    settings.auto.muted = autoMutedChk.checked;
    saveSettings();
    log(settings.auto.muted ? '自动播放静音已开启（新起播的视频不带声音）' : '自动播放静音已关闭（新起播的视频带声音）');
  });
  autoNextChk.addEventListener('change', () => {
    settings.auto.nextChapter = autoNextChk.checked;
    saveSettings();
    log(settings.auto.nextChapter ? '播完自动下一节已开启' : '播完自动下一节已关闭');
    doneStreak = 0;
    refreshModeSeg();
  });
  autoRateSel.addEventListener('change', () => {
    settings.auto.rate = clampRate(autoRateSel.value);
    saveSettings();
    log(`播放倍速设为 ${settings.auto.rate}x`);
  });
  autoJumpUnansweredChk.checked = !!settings.auto.jumpOnUnanswered;
  autoJumpUnansweredChk.addEventListener('change', () => {
    settings.auto.jumpOnUnanswered = autoJumpUnansweredChk.checked;
    saveSettings();
    log(settings.auto.jumpOnUnanswered
      ? '已开启「本页有题目未作答时也自动跳下一节」'
      : '已关闭「本页有题目未作答时也自动跳下一节」');
    doneStreak = 0;
  });
  win.querySelector('#auto-next-now').addEventListener('click', () => goNext(true));
  win.querySelector('#auto-scan').addEventListener('click', () => {
    const medias = ownMedia();
    const frames = frameStat();
    log(`本窗口自身 ${medias.length} 个媒体（未播完 ${medias.filter(unfinished).length}，计入 ${medias.filter(countable).length}）；iframe 回报 ${frameReports.size} 个：计入 ${frames.left}，媒体共 ${frames.total}，已播完 ${frames.done}`);
    medias.forEach((m, i) => log(`  本窗口 #${i + 1} ${describeMedia(m)}`));
    frameReports.forEach((r) => {
      log(`  iframe ${(r.href || '(无地址)').slice(0, 70)} → 计入 ${r.left}，共 ${r.total}，已播完 ${r.done}${r.info.length ? '｜' + r.info.join('；') : ''}`);
    });
    lastAutoStatus = '';
    doneStreak = 0;
    autoLoop();
  });

  setInterval(autoLoop, 1500);

  // ---------- 答题区逻辑 ----------
  const ansEnabledChk = win.querySelector('#ans-enabled');
  const ansSubmitChk = win.querySelector('#ans-submit');
  const ansReviewChk = win.querySelector('#ans-review');
  const ansSkipChk = win.querySelector('#ans-skip');
  const ansIntervalInput = win.querySelector('#ans-interval');
  const ansThresholdInput = win.querySelector('#ans-threshold');
  const ansRunBtn = win.querySelector('#ans-run');

  // 各 iframe 的答题状态回报（跨源也通）→ 并入首页日志，并记录「是否正在作答 / 有没有题目」供挂机判断
  const frameAnswerLast = new Map();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || !d.__cxAiAnswer) return;
    if (d.busy === true) { frameAnswerBusy = true; frameAnswerBusyAt = Date.now(); }
    else if (d.busy === false) { frameAnswerBusy = false; }
    if (d.found) frameAnswerFound = Math.max(frameAnswerFound, d.found);
    const text = d.text || '';
    if (text.indexOf('作答完成') >= 0) frameAnswerSettledAt = Date.now();
    if (!text || frameAnswerLast.get(e.source) === text) return;
    frameAnswerLast.set(e.source, text);
    log('[iframe] ' + text, levelOf(text));
  });

  ansEnabledChk.checked = !!settings.answer.enabled;
  ansSubmitChk.checked = !!settings.answer.autoSubmit;
  ansReviewChk.checked = !!settings.answer.review;
  ansSkipChk.checked = !!settings.answer.skipAnswered;
  ansIntervalInput.value = String(settings.answer.interval);
  ansThresholdInput.value = String(settings.answer.threshold);

  ansEnabledChk.addEventListener('change', () => {
    settings.answer.enabled = ansEnabledChk.checked;
    if (!settings.answer.enabled) { answerState.tried.clear(); clearTriedSigs(); clearSubmitted(); }
    saveSettings();
    log(settings.answer.enabled ? '自动答题已开启' : '自动答题已关闭');
    refreshModeSeg();
  });
  ansSubmitChk.addEventListener('change', () => {
    settings.answer.autoSubmit = ansSubmitChk.checked;
    saveSettings();
    log(settings.answer.autoSubmit ? '作答后自动提交已开启' : '作答后自动提交已关闭');
  });
  ansReviewChk.addEventListener('change', () => {
    settings.answer.review = ansReviewChk.checked;
    saveSettings();
    if (ansReviewChk.checked && !fallbackReady()) log('已开启「答案复核」，但未配置备用模型——请先在上方填备用模型名，否则复核不会生效', 'warn');
    else log(ansReviewChk.checked ? '答案复核已开启：主模型作答后由备用模型独立作答交叉验证' : '答案复核已关闭');
  });
  ansSkipChk.addEventListener('change', () => {
    settings.answer.skipAnswered = ansSkipChk.checked;
    saveSettings();
    log(settings.answer.skipAnswered ? '已开启「跳过已作答题目」' : '已关闭「跳过已作答题目」');
  });
  ansIntervalInput.addEventListener('change', () => {
    settings.answer.interval = Math.max(0.3, Number(ansIntervalInput.value) || 1);
    ansIntervalInput.value = String(settings.answer.interval);
    saveSettings();
    log(`答题间隔设为 ${settings.answer.interval}s`);
  });
  ansThresholdInput.addEventListener('change', () => {
    // 显式判空：只有「压根没填」才回落默认值，避免空串被当成 0（0 在这里是合法值 = 不设阈值）
    const raw = String(ansThresholdInput.value).trim();
    const v = raw === '' ? DEFAULTS.answer.threshold : Number(raw);
    settings.answer.threshold = isNaN(v) ? DEFAULTS.answer.threshold : Math.max(0, Math.min(100, v));
    ansThresholdInput.value = String(settings.answer.threshold);
    saveSettings();
    log(`提交阈值设为 ${settings.answer.threshold}%（完成率低于它只暂存不提交${settings.answer.threshold === 0 ? '；当前为 0，等于不设阈值' : ''}）`);
  });
  win.querySelector('#ans-diag').addEventListener('click', () => diagQuestions());
  ansRunBtn.addEventListener('click', () => {
    answerState.tried.clear();
    clearTriedSigs();     // 手动再来一次：清掉本页「已作答」持久记录
    clearSubmitted();     // 也清掉「已提交」标记，允许手动重新作答
    runAutoAnswer(true);
  });

  // ---------- 模式设置：「挂机 / 答题」一键批量切换 ----------
  // 模式只是把下面三个子开关按预设批量拨一遍，不新增任何设置项，老配置照常生效。
  const modeSegBtns = win.querySelectorAll('#mode-seg .cxai-seg-btn');
  const MODE_PRESETS = {
    normal: { autoplay: true, nextChapter: true, answer: true },   // 正常模式：挂机 + 答题全开
    video: { autoplay: true, nextChapter: true, answer: false },   // 仅视频：只挂机不答题
    answer: { autoplay: false, nextChapter: false, answer: true }  // 仅答题：只答题不挂机
  };
  const MODE_LABEL = { normal: '正常模式', video: '仅视频', answer: '仅答题' };
  // 由三个子开关反推当前属于哪个预设；没有匹配则返回空串（分段按钮都不高亮）
  function currentMode() {
    const a = !!settings.auto.autoplay;
    const n = !!settings.auto.nextChapter;
    const e = !!settings.answer.enabled;
    return Object.keys(MODE_PRESETS).find((k) => {
      const p = MODE_PRESETS[k];
      return p.autoplay === a && p.nextChapter === n && p.answer === e;
    }) || '';
  }
  function refreshModeSeg() {
    const cur = currentMode();
    modeSegBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === cur));
  }
  function applyMode(mode) {
    const p = MODE_PRESETS[mode];
    if (!p) return;
    settings.auto.autoplay = p.autoplay;
    settings.auto.nextChapter = p.nextChapter;
    settings.answer.enabled = p.answer;
    // 关闭自动答题时的清理，和手动取消勾选保持一致
    if (!p.answer) { answerState.tried.clear(); clearTriedSigs(); clearSubmitted(); }
    saveSettings();
    // 同步下方三个子开关的勾选态
    autoPlayChk.checked = p.autoplay;
    autoNextChk.checked = p.nextChapter;
    ansEnabledChk.checked = p.answer;
    doneStreak = 0;
    refreshModeSeg();
    if (p.autoplay) autoLoop();
    log(`已切换为「${MODE_LABEL[mode]}」：自动播放 ${p.autoplay ? '开' : '关'}、播完下一节 ${p.nextChapter ? '开' : '关'}、自动答题 ${p.answer ? '开' : '关'}`, 'ok');
  }
  modeSegBtns.forEach((b) => b.addEventListener('click', () => applyMode(b.dataset.mode)));

  startAnswerEngine();

  // ---------- 初始化 ----------
  fillSettings();
  applyUi();
  refreshModeSeg(); // 按已存配置高亮模式分段按钮
  log(`脚本已注入（v2.7.0）。服务商：${getProvider(settings.provider).name}，模型 ${settings.model || '未填'}${fallbackReady() ? `（备用 ${settings.fallback.provider ? getProvider(settings.fallback.provider).name + ' / ' : ''}${settings.fallback.model}）` : ''}；模式 ${MODE_LABEL[currentMode()] || '自定义'}，自动答题 ${settings.answer.enabled ? '已开启' : '未开启'}、自动提交 ${settings.answer.autoSubmit ? `已开启（提交阈值 ${settings.answer.threshold}%）` : '未开启'}${settings.answer.review && fallbackReady() ? '、答案复核已开启' : ''}、自动播放静音 ${settings.auto.muted !== false ? '已开启' : '未开启'}。`);
  if (!settings.baseUrl || !settings.model || (!settings.apiKey && settings.provider !== 'ollama')) {
    log('提示：还没配置大模型（API Key / 接口 / 模型），自动答题无法工作，请到「脚本配置」页签填写', 'warn');
  }
})();
//（注：内容由AI生成）
