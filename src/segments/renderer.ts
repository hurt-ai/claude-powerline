import path from "node:path";
import type { ClaudeHookData } from "../utils/claude";
import type { PowerlineColors } from "../themes";
import type { PowerlineConfig } from "../config/loader";
import type { BlockInfo } from "./block";
import { homedir } from "node:os";
import {
  getColorSupport,
  hexToAnsi,
  hexTo256Ansi,
  hexToBasicAnsi,
} from "../utils/colors";

/** Behind the even burn line — a reserve was built up. */
const PACE_UNDER_HEX = "#a6e3a1";
/** Ahead of it — the week is being overspent. */
const PACE_OVER_HEX = "#f38ba8";

/**
 * Which Claude account this statusline runs under, by CLAUDE_CONFIG_DIR.
 * ~/.claude (or unset) -> "1" (default/work); ~/.claude-second -> "2" (personal).
 * Other custom config dir -> "?".
 */
function accountLabel(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  const home = homedir();
  const dir = env ? (env.split(",")[0]?.trim() || "") : "";
  if (dir === "" || dir === path.join(home, ".claude")) return "1";
  if (dir === path.join(home, ".claude-second")) return "2";
  return "?";
}

export interface SegmentConfig {
  enabled: boolean;
}

export interface DirectorySegmentConfig extends SegmentConfig {
  showBasename?: boolean;
  style?: "full" | "fish" | "basename";
}

export interface GitSegmentConfig extends SegmentConfig {
  showSha?: boolean;
  showAheadBehind?: boolean;
  showWorkingTree?: boolean;
  showOperation?: boolean;
  showTag?: boolean;
  showTimeSinceCommit?: boolean;
  showStashCount?: boolean;
  showUpstream?: boolean;
  showRepoName?: boolean;
}

export interface UsageSegmentConfig extends SegmentConfig {
  type: "cost" | "tokens" | "both" | "breakdown";
  costSource?: "calculated" | "official";
}

export interface TmuxSegmentConfig extends SegmentConfig {}

export interface ContextSegmentConfig extends SegmentConfig {
  showPercentageOnly?: boolean;
  warningThreshold?: number;
}

export interface MetricsSegmentConfig extends SegmentConfig {
  showResponseTime?: boolean;
  showLastResponseTime?: boolean;
  showDuration?: boolean;
  showMessageCount?: boolean;
  showLinesAdded?: boolean;
  showLinesRemoved?: boolean;
}

export interface BlockSegmentConfig extends SegmentConfig {
  type: "cost" | "tokens" | "both" | "time" | "weighted";
  burnType?: "cost" | "tokens" | "both" | "none";
}

export interface TodaySegmentConfig extends SegmentConfig {
  type: "cost" | "tokens" | "both" | "breakdown";
}

export interface WeekSegmentConfig extends SegmentConfig {
  type: "cost" | "tokens" | "both" | "breakdown";
}

export interface RateLimitSegmentConfig extends SegmentConfig {
  show5h?: boolean;
  show7d?: boolean;
  show7dSonnet?: boolean;
  showTimeRemaining?: boolean;
}

export interface VersionSegmentConfig extends SegmentConfig {}

export type AnySegmentConfig =
  | SegmentConfig
  | DirectorySegmentConfig
  | GitSegmentConfig
  | UsageSegmentConfig
  | TmuxSegmentConfig
  | ContextSegmentConfig
  | MetricsSegmentConfig
  | BlockSegmentConfig
  | TodaySegmentConfig
  | WeekSegmentConfig
  | RateLimitSegmentConfig
  | VersionSegmentConfig;

import {
  formatCost,
  formatTokens,
  formatTokenBreakdown,
  formatTimeSince,
  formatDuration,
  formatTimeUntil,
  formatWeekPace,
} from "../utils/formatters";
import { getBudgetStatus } from "../utils/budget";
import type {
  UsageInfo,
  TokenBreakdown,
  GitInfo,
  ContextInfo,
  MetricsInfo,
} from ".";
import type { TodayInfo } from "./today";
import type { WeekInfo } from "./week";
import type { RateLimitInfo } from "./rate-limit";

