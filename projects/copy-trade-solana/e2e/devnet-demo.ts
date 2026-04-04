#!/usr/bin/env ts-node
/**
 * End-to-end devnet demo for Copy-Trade Bot (sprint-2).
 *
 * Flow:
 *   1. Create 3 ephemeral follower wallets via Executor.createDevnet()
 *   2. Airdrop 1 SOL to each follower on devnet
 *   3. Simulate 3 source trades with varying amounts
 *   4. Execute mirrored trades through the policy-gated executor
 *   5. Print results and Solana Explorer links
 *
 * Usage:
 *   RPC_URL=https://api.devnet.solana.com npx ts-node e2e/devnet-demo.ts
 *
 * Falls back to dry-run when airdrop/network is unavailable.
 */
import {
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { config as loadEnv } from "dotenv";
import { Executor, DevnetExecutorOptions } from "../src/executor";
import { Trade } from "../src/types";
import { DEFAULT_POLICY, PolicyConfig, validateConfig } from "../src/policy";

loadEnv();

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const NUM_FOLLOWERS = 3;

interface DemoTradeResult {
  follower: string;
  tradeIndex: number;
  amount: number;
  signature?: string;
  explorerUrl?: string;
  dryRun: boolean;
  policyBlocked?: boolean;
  error?: string;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Copy-Trade Bot — E2E Devnet Demo (sprint-2) ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // --- Step 1: Validate policy ---
  const policy: PolicyConfig = {
    ...DEFAULT_POLICY,
    minTradeLamports: 5_000_000, // 0.005 SOL for demo
    maxPerWalletLamports: 100_000_000, // 0.1 SOL cap per follower
  };
  const configErrors = validateConfig(policy);
  if (configErrors.length > 0) {
    console.error("Policy config invalid:", configErrors);
    process.exit(1);
  }
  console.log("Policy validated:", JSON.stringify(policy, null, 2), "\n");

  // --- Step 2: Create follower executors via factory ---
  let liveMode = true;
  const executors: Executor[] = [];

  for (let i = 0; i < NUM_FOLLOWERS; i++) {
    const opts: DevnetExecutorOptions = {
      rpcUrl: RPC_URL,
      dryRun: false,
      policy,
    };
    const exec = Executor.createDevnet(opts);
    executors.push(exec);
    console.log(`  Follower ${i + 1}: ${exec.publicKey.toBase58()}`);
  }

  // --- Step 3: Airdrop SOL ---
  console.log("\n--- Airdrop phase ---");
  for (const exec of executors) {
    const ok = await exec.fundFromAirdrop(LAMPORTS_PER_SOL);
    if (!ok) {
      console.warn("⚠ Airdrop failed — switching all followers to dry-run.");
      liveMode = false;
      break;
    }
    await sleep(1500);
  }

  // If airdrop failed, recreate executors in dry-run mode
  if (!liveMode) {
    executors.length = 0;
    for (let i = 0; i < NUM_FOLLOWERS; i++) {
      executors.push(
        Executor.createDevnet({ rpcUrl: RPC_URL, dryRun: true, policy })
      );
    }
  }

  // --- Step 4: Simulate source trades ---
  const sourcePubkey = Keypair.generate().publicKey.toBase58();
  const tradeAmounts = [10_000_000, 50_000_000, 2_000_000]; // 0.01, 0.05, 0.002 SOL
  // Note: 0.002 SOL < minTradeLamports (0.005 SOL) → should be blocked by policy

  const trades: Trade[] = tradeAmounts.map((amount, i) => ({
    signature: `E2E_SRC_${i + 1}_${Date.now()}`,
    from: sourcePubkey,
    to: Keypair.generate().publicKey.toBase58(),
    amount,
  }));

  // --- Step 5: Execute and collect results ---
  console.log("\n--- Execution phase ---");
  const results: DemoTradeResult[] = [];

  for (let i = 0; i < NUM_FOLLOWERS; i++) {
    const trade = trades[i];
    const executor = executors[i];

    console.log(
      `\nTrade ${i + 1}: ${trade.amount / LAMPORTS_PER_SOL} SOL → ${trade.to.slice(0, 8)}…`
    );
    const res = await executor.executeTrade(trade);

    const result: DemoTradeResult = {
      follower: executor.publicKey.toBase58(),
      tradeIndex: i + 1,
      amount: trade.amount,
      dryRun: res.dryRun,
      policyBlocked: res.policyBlocked,
    };

    if (res.success && res.signature) {
      result.signature = res.signature;
      result.explorerUrl = `https://explorer.solana.com/tx/${res.signature}?cluster=devnet`;
      console.log(`  ✓ ${result.explorerUrl}`);
    } else if (res.success && res.dryRun) {
      console.log("  ✓ [dry-run] would have sent");
    } else {
      result.error = res.error;
      if (res.policyBlocked) {
        console.log(`  ✗ [POLICY] ${res.error}`);
      } else {
        console.log(`  ✗ Error: ${res.error}`);
      }
    }

    results.push(result);
  }

  // --- Summary ---
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║                   SUMMARY                    ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`Mode: ${liveMode ? "LIVE (devnet)" : "DRY-RUN"}`);
  console.log(`RPC:  ${RPC_URL}`);

  const passed = results.filter((r) => !r.error).length;
  const blocked = results.filter((r) => r.policyBlocked).length;
  const failed = results.filter((r) => r.error && !r.policyBlocked).length;

  console.log(`\nResults: ${passed} passed, ${blocked} policy-blocked, ${failed} failed`);

  for (const r of results) {
    const status = r.error
      ? r.policyBlocked
        ? "BLOCKED"
        : "FAILED"
      : r.dryRun
      ? "DRY-RUN OK"
      : "LIVE OK";
    console.log(
      `  Trade ${r.tradeIndex}: ${r.amount / LAMPORTS_PER_SOL} SOL — ${status}${r.explorerUrl ? ` — ${r.explorerUrl}` : ""}`
    );
  }

  console.log("\n=== E2E Demo complete ===");
}

main().catch((err) => {
  console.error("E2E demo failed:", err);
  process.exit(1);
});
