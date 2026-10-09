import { MetricsProvider } from "../src/segments/metrics";
import { SegmentRenderer } from "../src/segments/renderer";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as claudePaths from "../src/utils/claude";
import type { ClaudeHookData } from "../src/utils/claude";

const hookData: ClaudeHookData = {
  hook_event_name: "Status",
  session_id: "speed",
  transcript_path: "/path/to/speed.jsonl",
  cwd: "/test/cwd",
  model: { id: "claude-opus-4-1", display_name: "Opus" },
  workspace: { current_dir: "/test/workspace", project_dir: "/test/project" },
  version: "1.0.0",
  cost: {
    total_cost_usd: 0.5,
    total_duration_ms: 120000,
    total_api_duration_ms: 5000,
    total_lines_added: 0,
    total_lines_removed: 0,
  },
};

const t0 = Date.parse("2026-10-09T10:00:00.000Z");
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const user = (s: number, content: unknown) =>
  JSON.stringify({ timestamp: at(s), type: "user", message: { role: "user", content } });
// Claude Code writes one line per content block; every line of a reply carries the reply's usage.
const assistant = (s: number, id: string, block: string, out?: number) =>
  JSON.stringify({
    timestamp: at(s),
    type: "assistant",
    message: {
      id,
      role: "assistant",
      content: [{ type: block }],
      ...(out === undefined ? {} : { usage: { input_tokens: 10, output_tokens: out } }),
    },
  });
const toolResult = (s: number) => user(s, [{ type: "tool_result", tool_use_id: "x", content: "ok" }]);

async function speedOf(lines: string[], fullTranscript = true): Promise<number | null> {
  const dir = mkdtempSync(join(tmpdir(), "speed-test-"));
  const path = join(dir, "t.jsonl");
  writeFileSync(path, lines.join("\n"));
  jest.spyOn(claudePaths, "findTranscriptFile").mockResolvedValue(path);
  const info = await new MetricsProvider().getMetricsInfo("speed", hookData, { fullTranscript });
  return info.lastTokenSpeed;
}

const padding = (s: number, kb: number) => user(s, "x".repeat(kb * 1024));

describe("token speed of the last reply", () => {
  it("is output tokens over the time from the question to the reply's last block", async () => {
    // 100 tokens; question at 0 s, thinking block written at 1 s, text block at 2 s -> 50 t/s
    const speed = await speedOf([
      user(0, "hi"),
      assistant(1, "m1", "thinking", 100),
      assistant(2, "m1", "text", 100),
    ]);
    expect(speed).toBeCloseTo(50, 5);
  });

  it("is measured from the tool result that started the last reply, not from the question", async () => {
    // reply m2: 80 tokens, started by the tool result at 3 s, last block at 5 s -> 40 t/s
    const speed = await speedOf([
      user(0, "hi"),
      assistant(1, "m1", "tool_use", 20),
      toolResult(3),
      assistant(5, "m2", "text", 80),
    ]);
    expect(speed).toBeCloseTo(40, 5);
  });

  it("is null when the last reply carries no token count", async () => {
    const speed = await speedOf([user(0, "hi"), assistant(2, "m1", "text")]);
    expect(speed).toBeNull();
  });

  it("is null when no request precedes the reply", async () => {
    const speed = await speedOf([assistant(2, "m1", "text", 100)]);
    expect(speed).toBeNull();
  });
});

describe("token speed in the metrics segment", () => {
  const symbols = {
    metrics_response: "R", metrics_last_response: "L", metrics_duration: "T",
    metrics_messages: "#", metrics_lines_added: "+", metrics_lines_removed: "-",
    metrics_burn: "~/h",
  } as any;
  const colors = { metricsBg: "", metricsFg: "" } as any;
  const info = {
    responseTime: null, lastResponseTime: null, sessionDuration: null, messageCount: null,
    linesAdded: null, linesRemoved: null, lastTokenSpeed: 42.4,
  };

  it("shows the speed in tokens per second when asked", () => {
    const r = new SegmentRenderer({} as any, symbols);
    const seg = r.renderMetrics(info, colors, null, { enabled: true, showTokenSpeed: true } as any);
    expect(seg?.text).toContain("42 t/s");
  });

  it("does not show it unless asked", () => {
    const r = new SegmentRenderer({} as any, symbols);
    const seg = r.renderMetrics(info, colors, null, { enabled: true } as any);
    expect(seg?.text ?? "").not.toContain("t/s");
  });
});

describe("token speed read from the end of the transcript", () => {
  it("gives the same speed as the full read", async () => {
    const lines = [user(0, "hi"), assistant(1, "m1", "thinking", 100), assistant(2, "m1", "text", 100)];
    expect(await speedOf(lines, false)).toBeCloseTo(50, 5);
  });

  it("finds the last reply at the end of a long session", async () => {
    // 2 MB of earlier conversation, then a 60-token reply over 3 s -> 20 t/s
    const earlier = Array.from({ length: 40 }, (_, i) => padding(i, 50));
    const lines = [...earlier, user(100, "go"), assistant(103, "m9", "text", 60)];
    expect(await speedOf(lines, false)).toBeCloseTo(20, 5);
  });

  it("widens the window when a large tool result precedes the reply", async () => {
    // the 1.5 MB tool result that starts the reply does not fit in the first window
    const big = user(10, [{ type: "tool_result", tool_use_id: "x", content: "y".repeat(1536 * 1024) }]);
    const lines = [user(0, "hi"), assistant(1, "m1", "tool_use", 5), big, assistant(14, "m2", "text", 120)];
    expect(await speedOf(lines, false)).toBeCloseTo(30, 5);
  });

  it("does not count messages when the full read is not asked for", async () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-test-"));
    const path = join(dir, "t.jsonl");
    writeFileSync(path, [user(0, "hi"), assistant(2, "m1", "text", 100)].join("\n"));
    jest.spyOn(claudePaths, "findTranscriptFile").mockResolvedValue(path);
    const info = await new MetricsProvider().getMetricsInfo("speed", hookData, { fullTranscript: false });
    expect(info.messageCount).toBeNull();
    expect(info.lastTokenSpeed).toBeCloseTo(50, 5);
  });
});
