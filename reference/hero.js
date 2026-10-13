// Wires the fluid to the hero element: loads the photo, forwards pointer
// input, and pauses when the hero is off screen or the tab is hidden.
// Without WebGL2 or with reduced motion the static <img> simply stays.

import { createJupiter } from './fluid.js';
import { IMAGE, STORMS } from './storms.js';

export function mountJupiter(root, overrides = {}) {
  const canvas = root.querySelector('canvas');
  if (!canvas) return null;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

  // Phones get lighter settings. Everywhere else the values in DEFAULTS
  // (top of fluid.js) apply, so that is the one place to tune.
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const phone = small ? { simRes: 48, mapRes: 320, pressureIterations: 16 } : {};
  let jupiter;
  try {
    jupiter = createJupiter(canvas, {
      imageSize: [IMAGE.width, IMAGE.height],
      focus: IMAGE.focus,
      storms: STORMS,
      ...phone,
      ...overrides,
    });
  } catch (err) {
    console.warn('jupiter: falling back to the still image', err);
    return null;
  }
  if (!jupiter) return null;

  const base = root.dataset.base || '';
  const need = canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2);
  const source = IMAGE.sources.find((s) => s.width >= need) || IMAGE.sources[IMAGE.sources.length - 1];
  const photo = new Image();
  photo.decoding = 'async';
  photo.src = base + source.src;

  let visible = true;
  const sync = () => (visible && !document.hidden ? jupiter.start() : jupiter.stop());

  photo.decode().then(() => {
    jupiter.setImage(photo);
    jupiter.firstFrame = () => root.classList.add('is-live');
    sync();
  }).catch(() => {});

  // pointer input (mouse, pen, and horizontal touch drags)
  const rect = () => canvas.getBoundingClientRect();
  const feed = (e, isNew) => {
    const r = rect();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of list.length ? list : [e]) {
      jupiter.pointer(ev.clientX - r.left, ev.clientY - r.top, ev.timeStamp, isNew);
      isNew = false;
    }
  };
  root.addEventListener('pointerenter', (e) => feed(e, true));
  root.addEventListener('pointerdown', (e) => feed(e, true));
  root.addEventListener('pointermove', (e) => feed(e, false));

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0 })
    .observe(root);
  document.addEventListener('visibilitychange', sync);

  return jupiter;
}
