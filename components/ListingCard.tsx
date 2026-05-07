"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Bed, Bath, Train, Sparkles, Check } from "lucide-react";
import type { Borough, Listing } from "@/lib/types";

function formatPrice(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000)}k`;
  return `$${p}`;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// Borough-specific badge palette gives the result list visual variety
// without departing from a clean Zillow-blue baseline. Tailwind base
// utility classes so the colors render in any theme.
const BOROUGH_BADGE: Record<Borough, string> = {
  Manhattan: "bg-sky-100 text-sky-800 border-sky-200",
  Brooklyn: "bg-orange-100 text-orange-800 border-orange-200",
  Queens: "bg-teal-100 text-teal-800 border-teal-200",
  Bronx: "bg-violet-100 text-violet-800 border-violet-200",
  "Staten Island": "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function BoroughBadge({ borough }: { borough: Borough }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BOROUGH_BADGE[borough]}`}
    >
      {borough}
    </span>
  );
}

type Props = {
  listing: Listing;
  active: boolean;
  selected: boolean;
  selectionFull: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
  onToggleCompare: (id: string) => void;
};

export function ListingCard({
  listing,
  active,
  selected,
  selectionFull,
  onHover,
  onClick,
  onToggleCompare,
}: Props) {
  const photo = listing.photos?.[0];
  const compareDisabled = !selected && selectionFull;
  return (
    <Card
      onMouseEnter={() => onHover(listing.listing_id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(listing.listing_id)}
      className={`cursor-pointer overflow-hidden border-border/70 bg-card p-0 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
        active ? "ring-2 ring-primary shadow-lg" : ""
      } ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <CardContent className="flex gap-3 p-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={listing.title}
            className="h-24 w-32 flex-none rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-24 w-32 flex-none rounded-md bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-lg font-bold tabular-nums text-primary">
              {formatPrice(listing.price)}
            </div>
            <BoroughBadge borough={listing.borough} />
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {listing.address ?? `${listing.city}, ${listing.zip}`}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Bed className="h-3.5 w-3.5" />
              {listing.beds === 0 ? "studio" : `${listing.beds} bd`}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bath className="h-3.5 w-3.5" />
              {listing.baths} ba
            </span>
            <span className="inline-flex items-center gap-1">
              <Train className="h-3.5 w-3.5" />
              {listing.nearest_subway}
              <span className="text-[10px] tabular-nums">
                ({formatDistance(listing.subway_distance_m)})
              </span>
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/listing/${encodeURIComponent(listing.listing_id)}`}
              onClick={(e) => e.stopPropagation()}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              Research
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!compareDisabled) onToggleCompare(listing.listing_id);
              }}
              disabled={compareDisabled}
              aria-pressed={selected}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              } ${
                compareDisabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer"
              }`}
              title={
                compareDisabled
                  ? "Already comparing 4 listings"
                  : selected
                    ? "Remove from compare"
                    : "Add to compare"
              }
            >
              {selected ? (
                <>
                  <Check className="h-3 w-3" />
                  Selected
                </>
              ) : (
                "Compare"
              )}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
