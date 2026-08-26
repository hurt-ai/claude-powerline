import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { debug } from "./logger";

/**
 * Resolve the Claude config dir for the CURRENTLY running account.
 * Honors CLAUDE_CONFIG_DIR (first entry if comma-separated), else ~/.claude.
 */
function getConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) {
    const first = env.split(",")[0]?.trim();
    if (first) return first;
  }
  return join(homedir(), ".claude");
}

/**
 * Keychain service name Claude Code uses on macOS, per account.
 * Default config dir (~/.claude) -> "Claude Code-credentials".
 * Custom CLAUDE_CONFIG_DIR   -> "Claude Code-credentials-<sha256(dir)[:8]>".
 * Without this, rate-limit always reads the default account's token.
 */
function getKeychainService(): string {
  const configDir = getConfigDir();
  const defaultDir = join(homedir(), ".claude");
  if (configDir === defaultDir) {
    return "Claude Code-credentials";
  }
  const hash = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

/**
 * Get OAuth access token from Claude Code credentials
 *
 * On macOS: Reads from Keychain (service name resolved per account)
 * On Linux/Windows: Reads from <configDir>/.credentials.json
 */
export function getCredentials(): string | null {
  try {
    if (process.platform === "darwin") {
      return getCredentialsFromKeychain();
    }
    return getCredentialsFromFile();
  } catch (error) {
    debug("Failed to get credentials:", error);
    return null;
  }
}

function getCredentialsFromKeychain(): string | null {
  try {
    const service = getKeychainService();
    debug(`Reading credentials from keychain service: ${service}`);
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-w"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    const creds = JSON.parse(result);
    return creds?.claudeAiOauth?.accessToken ?? null;
  } catch {
    // Fallback to file if Keychain fails
    return getCredentialsFromFile();
  }
}

function getCredentialsFromFile(): string | null {
  try {
    const credPath = join(getConfigDir(), ".credentials.json");
    if (!existsSync(credPath)) {
      return null;
    }
    const content = readFileSync(credPath, "utf-8");
    const creds = JSON.parse(content);
    return creds?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
