# Architecture & Technical Deep-Dive

## PrivacyCash Program Usage

### Verified Mainnet Deployment

- **Program ID:** `9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD`
- **Explorer:** https://explorer.solana.com/address/9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD
- **Audits:** Accretion, HashCloak, Zigtur, Kriko
- **Build Verified:** Yes (hash `c6f1e5336f2068dc1c1e1c64e92e3d8495b8df79f78011e2620af60aa43090c5`)

### How PrivacyCash Instructions Are Used

#### Deposit Instruction (Shield SOL)

When the sender initiates a private send, we use the `deposit` instruction:

```
deposit(
  amount: u64,           // SOL amount in lamports
  commitment: [u8; 32],  // hash(amount, ownerPubkey, rho, r)
  encrypted_note: Vec<u8> // encrypted for receiver
)
```

**What happens on-chain:**
1. SOL transfers from sender → pool vault PDA
2. Commitment added to Merkle tree
3. Encrypted note stored in commitment account

**Privacy achieved:**
- Amount is hidden inside the commitment hash
- Receiver identity is hidden inside the encrypted note
- Only the encrypted blob appears on-chain

#### Withdraw Instruction (Optional Unshield)

The receiver can optionally convert shielded SOL back to public SOL:

```
withdraw(
  amount: u64,
  nullifier: [u8; 32],    // derived from note + spending key
  recipient: Pubkey,       // can be ANY address
  proof: Vec<u8>           // ZK proof
)
```

**What happens on-chain:**
1. Verify nullifier hasn't been used (prevent double-spend)
2. Verify ZK proof (proves knowledge of valid note)
3. Transfer SOL from pool vault → recipient
4. Mark nullifier as spent

**Privacy maintained:**
- Nullifier is unlinkable to the original commitment
- Recipient can be different from receiver's wallet
- No connection to original deposit

---

## Client-Side Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SENDER FLOW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User Input                  Client Processing                    Output   │
│   ─────────                  ──────────────────                    ──────   │
│                                                                              │
│   amount: 1.5 SOL    ──►   1. Convert to lamports: 1,500,000,000          │
│                            2. Generate random rho (32 bytes)               │
│                            3. Generate random r (32 bytes)                 │
│                                                                              │
│   receiver:          ──►   4. Derive viewing pubkey from wallet            │
│   "7xKXt..."               5. Create note object:                          │
│                               { amount, ownerPubkey, rho, r }              │
│                            6. Compute commitment = hash(note)              │
│                            7. Encrypt note for receiver                    │
│                                                                              │
│                            8. Build deposit transaction:                    │
│                               - Transfer SOL to pool vault                 │
│                               - Register commitment                        │
│                               - Store encrypted note                       │
│                                                                              │
│                            9. Sign with sender keypair                     │
│                                                                              │
│                            10. Submit to relayer ─────────────────►  TX    │
│                                                                      Hash  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Relayer Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RELAYER FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Incoming Request              Relayer Processing              Result      │
│   ────────────────              ──────────────────              ──────      │
│                                                                              │
│   1. Intent (signed)    ──►    A. Verify sender signature                  │
│      - amount                   B. Check timestamp validity                 │
│      - receiver                 C. Validate transaction format              │
│      - timestamp                                                            │
│      - signature                                                            │
│                                                                              │
│   2. Encrypted Note    ──►     [Cannot decrypt - privacy preserved]        │
│      (opaque blob)                                                          │
│                                                                              │
│   3. Partial TX        ──►     D. Add relayer signature                    │
│      (sender signed)            E. Submit to Solana network               │
│                                 F. Wait for confirmation                    │
│                                                                              │
│                                 G. Return TX signature ─────────►  Success │
│                                                                              │
│   ⚠️ RELAYER NEVER SEES:                                                    │
│      - Decrypted note contents                                              │
│      - Receiver identity                                                    │
│      - Link between sender and receiver                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Receiver Scanning Logic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SCANNER FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Background Loop                Processing                      Result     │
│   ───────────────                ──────────                      ──────     │
│                                                                              │
│   Every 5 seconds:                                                          │
│                                                                              │
│   1. Query program    ──►    A. Fetch new commitment accounts              │
│      accounts                   since last scan                             │
│                                                                              │
│   2. For each new     ──►    B. Read encrypted note from account           │
│      commitment               C. Attempt decryption with                    │
│                                  receiver's viewing key                     │
│                                                                              │
│                              D. Decryption succeeds?                        │
│                                 │                                           │
│                                 ├── YES: This note is ours!                │
│                                 │        - Parse amount, rho, r            │
│                                 │        - Store in local database         │
│                                 │        - Update shielded balance         │
│                                 │        - Emit 'new_note' event           │
│                                 │                                           │
│                                 └── NO: Not our note, skip                 │
│                                                                              │
│   3. Update last      ──►    E. Remember slot number for                   │
│      scanned slot               next iteration                              │
│                                                                              │
│   ✅ RECEIVER AUTOMATICALLY HAS SHIELDED BALANCE                            │
│   ✅ NO WITHDRAW NEEDED TO "RECEIVE" FUNDS                                  │
│   ✅ CAN WITHDRAW LATER IF THEY WANT PUBLIC SOL                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Derivation Scheme

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        KEY DERIVATION                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Receiver's Solana Wallet                                                  │
│   ────────────────────────                                                  │
│                                                                              │
│   wallet_secret_key (Ed25519)                                               │
│          │                                                                   │
│          ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │ viewing_seed = SHA256("privacy-cash-viewing-key-v1" ||  │               │
│   │                        wallet_secret_key[0:32])          │               │
│   └─────────────────────────────────────────────────────────┘               │
│          │                                                                   │
│          ▼                                                                   │
│   viewing_keypair = nacl.box.keyPair.fromSecretKey(viewing_seed)            │
│          │                                                                   │
│          ├──► viewing_public_key (shared with sender for encryption)        │
│          │                                                                   │
│          └──► viewing_secret_key (kept private for decryption)              │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────┐               │
│   │ spending_key = SHA256("privacy-cash-spending-key-v1" || │               │
│   │                        wallet_secret_key[0:32])          │               │
│   └─────────────────────────────────────────────────────────┘               │
│          │                                                                   │
│          └──► Used to derive nullifiers when spending notes                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Properties

