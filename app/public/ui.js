/* ════════════════════════════════════════════════════════════════
   PeerDrop – motion
   Optional layer on top of app.js: CSS already renders every state,
   this only choreographs the changes. Nothing runs under reduced motion.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof gsap === 'undefined') return;

  gsap.registerPlugin(ScrollTrigger, SplitText);
  const $ = (s) => document.querySelector(s);
  const cleanups = [];

  // ─── Smooth scrolling (mouse and trackpad only; touch keeps native scrolling)
  if (typeof Lenis !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
    const lenis = new Lenis({ anchors: true, lerp: 0.12 });
    const tick = (time) => lenis.raf(time * 1000);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    cleanups.push(() => { gsap.ticker.remove(tick); lenis.destroy(); });
  }

  // ─── Intro: the status line draws from you to the other end.
  // The inline script in <head> held these back with .intro; hand them to GSAP and let go.
  const root = document.documentElement;
  const nodeB = $('.link-node-b');
  if (root.classList.contains('intro')) {
    gsap.set('.link-track', { scaleX: 0 });
    gsap.set(nodeB, { scale: 0 });
    gsap.set('.link-label-b', { opacity: 0 });
    root.classList.remove('intro');
    gsap.timeline({ delay: 0.15 })
      .from('.link-node-a', { scale: 0, duration: 0.4, ease: 'back.out(3)' }, 0)
      .to('.link-track', { scaleX: 1, duration: 0.9, ease: 'power3.inOut', clearProps: 'transform' }, 0.1)
      .to(nodeB, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform' }, 0.85)
      .to('.link-label-b', { opacity: 1, duration: 0.5, clearProps: 'opacity' }, 0.8);
  }

  // ─── Mode switch: the new panel and lede settle in
  document.addEventListener('pd:mode', (e) => {
    const mode = e.detail.mode;
    gsap.fromTo(`.lede-${mode}`, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'transform,opacity' });
    gsap.fromTo(`#panel-${mode}`, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', clearProps: 'transform,opacity' });
  });

  // ─── Link state changes: the far node answers
  let last = $('#link').dataset.state;
  document.addEventListener('pd:link', (e) => {
    const { state } = e.detail;
    if (state === last) return;
    last = state;
    if (state === 'linked') {
      gsap.fromTo(nodeB, { scale: 1.9 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.45)', clearProps: 'transform' });
    } else if (state === 'reconnecting') {
      gsap.fromTo(nodeB, { x: -5 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.25)', clearProps: 'transform' });
    }
  });

  // ─── "How it works": heading word by word, then the two columns
  document.fonts.ready.then(() => {
    const title = $('[data-split]');
    if (!title) return;
    const split = SplitText.create(title, { type: 'words', mask: 'words', aria: 'auto' });
    const tl = gsap.timeline({ scrollTrigger: { trigger: '.how', start: 'top 75%', once: true } });
    tl.from(split.words, { yPercent: 110, duration: 0.8, stagger: 0.07, ease: 'power3.out' })
      .from('.how-col', { opacity: 0, y: 24, duration: 0.7, stagger: 0.12, ease: 'power2.out', clearProps: 'transform,opacity' }, 0.3);
    cleanups.push(() => split.revert());
    ScrollTrigger.refresh();
  });

  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    cleanups.forEach((fn) => fn());
    ScrollTrigger.killAll();
  });
})();
