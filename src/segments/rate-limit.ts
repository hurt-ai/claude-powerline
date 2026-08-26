import { getCredentials } from "../utils/credentials";
import { debug } from "../utils/logger";

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

// In-memory cache
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

  private async fetchUsageLimits(): Promise<UsageLimits | null> {
    // Check cache first
    const now = Date.now();
    if (cachedLimits && now - cacheTimestamp < CACHE_TTL_MS) {
      debug("Using cached rate limits");
      return cachedLimits;
    }

    const token = getCredentials();
    if (!token) {
      debug("No OAuth token available");
      return cachedLimits; // Return stale cache if available
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
        return cachedLimits;
      }

      const data = await response.json();

      const limits: UsageLimits = {
        five_hour: data.five_hour ?? null,
        seven_day: data.seven_day ?? null,
        seven_day_sonnet: data.seven_day_sonnet ?? null,
      };

      // Update cache
      cachedLimits = limits;
      cacheTimestamp = now;

      debug(
        `Rate limits fetched: 5h=${limits.five_hour?.utilization}%, 7d=${limits.seven_day?.utilization}%`
      );

      return limits;
    } catch (error) {
      debug("Failed to fetch usage limits:", error);
      return cachedLimits;
    }
  }
}