### What's Protected

| Property | How |
|----------|-----|
| Amount confidentiality | Hidden inside commitment hash |
| Sender anonymity | Sender's wallet appears in deposit, but receiver is hidden |
| Receiver anonymity | Never appears on-chain; encrypted in note |
| Transaction unlinkability | Nullifier cannot be linked to commitment |
| Double-spend prevention | Nullifier tracking on-chain |

### Trust Assumptions

1. **ZK Proofs are sound** - If you can generate a valid proof, you know the note
2. **Encryption is secure** - NaCl box is well-established
3. **Hash function is collision-resistant** - Commitments are unique
4. **Relayer is honest but curious** - Won't collude, but might try to learn

### What the Relayer Knows

- ✅ Sender's IP address (use Tor to hide)
- ✅ Sender's public key
- ✅ Transaction timing
- ✅ Approximate amount range (from gas estimation)
- ❌ Receiver identity
- ❌ Exact amount
- ❌ Note contents

---

## Integration with Official SDK

For production use, integrate with the official PrivacyCash SDK:

```bash
npm install privacy-cash-sdk
```

```typescript
import { PrivacyCash } from 'privacy-cash-sdk';

// Initialize
const privacyCash = new PrivacyCash(connection);

// Deposit
const result = await privacyCash.deposit(amount);

// Check balance
const balance = await privacyCash.getPrivateBalance();

// Withdraw (optional)
const withdrawResult = await privacyCash.withdraw(amount, recipient);
```

The official SDK provides:
- Proper ZK proof generation (Groth16)
- Merkle tree proof construction
- Correct instruction encoding
- Relayer integration
- Production-tested cryptography

---

## Explicit Confirmation

### ✅ Receiver Does NOT Need to Click Withdraw to Receive

When someone sends you private SOL:

1. The sender deposits SOL + encrypted note to the pool
2. Your scanner automatically detects and decrypts the note
3. Your shielded balance updates immediately
4. **You have the funds** - no action required

Withdrawing is **OPTIONAL** and only needed if you want to:
- Convert shielded SOL back to public SOL
- Use the SOL with dApps that don't support shielded balances
- Move funds to a different wallet publicly

The privacy benefit is maintained as long as you keep the balance shielded!

