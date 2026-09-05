import process from "node:process";
import tty from "node:tty";

/**
 * Whether text on this background has to be dark to be read.
 *
 * Relative luminance per WCAG 2.x, sRGB linearised. The 0.5 line is where the contrast against
 * a pastel foreground collapses: #a6e3a1 on the cream #fff1c2 measures about 1.4:1, which is
 * legible on a screenshot and not on a screen.
 */
export function isLightBackground(hex: string | undefined): boolean {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return false;
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

export function hexToAnsi(hex: string, isBackground: boolean): string {
  if (
    isBackground &&
    (hex.toLowerCase() === "transparent" || hex.toLowerCase() === "none")
  ) {
    return "\x1b[49m";
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[${isBackground ? "48" : "38"};2;${r};${g};${b}m`;
}

export function extractBgToFg(
  ansiCode: string,
  useTextOnly: boolean = false
): string {
  if (!ansiCode || ansiCode === "") {
    return "";
  }

  const truecolorMatch = ansiCode.match(/48;2;(\d+);(\d+);(\d+)/);
  if (truecolorMatch) {
    return `\x1b[38;2;${truecolorMatch[1]};${truecolorMatch[2]};${truecolorMatch[3]}m`;
  }

  if (useTextOnly) {
    return "\x1b[37m";
  }

  if (ansiCode.includes("\x1b[") && ansiCode.includes("m")) {
    const codeMatch = ansiCode.match(/\[(\d+)m/);
    if (codeMatch && codeMatch[1]) {
      const bgCode = parseInt(codeMatch[1], 10);
      if (bgCode >= 40 && bgCode <= 47) {
        const fgCode = bgCode - 10;
        return `\x1b[${fgCode}m`;
      }
      if (bgCode >= 100 && bgCode <= 107) {
        const fgCode = bgCode - 10;
        return `\x1b[${fgCode}m`;
      }
    }
  }

  return ansiCode.replace("48", "38");
}

export function getColorSupport(): "none" | "ansi" | "ansi256" | "truecolor" {
  const { env } = process;

  let colorEnabled = true;

  if (env.NO_COLOR && env.NO_COLOR !== "") {
    colorEnabled = false;
  }

  const forceColor = env.FORCE_COLOR;
  if (forceColor && forceColor !== "") {
    if (forceColor === "false" || forceColor === "0") {
      return "none";
    }
    if (forceColor === "true" || forceColor === "1") {
      return "ansi";
    }
    if (forceColor === "2") {
      return "ansi256";
    }
    if (forceColor === "3") {
      return "truecolor";
    }
    return "ansi";
  }

  if (!colorEnabled) {
    return "none";
  }

  if (env.TERM === "dumb") {
    return "none";
  }

  if (env.CI) {
    if (
      ["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => key in env)
    ) {
      return "truecolor";
    }
    return "ansi";
  }

  if (env.COLORTERM === "truecolor") {
    return "truecolor";
  }

  const truecolorTerminals = [
    "xterm-kitty",
    "xterm-ghostty",
    "wezterm",
    "alacritty",
    "foot",
    "contour",
  ];

  if (truecolorTerminals.includes(env.TERM || "")) {
    return "truecolor";
  }

  if (env.TERM_PROGRAM) {
    switch (env.TERM_PROGRAM) {
      case "iTerm.app":
        return "truecolor";
      case "Apple_Terminal":
        return "ansi256";
      case "vscode":
        return "truecolor";
      case "Tabby":
        return "truecolor";
    }
  }

  if (/-256(color)?$/i.test(env.TERM || "")) {
    return "ansi256";
  }

  if (/-truecolor$/i.test(env.TERM || "")) {
    return "truecolor";
  }

  if (
    /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(
      env.TERM || ""
    )
  ) {
    return "ansi";
  }

  if (env.COLORTERM) {
    return "ansi";
  }

  if (tty?.WriteStream?.prototype?.hasColors) {
    try {
      const colors = tty.WriteStream.prototype.hasColors();
      if (!colors) {
        return "none";
      }

      const has256Colors = tty.WriteStream.prototype.hasColors(256);
      const has16mColors = tty.WriteStream.prototype.hasColors(16777216);

      if (has16mColors) {
        return "truecolor";
      } else if (has256Colors) {
        return "ansi256";
      } else {
        return "ansi";
      }
    } catch {}
  }

  return "ansi";
}

export function hexTo256Ansi(hex: string, isBackground: boolean): string {
  if (
    isBackground &&
    (hex.toLowerCase() === "transparent" || hex.toLowerCase() === "none")
  ) {
    return "\x1b[49m";
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const toAnsi256 = (r: number, g: number, b: number): number => {
    if (r === g && g === b) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return Math.round(((r - 8) / 247) * 24) + 232;
    }
    return (
      16 +
      36 * Math.round((r / 255) * 5) +
      6 * Math.round((g / 255) * 5) +
      Math.round((b / 255) * 5)
    );
  };

  const colorCode = toAnsi256(r, g, b);
  return `\x1b[${isBackground ? "48" : "38"};5;${colorCode}m`;
}

export function hexToBasicAnsi(hex: string, isBackground: boolean): string {
  if (
    isBackground &&
    (hex.toLowerCase() === "transparent" || hex.toLowerCase() === "none")
  ) {
    return "\x1b[49m";
  }

  if (isBackground) {
    return "";
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  if (g > r && g > b && g > 120) {
    return "\x1b[32m";
  }

  if (r > g && r > b && r > 120) {
    return "\x1b[31m";
  }

  if (b > r && b > g && b > 120) {
    return "\x1b[34m";
  }

  const brightness = (r + g + b) / 3;
  return brightness > 150 ? "\x1b[37m" : "\x1b[90m";
}
