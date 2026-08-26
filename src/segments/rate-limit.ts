import { getCredentials } from "../utils/credentials";
import { debug } from "../utils/logger";
import { CacheManager } from "../utils/cache";

const API_TIMEOUT_MS = 5000;

export interface UsageLimits {
  five_hour: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day: {
    utilization: number;
    resets_at: string | null;
  } | null;
  seven_day_sonnet: {
    utilization: number;
    resets_at: string | null;
  } | null;
}

export interface RateLimitInfo {
  session: number | null; // 5h utilization %
  sessionResetsAt: string | null;
  week: number | null; // 7d utilization %
  weekResetsAt: string | null;
  weekSonnet: number | null;
  weekSonnetResetsAt: string | null;
}

/**
 * Two-level cache, and the disk level is the one that matters.
 *
 * The status line is a NEW PROCESS on every repaint, so an in-memory cache is empty on every
 * repaint too: it never survives to be hit. That made a live HTTP call mandatory per repaint, and
 * any failed call rendered BOTH windows as null — so the whole segment vanished from the line
 * instead of showing a slightly older number. That is the disappearing rate limit.
 *
 * On disk the entry survives across processes and across accounts' own config dirs, so a repaint
 * inside the TTL costs no network at all, and a failed fetch falls back to the last known value.
 */
const CACHE_TYPE = "rate-limit" as const;

interface CachedRateLimits {
  limits: UsageLimits;
  fetchedAt: number;
}

let cachedLimits: UsageLimits | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 60 seconds

export class RateLimitProvider {
  async getRateLimitInfo(): Promise<RateLimitInfo> {
    try {
      const limits = await this.fetchUsageLimits();

      if (!limits) {
        return {
          session: null,
          sessionResetsAt: null,
          week: null,
          weekResetsAt: null,
          weekSonnet: null,
          weekSonnetResetsAt: null,
        };
      }

      return {
        session: limits.five_hour?.utilization ?? null,
        sessionResetsAt: limits.five_hour?.resets_at ?? null,
        week: limits.seven_day?.utilization ?? null,
        weekResetsAt: limits.seven_day?.resets_at ?? null,
        weekSonnet: limits.seven_day_sonnet?.utilization ?? null,
        weekSonnetResetsAt: limits.seven_day_sonnet?.resets_at ?? null,
      };
    } catch (error) {
      debug("Error getting rate limit info:", error);
      return {
        session: null,
        sessionResetsAt: null,
        week: null,
        weekResetsAt: null,
        weekSonnet: null,
        weekSonnetResetsAt: null,
      };
    }
  }

  private async readDiskCache(): Promise<CachedRateLimits | null> {
    try {
      const entry = await CacheManager.getUsageCache(CACHE_TYPE);
      if (entry && entry.limits && typeof entry.fetchedAt === "number") {
        return entry as CachedRateLimits;
      }
      return null;
    } catch (error) {
      debug("Failed to read rate limit disk cache:", error);
      return null;
    }
  }

  private async fetchUsageLimits(): Promise<UsageLimits | null> {
    const now = Date.now();
    if (cachedLimits && now - cacheTimestamp < CACHE_TTL_MS) {
      debug("Using in-memory rate limits");
      return cachedLimits;
    }

    // The disk entry is what actually survives between repaints. Kept even when stale: it is the
    // fallback every failure path below returns instead of null.
    const onDisk = await this.readDiskCache();
    if (onDisk && now - onDisk.fetchedAt < CACHE_TTL_MS) {
      cachedLimits = onDisk.limits;
      cacheTimestamp = onDisk.fetchedAt;
      debug("Using disk-cached rate limits");
      return onDisk.limits;
    }
    const stale = onDisk?.limits ?? cachedLimits;

    const token = getCredentials();
    if (!token) {
      debug("No OAuth token available");
      return stale;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "claude-powerline/1.0",
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        debug(`API response not ok: ${response.status}`);
        return stale;
      }

      const data = await response.json();

      const limits: UsageLimits = {
        five_hour: data.five_hour ?? null,
        seven_day: data.seven_day ?? null,
        seven_day_sonnet: data.seven_day_sonnet ?? null,
      };

      cachedLimits = limits;
      cacheTimestamp = now;
      const entry: CachedRateLimits = { limits, fetchedAt: now };
      await CacheManager.setUsageCache(CACHE_TYPE, entry, now);

      debug(
        `Rate limits fetched: 5h=${limits.five_hour?.utilization}%, 7d=${limits.seven_day?.utilization}%`
      );

      return limits;
    } catch (error) {
      debug("Failed to fetch usage limits:", error);
      return stale;
    }
  }
}
