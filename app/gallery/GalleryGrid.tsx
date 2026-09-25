"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./gallery.module.css";

export type GalleryPhoto = {
  src: string;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
};

// Photos per page by screen size (desktop / tablet / phone).
const PER_PAGE = { desktop: 15, tablet: 12, phone: 6 };

function usePerPage() {
  const [perPage, setPerPage] = useState(PER_PAGE.desktop);
  useEffect(() => {
    const tablet = window.matchMedia("(max-width: 1100px)");
    const phone = window.matchMedia("(max-width: 640px)");
    const update = () => setPerPage(phone.matches ? PER_PAGE.phone : tablet.matches ? PER_PAGE.tablet : PER_PAGE.desktop);
    update();
    tablet.addEventListener("change", update);
    phone.addEventListener("change", update);
    return () => {
      tablet.removeEventListener("change", update);
      phone.removeEventListener("change", update);
    };
  }, []);
  return perPage;
}

const ratioOf = (photo: GalleryPhoto) => (photo.width && photo.height ? photo.width / photo.height : 4 / 3);

// Photo-first gallery: justified rows of mixed widths (every photo keeps its
// own shape, nothing is cropped or stretched), numbered pages, and a
// full-quality lightbox.
export default function GalleryGrid({ photos }: { photos: GalleryPhoto[] }) {
  const perPage = usePerPage();
  const pageCount = Math.max(1, Math.ceil(photos.length / perPage));
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const current = Math.min(page, pageCount - 1);
  const start = current * perPage;
  const visible = photos.slice(start, start + perPage);

  const goTo = (next: number) => {
    setPage(next);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    topRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div ref={topRef} className={styles.galleryWrap}>
      <ul className={styles.grid} aria-label={`Gallery photos, page ${current + 1} of ${pageCount}`}>
        {visible.map((photo, i) => {
          const ratio = ratioOf(photo);
          return (
            <li
              key={photo.src}
              className={styles.tile}
              style={{ "--r": ratio } as React.CSSProperties}
            >
              <button type="button" className={styles.tileButton} onClick={() => setOpen(start + i)} aria-label={`Open ${photo.caption}`}>
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  sizes={`(max-width: 640px) 100vw, (max-width: 1100px) 50vw, ${Math.round(ratio * 300)}px`}
                  priority={current === 0 && i < 4}
                />
                <span className={styles.caption}>{photo.caption}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <nav className={styles.pagination} aria-label="Gallery pages">
        <button
          type="button"
          className={`${styles.pageButton} ${styles.pageArrow}`}
          onClick={() => goTo(current - 1)}
          disabled={current === 0}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M20 12H5m6-7-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {Array.from({ length: pageCount }, (_, n) => (
          <button
            key={n}
            type="button"
            className={`${styles.pageButton} ${n === current ? styles.pageActive : ""}`}
            onClick={() => goTo(n)}
            aria-label={`Page ${n + 1}`}
            aria-current={n === current ? "page" : undefined}
          >
            {n + 1}
          </button>
        ))}
        <button
          type="button"
          className={`${styles.pageButton} ${styles.pageArrow}`}
          onClick={() => goTo(current + 1)}
          disabled={current === pageCount - 1}
          aria-label="Next page"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 12h15m-6-7 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </nav>

      {open !== null && photos[open] ? (
        <Lightbox photos={photos} index={open} onChange={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function Lightbox({
  photos,
  index,
  onChange,
  onClose,
}: {
  photos: GalleryPhoto[];
  index: number;
  onChange: (i: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  const count = photos.length;
  const step = useCallback((d: number) => onChange((index + d + count) % count), [index, count, onChange]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption}
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      }}
    >
      <figure className={styles.lightboxFigure} onClick={(e) => e.stopPropagation()}>
        {/* Full-quality original, not a resized copy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={photo.src} className={styles.lightboxImage} src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} />
        <figcaption className={styles.lightboxCaption}>
          <span>
            {String(index + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
          </span>
          {photo.caption}
        </figcaption>
      </figure>

      <button ref={closeRef} type="button" className={styles.lightboxClose} onClick={onClose} aria-label="Close photo">
        ×
      </button>
      {count > 1 ? (
        <>
          <button
            type="button"
            className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            className={`${styles.lightboxNav} ${styles.lightboxNext}`}
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next photo"
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}
