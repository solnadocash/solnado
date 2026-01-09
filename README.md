# Solnado Cash

Private SOL transfers on Solana.
Privacy where money-privacy doesn't reach.

## Overview

Solnado enables private SOL transfers using zero-knowledge proofs. Send SOL to any address without revealing the connection between sender and recipient.

## Features

- **Private transfers** via shielded pool
- **Zero-knowledge proofs** for transaction privacy
- **Simple interface** - just enter amount and recipient
- **Mainnet ready**

## How It Works

1. Your SOL is deposited into a shielded pool
2. ZK proofs verify the transfer privately
3. Recipient receives funds with no on-chain link to you

## Fees

| Amount | Approximate Fee |
|--------|-----------------|
| 0.1 SOL | ~8% |
| 0.5 SOL | ~2% |
| 1+ SOL | ~1% |

Fees include network costs and privacy pool operations. Lower percentage for larger transfers.

## Usage

Visit [solnado.cash](https://solnado.cash) to send SOL privately.

## Development

```bash
npm install
npm run dev
```

Server runs at http://localhost:3000

## Deployment

See [DEPLOY.md](DEPLOY.md) for deployment instructions.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RELAYER_KEY` | Yes | Base58 encoded private key for relayer wallet |
| `RPC_URL` | No | Solana RPC endpoint (default: mainnet) |

## License

MIT
