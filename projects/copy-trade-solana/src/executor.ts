import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Trade } from "./types";
import { shouldCopy, PolicyConfig, DEFAULT_POLICY, FollowerState, validateConfig } from "./policy";

export interface ExecuteResult {
  success: boolean;
  signature?: string;
  error?: string;
  dryRun: boolean;
  policyBlocked?: boolean;
}

export interface DevnetExecutorOptions {
  rpcUrl?: string;
  keypairPath?: string;
  dryRun?: boolean;
  policy?: PolicyConfig;
}

const DEVNET_RPC = "https://api.devnet.solana.com";

/**
 * Executor signs and submits copy-trade transactions.
 *
 * Supports:
 *  - Dry-run mode (log only)
 *  - Live devnet execution with airdrop funding
 *  - Policy checks (min trade, per-wallet cap, slippage, mint filter, cooldown)
 */
export class Executor {
  private connection: Connection;
  private keypair: Keypair;
  private dryRun: boolean;
  private policy: PolicyConfig;
  private followerState: FollowerState;
  private lastCopyTimestamp?: number;

  constructor(
    connection: Connection,
    keypair: Keypair,
    dryRun = true,
    policy: PolicyConfig = DEFAULT_POLICY
  ) {
    this.connection = connection;
    this.keypair = keypair;
    this.dryRun = dryRun;
    this.policy = policy;
    this.followerState = { totalSpentLamports: 0 };

    // Validate policy on construction
    const errors = validateConfig(policy);
    if (errors.length > 0) {
      throw new Error(`Invalid policy config: ${errors.join("; ")}`);
    }
  }

  /**
   * Factory: create a devnet-ready executor with configurable RPC URL.
   * Generates an ephemeral keypair unless keypairPath is provided.
   */
  static createDevnet(options: DevnetExecutorOptions = {}): Executor {
    const rpcUrl = options.rpcUrl ?? DEVNET_RPC;
    const connection = new Connection(rpcUrl, "confirmed");
    const keypair = Executor.loadOrGenerateKeypair(options.keypairPath);
    const dryRun = options.dryRun ?? false;
    const policy = options.policy ?? DEFAULT_POLICY;

    console.log(`[DEVNET] RPC: ${rpcUrl}`);
    console.log(`[DEVNET] Wallet: ${keypair.publicKey.toBase58()}`);
    console.log(`[DEVNET] Mode: ${dryRun ? "dry-run" : "live"}`);

    return new Executor(connection, keypair, dryRun, policy);
  }

  /** Load a keypair from a JSON file path, or generate an ephemeral one */
  static loadOrGenerateKeypair(keypairPath?: string): Keypair {
    if (keypairPath) {
      const raw = JSON.parse(fs.readFileSync(path.resolve(keypairPath), "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(raw));
    }
    return Keypair.generate();
  }

  /** Request an airdrop on devnet and wait for confirmation */
  async fundFromAirdrop(lamports: number = LAMPORTS_PER_SOL): Promise<boolean> {
    try {
      console.log(
        `[AIRDROP] Requesting ${lamports / LAMPORTS_PER_SOL} SOL for ${this.keypair.publicKey.toBase58().slice(0, 8)}…`
      );
      const sig = await this.connection.requestAirdrop(
        this.keypair.publicKey,
        lamports
      );
      await this.connection.confirmTransaction(sig, "confirmed");
      console.log(`[AIRDROP] Confirmed: ${sig}`);
      return true;
    } catch (err: any) {
      console.error(`[AIRDROP] Failed: ${err.message}`);
      return false;
    }
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get rpcEndpoint(): string {
    return this.connection.rpcEndpoint;
  }

  /** Build and (optionally) send a transaction that mirrors the given trade */
  async executeTrade(trade: Trade): Promise<ExecuteResult> {
    // SPL token mirroring not yet supported
    if (trade.mint) {
      return {
        success: false,
        error: "SPL token copy-trade not yet implemented",
        dryRun: this.dryRun,
      };
    }

    // Policy check (with cooldown timestamp)
    const policyResult = shouldCopy(
      trade,
      this.followerState,
      this.policy,
      this.lastCopyTimestamp
    );
    if (!policyResult.allowed) {
      console.log(`[POLICY] Blocked: ${policyResult.reason}`);
      return {
        success: false,
        error: policyResult.reason,
        dryRun: this.dryRun,
        policyBlocked: true,
      };
    }

    const instruction = SystemProgram.transfer({
      fromPubkey: this.keypair.publicKey,
      toPubkey: new PublicKey(trade.to),
      lamports: trade.amount,
    });

    if (this.dryRun) {
      console.log(
        `[DRY-RUN] Would send ${trade.amount / LAMPORTS_PER_SOL} SOL → ${trade.to}`
      );
      this.followerState.totalSpentLamports += trade.amount;
      this.lastCopyTimestamp = Date.now();
      return { success: true, dryRun: true };
    }

    // --- Live execution ---
    try {
      const tx = new Transaction().add(instruction);
      const sig = await sendAndConfirmTransaction(this.connection, tx, [
        this.keypair,
      ]);
      this.followerState.totalSpentLamports += trade.amount;
      this.lastCopyTimestamp = Date.now();
      console.log(
        `[LIVE] Sent ${trade.amount / LAMPORTS_PER_SOL} SOL → ${trade.to} | sig: ${sig}`
      );
      return { success: true, signature: sig, dryRun: false };
    } catch (err: any) {
      console.error("[LIVE] Transaction failed:", err.message);
      return { success: false, error: err.message, dryRun: false };
    }
  }

  /** Build an instruction from a trade — useful for testing without sending */
  static buildInstruction(
    fromPubkey: PublicKey,
    trade: Trade
  ): TransactionInstruction {
    return SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey(trade.to),
      lamports: trade.amount,
    });
  }
}
