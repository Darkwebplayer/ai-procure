import { config } from "../config";
import type { VendorCandidate } from "../types";

interface GeocodeResponse {
  results?: Array<{
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

interface PlacesSearchResponse {
  results?: Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    rating?: number;
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

interface PlaceDetailsResponse {
  result?: {
    formatted_phone_number?: string;
    international_phone_number?: string;
    user_ratings_total?: number;
    reviews?: Array<{
      text?: string;
      rating?: number;
    }>;
  };
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
};

const normalizePhone = (value: string | undefined): string => {
  if (!value) return "";
  return value.replace(/[^+\d]/g, "");
};

export async function geocodeLocation(locationText: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", locationText);
  url.searchParams.set("key", config.googleMapsApiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocode failed: ${response.status}`);
  }

  const data = (await response.json()) as GeocodeResponse;
  const location = data.results?.[0]?.geometry?.location;
  return location ? { lat: location.lat, lng: location.lng } : null;
}

async function fetchPlaceDetails(placeId: string): Promise<{
  phone: string;
  reviewCount: number;
  reviewSnippets: string[];
}> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "formatted_phone_number,international_phone_number,user_ratings_total,reviews");
  url.searchParams.set("key", config.googleMapsApiKey);

  const response = await fetch(url);
  if (!response.ok) {
    return {
      phone: "",
      reviewCount: 0,
      reviewSnippets: []
    };
  }

  const data = (await response.json()) as PlaceDetailsResponse;
  const reviewSnippets = (data.result?.reviews ?? [])
    .map((review) => {
      const text = String(review.text ?? "")
        .replace(/\\s+/g, " ")
        .trim();
      if (!text) return "";
      const rating = typeof review.rating === "number" ? `${review.rating}/5` : "";
      return rating ? `${rating}: ${text}` : text;
    })
    .filter((text) => text.length > 0)
    .slice(0, 3);

  return {
    phone: normalizePhone(data.result?.international_phone_number ?? data.result?.formatted_phone_number),
    reviewCount: Number(data.result?.user_ratings_total ?? 0),
    reviewSnippets
  };
}

export async function discoverVendors(input: {
  searchQuery: string;
  locationText: string;
  limit: number;
}): Promise<VendorCandidate[]> {
  const center = await geocodeLocation(input.locationText);
  if (!center) {
    return [];
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${input.searchQuery} in ${input.locationText}`);
  url.searchParams.set("key", config.googleMapsApiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Places text search failed: ${response.status}`);
  }

  const data = (await response.json()) as PlacesSearchResponse;
  const candidates = data.results ?? [];

  const output: VendorCandidate[] = [];

  for (const row of candidates.slice(0, input.limit * 2)) {
    const lat = row.geometry?.location?.lat;
    const lng = row.geometry?.location?.lng;
    if (lat === undefined || lng === undefined) continue;

    const details = await fetchPlaceDetails(row.place_id);
    if (!details.phone) continue;

    output.push({
      placeId: row.place_id,
      name: row.name,
      phone: details.phone,
      address: row.formatted_address ?? "",
      rating: row.rating ?? 0,
      reviewCount: details.reviewCount,
      reviewSnippets: details.reviewSnippets,
      lat,
      lng,
      distanceKm: Number(haversineKm(center.lat, center.lng, lat, lng).toFixed(2))
    });

    if (output.length >= input.limit) break;
  }

  return output;
}
