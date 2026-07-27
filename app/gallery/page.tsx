"use client";

import { useEffect, useState } from "react";
import galleryData from "../data/gallery.json";

type GalleryPhoto = {
  src: string;
  alt: string;
  caption: string;
};

type GalleryData = {
  title: string;
  subtitle: string;
  photos: GalleryPhoto[];
};

const data = galleryData as GalleryData;

function GalleryImage({
  photo,
  index,
}: {
  photo: GalleryPhoto;
  index: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <span className="gallery-template-placeholder">
        <strong>{String(index + 1).padStart(2, "0")}</strong>
        <em>{photo.caption}</em>
      </span>
    );
  }

  return (
    <img
      src={photo.src}
      alt={photo.alt}
      onError={() => {
        setImageFailed(true);
      }}
    />
  );
}

const BOARD_SLOT_COUNT = 15;

export default function GalleryPage() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePhoto = activeIndex === null ? null : data.photos[activeIndex];
  const overflowPhotos = data.photos.slice(BOARD_SLOT_COUNT);

  const closeLightbox = () => {
    setActiveIndex(null);
  };

  const showPrevious = () => {
    setActiveIndex((current) => {
      if (current === null) return current;
      return (current - 1 + data.photos.length) % data.photos.length;
    });
  };

  const showNext = () => {
    setActiveIndex((current) => {
      if (current === null) return current;
      return (current + 1) % data.photos.length;
    });
  };

  useEffect(() => {
    if (activeIndex === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex]);

  return (
    <main className="gallery-page">
      <section className="gallery-template-shell" aria-labelledby="gallery-title">
        <div className="gallery-template-board">
          <img
            className="gallery-template-image"
            src="/images/hero/Gallery.png.png"
            alt=""
            aria-hidden="true"
          />

          <header className="gallery-template-mobile-header">
            <p>SANCTUARY ROCKS</p>
            <h1>{data.title}</h1>
            <span>{data.subtitle}</span>
          </header>

          <div className="gallery-template-heading">
            <h1 id="gallery-title">{data.title}</h1>
            <p>{data.subtitle}</p>
          </div>

          <div className="gallery-template-grid" aria-label="Gallery photos">
            {data.photos.slice(0, BOARD_SLOT_COUNT).map((photo, index) => (
              <button
                className={`gallery-template-slot gallery-template-slot--${index + 1}`}
                key={`${photo.src}-${index}`}
                type="button"
                onClick={() => {
                  setActiveIndex(index);
                }}
                aria-label={`Open ${photo.caption}`}
              >
                <GalleryImage photo={photo} index={index} />
                <span className="gallery-template-caption">{photo.caption}</span>
              </button>
            ))}
          </div>
        </div>

        {overflowPhotos.length > 0 ? (
          <div className="gallery-overflow" aria-label="More gallery photos">
            <h2 className="gallery-overflow-heading">More Photos</h2>
            <div className="gallery-overflow-scroll">
              {overflowPhotos.map((photo, overflowIndex) => {
                const index = BOARD_SLOT_COUNT + overflowIndex;
                return (
                  <button
                    className="gallery-overflow-item"
                    key={`${photo.src}-${index}`}
                    type="button"
                    onClick={() => {
                      setActiveIndex(index);
                    }}
                    aria-label={`Open ${photo.caption}`}
                  >
                    <GalleryImage photo={photo} index={index} />
                    <span className="gallery-template-caption">{photo.caption}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {activePhoto ? (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.caption}
        >
          <button
            className="gallery-lightbox-backdrop"
            type="button"
            aria-label="Close gallery image"
            onClick={closeLightbox}
          />

          <div className="gallery-lightbox-panel">
            <button
              className="gallery-lightbox-close"
              type="button"
              onClick={closeLightbox}
              aria-label="Close gallery image"
            >
              Close
            </button>

            {data.photos.length > 1 ? (
              <button
                className="gallery-lightbox-nav gallery-lightbox-nav--prev"
                type="button"
                onClick={showPrevious}
                aria-label="Previous gallery image"
              >
                Prev
              </button>
            ) : null}

            <figure>
              <div className="gallery-lightbox-image">
                <GalleryImage photo={activePhoto} index={activeIndex ?? 0} />
              </div>
              <figcaption>{activePhoto.caption}</figcaption>
            </figure>

            {data.photos.length > 1 ? (
              <button
                className="gallery-lightbox-nav gallery-lightbox-nav--next"
                type="button"
                onClick={showNext}
                aria-label="Next gallery image"
              >
                Next
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
