"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bed, Bath, Train } from "lucide-react";
import type { Listing } from "@/lib/types";

function formatPrice(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000)}k`;
  return `$${p}`;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

type Props = {
  listing: Listing;
  active: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
};

export function ListingCard({ listing, active, onHover, onClick }: Props) {
  const photo = listing.photos?.[0];
  return (
    <Card
      onMouseEnter={() => onHover(listing.listing_id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(listing.listing_id)}
      className={`cursor-pointer overflow-hidden p-0 transition-shadow ${
        active ? "ring-2 ring-primary shadow-md" : "hover:shadow-md"
      }`}
    >
      <CardContent className="flex gap-3 p-3">
        {photo ? (
          // Using a regular img tag avoids next/image runtime config for
          // remote Unsplash URLs. Acceptable for the demo's small list.
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
            <div className="text-lg font-semibold tabular-nums">
              {formatPrice(listing.price)}
            </div>
            <Badge variant="secondary" className="text-xs">
              {listing.borough}
            </Badge>
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
        </div>
      </CardContent>
    </Card>
  );
}
