import { NextRequest, NextResponse } from "next/server";
import { fetchVolumes, type VolumePair } from "@/lib/services/volume-fetcher";
import { ALL_EXCHANGES, type Exchange } from "@/lib/types/opportunity";

// Same geo constraints as /api/opportunity — several exchanges block other regions.
export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"];

/**
 * Bounds the work of a single request. The client sends the table's pairs in
 * chunks so rows fill in progressively instead of waiting on one long call.
 */
const MAX_PAIRS_PER_REQUEST = 150;

const EXCHANGE_SET = new Set<string>(ALL_EXCHANGES);

/** Control characters, which have no place in a symbol and could split a URL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function parsePairs(raw: unknown): VolumePair[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const pairs: VolumePair[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { exchange, symbol } = item as Record<string, unknown>;
    if (typeof exchange !== "string" || typeof symbol !== "string" || !EXCHANGE_SET.has(exchange)) {
      continue;
    }
    // Deliberately not a charset whitelist: several venues list CJK-named meme
    // coins (龙虾USDT and friends), and rejecting non-ASCII would silently drop
    // them. volume-fetcher percent-encodes before building upstream URLs, so
    // bounding length and refusing control characters is enough here.
    if (!symbol || symbol.length > 64 || CONTROL_CHARS.test(symbol)) continue;
    const key = `${exchange}:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ exchange: exchange as Exchange, symbol });
    if (pairs.length >= MAX_PAIRS_PER_REQUEST) break;
  }
  return pairs;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pairs = parsePairs(body?.pairs);
    if (pairs.length === 0) {
      return NextResponse.json({ volumes: {} });
    }
    const volumes = await fetchVolumes(pairs);
    return NextResponse.json({ volumes });
  } catch (error) {
    console.error("[volume] request failed:", error);
    return NextResponse.json({ volumes: {}, error: "Failed to fetch volumes" }, { status: 200 });
  }
}
