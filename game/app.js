(function () {
  'use strict';
  const story = window.STORY, engine = window.VNState, $ = id => document.getElementById(id);
  if (!story || !engine) { $('home').textContent = '故事文件未能加载。请保留整个文件夹，重新打开 index.html。'; return; }
  const nodes = new Map(story.nodes.map(n => [n.id, n]));
  const art = window.DREAMLAKE_ART?.storyId === story.id ? window.DREAMLAKE_ART : null;
  const bgmConfig = window.DREAMLAKE_BGM?.storyId === story.id ? window.DREAMLAKE_BGM : null;
  const sceneAdjustments = window.DREAMLAKE_SCENE_ADJUSTMENTS?.storyId === story.id ? window.DREAMLAKE_SCENE_ADJUSTMENTS : null;
  story.frameMeta = {...structuredClone(sceneAdjustments?.metaBeats || {}), ...(story.frameMeta || {})};
  const solidCgs = {'solid:black': {format: 'cg', name: '纯黑画面', color: '#000'}, 'solid:white': {format: 'cg', name: '纯白画面', color: '#fff'}};
  const flashScenes = new Map((story.presentation?.flashScenes || []).map(scene => [`${scene.node}#${scene.triggerBeat}`, scene]));
  const flashScenesBySkippedBeat = new Map((story.presentation?.flashScenes || []).map(scene => [`${scene.node}#${scene.skipBeat}`, scene]));
  const frameKey = (node, index) => node.type === 'passage'
    ? (node.beats?.[index]?._reviewKey || `${node.id}#${node.beats?.[index]?._sourceIndex ?? index}`)
    : `${node.id}#0`;
  const sourceIndex = (node, index) => node.beats?.[index]?._sourceIndex ?? index;
  const followingSourceIndex = (node, index) => node.beats.findIndex((beat, position) => (beat._sourceIndex ?? position) > index);
  const previousPassageForChoice = new Map();
  story.nodes.forEach((node, index) => {
    if (node.type !== 'choice') return;
    for (let before = index - 1; before >= 0; before--) {
      const prior = story.nodes[before];
      if (prior.chapter !== node.chapter) break;
      if (prior.type === 'passage') { previousPassageForChoice.set(node.id, prior); break; }
    }
  });
  const route = story.nodes.filter(n => n.type === 'passage' || n.type === 'choice' || n.type === 'complete');
  const positions = new Map(route.map((n, i) => [n.id, i]));
  const removedEndingIds = () => new Set(story.nodes.filter(n => n.type === 'choice' && n._reviewRemoved)
    .flatMap(n => n.options.map(option => nodes.get(option.next)?.type === 'passage' ? nodes.get(option.next).next : option.next))
    .filter(id => nodes.get(id)?.type === 'ending'));
  const key = 'vn:' + story.id + ':', memory = new Map();
  let storageFailed = false, state = engine.create(story), active = false, autoTimer = null, autoMode = false, toastTimer, panelKind = '', typeTimer = null, fullLine = '', typing = false;
  function read(name, fallback) { try { const value = localStorage.getItem(key + name); return value ? JSON.parse(value) : fallback; } catch (_) { return memory.get(name) ?? fallback; } }
  function write(name, value) { memory.set(name, value); try { localStorage.setItem(key + name, JSON.stringify(value)); } catch (_) { if (!storageFailed) toast('浏览器未允许本地保存，请用“导出存档”保存进度。'); storageFailed = true; } }
  function safeSave(name) {
    const raw = read(name, null); if (!raw) return null;
    try {
      let valid = engine.validate(raw, story);
      const redirect = sceneAdjustments?.frameRedirects?.[raw.reviewFrameKey];
      if (redirect && nodes.has(redirect.node)) {
        valid = engine.move(valid, redirect.node, story, valid.node !== redirect.node);
        if (window.DREAMLAKE_TEST) valid.reviewFrameKey = redirect.key;
      } else if (window.DREAMLAKE_TEST && typeof raw.reviewFrameKey === 'string') valid.reviewFrameKey = raw.reviewFrameKey;
      return valid;
    } catch (_) { return null; }
  }
  let saved = safeSave('auto');
  const defaultSettings = {size: 23, delay: 3, sans: false, motion: true, sound: false, music: true, musicVolume: 40};
  const storedSettings = read('settings', {});
  const savedSettings = storedSettings && typeof storedSettings === 'object' ? storedSettings : {};
  if (savedSettings.size === 20) savedSettings.size = 23;
  let settings = {...defaultSettings, ...savedSettings};
  settings.size = Math.max(18, Math.min(30, Number(settings.size) || 23));
  settings.delay = Math.max(2, Math.min(12, Number(settings.delay) || 3));
  settings.music = settings.music !== false;
  settings.musicVolume = Number.isFinite(Number(settings.musicVolume)) ? Math.max(0, Math.min(100, Number(settings.musicVolume))) : 40;
  const music = bgmConfig && window.VNBGM ? VNBGM.create(bgmConfig, {onError: title => toast('背景音乐无法加载：' + title)}) : null;
  if (music) window.DreamlakeAudio = music;
  const musicCue = () => window.VNBGM?.resolve(bgmConfig, nodes.get(state.node));
  document.addEventListener('pointerdown', () => music?.unlock(), {capture: true, passive: true});
  document.addEventListener('keydown', () => music?.unlock(), {capture: true});
  let archive = read('archive', {endings: [], visited: [], completed: false});
  if (!archive || typeof archive !== 'object') archive = {};
  archive = {endings: Array.isArray(archive.endings) ? archive.endings.filter(id => nodes.get(id)?.type === 'ending') : [], visited: Array.isArray(archive.visited) ? archive.visited.filter(id => nodes.has(id)) : [], completed: archive.completed === true};
  function el(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
  function btn(text, action, cls) { const n = el('button', text, cls); n.type = 'button'; n.addEventListener('click', action); return n; }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3800); }
  function persist() {
    if (window.DREAMLAKE_TEST) state.reviewFrameKey = frameKey(nodes.get(state.node), state.beat || 0);
    archive.endings = [...new Set([...archive.endings, ...state.endings])];
    archive.visited = [...new Set([...archive.visited, ...state.visited])];
    archive.completed = archive.completed || state.completed;
    write('archive', archive); write('auto', state); saved = state; $('continue').hidden = false;
  }
  function portraitPath(character, variant) { const c = story.characters[character]; if (!c) return ''; const file=c.variants[variant] || Object.values(c.variants)[0]; return 'game/assets/sprites/' + file.replace(/\.[^.]+$/,'.webp'); }
  function formatYear(raw) {
    const value = String(raw).trim();
    return /^公元\s*\d+[？?]?$/.test(value) ? value.replace(/(\d+)([？?]?)$/, '$1年$2') : value;
  }
  function chapterYear(chapter) {
    return formatYear(story.presentation?.chapterOpenings?.[String(chapter.number)]?.year ?? '公元？');
  }
  function frameMetadata(node, key) {
    const chapter = story.chapters.find(item => item.number === node.chapter);
    const meta = story.frameMeta?.[key] || {};
    return {place: meta.place ?? chapter.place, year: formatYear(meta.year ?? chapterYear(chapter))};
  }
  const cgFrame = el('div', undefined, 'story-cg');
  cgFrame.hidden = true;
  $('scene').append(cgFrame);
  const frameFade = el('div', undefined, 'frame-fade');
  frameFade.hidden = true;
  $('reader').append(frameFade);
  const arrowLayer = el('div', undefined, 'frame-arrow-effect');
  arrowLayer.setAttribute('aria-hidden', 'true'); arrowLayer.hidden = true;
  const arrowLight = el('span', undefined, 'frame-arrow-light');
  arrowLayer.append(arrowLight); $('reader').append(arrowLayer);
  const flashFrame = el('div', undefined, 'story-flash');
  flashFrame.hidden = true;
  $('reader').append(flashFrame);
  let artViews = [], lastRenderedBeat = null;
  let displayedCg = null, visualFadeTimer = null, pendingFadeNavigation = null, visualFadeGeneration = 0;
  let flashPlaying = false, flashGeneration = 0;
  let blankFrameKey = null, blankSeconds = null, blankTextSeconds = null, blankPhase = null, blankTimer = null, blankGeneration = 0;
  let timedFrameKey = null, timedMode = null, timedSeconds = null, timedTimer = null, timedWaiting = false, timedReady = false, timedReadyToAdvance = false, timedGeneration = 0;
  const openedChapters = new Set();
  let openingVisible = false, openingClosing = false, openingTimer = null;
  let pendingFrameReveal = null;
  let frameEffect = null, frameEffectPlaying = false;
  function clearFrameEffect() {
    frameEffect?.cancel(); frameEffect = null; frameEffectPlaying = false;
  }
  function frameEffectConfig(node, index) {
    const effect = sceneAdjustments?.frameEffects?.[frameKey(node, index)];
    const editing = window.DREAMLAKE_TEST && window.DREAMLAKE_REVIEW_MODE !== 'play';
    return !editing && effect?.type === 'arrow-sweep' && window.VNFrameEffects ? effect : null;
  }
  function playFrameEffect(config, ready, generation, text) {
    frameEffectPlaying = true;
    frameEffect = window.VNFrameEffects.arrowSweep({
      reader: $('reader'), cover: frameFade, layer: arrowLayer, light: arrowLight, ready,
      config, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      isCurrent: () => generation === visualFadeGeneration && active,
      onText: () => { frameEffectPlaying = false; playLine(text); }
    });
    return frameEffect.finished.catch(() => {
      if (generation !== visualFadeGeneration || !active) return;
      clearFrameEffect(); frameFade.hidden = true; playLine(text);
    });
  }
  function clearBlankFrame() {
    clearTimeout(blankTimer); blankTimer = null;
    blankFrameKey = null; blankSeconds = null; blankTextSeconds = null; blankPhase = null; blankGeneration++;
    $('reader').classList.remove('blank-frame', 'blank-waiting', 'blank-fading-in', 'blank-holding', 'blank-fading-out', 'blank-editing');
  }
  function blankFadeMs() {
    return settings.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 0;
  }
  function queueBlankStep(callback, milliseconds) {
    const generation = blankGeneration;
    blankTimer = setTimeout(() => {
      blankTimer = null;
      if (generation === blankGeneration) callback();
    }, milliseconds);
  }
  function advanceBlankFrame() {
    if (blankPhase !== 'ready' || $('panel').open || openingVisible) return;
    next(true);
  }
  function beginBlankFadeOut() {
    blankPhase = 'fade-out';
    $('reader').classList.remove('blank-fading-in', 'blank-holding');
    $('reader').classList.add('blank-fading-out');
    queueBlankStep(() => { blankPhase = 'ready'; advanceBlankFrame(); }, blankFadeMs());
  }
  function revealBlankText() {
    const node = nodes.get(state.node);
    if (!active || node?.type !== 'passage' || frameKey(node, state.beat || 0) !== blankFrameKey) return;
    blankPhase = 'fade-in';
    $('reader').classList.remove('blank-waiting');
    clearInterval(typeTimer); typeTimer = null; typing = false;
    fullLine = node.beats[state.beat || 0]?.text || '';
    $('passage').textContent = fullLine;
    $('passage').setAttribute('aria-label', fullLine);
    void $('passage').offsetWidth;
    $('reader').classList.add('blank-fading-in');
    queueBlankStep(() => {
      blankPhase = 'hold';
      $('reader').classList.remove('blank-fading-in');
      $('reader').classList.add('blank-holding');
      queueBlankStep(beginBlankFadeOut, blankTextSeconds * 1000);
    }, blankFadeMs());
  }
  function startBlankCountdown() {
    if (blankPhase !== 'black' || blankTimer || openingVisible) return;
    queueBlankStep(revealBlankText, blankSeconds * 1000);
  }
  function timingOverride(key) {
    return window.DREAMLAKE_TEST ? window.DreamlakeReview?.timingOverride?.(key) : null;
  }
  function flashIsInteractive(scene) {
    const key = `${scene.node}#${scene.skipBeat}`;
    const override = timingOverride(key);
    if (override && override.mode !== 'default') return true;
    return ['manual', 'hold', 'auto'].includes(sceneAdjustments?.timingBeats?.[key]?.mode);
  }
  function frameTiming(node, beatIndex) {
    const key = frameKey(node, beatIndex);
    const base = sceneAdjustments?.timingBeats?.[key] || node.beats?.[beatIndex]?._reviewOrderTiming || node.beats?.[beatIndex]?.timing || {mode: 'manual'};
    const override = timingOverride(key);
    return override && override.mode !== 'default' ? {...base, ...override} : base;
  }
  function fadeMilliseconds(seconds) {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.max(0, Number(seconds) || 0) * 1000;
  }
  function resetFrameFade(fadeIn) {
    const generation = ++visualFadeGeneration;
    pendingFrameReveal?.cancel(); pendingFrameReveal = null;
    frameFade.style.transition = 'none';
    frameFade.style.opacity = fadeIn ? '1' : '0';
    frameFade.hidden = !fadeIn;
    return generation;
  }
  function revealFrameAfterArt(fadeIn, artReady, generation) {
    return Promise.resolve(artReady).then(() => new Promise(resolve => {
      const reveal = () => {
        if (generation !== visualFadeGeneration) { resolve(); return; }
        // Keep the prepared scene covered throughout the title's own exit.
        // Replaying its fade after exposing it underneath the title causes a flash.
        if (openingVisible) { pendingFrameReveal = {start: reveal, cancel: resolve}; return; }
        if (!fadeIn) { frameFade.hidden = true; resolve(); return; }
        void frameFade.offsetWidth;
        frameFade.style.transition = `opacity ${fadeIn}ms ease-in-out`;
        requestAnimationFrame(() => {
          if (generation !== visualFadeGeneration) { resolve(); return; }
          frameFade.style.opacity = '0';
          setTimeout(resolve, fadeIn);
        });
      };
      reveal();
    }));
  }
  function resumeFrameReveal() {
    const pending = pendingFrameReveal;
    pendingFrameReveal = null;
    pending?.start();
  }
  function clearTimedFrame() {
    clearTimeout(timedTimer); timedTimer = null;
    timedFrameKey = null; timedMode = null; timedSeconds = null;
    timedWaiting = false; timedReady = false; timedReadyToAdvance = false; timedGeneration++;
    $('reader').classList.remove('timed-waiting', 'timed-auto');
  }
  function advanceTimedFrame() {
    if (!timedReadyToAdvance || $('panel').open) return;
    timedReadyToAdvance = false;
    if (typing) finishLine();
    next();
  }
  function startTimedCountdown() {
    if (!timedWaiting || !timedReady || timedTimer || openingVisible) return;
    const generation = timedGeneration;
    timedTimer = setTimeout(() => {
      timedTimer = null;
      if (generation !== timedGeneration || !active) return;
      timedWaiting = false;
      $('reader').classList.remove('timed-waiting');
      if (timedMode === 'auto') {
        timedReadyToAdvance = true;
        advanceTimedFrame();
      } else schedule();
    }, timedSeconds * 1000);
  }
  function prepareTimedFrame(node, beatIndex, frameVisible) {
    const timing = frameTiming(node, beatIndex);
    if (!['hold', 'auto'].includes(timing.mode) || !Number.isFinite(timing.seconds) || timing.seconds < 0) {
      clearTimedFrame(); return;
    }
    const key = frameKey(node, beatIndex);
    if (timedFrameKey !== key || timedMode !== timing.mode || timedSeconds !== timing.seconds) {
      clearTimedFrame();
      timedFrameKey = key; timedMode = timing.mode; timedSeconds = timing.seconds; timedWaiting = true;
    }
    $('reader').classList.toggle('timed-waiting', timedWaiting);
    $('reader').classList.toggle('timed-auto', timing.mode === 'auto');
    const generation = timedGeneration;
    Promise.resolve(frameVisible).then(() => {
      if (generation !== timedGeneration) return;
      timedReady = true; startTimedCountdown();
    });
  }
  let artGeneration = 0;
  async function decodedPortrait(path, fallback) {
    const image = new Image();
    image.src = path;
    try { await image.decode(); return image; }
    catch (_) { return path === fallback ? null : decodedPortrait(fallback, fallback); }
  }
  async function renderStage(stage, speaker, portraits = {}, generation = ++artGeneration) {
    const slots = [...document.querySelectorAll('.portrait-slot')];
    const positions = stage.length === 1 ? ['center'] : stage.length === 2 ? ['left', 'right'] : ['left', 'center', 'right'];
    const prepared = await Promise.all(stage.slice(0, 3).map(async (member, index) => {
      const character = story.characters[member.character];
      if (!character) return null;
      const slot = slots.find(item => item.dataset.position === (member.position || positions[index]));
      if (!slot) return null;
      const image = slot.querySelector('img');
      const transform = (member.flipped ?? slot.dataset.position === 'right') ? 'scaleX(-1)' : '';
      const variant = member.asset?.startsWith('base:') ? member.asset.slice(5) : member.variant;
      const selected = member.asset?.startsWith('art:') ? member.asset.slice(4) : portraits[member.character];
      const custom = art?.images[selected] || sceneAdjustments?.images?.[selected];
      const archived = window.DREAMLAKE_TEST && member.asset?.startsWith('archive:')
        ? window.DREAMLAKE_PORTRAIT_ARCHIVE?.images?.[member.asset.slice(8)] : null;
      const fallback = portraitPath(member.character, variant);
      const path = archived?.character === member.character ? archived.path
        : ['portrait', 'pose'].includes(custom?.format) && custom.character === member.character ? custom.path : fallback;
      const loaded = image.getAttribute('src') === path && image.complete && image.naturalWidth > 0
        ? image : await decodedPortrait(path, fallback);
      return loaded ? {slot, image: loaded, transform, character, member, index} : null;
    }));
    if (generation !== artGeneration) return;
    // Keep the previous complete stage on screen while assets load, then commit
    // every position together in one paint. This also rejects stale rapid edits.
    slots.forEach(slot => {
      const entry = prepared.find(item => item?.slot === slot);
      slot.classList.remove('speaking', 'listening');
      if (!entry) { slot.hidden = true; return; }
      if (slot.querySelector('img') !== entry.image) slot.querySelector('img').replaceWith(entry.image);
      entry.image.style.transform = entry.transform;
      entry.image.alt = entry.character.name;
      slot.style.zIndex = speaker === entry.member.character ? '3' : String(entry.index + 1);
      const translucent = entry.member.solid === false
        || (entry.member.solid !== true && speaker && speaker !== entry.member.character);
      slot.classList.add(translucent ? 'listening' : 'speaking');
      slot.hidden = false;
    });
    $('portrait-frame').hidden = prepared.every(item => !item);
    cgFrame.hidden = true;
    cgFrame.replaceChildren();
    cgFrame.classList.remove('floating');
    cgFrame.style.opacity = '';
    displayedCg = null;
    $('reader').classList.remove('showing-cg', 'floating-cg', 'solid-cg', 'cg-no-text', 'white-cg');
  }
  function drawArtView() {
    const generation = ++artGeneration;
    const baseView = artViews[0];
    if (!baseView) return Promise.resolve();
    const reviewOverride = window.DREAMLAKE_TEST ? window.DreamlakeReview?.visualOverride?.() : null;
    const cgId = reviewOverride?.type === 'cg' ? reviewOverride.id
      : reviewOverride?.type === 'portrait' ? null : (lastRenderedBeat ? sceneAdjustments?.cgs?.[lastRenderedBeat] : null);
    const cgAsset = art?.images?.[cgId] || sceneAdjustments?.images?.[cgId] || solidCgs[cgId];
    const view = cgId && cgAsset?.format === 'cg' ? {...baseView, type: 'cg', id: cgId} : baseView;
    const adjusted = reviewOverride?.type === 'portrait' ? reviewOverride.slots
      : cgId ? null : (lastRenderedBeat ? sceneAdjustments?.beats?.[lastRenderedBeat] : null);
    if (adjusted) {
      return renderStage(Object.entries(adjusted).map(([position, member]) => ({...member, position})), view.speaker, {}, generation);
    }
    const showingCg = view.type === 'cg';
    if (showingCg) {
      const item = art?.images?.[view.id] || sceneAdjustments?.images?.[view.id] || solidCgs[view.id];
      if (!item) return renderStage(view.stage, view.speaker, view.portraits, generation);
      const solid = Boolean(solidCgs[view.id]);
      const image = solid ? el('div', undefined, 'solid-cg-canvas') : el('img');
      if (solid) image.style.background = item.color;
      else { image.draggable = false; image.alt = item.name; image.src = item.path; }
      const layout = reviewOverride?.type === 'cg' && reviewOverride.layout ? reviewOverride.layout
        : (lastRenderedBeat && sceneAdjustments?.cgLayouts?.[lastRenderedBeat]) || view.layout || item.layout;
      if (!solid) image.className = layout === 'portrait' || (layout === 'landscape' && item.layout === 'portrait') ? 'portrait-cg' : '';
      displayedCg = view.id;
      const timing = frameTiming(nodes.get(state.node), state.beat || 0);
      $('reader').classList.toggle('cg-no-text', timing.showText === false);
      return (solid ? Promise.resolve() : image.decode()).then(() => {
        if (generation !== artGeneration) return;
        cgFrame.replaceChildren(image);
        cgFrame.classList.toggle('floating', layout === 'floating');
        cgFrame.hidden = false;
        $('portrait-frame').hidden = true;
        $('reader').classList.toggle('showing-cg', layout !== 'floating');
        $('reader').classList.toggle('floating-cg', layout === 'floating');
        $('reader').classList.toggle('solid-cg', solid);
        $('reader').classList.toggle('white-cg', view.id === 'solid:white');
        $('reader').classList.toggle('cg-no-text', timing.showText === false);
        cgFrame.style.transition = 'none';
        cgFrame.style.opacity = '1';
      }).catch(() => renderStage(view.stage, view.speaker, view.portraits, generation));
    } else {
      return renderStage(view.stage, view.speaker, view.portraits, generation);
    }
  }
  function buildArtViews(node, stage, speaker, beatIndex) {
    const insertedVisual = node.beats?.[beatIndex]?._reviewVisual;
    if (insertedVisual?.cg) return [{type: 'cg', id: insertedVisual.cg, layout: insertedVisual.cgLayout, stage: [], speaker}];
    if (insertedVisual?.slots) return [{type: 'portrait', stage: Object.entries(insertedVisual.slots).map(([position, member]) => ({...member, position})), speaker, portraits: {}}];
    const orderedVisual = node.beats?.[beatIndex]?._reviewOrderVisual;
    if (orderedVisual?.cg) return [{type:'cg',id:orderedVisual.cg,layout:orderedVisual.cgLayout,stage:[],speaker}];
    if (orderedVisual?.slots) return [{type:'portrait',stage:Object.entries(orderedVisual.slots).map(([position,member])=>({...member,position})),portraits:{},speaker}];
    const flash = flashScenesBySkippedBeat.get(`${node.id}#${sourceIndex(node, beatIndex)}`);
    if (flash && flashIsInteractive(flash)) return [{type: 'cg', id: flash.image, layout: 'landscape', stage: [], speaker}];
    const cue = node.type === 'passage' ? art?.beats?.[node.id]?.[String(sourceIndex(node, beatIndex))] : null;
    const momentKey = frameKey(node, beatIndex);
    const cgSuppressed = sceneAdjustments?.suppressedCg?.includes(momentKey);
    const cgOnly = sceneAdjustments?.cgOnly?.includes(momentKey);
    const base = stage.slice(0, 3);
    const views = [];
    if (cue) {
      if (!cgSuppressed) for (const id of cue.cg) views.push({type: 'cg', id, stage: base, speaker});
      const visible = new Map(base.map(member => [member.character, member]));
      for (const character of cue.enter) {
        if (!visible.has(character) && story.characters[character]) {
          visible.set(character, {character, variant: Object.keys(story.characters[character].variants)[0]});
        }
      }
      const drawn = Object.keys(cue.portraits).filter(character => visible.has(character));
      if (drawn.length && !cgOnly) {
        const focus = [...new Set([...(speaker && visible.has(speaker) ? [speaker] : []), ...drawn])];
        const groups = focus.length <= 3 ? [focus] : [focus.slice(0, 3), ...focus.slice(3).map(character => [focus[0], focus[1], character])];
        const phases = Math.max(1, ...drawn.map(character => cue.portraits[character].length), groups.length);
        for (let phase = 0; phase < phases; phase++) {
          const group = groups[phase % groups.length];
          const positioned = base.slice();
          for (const character of group) {
            if (positioned.some(member => member.character === character)) continue;
            const entrant = visible.get(character);
            if (positioned.length < 3) positioned.push(entrant);
            else {
              const replace = positioned.findLastIndex(member => !group.includes(member.character) && member.character !== speaker);
              if (replace >= 0) positioned[replace] = entrant;
            }
          }
          const portraits = {};
          for (const member of positioned) {
            const variants = cue.portraits[member.character];
            if (variants?.length) portraits[member.character] = variants[phase % variants.length];
          }
          views.push({type: 'portrait', stage: positioned, speaker, portraits});
        }
      }
    }
    if (!views.length) views.push({type: 'portrait', stage: base, speaker, portraits: {}});
    return views;
  }
  function renderArt(node, beat, stage, speaker, beatIndex = state.beat || 0) {
    artViews = buildArtViews(node, stage, speaker, beatIndex);
    lastRenderedBeat = ['passage', 'complete'].includes(node.type) ? frameKey(node, beatIndex) : null;
    return drawArtView();
  }
  function backgroundFor(node, beatIndex) {
    const chapter = story.chapters.find(item => item.number === node.chapter);
    const beat = node.type === 'passage' ? node.beats?.[beatIndex] : null;
    const adjustment = sceneAdjustments?.backgrounds?.[node.id];
    return beat?._reviewVisual?.background || sceneAdjustments?.backgroundBeats?.[frameKey(node, beatIndex)]
      || beat?._reviewOrderVisual?.background
      || (typeof adjustment === 'string' ? adjustment
        : adjustment && sourceIndex(node, beatIndex) >= adjustment.fromBeat ? adjustment.name : null)
      || node.background || chapter.background || chapter.theme;
  }
  function drawBackground(name) {
    const solid = name === 'solid:black' ? 'black' : name === 'solid:white' ? 'white' : null;
    const scene = $('scene'), reader = $('reader');
    if (solid) {
      scene.dataset.solidBackground = solid;
      reader.dataset.solidBackground = solid;
      scene.style.backgroundImage = 'none';
      scene.style.backgroundColor = solid === 'black' ? '#000' : '#fff';
    } else if (name && /^[a-z0-9-]+$/.test(name)) {
      delete scene.dataset.solidBackground;
      delete reader.dataset.solidBackground;
      scene.style.backgroundColor = '';
      scene.style.backgroundImage = `url("game/assets/backgrounds/${name}.webp")`;
    }
  }
  const backgroundLoads = new Map();
  function loadBackground(name) {
    if (!name || !/^[a-z0-9-]+$/.test(name)) return Promise.resolve();
    if (!backgroundLoads.has(name)) {
      const image = new Image();
      image.src = `game/assets/backgrounds/${name}.webp`;
      backgroundLoads.set(name, image.decode().catch(() => {}));
    }
    return backgroundLoads.get(name);
  }
  function previousFrameContext() {
    if (!active) return null;
    const current = nodes.get(state.node);
    let previous = null, beatIndex = 0;
    if (current.type === 'passage' && state.beat > 0) {
      previous = current;
      beatIndex = state.beat - 1;
    } else {
      for (let index = state.history.length - 1; index >= 0; index--) {
        const candidate = nodes.get(state.history[index]);
        if (candidate?.type === 'passage' && candidate.beats?.length) {
          previous = candidate; beatIndex = candidate.beats.length - 1; break;
        }
        if (candidate?.type === 'choice') {
          previous = candidate; break;
        }
      }
    }
    if (!previous) return null;
    let source = previous, sourceBeatIndex = beatIndex;
    if (previous.type === 'choice' && previousPassageForChoice.has(previous.id)) {
      source = previousPassageForChoice.get(previous.id);
      if (!source.beats?.length) source = story.nodes.slice(0, story.nodes.indexOf(previous)).reverse().find(item => item.type === 'passage' && item.chapter === previous.chapter && item.beats?.length) || previous;
      sourceBeatIndex = source.beats.length - 1;
    }
    const skipped = [...flashScenes.values()].find(scene => scene.node === source.id && scene.skipBeat === sourceIndex(source, sourceBeatIndex));
    if (skipped && !flashIsInteractive(skipped)) sourceBeatIndex = source.beats.findIndex((beat, position) => (beat._sourceIndex ?? position) === skipped.triggerBeat);
    const key = previous.type === 'passage' ? frameKey(previous, sourceBeatIndex) : `${previous.id}#0`;
    const beat = source.type === 'passage' ? source.beats?.[sourceBeatIndex] : null;
    const stage = beat?.stage || source.stage || [];
    const speaker = beat?.kind === 'dialogue' ? beat.speaker : null;
    const views = buildArtViews(source, stage, speaker, sourceBeatIndex);
    const view = views.find(item => item.type === 'portrait') || views[0];
    const choiceKey = `${previous.id}#0`;
    const renderedKey = previous.type === 'choice' && !(sceneAdjustments?.beats?.[choiceKey] || sceneAdjustments?.cgs?.[choiceKey])
      ? frameKey(source, sourceBeatIndex) : key;
    const adjusted = sceneAdjustments?.beats?.[renderedKey];
    const formalCg = sceneAdjustments?.cgs?.[renderedKey];
    const base = views[0];
    const cg = formalCg || (!adjusted && base?.type === 'cg' ? base.id : null);
    const image = art?.images?.[cg] || sceneAdjustments?.images?.[cg];
    const previousBeatIndex = previous.type === 'passage' ? sourceBeatIndex : beatIndex;
    return {key, node: previous.id, beat: previousBeatIndex, background: backgroundFor(previous, previousBeatIndex),
      cg, cgLayout: cg ? ((sceneAdjustments?.cgLayouts?.[renderedKey] || (base?.id === cg ? base.layout || image?.layout : image?.layout)) === 'floating' ? 'floating' : 'landscape') : null,
      view: {type: view.type, stage: view.stage.map(member => ({...member})), portraits: {...view.portraits}}};
  }
  function configurePresentation() {
    const p=story.presentation || {}, cover=story.characters[p.coverCharacter] || Object.values(story.characters)[0];
    document.querySelector('.masthead span:first-child').textContent=story.title;
    document.querySelector('.masthead span:last-child').textContent=p.tagline || story.subtitle;
    document.querySelector('.eyebrow').textContent=p.eyebrow || '文 字 冒 险';
    const heading=document.querySelector('.home-copy h1');heading.replaceChildren();
    (p.coverLines || [story.subtitle]).filter(Boolean).forEach((line,i)=>{if(i)heading.append(el('br'));heading.append(i?el('span',line):document.createTextNode(line));});
    document.querySelector('.lead').textContent=p.lead || '';
    const im=document.querySelector('.home-portrait img');im.src=portraitPath(p.coverCharacter || Object.keys(story.characters)[0],Object.keys(cover.variants)[0]);im.alt=cover.name;
    document.querySelector('.home-portrait figcaption').replaceChildren(el('span',cover.name),document.createTextNode(cover.alias || ''));
    $('to-home').querySelector('span').textContent=story.title;
    $('to-home').setAttribute('aria-label','返回封面：'+story.title);
  }
  function dismissChapterOpening() {
    if (!openingVisible || openingClosing) return;
    openingClosing = true;
    music?.select(musicCue(), {title: false});
    $('chapter-opening').classList.remove('visible');
    $('chapter-opening').classList.add('closing');
    clearTimeout(openingTimer);
    openingTimer = setTimeout(() => {
      openingVisible = false; openingClosing = false; $('chapter-opening').hidden = true;
      document.body.classList.remove('chapter-title-active');
      const node = nodes.get(state.node), beat = node?.beats?.[state.beat || 0];
      const timed = node?.type === 'passage' && ['hold', 'auto'].includes(frameTiming(node, state.beat || 0).mode);
      if ((beat?.blankSeconds !== undefined && !blankFrameKey) || (timed && !timedFrameKey)) render();
      else { resumeFrameReveal(); startBlankCountdown(); startTimedCountdown(); schedule(); }
    }, 450);
  }
  function hideChapterOpening() {
    clearTimeout(openingTimer);
    openingVisible = false; openingClosing = false;
    $('chapter-opening').hidden = true;
    $('chapter-opening').classList.remove('visible', 'closing');
    document.body.classList.remove('chapter-title-active');
  }
  function populateChapterOpening(chapter) {
    const details = story.presentation?.chapterOpenings?.[String(chapter.number)] || {};
    $('chapter-opening').dataset.chapter = String(chapter.number);
    $('opening-number').textContent = `第${chapter.label}章 · ${String(chapter.number).padStart(2, '0')}`;
    $('opening-title').textContent = chapter.title;
    $('opening-year').textContent = details.year || '公元？';
    $('opening-era-china').textContent = details.eraChina || '中国 · 年号不详';
    $('opening-era-japan').textContent = details.eraJapan || '';
    $('opening-era-japan').hidden = !details.eraJapan;
    $('opening-place').textContent = details.location || '？';
    $('opening-history').replaceChildren(...(details.background || []).filter(Boolean).map(line => el('span', line)));
    const cards = (details.cast || []).map(id => {
      const character = story.characters[id];
      if (!character) return null;
      const card = el('article', undefined, 'opening-person');
      card.dataset.character = id;
      const avatar = el('div', undefined, 'opening-avatar');
      const portrait = el('img');
      portrait.src = portraitPath(id, details.variants?.[id] || Object.keys(character.variants)[0]);
      portrait.alt = character.galleryName || character.name;
      const name = details.castNames?.[id] ?? character.galleryName ?? character.name;
      avatar.append(portrait);
      card.append(avatar, el('h3', name), el('p', story.presentation?.castIntroductions?.[id] ?? details.introductions?.[id] ?? character.profile ?? character.alias ?? ''));
      return card;
    }).filter(Boolean);
    $('opening-cast').replaceChildren(...cards);
    $('opening-cast').dataset.count = String(cards.length);
  }
  function showChapterOpening(chapter) {
    clearBlankFrame();
    clearTimedFrame();
    openedChapters.add(chapter.number);
    openingVisible = true;
    openingClosing = false;
    music?.select(musicCue(), {title: true});
    document.body.classList.add('chapter-title-active');
    stopAuto();
    clearTimeout(openingTimer);
    const opening = $('chapter-opening');
    opening.hidden = false;
    opening.classList.remove('visible', 'closing');
    populateChapterOpening(chapter);
    $('opening-back').disabled = !state.history.length;
    requestAnimationFrame(() => {
      if (openingVisible && !opening.hidden) opening.classList.add('visible');
    });
    $('opening-enter').focus({preventScroll: true});
  }
  function stopAuto() { clearTimeout(autoTimer); autoTimer = null; }
  function cancelFlash() {
    flashGeneration++;
    flashPlaying = false;
    flashFrame.classList.remove('visible');
    flashFrame.hidden = true;
    flashFrame.replaceChildren();
  }
  async function playFlash(scene) {
    if (flashPlaying) return;
    flashPlaying = true;
    stopAuto();
    const generation = ++flashGeneration;
    const image = el('img');
    const asset = art?.images?.[scene.image];
    let loaded = false;
    if (asset) {
      image.src = asset.path;
      try { await image.decode(); loaded = true; } catch (_) { /* Continue the story if the optional CG is unavailable. */ }
    }
    if (generation !== flashGeneration) return;
    if (loaded) {
      flashFrame.replaceChildren(image);
      flashFrame.style.setProperty('--flash-fade', `${scene.fadeMs || 600}ms`);
      flashFrame.hidden = false;
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (generation !== flashGeneration) return;
      flashFrame.classList.add('visible');
      await new Promise(resolve => setTimeout(resolve, (scene.fadeMs || 600) + (scene.holdMs || 2000)));
      if (generation !== flashGeneration) return;
      flashFrame.classList.remove('visible');
      await new Promise(resolve => setTimeout(resolve, scene.fadeMs || 600));
      if (generation !== flashGeneration) return;
    }
    cancelFlash();
    if (state.node === scene.node && sourceIndex(nodes.get(state.node), state.beat || 0) === scene.triggerBeat) {
      const after = followingSourceIndex(nodes.get(state.node), scene.skipBeat);
      state = after < 0 ? engine.advance(state, story) : {...state, beat: after, updated: Date.now()};
      persist(); render(); sound();
    }
  }
  function schedule() { stopAuto(); if (frameEffectPlaying || openingVisible || blankFrameKey !== null || timedWaiting || timedMode === 'auto' || (window.DREAMLAKE_TEST && window.DREAMLAKE_REVIEW_MODE && window.DREAMLAKE_REVIEW_MODE !== 'play')) return; if (autoMode && active && !typing && !$('panel').open && nodes.get(state.node).type === 'passage') autoTimer = setTimeout(next, Math.max(settings.delay * 1000, fullLine.length * 90)); }
  function finishLine() { clearInterval(typeTimer); typeTimer=null; typing=false; $('passage').textContent=fullLine; schedule(); }
  function playLine(text) {
    clearInterval(typeTimer); fullLine=text; $('passage').setAttribute('aria-label',text);
    if (!text || !settings.motion || (window.DREAMLAKE_TEST && window.DREAMLAKE_REVIEW_MODE !== 'play') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { typing=false; $('passage').textContent=text; schedule(); return; }
    let index=0; typing=true; $('passage').textContent='';
    typeTimer=setInterval(()=>{index=Math.min(text.length,index+2);$('passage').textContent=text.slice(0,index);if(index===text.length)finishLine();},24);
  }
  function render() {
    clearFrameEffect();
    const n = nodes.get(state.node), ch = story.chapters.find(c => c.number === n.chapter), terminal = ['ending', 'complete'].includes(n.type);
    clearTimeout(visualFadeTimer); visualFadeTimer = null; pendingFadeNavigation = null;
    if (n.type === 'choice' && n._reviewRemoved) {
      state = engine.move(state, n.next, story);
      persist(); render(); return;
    }
    if (n.type === 'ending' && removedEndingIds().has(n.id)) {
      const choice = story.nodes.find(item => item.type === 'choice' && item._reviewRemoved && item.options.some(option => option.next === n.id));
      state = engine.move(state, choice.next, story);
      persist(); render(); return;
    }
    if (n.type === 'passage' && n.beats?.length === 0) { state=engine.advance(state,story);persist();render();return; }
    const skipped = n.type === 'passage' && !n.beats[state.beat || 0]?._reviewKey && [...flashScenes.values()].find(scene => scene.node === n.id && scene.skipBeat === sourceIndex(n, state.beat || 0));
    if (skipped && !flashIsInteractive(skipped)) { const after = followingSourceIndex(n, skipped.skipBeat); state=after < 0 ? engine.advance(state,story) : {...state,beat:after,updated:Date.now()};persist();render();return; }
    const beat = n.type === 'passage' ? (n.beats || [{kind:'narration',text:n.text}])[state.beat || 0] : null;
    $('home').hidden = true; $('reader').hidden = false; active = true;
    if (n.id === ch.start && (state.beat || 0) === 0 && !openedChapters.has(ch.number)) showChapterOpening(ch);
    music?.select(musicCue(), {title: openingVisible && !openingClosing});
    const isBlankFrame = Number.isFinite(beat?.blankSeconds) && beat.blankSeconds >= 0;
    const effect = !isBlankFrame && n.type === 'passage' ? frameEffectConfig(n, state.beat || 0) : null;
    const fadeIn = !isBlankFrame ? fadeMilliseconds(frameTiming(n, state.beat || 0).fadeInSeconds) : 0;
    const fadeGeneration = resetFrameFade(effect ? 1 : fadeIn);
    if (isBlankFrame) {
      const key = frameKey(n, state.beat || 0);
      const textSeconds = Number.isFinite(beat.blankTextSeconds) && beat.blankTextSeconds >= 0 ? beat.blankTextSeconds : 3;
      const editingBlank = window.DREAMLAKE_TEST && window.DREAMLAKE_REVIEW_MODE !== 'play';
      if (blankFrameKey !== key || blankSeconds !== beat.blankSeconds || blankTextSeconds !== textSeconds || (blankPhase === 'editing') !== editingBlank) {
        clearBlankFrame();
        blankFrameKey = key; blankSeconds = beat.blankSeconds; blankTextSeconds = textSeconds; blankPhase = editingBlank ? 'editing' : 'black';
      }
      $('reader').style.setProperty('--blank-fade', `${blankFadeMs()}ms`);
      $('reader').classList.add('blank-frame');
      $('reader').classList.toggle('blank-waiting', blankPhase === 'black');
      $('reader').classList.toggle('blank-editing', blankPhase === 'editing');
    } else clearBlankFrame();
    $('reader').classList.toggle('terminal', terminal);
    $('reader').classList.toggle('dark', ['cave', 'night', 'rift', 'death'].includes(n.theme));
    $('reader').dataset.lineKind=beat?.kind || n.type;
    $('scene').dataset.theme = n.theme;
    const background = (window.DREAMLAKE_TEST && window.DreamlakeReview?.backgroundOverride?.()) || backgroundFor(n, state.beat || 0);
    drawBackground(background);
    const metadata = frameMetadata(n, frameKey(n, state.beat || 0));
    $('chapter-label').textContent = '第' + ch.label + '章 · ' + ch.title;
    $('place').textContent = metadata.place;
    $('scene-number').textContent = '卷 ' + String(ch.number).padStart(2, '0') + ' / ' + story.chapters.length;
    $('scene-title').textContent = ch.title;
    $('scene-tag').textContent = ({hearth:'灯火可亲 · 故人如昨',snow:'雪落人间 · 梦未醒',mountain:'山口有风 · 归路何处',river:'一水之间 · 相思千年',dream:'似梦非梦 · 此生何求',cave:'无明之中 · 万象皆空',rift:'天地有隙 · 梦亦有终',night:'星河无声 · 故人入梦'})[n.theme] || '';
    const stage = terminal ? [] : beat?.stage || n.stage || (n.character ? [{character:n.character,variant:n.variant}] : []);
    let artReady = Promise.resolve();
    if (n.type === 'choice' && previousPassageForChoice.has(n.id)) {
      let previous = previousPassageForChoice.get(n.id);
      if (!previous.beats?.length) previous = story.nodes.slice(0, story.nodes.indexOf(n)).reverse().find(item => item.type === 'passage' && item.chapter === n.chapter && item.beats?.length);
      if (previous) {
        const previousBeatIndex = previous.beats.length - 1;
        const previousBeat = previous.beats[previousBeatIndex];
        if (lastRenderedBeat !== frameKey(previous, previousBeatIndex) || !artViews.length) {
          artReady = renderArt(previous, previousBeat, previousBeat.stage || previous.stage || [], previousBeat.kind === 'dialogue' ? previousBeat.speaker : null, previousBeatIndex);
        }
      } else artReady = renderArt(n, null, stage, null, 0);
      if (sceneAdjustments?.beats?.[`${n.id}#0`] || sceneAdjustments?.cgs?.[`${n.id}#0`]) {
        lastRenderedBeat = `${n.id}#0`;
        artReady = drawArtView();
      }
    } else {
      artReady = renderArt(n, beat, stage, beat?.kind === 'dialogue' ? beat.speaker : null);
    }
    const frameReady = fadeIn || effect ? Promise.all([artReady, loadBackground(background)]) : artReady;
    const frameVisible = effect ? playFrameEffect(effect, frameReady, fadeGeneration, beat.text)
      : revealFrameAfterArt(fadeIn, frameReady, fadeGeneration);
    if (n.type === 'passage' && !isBlankFrame) prepareTimedFrame(n, state.beat || 0, frameVisible);
    else clearTimedFrame();
    $('speaker-name').hidden=beat?.kind!=='dialogue';
    $('speaker-name').textContent=beat?.kind==='dialogue' ? (beat.speakerLabel || story.characters[beat.speaker]?.name || '？？？') : '';
    $('node-label').textContent = n.type === 'passage' ? metadata.place : n.title || metadata.place;
    $('year-label').textContent = metadata.year;
    const index = positions.get(n.id) ?? positions.get(n.retryTo) ?? 0;
    const fraction=n.type==='passage'?(state.beat||0)/(n.beats?.length||1):0;
    $('progress-label').textContent = `第${ch.label}章`;
    $('progress-bar').style.width = ((index + fraction + 1) / route.length * 100) + '%';
    if (isBlankFrame) {
      stopAuto(); clearInterval(typeTimer); typeTimer = null; typing = false;
      if (blankPhase === 'black') {
        fullLine = '';
        $('passage').textContent = ''; $('passage').setAttribute('aria-label', '');
        startBlankCountdown();
      } else {
        fullLine = beat?.text || '';
        $('passage').textContent = fullLine;
        $('passage').setAttribute('aria-label', fullLine);
      }
    } else if (effect) {
      stopAuto(); clearInterval(typeTimer); typeTimer = null; typing = false; fullLine = '';
      $('passage').textContent = ''; $('passage').setAttribute('aria-label', '');
    } else playLine(beat?.text ?? n.text);
    $('choices').replaceChildren();
    if (n.type === 'choice') {
      n.options.forEach((option, i) => { const b = btn('', () => chooseOption(i), 'choice'); b.append(el('small', String(i + 1).padStart(2, '0')), el('span', option.text)); $('choices').append(b); });
    }
    $('advance-row').hidden = n.type !== 'passage'; $('ending-actions').hidden = !terminal; $('retry').hidden = n.type !== 'ending';
    $('back').disabled = !state.history.length && !(state.beat>0) && !(n.id === ch.start && (state.beat || 0) === 0); $('auto').disabled = terminal;
    document.title = `${ch.title} · ${story.title}`;
    schedule();
    if (window.DREAMLAKE_TEST) document.dispatchEvent(new Event('dreamlake:render'));
  }
  function startFrameFadeOut(afterFade) {
    const fadeOut = fadeMilliseconds(frameTiming(nodes.get(state.node), state.beat || 0).fadeOutSeconds);
    if (fadeOut) {
      const opacity = frameFade.hidden ? '0' : getComputedStyle(frameFade).opacity;
      frameFade.hidden = false;
      frameFade.style.transition = 'none';
      frameFade.style.opacity = opacity;
      void frameFade.offsetWidth;
      frameFade.style.transition = `opacity ${fadeOut}ms ease-in-out`;
      frameFade.style.opacity = '1';
      visualFadeTimer = setTimeout(() => {
        visualFadeTimer = null;
        if ($('panel').open) { pendingFadeNavigation = afterFade; return; }
        afterFade();
      }, fadeOut);
      return true;
    }
    return false;
  }
  function chooseOption(index, afterVisualFade = false) {
    if (!active || openingVisible || flashPlaying || $('panel').open || visualFadeTimer || nodes.get(state.node).type !== 'choice') return;
    if (!afterVisualFade && startFrameFadeOut(() => chooseOption(index, true))) return;
    state = engine.choose(state, index, story); persist(); render(); sound();
  }
  function next(fromBlank = false, afterVisualFade = false) {
    if (!active || openingVisible || flashPlaying || frameEffectPlaying || (blankFrameKey !== null && blankPhase !== 'editing' && fromBlank !== true) || timedWaiting || $('panel').open || nodes.get(state.node).type !== 'passage' || visualFadeTimer) return;
    if (typing) { finishLine(); return; }
    const n = nodes.get(state.node), beatIndex = state.beat || 0;
    if (!afterVisualFade && startFrameFadeOut(() => next(false, true))) return;
    const flash = flashScenes.get(`${n.id}#${sourceIndex(n, beatIndex)}`);
    if (flash && !flashIsInteractive(flash) && !n.beats[beatIndex]?._reviewKey) { playFlash(flash); return; }
    if (beatIndex < (n.beats?.length || 1) - 1) state = {...state, beat: beatIndex + 1, updated: Date.now()};
    else state = engine.advance(state, story);
    persist(); render(); sound();
  }
  function previous() {
    if (!active || flashPlaying) return;
    if (openingVisible) {
      if (!state.history.length) return;
      openedChapters.delete(nodes.get(state.node).chapter);
      hideChapterOpening();
    } else {
      const current = nodes.get(state.node);
      const chapter = story.chapters.find(item => item.number === current.chapter);
      if (current.id === chapter.start && (state.beat || 0) === 0) {
        if (typing) finishLine();
        showChapterOpening(chapter);
        render();
        return;
      }
    }
    if (state.beat > 0) state = {...state, beat: state.beat - 1, updated: Date.now()};
    else {
      state = engine.back(state, story);
      while (state.history.length && ((nodes.get(state.node).type === 'passage' && nodes.get(state.node).beats?.length === 0)
        || (nodes.get(state.node).type === 'choice' && nodes.get(state.node)._reviewRemoved))) state = engine.back(state, story);
      const node = nodes.get(state.node);
      state.beat = node.type === 'passage' ? (node.beats?.length || 1) - 1 : 0;
    }
    const node = nodes.get(state.node);
    const skipped = node.type === 'passage' && !node.beats[state.beat]?._reviewKey
      && [...flashScenes.values()].find(scene => scene.node === state.node && scene.skipBeat === sourceIndex(node, state.beat));
    if (skipped && !flashIsInteractive(skipped)) {
      const target = node.beats.findIndex((beat, position) => (beat._sourceIndex ?? position) === skipped.triggerBeat);
      if (target >= 0) state = {...state, beat: target, updated: Date.now()};
    }
    persist(); render();
  }
  function home() { music?.stop(); stopAuto(); clearFrameEffect(); clearBlankFrame(); clearTimedFrame(); clearTimeout(visualFadeTimer); visualFadeTimer = null; pendingFadeNavigation = null; resetFrameFade(0); cancelFlash(); clearInterval(typeTimer); clearTimeout(openingTimer); openingVisible = false; openingClosing = false; document.body.classList.remove('chapter-title-active'); $('chapter-opening').hidden = true; $('chapter-opening').classList.remove('visible', 'closing'); typing=false; active = false; $('reader').hidden = true; $('home').hidden = false; $('continue').hidden = !saved; document.title = story.title+' · '+story.subtitle; if (window.DREAMLAKE_TEST) document.dispatchEvent(new Event('dreamlake:render')); }
  function closePanel() { $('panel').close(); advanceBlankFrame(); advanceTimedFrame(); schedule(); }
  function begin() {
    if (saved && !confirm('重新入梦会替换自动存档。已收藏的结局会保留；需要时请先保存到手动存档。继续吗？')) return;
    openedChapters.clear(); state = engine.create(story); persist(); render();
  }
  function title(t) { $('panel-title').textContent = t; }
  function openPanel(kind) {
    stopAuto(); panelKind = kind; const body = $('panel-body'); body.replaceChildren();
    ({chapters: chaptersPanel, endings: endingsPanel, gallery: galleryPanel, saves: savesPanel, log: logPanel, settings: settingsPanel, about: aboutPanel})[kind](body);
    if (!$('panel').open) $('panel').showModal();
    if (window.DREAMLAKE_TEST) document.dispatchEvent(new Event('dreamlake:render'));
  }
  function chaptersPanel(body) {
    title('卷目');
    const grid = el('div', undefined, 'chapter-grid');
    story.chapters.forEach(ch => { const unlocked = ch.number === 1 || archive.completed || archive.visited.some(id => nodes.get(id)?.chapter === ch.number); const b = btn('', () => { state = engine.move(saved || state, ch.start, story); openedChapters.delete(ch.number); persist(); closePanel(); render(); }, 'chapter-card'); b.disabled = !unlocked; b.append(el('small', String(ch.number).padStart(2, '0'))); const detail = el('div'); detail.append(el('strong', unlocked ? ch.title : '尚未抵达'), el('span', unlocked ? ch.place : '第' + ch.label + '章')); b.append(detail); grid.append(b); }); body.append(grid);
  }
  function endingsPanel(body) {
    const removed = window.DREAMLAKE_TEST ? removedEndingIds() : new Set();
    const endings = story.nodes.filter(n => n.type === 'ending' && !removed.has(n.id));
    title('梦的余页'); body.append(el('p', `已拾得 ${archive.endings.filter(id => !removed.has(id)).length} / ${endings.length} 张余页${archive.completed ? ' · 真结局已抵达' : ''}。`, 'panel-intro'));
    const grid = el('div', undefined, 'endings-grid');
    endings.forEach(n => { const found = archive.endings.includes(n.id), card = el('section', undefined, 'ending-card' + (found ? '' : ' locked')); card.append(el('small', String(n.number).padStart(2, '0')), el('h3', found ? n.title : '未拾得的余页'), el('p', found ? n.text : '某个选择的尽头，梦还没有留下名字。')); grid.append(card); }); body.append(grid);
  }
  function galleryPanel(body) {
    title('人物'); const grid = el('div', undefined, 'gallery-grid');
    Object.entries(story.characters).forEach(([id,c]) => { const b = btn('', () => detailGallery(id), 'gallery-card'); b.dataset.character = id; const im = el('img'); im.src = portraitPath(id,Object.keys(c.variants)[0]); im.alt = c.galleryName || c.name; im.loading = 'lazy'; b.append(im,el('span',c.galleryName || c.name),el('small',c.profile || c.alias)); grid.append(b); }); body.append(grid);
  }
  function detailGallery(id) {
    const c = story.characters[id], body = $('panel-body'); body.replaceChildren(); title(c.galleryName || c.name);
    const box = el('div', undefined, 'gallery-detail'), im = el('img'); box.dataset.character = id; im.alt = c.galleryName || c.name; im.src = portraitPath(id,Object.keys(c.variants)[0]); const info = el('div'); info.append(el('p',c.profile || c.alias,'gallery-profile'));
    const labels = {calm:'平常',smile:'微笑',sad:'思念',resolve:'决意',old:'梦中流年',think:'思索',aim:'引弓',guard:'守护',fight:'迎敌',home:'家中',armor:'戎装',care:'关切',talk:'游说',hollow:'洞中旧影',young:'旧日容颜',hope:'释然',joy:'相逢',shy:'拘谨',angry:'愠怒',regret:'悔意',train:'剑庭',warm:'温和',stern:'冷峻',bound:'梦中',greet:'招呼',row:'撑渡',wait:'等候',lead:'引路',hood:'彼岸',reunion:'重逢',dream:'入梦',fear:'惊惧',command:'将令',complain:'絮语',surprise:'惊讶'};
    Object.keys(c.variants).forEach(v => info.append(btn(labels[v] || v, () => { im.src = portraitPath(id,v); })));
    info.append(btn('← 返回人物册',()=>openPanel('gallery'))); box.append(im,info); body.append(box);
  }
  function savesPanel(body) {
    title('留住此刻'); body.append(el('p','每次翻页都会自动保存。手动存档可保留不同进度；导出的存档可以带到另一台设备。', 'panel-intro')); const grid = el('div', undefined, 'save-grid');
    for (let i=1;i<=6;i++) { const slot = safeSave('slot'+i), card = el('section',undefined,'save-card'); card.append(el('h3','存档 '+String(i).padStart(2,'0'))); const ch = slot && story.chapters.find(c=>c.number===nodes.get(slot.node).chapter); card.append(el('p',slot ? ch.title+' · '+new Date(slot.updated).toLocaleString('zh-CN') : '一页空白，等待落笔。')); const save=btn('保存',()=>{if(slot&&!confirm('覆盖这份手动存档吗？'))return;write('slot'+i,{...state,updated:Date.now()});toast('已保存到存档 '+i);openPanel('saves');}); save.disabled=!active; const restore=btn('读取',()=>{state=slot;persist();closePanel();render();});restore.disabled=!slot;card.append(save,restore);grid.append(card); } body.append(grid);
    const actions=el('div',undefined,'panel-actions'); const exp=btn('导出当前存档',()=>{const current=active?state:saved;if(!current){toast('请先开始故事。');return;}const blob=new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=story.title+'-存档.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});actions.append(exp);
    const input=el('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.addEventListener('change',async()=>{try{const f=input.files[0];if(!f)return;if(f.size>2*1024*1024)throw Error('存档过大。');const parsed=JSON.parse(await f.text());const imported=engine.validate(parsed,story);state=imported;persist();closePanel();render();toast('存档已导入。');}catch(e){toast('无法导入：'+e.message);}finally{input.value='';}});actions.append(btn('导入存档',()=>input.click()),input);body.append(actions);
  }
  function logPanel(body) { title('往事'); const entries=[...state.history.map(id=>nodes.get(id)),nodes.get(state.node)].filter(n=>n.type==='passage'||n.type==='choice').flatMap(n=>n.type==='choice'?[{chapter:n.chapter,text:n.text}]:n.beats?.map((b,i)=>({chapter:n.chapter,text:(b.kind==='dialogue'?(b.speakerLabel||story.characters[b.speaker]?.name||'？？？')+'：':'')+b.text,node:n.id,index:i}))||[{chapter:n.chapter,text:n.text}]).filter(e=>e.node!==state.node||e.index<=state.beat).slice(-100); if(!entries.length)body.append(el('p','故事才刚开始。')); entries.forEach(n=>{const e=el('div',undefined,'log-entry');e.append(el('small','第'+story.chapters[n.chapter-1].label+'章'),el('span',n.text));body.append(e);}); setTimeout(()=>body.lastElementChild?.scrollIntoView({block:'end'}),0); }
  function applySettings() { document.documentElement.style.setProperty('--reading-size',settings.size+'px');document.body.classList.toggle('strong-text',settings.sans);music?.setOptions({enabled: settings.music, volume: settings.musicVolume / 100});write('settings',settings); }
  function settingsPanel(body) {
    title('阅读设置');
    for(const [name,label,min,max] of [['size','文字大小',18,30],['delay','自动播放间隔（秒）',2,12],['musicVolume','背景音乐音量（%）',0,100]]){const row=el('label',undefined,'setting'),caption=el('span',label+' · '+settings[name]),input=el('input');input.type='range';input.min=min;input.max=max;input.value=settings[name];input.setAttribute('aria-label',label);input.addEventListener('input',()=>{settings[name]=Number(input.value);caption.textContent=label+' · '+input.value;applySettings();});row.append(caption,input);body.append(row);}
    for(const [name,label] of [['sans','使用黑体'],['motion','逐字显示'],['sound','翻页音'],['music','背景音乐']]){const row=el('label',undefined,'setting'),input=el('input');input.type='checkbox';input.checked=settings[name];input.setAttribute('aria-label',label);input.addEventListener('change',()=>{settings[name]=input.checked;applySettings();if(name==='sound')sound();});row.append(el('span',label),input);body.append(row);}
  }
  function aboutPanel(body) {title('关于此作');const text=el('div',undefined,'about');text.append(el('h3',story.subtitle),el('p',story.presentation?.credits || '','about-credits'));text.append(el('p','键盘：空格 / → 继续；← 回看；1 / 2 选择；S 存档；L 往事；Esc 关闭窗口。也可直接点击或触摸操作。'));body.append(text);}
  let audio;
  function sound(){if(!settings.sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();audio.resume();const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(620,audio.currentTime);gain.gain.setValueAtTime(.025,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.08);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.08);}catch(_){}}
  $('start').onclick=begin;$('continue').onclick=()=>{state=saved;render();};$('to-home').onclick=home;$('ending-home').onclick=home;$('next').onclick=next;
  $('opening-enter').onclick=dismissChapterOpening;
  $('opening-back').onclick=previous;
  $('chapter-opening').addEventListener('click', e => e.stopPropagation());
  $('reader').addEventListener('click',e=>{if(!e.target.closest('button,nav'))next();});$('back').onclick=previous;$('retry').onclick=()=>{state=engine.retry(state,story);persist();render();};
  $('auto').onclick=()=>{autoMode=!autoMode;$('auto').setAttribute('aria-pressed',String(autoMode));$('auto').textContent=autoMode?'自动中':'自动';schedule();};
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openPanel(b.dataset.open)));
  $('close-panel').onclick=closePanel;$('panel').addEventListener('close',()=>{if(pendingFadeNavigation){const action=pendingFadeNavigation;pendingFadeNavigation=null;action();}advanceBlankFrame();advanceTimedFrame();schedule();});$('panel').addEventListener('click',e=>{if(e.target===$('panel')){const r=$('panel').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePanel();}});
  document.addEventListener('keydown',e=>{if(openingVisible){if(e.target.closest?.('#review-ui, #review-dialog, #review-list-dialog, #review-stage-confirm, #opening-review-edit')||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='ArrowLeft'||(e.target.id==='opening-back'&&[' ','Enter'].includes(e.key))){e.preventDefault();previous();return;}if([' ','Enter','ArrowRight','Escape'].includes(e.key)){e.preventDefault();dismissChapterOpening();}return;}if($('panel').open||document.querySelector('#review-choice-confirm[open],#review-stage-confirm[open],#review-dialog[open],#review-list-dialog[open]')||!active||e.altKey||e.ctrlKey||e.metaKey||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.target.tagName==='BUTTON'&&e.key===' ')return;const n=nodes.get(state.node);if([' ','ArrowRight'].includes(e.key)){e.preventDefault();next();}else if(e.key==='ArrowLeft'){$('back').click();}else if(n.type==='choice'&&['1','2'].includes(e.key)){$('choices').querySelectorAll('button')[Number(e.key)-1]?.click();}else if(e.key.toLowerCase()==='s')openPanel('saves');else if(e.key.toLowerCase()==='l')openPanel('log');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAuto();else schedule();});
  if (window.DREAMLAKE_TEST) window.DreamlakeReview = {
    current: () => ({active, node: state.node, beat: state.beat || 0, key: frameKey(nodes.get(state.node), state.beat || 0), panel: $('panel').open ? panelKind : ''}),
    artContext: () => { const view = artViews[0]; return view ? {type: view.type, id: view.id, layout: view.layout, stage: view.stage.map(member => ({...member})), portraits: {...view.portraits}, speaker: view.speaker} : null; },
    previousFrame: previousFrameContext,
    frameContext: (nodeId, beatIndex = 0) => {
      const node=nodes.get(nodeId);if(!node)return null;
      const key=frameKey(node,beatIndex),beat=node.beats?.[beatIndex];
      let source=node,index=beatIndex;
      if(node.type==='choice'){
        source=previousPassageForChoice.get(node.id)||node;
        if(!source.beats?.length)source=story.nodes.slice(0,story.nodes.indexOf(node)).reverse().find(n=>n.type==='passage'&&n.chapter===node.chapter&&n.beats?.length)||node;
        index=Math.max(0,(source.beats?.length||1)-1);
      }
      const line=source.beats?.[index],speaker=line?.kind==='dialogue'?line.speaker:null;
      const view=buildArtViews(source,line?.stage||source.stage||[],speaker,index)[0];
      const renderedKey=node.type==='choice'&&!sceneAdjustments?.beats?.[key]&&!sceneAdjustments?.cgs?.[key]?frameKey(source,index):key;
      const cg=sceneAdjustments?.cgs?.[renderedKey]||(!sceneAdjustments?.beats?.[renderedKey]&&view.type==='cg'?view.id:null);
      return {key,node:nodeId,beat:beatIndex,background:backgroundFor(node,beatIndex),cg,
        cgLayout:sceneAdjustments?.cgLayouts?.[renderedKey]||view.layout||'landscape',
        view, timing:frameTiming(node,beatIndex),meta:frameMetadata(node,key)};
    },
    frameMetadata: (nodeId, key) => {
      const node = nodes.get(nodeId);
      return node ? frameMetadata(node, key) : null;
    },
    reconcileNodes: () => {
      nodes.clear(); story.nodes.forEach(node => nodes.set(node.id, node));
      previousPassageForChoice.clear();
      for(const chapter of story.chapters){let prior=null;
        for(const node of VNFrameOrder.route(story,`chapter:${chapter.number}`)){
          if(node.type==='passage'&&node.beats.length)prior=node;
          else if(node.type==='choice'&&prior)previousPassageForChoice.set(node.id,prior);
        }
      }
      for (const node of story.nodes) if (node._reviewBranchFor) positions.set(node.id, positions.get(node._reviewChoiceId) ?? 0);
      if (!saved) { saved = safeSave('auto'); $('continue').hidden = !saved; }
    },
    reconcileSavedFrame: () => {
      if (!saved?.reviewFrameKey) return;
      const node = story.nodes.find(n=>n.type==='passage'&&n.beats.some((_,i)=>frameKey(n,i)===saved.reviewFrameKey))||nodes.get(saved.node);
      if (node?.type !== 'passage') return;
      const index = node.beats.findIndex((_, position) => frameKey(node, position) === saved.reviewFrameKey);
      if (index >= 0) saved = {...saved,node:node.id,beat:index};
    },
    seekFrame: (nodeId, key, fallbackIndex = 0, reconcileRoute = false) => {
      const node = story.nodes.find(n=>n.type==='passage'&&n.beats.some((_,i)=>frameKey(n,i)===key))||nodes.get(nodeId);
      if (!node) return;
      nodeId=node.id;
      const routeHistory=()=>{if(!reconcileRoute)return;const scope=VNFrameOrder.group(node),route=VNFrameOrder.route(story,scope);
        const prior=state.history.filter(id=>scope.startsWith('chapter:')?nodes.get(id)?.chapter<node.chapter:VNFrameOrder.group(nodes.get(id))!==scope);
        state={...state,history:[...prior,...route.slice(0,route.indexOf(node)).map(n=>n.id)]};};
      if(node.type==='choice'){if(state.node!==nodeId)state=engine.move(state,nodeId,story);routeHistory();persist();render();return;}
      if(node.type!=='passage')return;
      if (node._reviewBranchFor && nodes.get(state.node)?.type === 'ending'
          && nodes.get(state.node).retryTo === node._reviewChoiceId) state = engine.retry(state, story);
      if (state.node !== nodeId) state = engine.move(state, nodeId, story);
      const found = node.beats.findIndex((_, index) => frameKey(node, index) === key);
      state = {...state, beat: found >= 0 ? found : Math.min(fallbackIndex, Math.max(0, node.beats.length - 1)), updated: Date.now()};
      routeHistory();persist(); render();
    },
    drawArt: drawArtView,
    restartFrameTiming: clearTimedFrame,
    drawBackground,
    refresh: () => { configurePresentation(); if (active) render(); else home(); if (openingVisible) populateChapterOpening(story.chapters.find(ch => ch.number === Number($('chapter-opening').dataset.chapter))); if ($('panel').open) openPanel(panelKind); },
    finishLine,
    stopAuto,
    resumeAuto: schedule
  };
  configurePresentation();applySettings();home();
})();
