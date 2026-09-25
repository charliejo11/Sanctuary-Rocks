"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./DragonCursor.module.css";

// Sitewide dragon cursor: a small dragon head follows the mouse and breathes
// a short burst of fire on click.
//
// - Desktop only: needs a real mouse (hover + fine pointer). Touch screens and
//   phones keep their normal behaviour.
// - Off when the visitor prefers reduced motion.
// - The layer ignores the pointer entirely (pointer-events: none), so links,
//   buttons and text selection work exactly as before. Over text fields the
//   dragon steps aside and the normal text cursor comes back.

const SIZE = 44; // rendered width of the dragon head (px)
// The snout tip is the hotspot: 14% across, 53% down the image.
const HOT_X = Math.round(SIZE * 0.14);
const HOT_Y = Math.round(SIZE * (176 / 192) * 0.53);

const TEXT_FIELDS = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const INTERACTIVE = "a, button, [role='button'], label, summary, [tabindex]:not([tabindex='-1'])";
const MAX_FLAMES = 36;

export default function DragonCursor() {
  const [enabled, setEnabled] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // Decide once, and again if the device/setting changes (e.g. a mouse is
  // plugged into a tablet, or reduced motion is switched on).
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(fine.matches && !calm.matches);
    update();
    fine.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const head = headRef.current;
    const layer = layerRef.current;
    if (!head || !layer) return;

    const root = document.documentElement;
    root.classList.add(styles.active);

    let x = -100;
    let y = -100;
    let frame = 0;
    let visible = false;

    const render = () => {
      frame = 0;
      head.style.transform = `translate3d(${x - HOT_X}px, ${y - HOT_Y}px, 0)`;
    };

    const setVisible = (value: boolean) => {
      if (value === visible) return;
      visible = value;
      head.classList.toggle(styles.shown, value);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      const target = event.target as Element | null;
      const inTextField = Boolean(target?.closest?.(TEXT_FIELDS));
      setVisible(!inTextField);
      head.classList.toggle(styles.hover, Boolean(target?.closest?.(INTERACTIVE)));
      if (!frame) frame = requestAnimationFrame(render);
    };

    const onLeave = (event: MouseEvent) => {
      if (!event.relatedTarget) setVisible(false);
    };

    const breathe = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !visible) return;

      // A little head-jerk on the image (the wrapper's transform is the
      // position, so it is left alone).
      head.firstElementChild?.animate(
        [
          { transform: "rotate(0deg) scale(1)" },
          { transform: "rotate(9deg) scale(1.1)", offset: 0.35 },
          { transform: "rotate(0deg) scale(1)" },
        ],
        { duration: 420, easing: "ease-out" },
      );

      const count = 9;
      for (let i = 0; i < count; i += 1) {
        if (layer.childElementCount >= MAX_FLAMES) break;
        const flame = document.createElement("span");
        flame.className = styles.flame;
        const size = 8 + Math.random() * 12;
        flame.style.width = `${size}px`;
        flame.style.height = `${size}px`;
        flame.style.left = `${event.clientX - size / 2}px`;
        flame.style.top = `${event.clientY - size / 2}px`;
        layer.appendChild(flame);

        // Out of the snout (to the left), fanning ±24°, rising as it cools.
        const angle = Math.PI + (Math.random() - 0.5) * (Math.PI / 3.75);
        const distance = 34 + Math.random() * 40;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - (6 + Math.random() * 10);

        const animation = flame.animate(
          [
            { transform: "translate(0, 0) scale(0.4)", opacity: 1 },
            { transform: `translate(${dx * 0.55}px, ${dy * 0.5}px) scale(1.15)`, opacity: 0.95, offset: 0.4 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 },
          ],
          { duration: 380 + Math.random() * 220, delay: i * 14, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "both" },
        );
        animation.onfinish = () => flame.remove();
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", breathe, { passive: true });
    document.addEventListener("mouseout", onLeave);

    return () => {
      root.classList.remove(styles.active);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", breathe);
      document.removeEventListener("mouseout", onLeave);
      if (frame) cancelAnimationFrame(frame);
      layer.replaceChildren();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className={styles.cursorRoot} aria-hidden="true">
      <div ref={layerRef} className={styles.flames} />
      <div ref={headRef} className={styles.head} style={{ width: SIZE }}>
        <img src="/images/shared/cursor/dragon-cursor.webp" alt="" width={192} height={176} draggable={false} />
      </div>
    </div>
  );
}
