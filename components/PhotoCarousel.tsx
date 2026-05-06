"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  photos: string[];
  alt: string;
};

export function PhotoCarousel({ photos, alt }: Props) {
  const [idx, setIdx] = useState(0);
  const total = photos.length;
  if (total === 0) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
        No photos available for this listing.
      </div>
    );
  }
  const go = (delta: number) => setIdx((i) => (i + delta + total) % total);
  return (
    <div className="relative h-72 w-full overflow-hidden rounded-lg bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[idx]}
        alt={alt}
        className="h-full w-full object-cover"
      />
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 shadow hover:bg-background"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1.5 shadow hover:bg-background"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-background/70 px-2 py-1">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Go to photo ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === idx ? "bg-foreground" : "bg-foreground/30"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
