PROOFS for Copy-Trade Bot (Solana)

- Created: initial scaffold

## Sprint-2 Demo — 2026-04-03T06:07:04.062Z

Mode: DRY-RUN (network unavailable)
RPC: https://api.devnet.solana.com

- **Trade 1** (follower `5Kx2JXQN…`): DRY-RUN — policy passed, tx simulated
- **Trade 2** (follower `8piKf4rV…`): DRY-RUN — policy passed, tx simulated
- **Trade 3** (follower `63LBD3Kn…`): DRY-RUN — policy passed, tx simulated

> Note: Airdrop/network calls failed; results are dry-run simulations.

## Sprint-2 Demo — 2026-04-16T21:09:13.058Z

Mode: DRY-RUN (network unavailable)
RPC: https://api.devnet.solana.com

- **Trade 1** (follower `CUD2Lpfb…`): DRY-RUN — policy passed, tx simulated
- **Trade 2** (follower `48cGeHLs…`): DRY-RUN — policy passed, tx simulated
- **Trade 3** (follower `CLcQ2eMv…`): DRY-RUN — policy passed, tx simulated

> Note: Airdrop/network calls failed; results are dry-run simulations.

## E2E Devnet Demo — 2026-04-17 (policy gate verified)

Command: `npm run e2e`
Mode: DRY-RUN (devnet faucet rate-limited — 429 Too Many Requests)
RPC: https://api.devnet.solana.com
Policy: minTradeLamports=5_000_000 (0.005 SOL), maxPerWalletLamports=100_000_000 (0.1 SOL)

- **Trade 1** (0.01 SOL): ✓ DRY-RUN OK — policy passed
- **Trade 2** (0.05 SOL): ✓ DRY-RUN OK — policy passed
- **Trade 3** (0.002 SOL): ✗ BLOCKED — `Trade amount 2000000 below minimum 5000000 lamports`

Result: 2 passed, 1 policy-blocked, 0 failed — policy gate correctly enforces minTradeLamports.

### Unit tests (42 passing)

```
Test Suites: 4 passed, 4 total
Tests:       42 passed, 42 total
```

- `policy.test.ts` — 25 tests (shouldCopy, mint allow/block, cooldown, validateConfig)
- `executor.test.ts` — 11 tests (construction, createDevnet, dry-run, spend tracking, cooldown, SPL rejection)
- `listener.test.ts` — 5 tests (SOL/SPL parse paths)
- `poster.test.ts` — 1 test (dashboard + discord posting)
