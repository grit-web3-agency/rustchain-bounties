import { Trade } from "./types";

/** Per-follower state tracked across trades */
export interface FollowerState {
  /** Total lamports already spent by this follower */
  totalSpentLamports: number;
}

/** Policy configuration — all amounts in lamports */
export interface PolicyConfig {
  /** Minimum trade size to copy (ignore dust) */
  minTradeLamports: number;
  /** Maximum cumulative spend per follower wallet */
  maxPerWalletLamports: number;
  /** Maximum allowed slippage percentage (0-100) */
  slippagePct: number;
  /** Optional token mint allowlist — if set, only these mints are copied */
  allowedMints?: string[];
  /** Optional token mint blocklist — these mints are never copied */
  blockedMints?: string[];
  /** Cooldown in milliseconds between successive copies (0 = no cooldown) */
  cooldownMs?: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  minTradeLamports: 1_000_000, // 0.001 SOL
  maxPerWalletLamports: 500_000_000, // 0.5 SOL
  slippagePct: 2,
  cooldownMs: 0,
};

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a PolicyConfig — returns an array of error strings.
 * Empty array means the config is valid.
 */
export function validateConfig(config: PolicyConfig): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(config.minTradeLamports) || config.minTradeLamports < 0) {
    errors.push("minTradeLamports must be a non-negative finite number");
  }
  if (!Number.isFinite(config.maxPerWalletLamports) || config.maxPerWalletLamports <= 0) {
    errors.push("maxPerWalletLamports must be a positive finite number");
  }
  if (!Number.isFinite(config.slippagePct) || config.slippagePct < 0 || config.slippagePct > 100) {
    errors.push("slippagePct must be between 0 and 100");
  }
  if (config.minTradeLamports > config.maxPerWalletLamports) {
    errors.push("minTradeLamports cannot exceed maxPerWalletLamports");
  }
  if (config.cooldownMs !== undefined && (config.cooldownMs < 0 || !Number.isFinite(config.cooldownMs))) {
    errors.push("cooldownMs must be a non-negative finite number");
  }

  return errors;
}

/**
 * Check if a token mint is allowed by the policy.
 * - Native SOL (mint === undefined) is always allowed unless explicitly blocked.
 * - If allowedMints is set, only those mints pass.
 * - blockedMints always takes precedence over allowedMints.
 */
function isMintAllowed(mint: string | undefined, config: PolicyConfig): PolicyResult {
  const mintStr = mint ?? "native-sol";

  if (config.blockedMints?.includes(mintStr)) {
    return { allowed: false, reason: `Mint ${mintStr} is blocklisted` };
  }
  if (config.allowedMints && config.allowedMints.length > 0) {
    if (mint === undefined) {
      // Native SOL — allowed unless explicitly in allowedMints and not present
      // By convention, include "native-sol" in allowedMints to allow SOL
      if (!config.allowedMints.includes("native-sol")) {
        return { allowed: false, reason: "Native SOL not in allowedMints list" };
      }
    } else if (!config.allowedMints.includes(mint)) {
      return { allowed: false, reason: `Mint ${mint} not in allowedMints list` };
    }
  }
  return { allowed: true };
}

/** Decide whether a trade should be copied for a given follower */
export function shouldCopy(
  trade: Trade,
  followerState: FollowerState,
  config: PolicyConfig = DEFAULT_POLICY,
  lastCopyTimestamp?: number
): PolicyResult {
  // Validate trade amount is positive
  if (trade.amount <= 0) {
    return { allowed: false, reason: "Trade amount must be positive" };
  }

  // Mint allowlist/blocklist check
  const mintResult = isMintAllowed(trade.mint, config);
  if (!mintResult.allowed) return mintResult;

  // Minimum trade size check
  if (trade.amount < config.minTradeLamports) {
    return {
      allowed: false,
      reason: `Trade amount ${trade.amount} below minimum ${config.minTradeLamports} lamports`,
    };
  }

  // Per-wallet cap check
  const projectedTotal = followerState.totalSpentLamports + trade.amount;
  if (projectedTotal > config.maxPerWalletLamports) {
    return {
      allowed: false,
      reason: `Would exceed per-wallet cap: ${projectedTotal} > ${config.maxPerWalletLamports} lamports`,
    };
  }

  // Cooldown check
  if (
    config.cooldownMs &&
    config.cooldownMs > 0 &&
    lastCopyTimestamp !== undefined
  ) {
    const elapsed = Date.now() - lastCopyTimestamp;
    if (elapsed < config.cooldownMs) {
      return {
        allowed: false,
        reason: `Cooldown active: ${config.cooldownMs - elapsed}ms remaining`,
      };
    }
  }

  return { allowed: true };
}
