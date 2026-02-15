import { NextResponse } from "next/server";
import { fetchAllFundingRates } from "@/lib/services/funding-fetcher";
import { detectOpportunities, calculateStats } from "@/lib/services/opportunity-detector";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Run this API route in Singapore region to avoid geo-blocking from exchanges
export const runtime = "edge";
export const preferredRegion = ["sin1", "hkg1", "kix1"]; // Singapore, Hong Kong, Osaka

export async function GET() {
  try {
    const fundingRates = await fetchAllFundingRates();
    const opportunities = detectOpportunities(fundingRates);
    const stats = calculateStats(opportunities);

    return NextResponse.json({
      opportunities,
      stats,
      fundingRates,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching opportunity data:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunity data" },
      { status: 500 }
    );
  }
}
