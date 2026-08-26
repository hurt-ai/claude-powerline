import { readFileSync } from "node:fs";
import { debug } from "../utils/logger";
import { parseJsonlFile, type ParsedEntry, type ClaudeHookData } from "../utils/claude";
import type { PowerlineConfig } from "../config/loader";

export interface ContextInfo {
  inputTokens: number;
  percentage: number;
  usablePercentage: number;
  contextLeftPercentage: number;
  maxTokens: number;
  usableTokens: number;
}

interface ContextUsageThresholds {
  LOW: number;
  MEDIUM: number;
}

export class ContextProvider {
  private readonly thresholds: ContextUsageThresholds = {
    LOW: 50,
    MEDIUM: 80,
  };
  private readonly config: PowerlineConfig;

  constructor(config: PowerlineConfig) {
    this.config = config;
  }

  getContextUsageThresholds(): ContextUsageThresholds {
    return this.thresholds;
  }

  private getContextLimit(modelId: string): number {
    const modelLimits = this.config.modelContextLimits || { default: 200000 };
    const modelType = this.getModelType(modelId);
    return modelLimits[modelType] || modelLimits.default || 200000;
  }

  private getModelType(modelId: string): string {
    const id = modelId.toLowerCase();

    if (id.includes("sonnet")) {
      return "sonnet";
    }
    if (id.includes("opus")) {
      return "opus";
    }

    return "default";
  }

  private buildContextInfo(
    contextLength: number,
    contextLimit: number
  ): ContextInfo {
    // Don't cap at 100% - allow showing overflow
    const percentage = Math.max(0, Math.round((contextLength / contextLimit) * 100));
    const usablePercentage = percentage;
    const contextLeftPercentage = Math.max(0, 100 - usablePercentage);

    return {
      inputTokens: contextLength,
      percentage,
      usablePercentage,
      contextLeftPercentage,
      maxTokens: contextLimit,
      usableTokens: contextLimit,
    };
  }

  async calculateContextTokens(
    transcriptPath: string,
    modelId?: string,
    contextWindow?: ClaudeHookData["context_window"]
  ): Promise<ContextInfo | null> {
    // Use new API fields if available (Claude Code v2.1.6+)
    if (
      contextWindow &&
      typeof contextWindow.used_percentage === "number" &&
      contextWindow.context_window_size
    ) {
      const percentage = Math.floor(contextWindow.used_percentage);
      const contextLimit = contextWindow.context_window_size;
      const inputTokens = Math.round(
        (contextLimit * contextWindow.used_percentage) / 100
      );
      const remainingPercentage =
        contextWindow.remaining_percentage ?? 100 - percentage;

      debug(
        `Using API percentages: ${percentage}% used, ${remainingPercentage}% remaining`
      );

      return {
        inputTokens,
        percentage,
        usablePercentage: percentage,
        contextLeftPercentage: Math.max(0, remainingPercentage),
        maxTokens: contextLimit,
        usableTokens: contextLimit,
      };
    }

    // Fallback: Read from transcript (original approach)
    try {
      debug(`Calculating context tokens from transcript: ${transcriptPath}`);

      try {
        const content = readFileSync(transcriptPath, "utf-8");
        if (!content) {
          debug("Transcript file is empty");
          return null;
        }
      } catch {
        debug("Could not read transcript file");
        return null;
      }

      const parsedEntries = await parseJsonlFile(transcriptPath);

      if (parsedEntries.length === 0) {
        debug("No entries in transcript");
        return null;
      }

      let mostRecentEntry: ParsedEntry | null = null;

      for (let i = parsedEntries.length - 1; i >= 0; i--) {
        const entry = parsedEntries[i];
        if (!entry) continue;

        if (!entry.message?.usage?.input_tokens) continue;
        if (entry.isSidechain === true) continue;

        mostRecentEntry = entry;
        debug(
          `Context segment: Found most recent entry at ${entry.timestamp.toISOString()}, stopping search`
        );
        break;
      }

      if (mostRecentEntry?.message?.usage) {
        const usage = mostRecentEntry.message.usage;
        const contextLength =
          (usage.input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0);

        const contextLimit = modelId ? this.getContextLimit(modelId) : 200000;

        debug(
          `Most recent main chain context: ${contextLength} tokens (limit: ${contextLimit})`
        );

        return this.buildContextInfo(contextLength, contextLimit);
      }

      debug("No main chain entries with usage data found");
      return null;
    } catch (error) {
      debug(
        `Error reading transcript: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}
