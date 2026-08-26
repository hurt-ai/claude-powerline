import { debug } from "../utils/logger";
import { PricingService } from "./pricing";
import { CacheManager } from "../utils/cache";
import { loadEntriesFromProjects, type ParsedEntry } from "../utils/claude";
import type { TokenBreakdown } from "./session";

export interface WeekUsageEntry {
  timestamp: Date;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUSD: number;
  model: string;
}

export interface WeekInfo {
  cost: number | null;
  tokens: number | null;
  tokenBreakdown: TokenBreakdown | null;
  weekStart: string;
  weekEnd: string;
  daysRemaining: number;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekBounds(): { start: Date; end: Date; daysRemaining: number } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  // Week starts on Monday (1), ends on Sunday (0)
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // Days remaining including today
  const daysRemaining = 7 - daysToMonday - (dayOfWeek === 0 ? 0 : 0);

  return { start: weekStart, end: weekEnd, daysRemaining: Math.max(1, 7 - daysToMonday) };
}

function getTotalTokens(usage: WeekUsageEntry["usage"]): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}

function convertToWeekEntry(entry: ParsedEntry): WeekUsageEntry {
  return {
    timestamp: entry.timestamp,
    usage: {
      inputTokens: entry.message?.usage?.input_tokens || 0,
      outputTokens: entry.message?.usage?.output_tokens || 0,
      cacheCreationInputTokens:
        entry.message?.usage?.cache_creation_input_tokens || 0,
      cacheReadInputTokens: entry.message?.usage?.cache_read_input_tokens || 0,
    },
    costUSD: entry.costUSD || 0,
    model: entry.message?.model || "unknown",
  };
}

export class WeekProvider {
  private async loadWeekEntries(): Promise<WeekUsageEntry[]> {
    const { start: weekStart, end: weekEnd } = getWeekBounds();
    const weekStartStr = formatDate(weekStart);

    debug(`Week segment: Loading entries for week starting ${weekStartStr}`);

    const latestMtime = await CacheManager.getLatestTranscriptMtime();

    const sharedCached = await CacheManager.getUsageCache("week", latestMtime);
    if (sharedCached) {
      debug("Using shared week usage cache");
      return sharedCached;
    }

    // Load files from last 8 days to ensure we get full week
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    eightDaysAgo.setHours(0, 0, 0, 0);

    const fileFilter = (_filePath: string, modTime: Date): boolean => {
      return modTime >= eightDaysAgo;
    };

    const timeFilter = (entry: ParsedEntry): boolean => {
      return entry.timestamp >= weekStart && entry.timestamp <= weekEnd;
    };

    const parsedEntries = await loadEntriesFromProjects(
      timeFilter,
      fileFilter,
      true
    );
    const weekEntries: WeekUsageEntry[] = [];

    let entriesFound = 0;

    for (const entry of parsedEntries) {
      if (entry.message?.usage) {
        const weekEntry = convertToWeekEntry(entry);

        if (!weekEntry.costUSD && entry.raw) {
          weekEntry.costUSD = await PricingService.calculateCostForEntry(
            entry.raw
          );
        }

        weekEntries.push(weekEntry);
        entriesFound++;
      }
    }

    debug(
      `Week segment: Found ${entriesFound} entries for this week (${weekStartStr})`
    );

    await CacheManager.setUsageCache("week", weekEntries, latestMtime);

    return weekEntries;
  }

  private async getWeekEntries(): Promise<WeekUsageEntry[]> {
    try {
      return await this.loadWeekEntries();
    } catch (error) {
      debug("Error loading week's entries:", error);
      return [];
    }
  }

  async getWeekInfo(): Promise<WeekInfo> {
    try {
      const entries = await this.getWeekEntries();
      const { start: weekStart, end: weekEnd, daysRemaining } = getWeekBounds();

      if (entries.length === 0) {
        return {
          cost: null,
          tokens: null,
          tokenBreakdown: null,
          weekStart: formatDate(weekStart),
          weekEnd: formatDate(weekEnd),
          daysRemaining,
        };
      }

      const totalCost = entries.reduce((sum, entry) => sum + entry.costUSD, 0);
      const totalTokens = entries.reduce(
        (sum, entry) => sum + getTotalTokens(entry.usage),
        0
      );

      const tokenBreakdown = entries.reduce(
        (breakdown, entry) => ({
          input: breakdown.input + entry.usage.inputTokens,
          output: breakdown.output + entry.usage.outputTokens,
          cacheCreation:
            breakdown.cacheCreation + entry.usage.cacheCreationInputTokens,
          cacheRead: breakdown.cacheRead + entry.usage.cacheReadInputTokens,
        }),
        {
          input: 0,
          output: 0,
          cacheCreation: 0,
          cacheRead: 0,
        }
      );

      debug(
        `Week segment: $${totalCost.toFixed(2)}, ${totalTokens} tokens total`
      );

      return {
        cost: totalCost,
        tokens: totalTokens,
        tokenBreakdown,
        weekStart: formatDate(weekStart),
        weekEnd: formatDate(weekEnd),
        daysRemaining,
      };
    } catch (error) {
      debug("Error getting week's info:", error);
      const { start: weekStart, end: weekEnd, daysRemaining } = getWeekBounds();
      return {
        cost: null,
        tokens: null,
        tokenBreakdown: null,
        weekStart: formatDate(weekStart),
        weekEnd: formatDate(weekEnd),
        daysRemaining,
      };
    }
  }
}
