import { open, readFile } from "node:fs/promises";
import { debug } from "../utils/logger";
import { findTranscriptFile, ClaudeHookData } from "../utils/claude";

export interface MetricsInfo {
  responseTime: number | null;
  lastResponseTime: number | null;
  sessionDuration: number | null;
  messageCount: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  lastTokenSpeed: number | null;
}

interface TranscriptEntry {
  timestamp: string;
  type?: string;
  message?: {
    id?: string;
    role?: string;
    type?: string;
    content?: Array<{
      type?: string;
      [key: string]: any;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  isSidechain?: boolean;
}

export interface MetricsNeeds {
  /** Message count and last response time need every line of the transcript. */
  fullTranscript: boolean;
}

const TAIL_START_BYTES = 512 * 1024;
const TAIL_MAX_BYTES = 8 * 1024 * 1024;

function parseEntries(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as TranscriptEntry;
      if (entry.isSidechain === true) continue;
      entries.push(entry);
    } catch (parseError) {
      debug(`Failed to parse JSONL line: ${parseError}`);
    }
  }
  return entries;
}

export class MetricsProvider {
  private async loadTranscriptEntries(
    transcriptPath: string
  ): Promise<TranscriptEntry[]> {
    try {
      debug(`Loading transcript from: ${transcriptPath}`);
      const entries = parseEntries(await readFile(transcriptPath, "utf-8"));
      debug(`Loaded ${entries.length} transcript entries`);
      return entries;
    } catch (error) {
      debug(`Error loading transcript ${transcriptPath}:`, error);
      return [];
    }
  }

  /**
   * The last reply's speed needs only the end of the transcript, so a long session costs the
   * same as a short one. The window grows when the reply and its request do not fit in it
   * (a large tool result just before the reply).
   */
  private async loadTailTokenSpeed(transcriptPath: string): Promise<number | null> {
    let handle;
    try {
      handle = await open(transcriptPath, "r");
      const size = (await handle.stat()).size;
      for (let window = TAIL_START_BYTES; ; window *= 2) {
        const length = Math.min(window, size);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, size - length);
        let text = buffer.toString("utf-8");
        // A window that starts mid-file starts mid-line; that partial line is dropped.
        if (length < size) text = text.slice(text.indexOf("\n") + 1);
        const speed = this.calculateLastTokenSpeed(parseEntries(text));
        if (speed !== null || length >= size || window >= TAIL_MAX_BYTES) return speed;
      }
    } catch (error) {
      debug(`Error reading transcript tail ${transcriptPath}:`, error);
      return null;
    } finally {
      await handle?.close();
    }
  }

  private calculateMessageCount(entries: TranscriptEntry[]): number {
    return entries.filter((entry) => {
      const messageType =
        entry.type || entry.message?.role || entry.message?.type;
      const isToolResult =
        entry.type === "user" &&
        entry.message?.content?.[0]?.type === "tool_result";
      return messageType === "user" && !isToolResult;
    }).length;
  }

  private calculateLastResponseTime(entries: TranscriptEntry[]): number | null {
    if (entries.length === 0) return null;

    const recentEntries = entries.slice(-20);

    let lastUserTime: Date | null = null;
    let bestResponseTime: number | null = null;

    for (const entry of recentEntries) {
      if (!entry.timestamp) continue;

      try {
        const timestamp = new Date(entry.timestamp);
        const messageType =
          entry.type || entry.message?.role || entry.message?.type;

        const isToolResult =
          entry.type === "user" &&
          entry.message?.content?.[0]?.type === "tool_result";
        const isRealUserMessage = messageType === "user" && !isToolResult;

        if (isRealUserMessage) {
          lastUserTime = timestamp;
        } else if (messageType === "assistant" && lastUserTime) {
          const responseTime =
            (timestamp.getTime() - lastUserTime.getTime()) / 1000;
          if (responseTime > 0.1 && responseTime < 300) {
            bestResponseTime = responseTime;
          }
        }
      } catch {
        continue;
      }
    }

    return bestResponseTime;
  }

  /**
   * Output tokens of the last reply over the time it took, from the request that started it
   * (the user's message or a tool result) to the reply's last block.
   *
   * Claude Code writes a reply as one transcript line per content block, each carrying the
   * reply's usage, so the reply's end is its last line. The span includes reading the new part
   * of the prompt and the network, so this is the speed the person waits at, not pure decode.
   */
  private calculateLastTokenSpeed(entries: TranscriptEntry[]): number | null {
    let requestTime: number | null = null;
    let replyId: string | undefined;
    let replyStart: number | null = null;
    let replyEnd: number | null = null;
    let replyTokens: number | null = null;

    for (const entry of entries) {
      const time = Date.parse(entry.timestamp);
      if (Number.isNaN(time)) continue;
      const role = entry.type || entry.message?.role;
      if (role === "user") {
        requestTime = time;
      } else if (role === "assistant") {
        const id = entry.message?.id;
        if (replyEnd === null || id === undefined || id !== replyId) {
          replyId = id;
          replyStart = requestTime;
          replyTokens = null;
        }
        replyEnd = time;
        const out = entry.message?.usage?.output_tokens;
        if (typeof out === "number") replyTokens = out;
      }
    }

    if (replyStart === null || replyEnd === null || !replyTokens) return null;
    const seconds = (replyEnd - replyStart) / 1000;
    if (seconds < 0.2 || seconds > 3600) return null;
    return replyTokens / seconds;
  }

  async getMetricsInfo(
    sessionId: string,
    hookData: ClaudeHookData,
    needs: MetricsNeeds = { fullTranscript: true }
  ): Promise<MetricsInfo> {
    try {
      debug(`Getting metrics from hook data for session: ${sessionId}`);

      if (!hookData.cost) {
        debug(`No cost data available in hook data`);
        return {
          responseTime: null,
          lastResponseTime: null,
          sessionDuration: null,
          messageCount: null,
          linesAdded: null,
          linesRemoved: null,
          lastTokenSpeed: null,
        };
      }

      const transcriptPath = await findTranscriptFile(sessionId);
      if (!transcriptPath) debug(`No transcript found for session: ${sessionId}`);

      let messageCount: number | null = null;
      let lastResponseTime: number | null = null;
      let lastTokenSpeed: number | null = null;
      if (needs.fullTranscript) {
        const entries = transcriptPath ? await this.loadTranscriptEntries(transcriptPath) : [];
        messageCount = this.calculateMessageCount(entries);
        lastResponseTime = this.calculateLastResponseTime(entries);
        lastTokenSpeed = this.calculateLastTokenSpeed(entries);
      } else if (transcriptPath) {
        lastTokenSpeed = await this.loadTailTokenSpeed(transcriptPath);
      }

      return {
        responseTime: hookData.cost.total_api_duration_ms / 1000,
        lastResponseTime,
        sessionDuration: hookData.cost.total_duration_ms / 1000,
        messageCount,
        linesAdded: hookData.cost.total_lines_added,
        linesRemoved: hookData.cost.total_lines_removed,
        lastTokenSpeed,
      };
    } catch (error) {
      debug(
        `Error getting metrics from hook data for session ${sessionId}:`,
        error
      );
      return {
        responseTime: null,
        lastResponseTime: null,
        sessionDuration: null,
        messageCount: null,
        linesAdded: null,
        linesRemoved: null,
        lastTokenSpeed: null,
      };
    }
  }
}
