/**
 * Unit tests for Executor — policy gate, spend tracking, cooldown updates,
 * and dry-run behavior. Avoids network calls by using dry-run mode.
 */
import { Connection, Keypair } from "@solana/web3.js";
import { Executor } from "../executor";
import { PolicyConfig } from "../policy";
import { Trade } from "../types";

function makeTrade(amount: number, mint?: string): Trade {
  return {
    signature: "sig-" + amount,
    from: "SourcePubkey111111111111111111111111111111111",
    to: Keypair.generate().publicKey.toBase58(),
    amount,
    mint,
  };
}

function makeExecutor(policy?: PolicyConfig): Executor {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const keypair = Keypair.generate();
  return new Executor(connection, keypair, /* dryRun */ true, policy);
}

describe("Executor construction", () => {
  it("validates policy on construction and throws for invalid config", () => {
    const connection = new Connection("http://localhost:8899", "confirmed");
    const keypair = Keypair.generate();
    const badPolicy: PolicyConfig = {
      minTradeLamports: -1,
      maxPerWalletLamports: 100,
      slippagePct: 2,
    };
    expect(() => new Executor(connection, keypair, true, badPolicy)).toThrow(
      /Invalid policy config/
    );
  });

  it("accepts a valid policy", () => {
    expect(() => makeExecutor()).not.toThrow();
  });

  it("exposes publicKey and rpcEndpoint", () => {
    const exec = makeExecutor();
    expect(exec.publicKey.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(exec.rpcEndpoint).toBe("http://localhost:8899");
  });
});

describe("Executor.createDevnet", () => {
  it("creates a devnet executor with ephemeral keypair", () => {
    const exec = Executor.createDevnet({ dryRun: true });
    expect(exec.publicKey).toBeDefined();
    expect(exec.rpcEndpoint).toBe("https://api.devnet.solana.com");
  });

  it("uses custom RPC URL when provided", () => {
    const exec = Executor.createDevnet({
      rpcUrl: "https://api.testnet.solana.com",
      dryRun: true,
    });
    expect(exec.rpcEndpoint).toBe("https://api.testnet.solana.com");
  });
});

describe("Executor.loadOrGenerateKeypair", () => {
  it("generates ephemeral keypair when no path given", () => {
    const kp1 = Executor.loadOrGenerateKeypair();
    const kp2 = Executor.loadOrGenerateKeypair();
    expect(kp1.publicKey.toBase58()).not.toBe(kp2.publicKey.toBase58());
  });
});

describe("Executor.executeTrade (dry-run)", () => {
  const policy: PolicyConfig = {
    minTradeLamports: 1_000_000,
    maxPerWalletLamports: 100_000_000,
    slippagePct: 2,
  };

  it("succeeds in dry-run mode for a valid trade", async () => {
    const exec = makeExecutor(policy);
    const result = await exec.executeTrade(makeTrade(5_000_000));
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.signature).toBeUndefined();
  });

  it("blocks a trade below minimum via policy gate", async () => {
    const exec = makeExecutor(policy);
    const result = await exec.executeTrade(makeTrade(500_000));
    expect(result.success).toBe(false);
    expect(result.policyBlocked).toBe(true);
    expect(result.error).toContain("below minimum");
  });

  it("tracks cumulative spend and blocks when cap exceeded", async () => {
    const exec = makeExecutor(policy);
    // First two succeed (40M + 40M = 80M, cap is 100M)
    const r1 = await exec.executeTrade(makeTrade(40_000_000));
    const r2 = await exec.executeTrade(makeTrade(40_000_000));
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Third would push total to 120M — should be blocked
    const r3 = await exec.executeTrade(makeTrade(40_000_000));
    expect(r3.success).toBe(false);
    expect(r3.policyBlocked).toBe(true);
    expect(r3.error).toContain("exceed per-wallet cap");
  });

  it("rejects SPL token trades (not yet supported)", async () => {
    const exec = makeExecutor(policy);
    const result = await exec.executeTrade(
      makeTrade(5_000_000, "MintAddr1111111111111111111111111111111111111")
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("SPL token copy-trade not yet implemented");
  });

  it("enforces cooldown between successive copies", async () => {
    const cooldownPolicy: PolicyConfig = {
      minTradeLamports: 1_000,
      maxPerWalletLamports: 1_000_000_000,
      slippagePct: 2,
      cooldownMs: 5_000,
    };
    const exec = makeExecutor(cooldownPolicy);

    const r1 = await exec.executeTrade(makeTrade(10_000));
    expect(r1.success).toBe(true);

    // Immediately try again — should be cooldown-blocked
    const r2 = await exec.executeTrade(makeTrade(10_000));
    expect(r2.success).toBe(false);
    expect(r2.policyBlocked).toBe(true);
    expect(r2.error).toContain("Cooldown active");
  });
});
