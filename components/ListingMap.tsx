"use client";

import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Listing } from "@/lib/types";

const NYC_CENTER: [number, number] = [-73.96, 40.72];

type Props = {
  listings: Listing[];
  activeId: string | null;
  onMarkerClick: (id: string) => void;
};

export function ListingMap({ listings, activeId, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const rawToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  // Mapbox GL JS only accepts public tokens. Reject sk.* up front so the
  // page does not crash if someone pastes a secret token by mistake.
  const tokenIsPublic = rawToken?.startsWith("pk.") ?? false;
  const token = tokenIsPublic ? rawToken : undefined;

  // Initialize map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!token) return;
    mapboxgl.accessToken = token;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: NYC_CENTER,
      zoom: 10.5,
      attributionControl: true,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, [token]);

  // Reconcile markers when listings change.
  const validListings = useMemo(
    () =>
      listings.filter(
        (l) =>
          l.location &&
          typeof l.location.lon === "number" &&
          typeof l.location.lat === "number",
      ),
    [listings],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const incoming = new Set(validListings.map((l) => l.listing_id));
    // Remove markers that are no longer in results.
    for (const [id, marker] of markersRef.current.entries()) {
      if (!incoming.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    // Add markers for new listings.
    for (const l of validListings) {
      if (markersRef.current.has(l.listing_id)) continue;
      const el = document.createElement("button");
      el.className =
        "rounded-full border-2 border-white shadow-md cursor-pointer transition-transform hover:scale-110";
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.background = "#0f172a";
      el.title = `${l.title} - $${l.price.toLocaleString()}`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onMarkerClick(l.listing_id);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([l.location.lon, l.location.lat])
        .addTo(map);
      markersRef.current.set(l.listing_id, marker);
    }

    // Fit bounds to results, but only when results change non-trivially.
    if (validListings.length >= 2) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const l of validListings)
        bounds.extend([l.location.lon, l.location.lat]);
      map.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 14 });
    } else if (validListings.length === 1) {
      map.flyTo({
        center: [validListings[0].location.lon, validListings[0].location.lat],
        zoom: 13,
        duration: 600,
      });
    }
  }, [validListings, onMarkerClick]);

  // Highlight active marker.
  useEffect(() => {
    for (const [id, marker] of markersRef.current.entries()) {
      const el = marker.getElement();
      if (id === activeId) {
        el.style.background = "#dc2626";
        el.style.width = "20px";
        el.style.height = "20px";
        el.style.zIndex = "10";
      } else {
        el.style.background = "#0f172a";
        el.style.width = "16px";
        el.style.height = "16px";
        el.style.zIndex = "";
      }
    }
  }, [activeId]);

  if (!token) {
    const reason = !rawToken
      ? "NEXT_PUBLIC_MAPBOX_TOKEN is not set in this environment."
      : "Mapbox GL needs a public token (pk.*). The current value looks like a secret token.";
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
        Map unavailable: {reason}
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full rounded-md" />;
}
