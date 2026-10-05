(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VNFrameEffects = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // A cancellable sequence: black cover, a left-to-right arrow light,
  // reveal of the empty scene, then a distinct pause before the narration.
  function arrowSweep({reader, cover, layer, light, ready, isCurrent,
                       config, reducedMotion = false, onText}) {
    let cancelled = false;
    const timers = new Map(), animations = new Set();
    let releaseStop;
    const stopped = new Promise(resolve => { releaseStop = resolve; });
    const live = () => !cancelled && isCurrent();
    const phase = name => { reader.dataset.frameEffectPhase = name; };
    const milliseconds = (value, fallback) => Math.max(0, Number.isFinite(value) ? value : fallback) * 1000;
    const pause = duration => new Promise(resolve => {
      const timer = setTimeout(() => { timers.delete(timer); resolve(live()); }, duration);
      timers.set(timer, resolve);
    });
    async function animate(element, keyframes, duration, easing) {
      if (!live()) return false;
      if (!duration || typeof element.animate !== 'function') {
        Object.assign(element.style, keyframes.at(-1));
        return live();
      }
      const animation = element.animate(keyframes, {duration, easing, fill: 'forwards'});
      animations.add(animation);
      try { await animation.finished; } catch (_) { /* Cancellation is normal on navigation. */ }
      if (live()) Object.assign(element.style, keyframes.at(-1));
      animation.cancel(); animations.delete(animation);
      return live();
    }
    function cancel() {
      if (cancelled) return;
      cancelled = true; releaseStop();
      for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(false); }
      timers.clear();
      for (const animation of animations) animation.cancel();
      animations.clear();
      layer.hidden = true;
      reader.classList.remove('frame-effect-playing');
      reader.removeAttribute('aria-busy');
      delete reader.dataset.frameEffectPhase;
    }

    reader.classList.add('frame-effect-playing');
    reader.setAttribute('aria-busy', 'true');
    phase('preparing');
    const finished = (async () => {
      await Promise.race([Promise.resolve(ready), stopped]);
      if (!live()) return false;
      cover.hidden = false; cover.style.transition = 'none'; cover.style.opacity = '1';
      if (!reducedMotion) {
        phase('sweep'); layer.hidden = false;
        if (!await animate(light,
          [{transform: 'translateX(-110vw)', opacity: 0},
           {transform: 'translateX(-55vw)', opacity: 1, offset: .2},
           {transform: 'translateX(100vw)', opacity: 1, offset: .85},
           {transform: 'translateX(120vw)', opacity: 0}],
          milliseconds(config.sweepSeconds, .45), 'linear')) return false;
      }
      layer.hidden = true;
      phase('reveal');
      if (!await animate(cover, [{opacity: '1'}, {opacity: '0'}],
        reducedMotion ? 0 : milliseconds(config.revealSeconds, 1.25), 'ease-in-out')) return false;
      cover.hidden = true;
      phase('hold');
      if (!await pause(milliseconds(config.backgroundSeconds, 1.5))) return false;
      phase('text');
      reader.classList.remove('frame-effect-playing');
      reader.removeAttribute('aria-busy');
      onText();
      return true;
    })();
    return {finished, cancel};
  }
  return {arrowSweep};
});
