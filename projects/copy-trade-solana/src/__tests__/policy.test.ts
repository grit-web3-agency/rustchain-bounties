import {
  shouldCopy,
  PolicyConfig,
  FollowerState,
  DEFAULT_POLICY,
  validateConfig,
} from "../policy";
import { Trade } from "../types";

function makeTrade(amount: number, mint?: string): Trade {
  return {
    signature: "test-sig",
    from: "SourcePubkey111111111111111111111111111111111",
    to: "DestPubkey1111111111111111111111111111111111",
    amount,
    mint,
  };
}

describe("shouldCopy policy checks", () => {
  const policy: PolicyConfig = {
    minTradeLamports: 1_000_000,
    maxPerWalletLamports: 100_000_000,
    slippagePct: 2,
  };

  it("allows a trade within limits", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(5_000_000), state, policy);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks trade below minimum", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(500_000), state, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("below minimum");
  });

  it("blocks trade that would exceed per-wallet cap", () => {
    const state: FollowerState = { totalSpentLamports: 95_000_000 };
    const result = shouldCopy(makeTrade(10_000_000), state, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("exceed per-wallet cap");
  });

  it("allows trade right at the cap boundary", () => {
    const state: FollowerState = { totalSpentLamports: 90_000_000 };
    const result = shouldCopy(makeTrade(10_000_000), state, policy);
    expect(result.allowed).toBe(true);
  });

  it("uses DEFAULT_POLICY when no config provided", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(DEFAULT_POLICY.minTradeLamports), state);
    expect(result.allowed).toBe(true);
  });

  it("blocks when exactly at zero amount below minimum", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(999_999), state, policy);
    expect(result.allowed).toBe(false);
  });

  it("blocks trade with zero amount", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(0), state, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("must be positive");
  });

  it("blocks trade with negative amount", () => {
    const state: FollowerState = { totalSpentLamports: 0 };
    const result = shouldCopy(makeTrade(-100), state, policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("must be positive");
  });
});

describe("mint allowlist/blocklist", () => {
  const base: PolicyConfig = {
    minTradeLamports: 1_000,
    maxPerWalletLamports: 1_000_000_000,
    slippagePct: 5,
  };
  const state: FollowerState = { totalSpentLamports: 0 };

  it("allows native SOL when no allowlist/blocklist set", () => {
    const result = shouldCopy(makeTrade(10_000), state, base);
    expect(result.allowed).toBe(true);
  });

  it("blocks a blocklisted mint", () => {
    const cfg: PolicyConfig = { ...base, blockedMints: ["BadMint111"] };
    const result = shouldCopy(makeTrade(10_000, "BadMint111"), state, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocklisted");
  });

  it("allows a mint not in blocklist", () => {
    const cfg: PolicyConfig = { ...base, blockedMints: ["BadMint111"] };
    const result = shouldCopy(makeTrade(10_000, "GoodMint222"), state, cfg);
    expect(result.allowed).toBe(true);
  });

  it("blocks a mint not in allowlist", () => {
    const cfg: PolicyConfig = {
      ...base,
      allowedMints: ["native-sol", "AllowedMint333"],
    };
    const result = shouldCopy(makeTrade(10_000, "UnknownMint444"), state, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in allowedMints");
  });

  it("allows a mint in allowlist", () => {
    const cfg: PolicyConfig = {
      ...base,
      allowedMints: ["native-sol", "AllowedMint333"],
    };
    const result = shouldCopy(makeTrade(10_000, "AllowedMint333"), state, cfg);
    expect(result.allowed).toBe(true);
  });

  it("blocklist takes precedence over allowlist", () => {
    const cfg: PolicyConfig = {
      ...base,
      allowedMints: ["MintX"],
      blockedMints: ["MintX"],
    };
    const result = shouldCopy(makeTrade(10_000, "MintX"), state, cfg);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocklisted");
  });
});

describe("cooldown enforcement", () => {
  const policy: PolicyConfig = {
    minTradeLamports: 1_000,
    maxPerWalletLamports: 1_000_000_000,
    slippagePct: 2,
    cooldownMs: 5000,
  };
  const state: FollowerState = { totalSpentLamports: 0 };

  it("allows trade when no previous copy timestamp", () => {
    const result = shouldCopy(makeTrade(10_000), state, policy);
    expect(result.allowed).toBe(true);
  });

  it("blocks trade within cooldown window", () => {
    const recentTimestamp = Date.now() - 1000; // 1s ago, cooldown is 5s
    const result = shouldCopy(makeTrade(10_000), state, policy, recentTimestamp);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cooldown active");
  });

  it("allows trade after cooldown expires", () => {
    const oldTimestamp = Date.now() - 6000; // 6s ago, cooldown is 5s
    const result = shouldCopy(makeTrade(10_000), state, policy, oldTimestamp);
    expect(result.allowed).toBe(true);
  });
});

describe("validateConfig", () => {
  it("returns no errors for DEFAULT_POLICY", () => {
    expect(validateConfig(DEFAULT_POLICY)).toEqual([]);
  });

  it("rejects negative minTradeLamports", () => {
    const errors = validateConfig({ ...DEFAULT_POLICY, minTradeLamports: -1 });
    expect(errors).toContain("minTradeLamports must be a non-negative finite number");
  });

  it("rejects zero maxPerWalletLamports", () => {
    const errors = validateConfig({ ...DEFAULT_POLICY, maxPerWalletLamports: 0 });
    expect(errors).toContain("maxPerWalletLamports must be a positive finite number");
  });

  it("rejects slippagePct out of range", () => {
    const errors = validateConfig({ ...DEFAULT_POLICY, slippagePct: 101 });
    expect(errors).toContain("slippagePct must be between 0 and 100");
  });

  it("rejects minTrade > maxPerWallet", () => {
    const errors = validateConfig({
      ...DEFAULT_POLICY,
      minTradeLamports: 1_000_000_000,
      maxPerWalletLamports: 100,
    });
    expect(errors).toContain("minTradeLamports cannot exceed maxPerWalletLamports");
  });

  it("rejects negative cooldownMs", () => {
    const errors = validateConfig({ ...DEFAULT_POLICY, cooldownMs: -100 });
    expect(errors).toContain("cooldownMs must be a non-negative finite number");
  });

  it("rejects Infinity in amounts", () => {
    const errors = validateConfig({ ...DEFAULT_POLICY, minTradeLamports: Infinity });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts valid custom config", () => {
    const errors = validateConfig({
      minTradeLamports: 5_000_000,
      maxPerWalletLamports: 2_000_000_000,
      slippagePct: 0.5,
      cooldownMs: 3000,
    });
    expect(errors).toEqual([]);
  });
});
