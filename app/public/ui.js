/* ════════════════════════════════════════════════════════════════
   PeerDrop – motion
   Optional layer on top of app.js: CSS already renders every state,
   this only plays the two moments worth seeing. Web Animations API,
   no libraries. Nothing runs under reduced motion.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !Element.prototype.animate) { root.classList.remove('intro'); return; }

  const $ = (s) => document.querySelector(s);
  const easeOut = 'cubic-bezier(.23, 1, .32, 1)';
  const easeInOut = 'cubic-bezier(.77, 0, .175, 1)';
  const track = $('.link-track');
  const nodeB = $('.link-node-b');
  const labelB = $('.link-label-b');

  // ─── Once, on load: the readout draws a line from you to the other end.
  // The inline script in <head> held these back with .intro.
  if (root.classList.contains('intro')) {
    root.classList.remove('intro');
    track.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: 700, delay: 150, easing: easeInOut, fill: 'backwards' });
    nodeB.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 300, delay: 760, easing: easeOut, fill: 'backwards' });
    labelB.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: 300, delay: 700, easing: 'ease', fill: 'backwards' });
  }

  // ─── When the far end answers, its lamp pulses once
  let last = $('#link').dataset.state;
  document.addEventListener('pd:link', (e) => {
    const { state } = e.detail;
    if (state === last) return;
    last = state;
    if (state === 'linked') {
      nodeB.animate([{ transform: 'scale(1.8)' }, { transform: 'scale(1)' }], { duration: 420, easing: easeOut });
    } else if (state === 'reconnecting') {
      nodeB.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: easeOut });
    }
  });

  // ─── Switching mode: the new panel settles in under the thumb
  document.addEventListener('pd:mode', (e) => {
    const panel = document.getElementById(`panel-${e.detail.mode}`);
    if (panel) panel.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: easeOut });
  });
})();