export interface PowerlineSymbols {
  right: string;
  left: string;
  branch: string;
  model: string;
  git_clean: string;
  git_dirty: string;
  git_conflicts: string;
  git_ahead: string;
  git_behind: string;
  git_worktree: string;
  git_tag: string;
  git_sha: string;
  git_upstream: string;
  git_stash: string;
  git_time: string;
  session_cost: string;
  block_cost: string;
  today_cost: string;
  week_cost: string;
  context_time: string;
  metrics_response: string;
  metrics_last_response: string;
  metrics_duration: string;
  metrics_messages: string;
  metrics_lines_added: string;
  metrics_lines_removed: string;
  metrics_burn: string;
  version: string;
  rate_limit_5h: string;
  rate_limit_7d: string;
}

export interface SegmentData {
  text: string;
  bgColor: string;
  fgColor: string;
}

export class SegmentRenderer {
  constructor(
    private readonly config: PowerlineConfig,
    private readonly symbols: PowerlineSymbols
  ) {}

  renderDirectory(
    hookData: ClaudeHookData,
    colors: PowerlineColors,
    config?: DirectorySegmentConfig
  ): SegmentData {
    const currentDir = hookData.workspace?.current_dir || hookData.cwd || "/";
    const projectDir = hookData.workspace?.project_dir;

    const style = config?.style ?? (config?.showBasename ? "basename" : "full");

    if (style === "basename") {
      const basename = path.basename(currentDir) || "root";
      return {
        text: basename,
        bgColor: colors.modeBg,
        fgColor: colors.modeFg,
      };
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE;
    let displayDir = currentDir;
    let displayProjectDir = projectDir;

    if (homeDir) {
      if (currentDir.startsWith(homeDir)) {
        displayDir = currentDir.replace(homeDir, "~");
      }
      if (projectDir && projectDir.startsWith(homeDir)) {
        displayProjectDir = projectDir.replace(homeDir, "~");
      }
    }

    let dirName = this.getDisplayDirectoryName(displayDir, displayProjectDir);

    if (style === "fish") {
      dirName = this.abbreviateFishStyle(dirName);
    }

    return {
      text: dirName,
      bgColor: colors.modeBg,
      fgColor: colors.modeFg,
    };
  }

  renderGit(
    gitInfo: GitInfo,
    colors: PowerlineColors,
    config?: GitSegmentConfig
  ): SegmentData | null {
    if (!gitInfo) return null;

    const parts: string[] = [];

    if (config?.showRepoName && gitInfo.repoName) {
      parts.push(gitInfo.repoName);
      if (gitInfo.isWorktree) {
        parts.push(this.symbols.git_worktree);
      }
    }

    if (config?.showOperation && gitInfo.operation) {
      parts.push(`[${gitInfo.operation}]`);
    }

    parts.push(`${this.symbols.branch} ${gitInfo.branch}`);

    if (config?.showTag && gitInfo.tag) {
      parts.push(`${this.symbols.git_tag} ${gitInfo.tag}`);
    }

    if (config?.showSha && gitInfo.sha) {
      parts.push(`${this.symbols.git_sha} ${gitInfo.sha}`);
    }

    if (config?.showAheadBehind !== false) {
      if (gitInfo.ahead > 0 && gitInfo.behind > 0) {
        parts.push(
          `${this.symbols.git_ahead}${gitInfo.ahead}${this.symbols.git_behind}${gitInfo.behind}`
        );
      } else if (gitInfo.ahead > 0) {
        parts.push(`${this.symbols.git_ahead}${gitInfo.ahead}`);
      } else if (gitInfo.behind > 0) {
        parts.push(`${this.symbols.git_behind}${gitInfo.behind}`);
      }
    }

    if (config?.showWorkingTree) {
      const counts: string[] = [];
      if (gitInfo.staged && gitInfo.staged > 0)
        counts.push(`+${gitInfo.staged}`);
      if (gitInfo.unstaged && gitInfo.unstaged > 0)
        counts.push(`~${gitInfo.unstaged}`);
      if (gitInfo.untracked && gitInfo.untracked > 0)
        counts.push(`?${gitInfo.untracked}`);
      if (gitInfo.conflicts && gitInfo.conflicts > 0)
        counts.push(`!${gitInfo.conflicts}`);
      if (counts.length > 0) {
        parts.push(`(${counts.join(" ")})`);
      }
    }

    if (config?.showUpstream && gitInfo.upstream) {
      parts.push(`${this.symbols.git_upstream}${gitInfo.upstream}`);
    }

    if (
      config?.showStashCount &&
      gitInfo.stashCount &&
      gitInfo.stashCount > 0
    ) {
      parts.push(`${this.symbols.git_stash} ${gitInfo.stashCount}`);
    }

    if (config?.showTimeSinceCommit && gitInfo.timeSinceCommit !== undefined) {
      const time = formatTimeSince(gitInfo.timeSinceCommit);
      parts.push(`${this.symbols.git_time} ${time}`);
    }

    let gitStatusIcon = this.symbols.git_clean;
    if (gitInfo.status === "conflicts") {
      gitStatusIcon = this.symbols.git_conflicts;
    } else if (gitInfo.status === "dirty") {
      gitStatusIcon = this.symbols.git_dirty;
    }
    parts.push(gitStatusIcon);

    return {
      text: parts.join(" "),
      bgColor: colors.gitBg,
      fgColor: colors.gitFg,
    };
  }

  renderModel(hookData: ClaudeHookData, colors: PowerlineColors): SegmentData {
    const modelName = hookData.model?.display_name || "Claude";

    return {
      text: `${accountLabel()} ${this.symbols.model} ${modelName}`,
      bgColor: colors.modelBg,
      fgColor: colors.modelFg,
    };
  }

  renderSession(
    usageInfo: UsageInfo,
    colors: PowerlineColors,
    config?: UsageSegmentConfig
  ): SegmentData {
    const type = config?.type || "cost";
    const costSource = config?.costSource;
    const sessionBudget = this.config.budget?.session;

    const getCost = () => {
      if (costSource === "calculated") return usageInfo.session.calculatedCost;
      if (costSource === "official") return usageInfo.session.officialCost;
      return usageInfo.session.cost;
    };

    const formattedUsage = this.formatUsageWithBudget(
      getCost(),
      usageInfo.session.tokens,
      usageInfo.session.tokenBreakdown,
      type,
      sessionBudget?.amount,
      sessionBudget?.warningThreshold || 80,
      sessionBudget?.type
    );

    const text = `${this.symbols.session_cost} ${formattedUsage}`;

    return {
      text,
      bgColor: colors.sessionBg,
      fgColor: colors.sessionFg,
    };
  }

  renderTmux(
    sessionId: string | null,
    colors: PowerlineColors
  ): SegmentData | null {
    if (!sessionId) {
      return {
        text: `tmux:none`,
        bgColor: colors.tmuxBg,
        fgColor: colors.tmuxFg,
      };
    }

    return {
      text: `tmux:${sessionId}`,
      bgColor: colors.tmuxBg,
      fgColor: colors.tmuxFg,
    };
  }

  renderContext(
    contextInfo: ContextInfo | null,
    colors: PowerlineColors,
    config?: ContextSegmentConfig
  ): SegmentData | null {
    if (!contextInfo) {
      return {
        text: `${this.symbols.context_time} 0 (0%)`,
        bgColor: colors.contextBg,
        fgColor: colors.contextFg,
      };
    }

    const contextUsed = `${contextInfo.percentage}%`;
    const warningThreshold = config?.warningThreshold ?? 100;
    const isWarning = contextInfo.percentage >= warningThreshold;

    const text = config?.showPercentageOnly
      ? `${this.symbols.context_time} ${contextUsed}`
      : `${this.symbols.context_time} ${contextInfo.inputTokens.toLocaleString()} (${contextUsed})`;

    return {
      text,
      bgColor: isWarning ? colors.warningBg : colors.contextBg,
      fgColor: isWarning ? colors.warningFg : colors.contextFg,
    };
  }

  renderMetrics(
    metricsInfo: MetricsInfo | null,
    colors: PowerlineColors,
    _blockInfo: BlockInfo | null,
    config?: MetricsSegmentConfig
  ): SegmentData | null {
    if (!metricsInfo) {
      return {
        text: `${this.symbols.metrics_response} new`,
        bgColor: colors.metricsBg,
        fgColor: colors.metricsFg,
      };
    }

    const parts: string[] = [];

    if (config?.showLastResponseTime && metricsInfo.lastResponseTime !== null) {
      const lastResponseTime =
        metricsInfo.lastResponseTime < 60
          ? `${metricsInfo.lastResponseTime.toFixed(1)}s`
          : `${(metricsInfo.lastResponseTime / 60).toFixed(1)}m`;
      parts.push(`${this.symbols.metrics_last_response} ${lastResponseTime}`);
    }

    if (
      config?.showResponseTime !== false &&
      metricsInfo.responseTime !== null
    ) {
      const responseTime =
        metricsInfo.responseTime < 60
          ? `${metricsInfo.responseTime.toFixed(1)}s`
          : `${(metricsInfo.responseTime / 60).toFixed(1)}m`;
      parts.push(`${this.symbols.metrics_response} ${responseTime}`);
    }

    if (
      config?.showDuration !== false &&
      metricsInfo.sessionDuration !== null
    ) {
      const duration = formatDuration(metricsInfo.sessionDuration);
      parts.push(`${this.symbols.metrics_duration} ${duration}`);
    }

    if (
      config?.showMessageCount !== false &&
      metricsInfo.messageCount !== null
    ) {
      parts.push(
        `${this.symbols.metrics_messages} ${metricsInfo.messageCount}`
      );
    }

    if (
      config?.showLinesAdded !== false &&
      metricsInfo.linesAdded !== null &&
      metricsInfo.linesAdded > 0
    ) {
      parts.push(
        `${this.symbols.metrics_lines_added} ${metricsInfo.linesAdded}`
      );
    }

    if (
      config?.showLinesRemoved !== false &&
      metricsInfo.linesRemoved !== null &&
      metricsInfo.linesRemoved > 0
    ) {
      parts.push(
        `${this.symbols.metrics_lines_removed} ${metricsInfo.linesRemoved}`
      );
    }

    if (parts.length === 0) {
      return {
        text: `${this.symbols.metrics_response} active`,
        bgColor: colors.metricsBg,
        fgColor: colors.metricsFg,
      };
    }

    return {
      text: parts.join(" "),
      bgColor: colors.metricsBg,
      fgColor: colors.metricsFg,
    };
  }

  renderBlock(
    blockInfo: BlockInfo,
    colors: PowerlineColors,
    config?: BlockSegmentConfig
  ): SegmentData {
    let displayText: string;

    if (blockInfo.cost === null && blockInfo.tokens === null) {
      displayText = "No active block";
    } else {
      const type = config?.type || "cost";
      const burnType = config?.burnType;
      const blockBudget = this.config.budget?.block;

      const timeStr =
        blockInfo.timeRemaining !== null
          ? (() => {
              const hours = Math.floor(blockInfo.timeRemaining / 60);
              const minutes = blockInfo.timeRemaining % 60;
              return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            })()
          : null;

      let mainContent: string;
      switch (type) {
        case "cost":
          mainContent = this.formatUsageWithBudget(
            blockInfo.cost,
            null,
            null,
            "cost",
            blockBudget?.amount,
            blockBudget?.warningThreshold,
            blockBudget?.type
          );
          break;
        case "tokens":
          mainContent = this.formatUsageWithBudget(
            null,
            blockInfo.tokens,
            null,
            "tokens",
            blockBudget?.amount,
            blockBudget?.warningThreshold,
            blockBudget?.type
          );
          break;
        case "weighted":
          const rateLimit =
            blockBudget?.type === "tokens" ? blockBudget.amount : undefined;
          const weightedDisplay = formatTokens(blockInfo.weightedTokens);
          if (rateLimit && blockInfo.weightedTokens !== null) {
            const rateLimitStatus = getBudgetStatus(
              blockInfo.weightedTokens,
              rateLimit,
              blockBudget?.warningThreshold || 80
            );
            mainContent = `${weightedDisplay}${rateLimitStatus.displayText}`;
          } else {
            mainContent = `${weightedDisplay} (weighted)`;
          }
          break;
        case "both":
          mainContent = this.formatUsageWithBudget(
            blockInfo.cost,
            blockInfo.tokens,
            null,
            "both",
            blockBudget?.amount,
            blockBudget?.warningThreshold,
            blockBudget?.type
          );
          break;
        case "time":
          mainContent = timeStr || "N/A";
          break;
        default:
          mainContent = this.formatUsageWithBudget(
            blockInfo.cost,
            null,
            null,
            "cost",
            blockBudget?.amount,
            blockBudget?.warningThreshold,
            blockBudget?.type
          );
      }

      let burnContent = "";
      if (burnType && burnType !== "none") {
        switch (burnType) {
          case "cost":
            const costBurnRate =
              blockInfo.burnRate !== null
                ? blockInfo.burnRate < 1
                  ? `${(blockInfo.burnRate * 100).toFixed(0)}¢/h`
                  : `$${blockInfo.burnRate.toFixed(2)}/h`
                : "N/A";
            burnContent = ` | ${costBurnRate}`;
            break;
          case "tokens":
            const tokenBurnRate =
              blockInfo.tokenBurnRate !== null
                ? `${formatTokens(Math.round(blockInfo.tokenBurnRate))}/h`
                : "N/A";
            burnContent = ` | ${tokenBurnRate}`;
            break;
          case "both":
            const costBurn =
              blockInfo.burnRate !== null
                ? blockInfo.burnRate < 1
                  ? `${(blockInfo.burnRate * 100).toFixed(0)}¢/h`
                  : `$${blockInfo.burnRate.toFixed(2)}/h`
                : "N/A";
            const tokenBurn =
              blockInfo.tokenBurnRate !== null
                ? `${formatTokens(Math.round(blockInfo.tokenBurnRate))}/h`
                : "N/A";
            burnContent = ` | ${costBurn} / ${tokenBurn}`;
            break;
        }
      }

      if (type === "time") {
        displayText = mainContent;
      } else {
        displayText = timeStr
          ? `${mainContent}${burnContent} (${timeStr} left)`
          : `${mainContent}${burnContent}`;
      }
    }

    return {
      text: `${this.symbols.block_cost} ${displayText}`,
      bgColor: colors.blockBg,
      fgColor: colors.blockFg,
    };
  }

  renderToday(
    todayInfo: TodayInfo,
    colors: PowerlineColors,
    type = "cost"
  ): SegmentData {
    const todayBudget = this.config.budget?.today;
    const text = `${this.symbols.today_cost} ${this.formatUsageWithBudget(
      todayInfo.cost,
      todayInfo.tokens,
      todayInfo.tokenBreakdown,
      type,
      todayBudget?.amount,
      todayBudget?.warningThreshold,
      todayBudget?.type
    )}`;

    return {
      text,
      bgColor: colors.todayBg,
      fgColor: colors.todayFg,
    };
  }

  renderWeek(
    weekInfo: WeekInfo,
    colors: PowerlineColors,
    type = "cost"
  ): SegmentData {
    const weekBudget = this.config.budget?.week;
    const text = `${this.symbols.week_cost} ${this.formatUsageWithBudget(
      weekInfo.cost,
      weekInfo.tokens,
      weekInfo.tokenBreakdown,
      type,
      weekBudget?.amount,
      weekBudget?.warningThreshold,
      weekBudget?.type
    )}`;

    return {
      text,
      bgColor: colors.weekBg || colors.todayBg,
      fgColor: colors.weekFg || colors.todayFg,
    };
  }

  renderRateLimit(
    rateLimitInfo: RateLimitInfo,
    colors: PowerlineColors,
    config?: RateLimitSegmentConfig
  ): SegmentData[] {
    const segments: SegmentData[] = [];
    const show5h = config?.show5h !== false;
    const show7d = config?.show7d !== false;
    const showTime = config?.showTimeRemaining !== false;

    // 5h session limit
    if (show5h && rateLimitInfo.session !== null) {
      const pct = Math.round(rateLimitInfo.session);
      const timeLeft = showTime ? formatTimeUntil(rateLimitInfo.sessionResetsAt) : null;
      const text = timeLeft
        ? `${this.symbols.rate_limit_5h} ${pct}% (${timeLeft})`
        : `${this.symbols.rate_limit_5h} ${pct}%`;
      segments.push({
        text,
        bgColor: colors.rateLimitBg || colors.modelBg,
        fgColor: colors.rateLimitFg || colors.modelFg,
      });
    }

    // 7d week limit
    if (show7d && rateLimitInfo.week !== null) {
      const pct = Math.round(rateLimitInfo.week);
      const timeLeft = showTime ? formatTimeUntil(rateLimitInfo.weekResetsAt) : null;
      const pace = formatWeekPace(rateLimitInfo.week, rateLimitInfo.weekResetsAt);
      const segFg = colors.rateLimitFg || colors.modelFg;
      const head = pace
        ? `${this.symbols.rate_limit_7d} ${pct}% ${this.colorizePace(pace, segFg)}`
        : `${this.symbols.rate_limit_7d} ${pct}%`;
      const text = timeLeft ? `${head} (${timeLeft})` : head;
      segments.push({
        text,
        bgColor: colors.rateLimitBg || colors.modelBg,
        fgColor: colors.rateLimitFg || colors.modelFg,
      });
    }

    return segments;
  }

  /**
   * The pace digit is the only part of a segment that carries a colour of its own.
   *
   * The value it returns to is `segFg` VERBATIM, never a re-conversion of it. Fields of
   * PowerlineColors are ALREADY ANSI strings — powerline.ts builds them through hexToAnsi
   * before the renderer ever sees them. Feeding one back in parses "\x1b[38;2;125;78;0m" as a
   * hex triple: `parseInt("[3", 16)` is NaN, and out comes `\x1b[38;2;NaN;8;2m`, which the
   * terminal cannot read and prints as text. That also widened the line, because stripAnsi
   * only removes `ESC[<digits and ;>m` and a sequence with letters in it counts as visible
   * characters. Caught on screen 2026-08-26, across all three accounts at once.
   *
   * The colour comes through the same colorSupport fork as the rest of the line (the idiom is
   * powerline.ts:formatSegment): a truecolor escape on a terminal that cannot read one is the
   * same garbage by another route. Where there is no colour at all the digit stays plain — a
   * single escape in an otherwise escape-free line is worse than no colour.
   *
   * The ARROW decides, not the sign. Below PACE_MIN_ELAPSED formatWeekPace returns the gap
   * without an arrow, and exactly on the line `delta = 0` renders as `↓`. Reading the sign
   * would colour the first case and mis-colour the second.
   */
  private colorizePace(pace: string, segFg: string): string {
    const hex = pace.includes("↑")
      ? PACE_OVER_HEX
      : pace.includes("↓")
        ? PACE_UNDER_HEX
        : null;
    if (!hex) return pace;

    const colorMode = this.config.display.colorCompatibility || "auto";
    const colorSupport = colorMode === "auto" ? getColorSupport() : colorMode;
    if (colorSupport === "none") return pace;

    const toAnsi =
      colorSupport === "ansi"
        ? hexToBasicAnsi
        : colorSupport === "ansi256"
          ? hexTo256Ansi
          : hexToAnsi;

    return `${toAnsi(hex, false)}${pace}${segFg}`;
  }

  private getDisplayDirectoryName(
    currentDir: string,
    projectDir?: string
  ): string {
    if (currentDir.startsWith("~")) {
      return currentDir;
    }

    if (projectDir && projectDir !== currentDir) {
      if (currentDir.startsWith(projectDir)) {
        const relativePath = currentDir.slice(projectDir.length + 1);
        return relativePath || path.basename(projectDir) || "project";
      }
      return path.basename(currentDir) || "root";
    }

    return path.basename(currentDir) || "root";
  }

  private abbreviateFishStyle(dirPath: string): string {
    const parts = dirPath.split(path.sep);
    return parts
      .map((part, index) => {
        if (index === parts.length - 1) return part;
        if (part === "~" || part === "") return part;
        return part.charAt(0);
      })
      .join(path.sep);
  }

  private formatUsageDisplay(
    cost: number | null,
    tokens: number | null,
    tokenBreakdown: TokenBreakdown | null,
    type: string
  ): string {
    switch (type) {
      case "cost":
        return formatCost(cost);
      case "tokens":
        return formatTokens(tokens);
      case "both":
        return `${formatCost(cost)} (${formatTokens(tokens)})`;
      case "breakdown":
        return formatTokenBreakdown(tokenBreakdown);
      default:
        return formatCost(cost);
    }
  }


  private formatUsageWithBudget(
    cost: number | null,
    tokens: number | null,
    tokenBreakdown: TokenBreakdown | null,
    type: string,
    budget: number | undefined,
    warningThreshold = 80,
    budgetType?: "cost" | "tokens"
  ): string {
    const baseDisplay = this.formatUsageDisplay(
      cost,
      tokens,
      tokenBreakdown,
      type
    );

    if (budget && budget > 0) {
      let budgetValue: number | null = null;

      if (budgetType === "tokens" && tokens !== null) {
        budgetValue = tokens;
      } else if (budgetType === "cost" && cost !== null) {
        budgetValue = cost;
      } else if (!budgetType && cost !== null) {
        budgetValue = cost;
      }

      if (budgetValue !== null) {
        const budgetStatus = getBudgetStatus(
          budgetValue,
          budget,
          warningThreshold
        );
        return baseDisplay + budgetStatus.displayText;
      }
    }

    return baseDisplay;
  }

  renderVersion(
    hookData: ClaudeHookData,
    colors: PowerlineColors,
    _config?: VersionSegmentConfig
  ): SegmentData | null {
    if (!hookData.version) {
      return null;
    }

    return {
      text: `${this.symbols.version} v${hookData.version}`,
      bgColor: colors.versionBg,
      fgColor: colors.versionFg,
    };
  }
}
