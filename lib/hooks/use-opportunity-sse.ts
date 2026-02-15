"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Opportunity, OpportunityStats, CombinedFundingRate } from '@/lib/types/opportunity';

interface UseOpportunitySSEResult {
  opportunities: Opportunity[];
  stats: OpportunityStats | null;
  fundingRates: CombinedFundingRate[];
  connected: boolean;
  lastUpdate: Date | null;
  error: string | null;
  refresh: () => void;
  isLoading: boolean;
}

const POLL_INTERVAL = 30000; // 30 seconds

export function useOpportunitySSE(): UseOpportunitySSEResult {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [stats, setStats] = useState<OpportunityStats | null>(null);
  const [fundingRates, setFundingRates] = useState<CombinedFundingRate[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/opportunity');

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!isMountedRef.current) return;

      setOpportunities(data.opportunities);
      setStats(data.stats);
      setFundingRates(data.fundingRates);
      setLastUpdate(new Date());
      setConnected(true);
      setError(null);
      setIsLoading(false);
    } catch (e) {
      if (!isMountedRef.current) return;

      console.error('[Opportunity] Fetch error:', e);
      setConnected(false);
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    isMountedRef.current = true;

    // Initial fetch
    fetchData();

    // Set up polling
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData]);

  return {
    opportunities,
    stats,
    fundingRates,
    connected,
    lastUpdate,
    error,
    refresh,
    isLoading,
  };
}
