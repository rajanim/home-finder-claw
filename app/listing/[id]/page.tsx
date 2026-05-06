import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bed, Bath, MapPin, Train, Home as HomeIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PhotoCarousel } from "@/components/PhotoCarousel";
import { ResearchPanel } from "@/components/ResearchPanel";
import { getOpenSearch, Indexes } from "@/lib/opensearch";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchListing(id: string): Promise<Listing | null> {
  try {
    const client = getOpenSearch();
    const r = await client.get({ index: Indexes.listings, id });
    const body = (r as unknown as { body?: { _source?: Listing } }).body;
    return (
      body?._source ??
      ((r as unknown as { _source?: Listing })._source as Listing) ??
      null
    );
  } catch {
    return null;
  }
}

function formatPrice(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000)}k`;
  return `$${p}`;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await fetchListing(id);
  if (!listing) notFound();

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-border px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to search
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Listing detail</span>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Left column: photos + specs */}
        <div className="flex flex-col gap-4">
          <PhotoCarousel photos={listing.photos} alt={listing.title} />

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-3xl font-semibold tabular-nums">
                {formatPrice(listing.price)}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {listing.address ?? `${listing.city}, ${listing.zip}`}
              </div>
            </div>
            <Badge variant="secondary">{listing.borough}</Badge>
          </div>

          <SpecsGrid listing={listing} />

          {listing.description && (
            <div className="rounded-lg border bg-background p-4 text-sm leading-relaxed text-muted-foreground">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground/70">
                Description
              </div>
              {listing.description}
            </div>
          )}
        </div>

        {/* Right column: research panel */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <ResearchPanel listingId={listing.listing_id} />
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Brief is generated live by a planner-fetcher-synthesizer agent
            (Llama 3.3 70B planner, Llama 3.1 405B synthesizer) over OpenSearch
            data: 311 complaints, ZHVI price trend, schools, transit. If a
            data source returned nothing, the topic is omitted.
          </div>
        </div>
      </section>
    </main>
  );
}

function SpecsGrid({ listing }: { listing: Listing }) {
  const specs: Array<{ label: string; value: string; icon: React.ReactNode }> = [
    {
      label: "Bedrooms",
      value: listing.beds === 0 ? "Studio" : String(listing.beds),
      icon: <Bed className="h-4 w-4" />,
    },
    {
      label: "Bathrooms",
      value: String(listing.baths),
      icon: <Bath className="h-4 w-4" />,
    },
    {
      label: "Property type",
      value: listing.property_type,
      icon: <HomeIcon className="h-4 w-4" />,
    },
    {
      label: "ZIP",
      value: listing.zip,
      icon: <MapPin className="h-4 w-4" />,
    },
    {
      label: "Nearest subway",
      value: `${listing.nearest_subway} (${formatDistance(listing.subway_distance_m)})`,
      icon: <Train className="h-4 w-4" />,
    },
  ];
  if (listing.house_size_sqft) {
    specs.push({
      label: "Size",
      value: `${listing.house_size_sqft.toLocaleString()} sqft`,
      icon: <HomeIcon className="h-4 w-4" />,
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {specs.map((s) => (
        <div
          key={s.label}
          className="flex items-start gap-2 rounded-lg border bg-background p-3"
        >
          <div className="mt-0.5 text-muted-foreground">{s.icon}</div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
            <div className="truncate text-sm font-medium">{s.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
