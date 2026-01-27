# Inco Lightning on Solana - Comprehensive Documentation

**Last Updated:** January 2026  
**Status:** Beta on Solana Devnet  
**Official Documentation:** https://docs.inco.org/svm/

---

## Quick Reference Card

### Essential Information

**Program ID:** `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`

**Network:** Solana Devnet (Beta)

**Crate Version:** `0.1.4`

### Basic Import Pattern

```rust
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{e_add, e_sub, new_euint128};
use inco_lightning::types::{Euint128, Ebool};
use inco_lightning::ID as INCO_LIGHTNING_ID;
```

### CPI Context Pattern

```rust
let cpi_ctx = CpiContext::new(
    ctx.accounts.inco_lightning_program.to_account_info(),
    Operation {
        authority: ctx.accounts.authority.to_account_info(),
    },
);
```

### Account Constraint Pattern

```rust
/// CHECK: Inco Lightning program for encrypted operations
#[account(address = INCO_LIGHTNING_ID)]
pub inco_lightning_program: AccountInfo<'info>,
```

---

## Frequently Asked Questions

### Q: What's the difference between Inco Lightning and regular Solana programs?

A: Inco Lightning adds confidential computation capabilities to Solana programs. Instead of storing and operating on plaintext values, you work with encrypted handles that reference encrypted data stored off-chain. All computation happens in Trusted Execution Environments.

### Q: Do I need a separate blockchain for Inco?

A: No. Inco Lightning integrates directly with Solana. You write normal Anchor programs that make CPI calls to the Inco Lightning program for encrypted operations.

### Q: How do I encrypt data before sending it to my program?

A: You use the Inco JavaScript/TypeScript SDK to encrypt data client-side before sending it in transactions. The encrypted ciphertext is then converted to handles on-chain.

### Q: Can I decrypt data on-chain?

A: Yes, but only with proper access control. You can request onchain decryption, which is processed by a network of TEE nodes that verify permissions and submit the decrypted result back to your program.

### Q: What's the performance impact?

A: Encrypted operations are processed off-chain, which introduces some latency compared to native Solana operations. However, it provides strong privacy guarantees that aren't possible with standard programs.

### Q: Is this production-ready?

A: No, it's currently in beta on Devnet only. Do not use for production applications yet.

### Q: What happens to my data if the Inco network goes down?

A: The handles on-chain still exist, but you wouldn't be able to perform operations or decrypt until the network is back. This is an important consideration for mission-critical applications.

### Q: Can I mix encrypted and unencrypted data?

A: Yes. Your program can have both regular Solana data types and Inco encrypted types. You choose what to encrypt based on your privacy requirements.

---

## Glossary

**Handle:** A 128-bit reference to an encrypted value stored off-chain. Handles are stored on-chain but don't reveal the underlying data.

**Ciphertext:** The encrypted form of data, represented as a byte array (`Vec<u8>`).

**CPI (Cross-Program Invocation):** Solana's mechanism for one program to call another. All Inco operations use CPI to the Lightning program.

**Euint128:** An encrypted 128-bit unsigned integer type provided by Inco.

**Ebool:** An encrypted boolean type provided by Inco.

**TEE (Trusted Execution Environment):** A secure area of a processor that guarantees code and data are protected with respect to confidentiality and integrity.

**Access Control List (ACL):** A system that defines who can decrypt which encrypted values.

**Allowance PDA:** A Program Derived Address used to grant decryption access to specific addresses for specific handles.

**Input Type:** An identifier that specifies the encryption scheme used for the ciphertext.

**Simulation:** Running a transaction in simulation mode to preview results (like handle values) before actual execution.

**Re-encryption:** A decryption mechanism where data is decrypted and re-encrypted with a user's ephemeral key for private viewing.

**Onchain Decryption:** A decryption mechanism where the decrypted result is submitted back to the blockchain for use by smart contracts.

---

## Version History

### v0.1.4 (Current)
- Beta release on Solana Devnet
- Core encrypted types: Euint128, Ebool
- Arithmetic operations: add, sub, mul, div
- Comparison operations
- Conditional select
- Access control system
- Confidential SPL Token reference implementation

---

## Common Patterns & Recipes

### Pattern 1: Basic Encrypted Storage

```rust
#[account]
pub struct UserData {
    pub owner: Pubkey,
    pub secret_value: Euint128,
}

pub fn initialize(
    ctx: Context<Initialize>,
    encrypted_value: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    
    let handle = new_euint128(cpi_ctx, encrypted_value, input_type)?;
    
    ctx.accounts.user_data.owner = ctx.accounts.authority.key();
    ctx.accounts.user_data.secret_value = handle;
    
    Ok(())
}
```

### Pattern 2: Encrypted Addition

```rust
pub fn add_values(ctx: Context<AddValues>) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    
    let result = e_add(
        cpi_ctx,
        ctx.accounts.value_a.secret_value,
        ctx.accounts.value_b.secret_value,
    )?;
    
    ctx.accounts.output.secret_value = result;
    
    Ok(())
}
```

### Pattern 3: Conditional Logic

```rust
pub fn conditional_update(
    ctx: Context<ConditionalUpdate>,
    encrypted_condition: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            authority: ctx.accounts.authority.to_account_info(),
        },
    );
    
    // Create condition handle
    let condition = new_euint128(cpi_ctx.clone(), encrypted_condition, input_type)?;
    
    // Compare with threshold
    let is_greater: Ebool = e_ge(
        cpi_ctx.clone(),
        condition,
        ctx.accounts.threshold.value,
    )?;
    
    // Select new value based on condition
    let new_value = e_select(
        cpi_ctx,
        is_greater,
        ctx.accounts.option_a.value,
        ctx.accounts.option_b.value,
    )?;
    
    ctx.accounts.result.value = new_value;
    
    Ok(())
}
```

### Pattern 4: Access Control Setup

```rust
pub fn mint_with_access<'info>(
    ctx: Context<'_, '_, '_, 'info, MintWithAccess<'info>>,
    ciphertext: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    // Your mint logic here...
    
    // Grant access via remaining_accounts
    // remaining_accounts[0] = allowance_account (mut)
    // remaining_accounts[1] = owner_address (readonly)
    
    // The allowance PDA should be derived as:
    // [new_handle.to_le_bytes(), owner_address]
    
    Ok(())
}
```

---

## Troubleshooting Guide

### Issue: "Account not initialized"

**Cause:** Trying to operate on an account before it's been properly initialized.

**Solution:** Ensure you call initialize functions before attempting operations.

### Issue: "Mint mismatch"

**Cause:** Token account doesn't match the mint being used.

**Solution:** Verify that the account was created for the correct mint.

### Issue: "Owner mismatch"

**Cause:** Signer doesn't match the account owner.

**Solution:** Ensure the transaction is signed by the account owner.

### Issue: "Account frozen"

**Cause:** Attempting to transfer from/to a frozen account.

**Solution:** Thaw the account first (requires freeze authority).

### Issue: Handle not found during decryption

**Cause:** Attempting to decrypt a handle that doesn't exist or access not granted.

**Solution:** Verify the handle exists and proper access control PDAs are set up.

### Issue: CPI call fails

**Cause:** Incorrect program ID or missing accounts.

**Solution:** Verify INCO_LIGHTNING_ID is correct and inco_lightning_program account is included.

---

## Code Snippets Library

### Complete Program Template

```rust
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{e_add, e_sub, new_euint128};
use inco_lightning::types::Euint128;
use inco_lightning::ID as INCO_LIGHTNING_ID;

declare_id!("YourProgramIDHere");

#[program]
pub mod my_confidential_program {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        encrypted_value: Vec<u8>,
        input_type: u8,
    ) -> Result<()> {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            Operation {
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        
        let handle = new_euint128(cpi_ctx, encrypted_value, input_type)?;
        
        ctx.accounts.state.owner = ctx.accounts.authority.key();
        ctx.accounts.state.value = handle;
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ConfidentialState::LEN
    )]
    pub state: Account<'info, ConfidentialState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Inco Lightning program
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: AccountInfo<'info>,
}

#[account]
pub struct ConfidentialState {
    pub owner: Pubkey,
    pub value: Euint128,
}

impl ConfidentialState {
    pub const LEN: usize = 32 + 32; // Pubkey + Euint128
}
```

### Testing Template

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MyConfidentialProgram } from "../target/types/my_confidential_program";

describe("my-confidential-program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MyConfidentialProgram as Program<MyConfidentialProgram>;

  it("Initializes with encrypted value", async () => {
    const state = anchor.web3.Keypair.generate();
    
    // You would use Inco SDK to encrypt the value
    const encryptedValue = Buffer.from([/* encrypted bytes */]);
    const inputType = 0;

    const tx = await program.methods
      .initialize(encryptedValue, inputType)
      .accounts({
        state: state.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        incoLightningProgram: new anchor.web3.PublicKey(
          "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
        ),
      })
      .signers([state])
      .rpc();

    console.log("Transaction signature", tx);
  });
});
```

---

This comprehensive documentation should serve as a complete reference for working with Inco Lightning on Solana. For the most up-to-date information, always refer to the official documentation at https://docs.inco.org/svm/ Table of Contents

1. [Overview](#overview)
2. [What is Inco Lightning?](#what-is-inco-lightning)
3. [Key Concepts](#key-concepts)
4. [Rust SDK](#rust-sdk)
5. [Encrypted Types](#encrypted-types)
6. [Operations](#operations)
7. [Account Structures](#account-structures)
8. [Confidential SPL Token Program](#confidential-spl-token-program)
9. [Access Control](#access-control)
10. [JavaScript/TypeScript Integration](#javascripttypescript-integration)
11. [Architecture](#architecture)
12. [Best Practices](#best-practices)
13. [Error Handling](#error-handling)
14. [Example Use Cases](#example-use-cases)

---

## Overview

### What is Inco on Solana?

Inco Lightning is a confidential computation layer that enables developers to build privacy-preserving applications on Solana where sensitive data remains encrypted throughout computation. It's currently in beta on Solana Devnet.

### Key Features

- **Private Use Cases:** Build confidential dApps across payments, DeFi, governance, gaming, and more
- **Developer Friendly:** Write confidential Anchor programs in Rust with an easy-to-use SDK
- **Scalable & Secure:** Enterprise-grade security and privacy on Solana
- **TEE-Based:** Uses Trusted Execution Environments for verifiable compute
- **No New Chain:** Integrates directly with Solana - no separate blockchain needed

### Technology Stack

- **Underlying Technology:** Trusted Execution Environments (TEEs)
- **Program Framework:** Anchor (Solana's framework for building programs)
- **Language:** Rust for programs, TypeScript/JavaScript for clients
- **Encryption:** Operations processed off-chain with cryptographic guarantees

---

## What is Inco Lightning?

Inco Lightning enables developers to build applications on Solana where sensitive data remains encrypted even during computation.

### How It Works

1. **Encrypted Handles:** Programs receive ciphertext from clients and convert them into encrypted "handles" via CPI (Cross-Program Invocation)
2. **Off-Chain Processing:** A network processes encrypted operations off-chain with cryptographic guarantees
3. **Reference-Based Operations:** Programs operate on handle references instead of raw values
4. **Supported Operations:** Arithmetic, comparisons, encrypted random numbers, conditional logic, and programmable access control

### Core Capabilities

- Encrypted Types: Work with encrypted integers and booleans on-chain
- Encrypted Operations: Perform computations on encrypted data without decryption
- Attested Decryption: Securely decrypt data with TEE-based attestations

---

## Key Concepts

### 1. Handles

**Definition:** 128-bit references to encrypted values stored off-chain

- Handles are returned by the Inco Lightning program
- They reference encrypted data without revealing the actual values
- Used throughout your program to maintain confidentiality

### 2. Encrypted Types

Available encrypted types:
- `Euint128`: Encrypted 128-bit unsigned integer
- `Ebool`: Encrypted boolean

These types represent encrypted data that can be operated on without decryption.

### 3. CPI Operations

Cross-Program Invocations for encrypted arithmetic and logic operations. All operations are performed via CPI to the Inco Lightning program.

### 4. Access Control

A permission system for managing decryption rights. Programs can grant or revoke access to encrypted data for specific users or addresses.

---

## Rust SDK

### Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
inco-lightning = { version = "0.1.4", features = ["cpi"] }
```

### Setup

#### 1. Add the program to your Anchor.toml

```toml
[programs.devnet]
inco_lightning = "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
```

**Important:** The Inco Lightning Program ID is `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`

#### 2. Import the crate in your program

```rust
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{e_add, e_sub, e_ge, e_select, new_euint128};
use inco_lightning::types::{Euint128, Ebool};
use inco_lightning::ID as INCO_LIGHTNING_ID;
```

#### 3. Add Inco Lightning program to your account struct

```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Inco Lightning program for encrypted operations
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: AccountInfo<'info>,
}
```

---

## Encrypted Types

### Euint128

Represents an encrypted 128-bit unsigned integer.

**Usage:**
```rust
use inco_lightning::types::Euint128;

#[account]
pub struct MyAccount {
    pub encrypted_value: Euint128,
    // other fields...
}
```

**Creating a new Euint128:**
```rust
use inco_lightning::cpi::new_euint128;

let cpi_ctx = CpiContext::new(
    ctx.accounts.inco_lightning_program.to_account_info(),
    Operation {
        authority: ctx.accounts.authority.to_account_info(),
    },
);

let handle = new_euint128(cpi_ctx, ciphertext, input_type)?;
```

### Ebool

Represents an encrypted boolean value.

**Usage:**
```rust
use inco_lightning::types::Ebool;

#[account]
pub struct MyAccount {
    pub encrypted_flag: Ebool,
    // other fields...
}
```

---

## Operations

All operations are performed via CPI to the Inco Lightning program. They operate on encrypted values without decryption.

### Arithmetic Operations

#### Addition: `e_add`
```rust
use inco_lightning::cpi::e_add;

let cpi_ctx = CpiContext::new(
    ctx.accounts.inco_lightning_program.to_account_info(),
    Operation {
        authority: ctx.accounts.authority.to_account_info(),
    },
);

let result = e_add(cpi_ctx, lhs_handle, rhs_handle)?;
```

#### Subtraction: `e_sub`
```rust
let result = e_sub(cpi_ctx, lhs_handle, rhs_handle)?;
```

#### Multiplication: `e_mul`
```rust
let result = e_mul(cpi_ctx, lhs_handle, rhs_handle)?;
```

#### Division: `e_div`
```rust
let result = e_div(cpi_ctx, lhs_handle, rhs_handle)?;
```

### Comparison Operations

#### Greater Than or Equal: `e_ge`
```rust
use inco_lightning::cpi::e_ge;

let comparison_result: Ebool = e_ge(cpi_ctx, lhs_handle, rhs_handle)?;
```

Other comparison operations likely include:
- `e_gt` (greater than)
- `e_lt` (less than)
- `e_le` (less than or equal)
- `e_eq` (equal to)
- `e_ne` (not equal to)

### Logical Operations

#### Select (Conditional): `e_select`
```rust
use inco_lightning::cpi::e_select;

// If condition is true, returns true_value, otherwise false_value
let result = e_select(cpi_ctx, condition, true_value, false_value)?;
```

### Random Number Generation

Generate encrypted random values on-chain:

```rust
// Example structure - exact API may vary
let random_value = e_rand_euint128(cpi_ctx)?;
```

---

## Account Structures

### Standard Account Pattern

When storing encrypted data on-chain, use the encrypted types in your account structures:

```rust
#[account]
pub struct ConfidentialAccount {
    pub owner: Pubkey,
    pub encrypted_balance: Euint128,
    pub is_active: Ebool,
    // other fields...
}

impl ConfidentialAccount {
    pub const LEN: usize = 32 + 32 + 32; // pubkey + euint128 + ebool
}
```

### Account Initialization

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + ConfidentialAccount::LEN
    )]
    pub account: Account<'info, ConfidentialAccount>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Inco Lightning program
    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: AccountInfo<'info>,
}
```

---

## Confidential SPL Token Program

A reference implementation of an SPL token with confidential balances.

### Account Structures

#### COption

A C-compatible option type:

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum COption<T> {
    None,
    Some(T),
}
```

#### AccountState

```rust
#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AccountState {
    Uninitialized = 0,
    Initialized = 1,
    Frozen = 2,
}
```

#### IncoMint

The mint account structure (106 bytes):

```rust
#[account]
pub struct IncoMint {
    /// Optional authority used to mint new tokens
    pub mint_authority: COption<Pubkey>,
    /// Total supply of tokens (encrypted)
    pub supply: Euint128,
    /// Number of base 10 digits to the right of the decimal place
    pub decimals: u8,
    /// Is `true` if this structure has been initialized
    pub is_initialized: bool,
    /// Optional authority to freeze token accounts
    pub freeze_authority: COption<Pubkey>,
}

impl IncoMint {
    pub const LEN: usize = 36 + 32 + 1 + 1 + 36; // 106 bytes
}
```

#### IncoAccount

The token account structure (213 bytes):

```rust
#[account]
pub struct IncoAccount {
    /// The mint associated with this account
    pub mint: Pubkey,
    /// The owner of this account
    pub owner: Pubkey,
    /// The amount of tokens this account holds (encrypted)
    pub amount: Euint128,
    /// If `delegate` is `Some` then `delegated_amount` represents
    /// the amount authorized by the delegate
    pub delegate: COption<Pubkey>,
    /// The account's state
    pub state: AccountState,
    /// If is_some, this is a native token, and the value logs
    /// the rent-exempt reserve
    pub is_native: COption<u64>,
    /// The amount delegated (encrypted)
    pub delegated_amount: Euint128,
    /// Optional authority to close the account
    pub close_authority: COption<Pubkey>,
}

impl IncoAccount {
    pub const LEN: usize = 32 + 32 + 32 + 36 + 1 + 12 + 32 + 36; // 213 bytes
}
```

### Mint Operations

#### initialize_mint

Creates a new confidential token mint:

```rust
pub fn initialize_mint(
    ctx: Context<InitializeMint>,
    decimals: u8,                    // Token precision (e.g., 9)
    mint_authority: Pubkey,          // Authority to mint tokens
    freeze_authority: Option<Pubkey> // Authority to freeze accounts
) -> Result<()>
```

#### mint_to

Mints confidential tokens to an account:

```rust
/// remaining_accounts:
///   [0] allowance_account (mut) - PDA for granting decrypt access
///   [1] owner_address (readonly) - The owner to grant access to
pub fn mint_to<'info>(
    ctx: Context<'_, '_, '_, 'info, IncoMintTo<'info>>,
    ciphertext: Vec<u8>,  // Encrypted amount
    input_type: u8        // Encryption type identifier
) -> Result<()>
```

**Note:** Pass `remaining_accounts` to automatically grant decryption access to the owner for the new balance handle.

### Account Operations

#### initialize_account

Creates a new confidential token account:

```rust
pub fn initialize_account(ctx: Context<InitializeAccount>) -> Result<()>
```

#### create

Creates an associated token account using PDA derivation:

```rust
pub fn create(ctx: Context<Create>) -> Result<()>
```

#### create_idempotent

Creates an associated token account, succeeding silently if it already exists:

```rust
pub fn create_idempotent(ctx: Context<CreateIdempotent>) -> Result<()>
```

**Use Case:** Useful for user-facing applications where you want to ensure the account exists without failing.

#### close_account

Closes a token account and reclaims the rent:

```rust
pub fn close_account(ctx: Context<CloseAccount>) -> Result<()>
```

**Requirement:** The account must have a zero balance. Balance verification should be done client-side.

### Transfer Operations

#### transfer

Transfers confidential tokens between accounts:

```rust
/// remaining_accounts:
///   [0] source_allowance_account (mut) - PDA for source owner's new balance
///   [1] source_owner_address (readonly)
///   [2] dest_allowance_account (mut) - PDA for destination owner's new balance
///   [3] dest_owner_address (readonly)
pub fn transfer<'info>(
    ctx: Context<'_, '_, '_, 'info, IncoTransfer<'info>>,
    ciphertext: Vec<u8>,  // Encrypted transfer amount
    input_type: u8        // Encryption type identifier
) -> Result<()>
```

**Note:** Both source and destination get new handles after a transfer.

### Delegation Operations

#### approve

Allows a delegate to spend tokens on behalf of the owner:

```rust
/// remaining_accounts:
///   [0] allowance_account (mut) - PDA for granting decrypt access to delegate
///   [1] delegate_address (readonly)
pub fn approve<'info>(
    ctx: Context<'_, '_, '_, 'info, IncoApprove<'info>>,
    ciphertext: Vec<u8>,  // Encrypted allowance amount
    input_type: u8        // Encryption type identifier
) -> Result<()>
```

#### revoke

Revokes delegate permissions:

```rust
pub fn revoke(ctx: Context<IncoRevoke>) -> Result<()>
```

### Burn Operations

#### burn

Burns (destroys) tokens from an account:

```rust
/// remaining_accounts:
///   [0] allowance_account (mut) - PDA for granting decrypt access to owner
///   [1] owner_address (readonly)
pub fn burn<'info>(
    ctx: Context<'_, '_, '_, 'info, IncoBurn<'info>>,
    ciphertext: Vec<u8>,  // Encrypted burn amount
    input_type: u8        // Encryption type identifier
) -> Result<()>
```

### Freeze/Thaw Operations

#### freeze_account

Freezes a token account, preventing any transfers:

```rust
pub fn freeze_account(ctx: Context<FreezeAccount>) -> Result<()>
```

#### thaw_account

Unfreezes a previously frozen token account:

```rust
pub fn thaw_account(ctx: Context<ThawAccount>) -> Result<()>
```

**Note:** Only the freeze authority can freeze or thaw accounts. Frozen accounts cannot send or receive tokens until thawed.

### Authority Management

#### set_mint_authority

Changes the mint authority:

```rust
pub fn set_mint_authority(
    ctx: Context<SetMintAuthority>,
    new_authority: Option<Pubkey>
) -> Result<()>
```

**Warning:** Setting the mint authority to `None` permanently disables minting. This action cannot be undone.

#### set_freeze_authority

Changes the freeze authority:

```rust
pub fn set_freeze_authority(
    ctx: Context<SetFreezeAuthority>,
    new_authority: Option<Pubkey>
) -> Result<()>
```

#### set_account_owner

Changes account ownership:

```rust
pub fn set_account_owner(
    ctx: Context<SetAccountOwner>,
    new_owner: Pubkey
) -> Result<()>
```

#### set_close_authority

Changes the close authority for an account:

```rust
pub fn set_close_authority(
    ctx: Context<SetCloseAuthority>,
    new_authority: Option<Pubkey>
) -> Result<()>
```

---

## Access Control

Access control is a critical component for managing who can decrypt encrypted data.

### Allowance PDAs

When granting decryption access, you must create allowance PDAs (Program Derived Addresses):

```rust
// Allowance PDA derivation
let allowance_pda = Pubkey::find_program_address(
    &[
        new_handle.to_le_bytes(),  // The handle being granted access to
        owner_address.as_ref()      // The address being granted access
    ],
    &program_id
);
```

### Simulation Pattern

To get the handle before a transaction is executed, use a simulation pattern:

1. Simulate the transaction to get the handle that will be created
2. Derive the allowance PDA using the simulated handle
3. Include the allowance PDA in `remaining_accounts` when executing the actual transaction

### Granting Access

Access is granted by including the appropriate allowance PDAs in the `remaining_accounts` parameter of instructions that create or modify encrypted values.

**Example from mint_to:**
```rust
/// remaining_accounts:
///   [0] allowance_account (mut) - PDA for granting decrypt access
///   [1] owner_address (readonly) - The owner to grant access to
```

---

## JavaScript/TypeScript Integration

While specific Inco Lightning JavaScript SDK documentation wasn't fully available in the fetched pages, you would integrate with confidential Solana programs using standard Solana JavaScript libraries along with Inco's JavaScript SDK.

### Expected Integration Pattern

```typescript
// Standard Solana imports
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';

// Inco Lightning SDK (expected structure)
import { encrypt, decrypt, IncoClient } from '@inco/lightning-sdk';

// Encrypt data client-side before sending
const encryptedAmount = await encrypt(amount, publicKey);

// Send transaction with encrypted data
const tx = await program.methods
  .transfer(encryptedAmount, inputType)
  .accounts({
    source: sourceAccount,
    destination: destAccount,
    authority: wallet.publicKey,
    incoLightningProgram: INCO_LIGHTNING_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts([
    // Allowance PDAs for access control
  ])
  .rpc();

// Decrypt data (with proper access)
const decryptedValue = await decrypt(encryptedHandle, privateKey);
```

### Key Points for Client Integration

1. **Encryption:** Data must be encrypted client-side before being sent to the program
2. **Input Types:** Different encryption types may have different `input_type` identifiers
3. **Ciphertext Format:** Encrypted data is passed as `Vec<u8>` (byte array)
4. **Access Control:** Must properly set up allowance PDAs for decryption rights
5. **Simulation:** May need to simulate transactions to get handles before execution

---

## Architecture

### Components

#### 1. Smart Contract Library

The Inco Lightning SDK extends Solana programs with encrypted data types and operations. It's integrated via the `inco-lightning` crate.

Provides:
- Encrypted data types (`Euint128`, `Ebool`)
- CPI operations for encrypted computation
- Handle management

#### 2. Confidential Compute Nodes

Run in Trusted Execution Environments (TEEs) and execute confidential computations:

- Run the Inco computation binary in a secure enclave
- Process encrypted operations based on blockchain events
- Maintain cryptographic guarantees

#### 3. Decryption Nodes

Multiple decryption nodes operate in a quorum of TEEs to ensure security and reliability:

- Verify access control rules
- Decrypt values when authorized
- Sign decryption results
- Submit callbacks to programs

### Decryption Mechanisms

Inco provides two types of decryption:

#### Re-encryption (for private viewing)

Used when a user wants to view their confidential data:

1. User signs a message proving ownership of their wallet
2. Client generates an ephemeral keypair
3. User sends decryption request with signed message and ephemeral public key
4. Decryption node verifies signature and checks access control
5. Decryption node re-encrypts data with user's ephemeral public key
6. User decrypts the result with ephemeral private key

**Purpose:** No information leakage in transit

#### Onchain Decryption

Used when the result needs to be made available on-chain:

1. Smart contract calls a decryption function
2. Decryption network monitors for decryption events
3. Decryption network queries the ACL to verify permissions
4. Each decryption node decrypts the value and signs the result
5. Relayer collects signatures and submits a callback to the contract

---

## Best Practices

### 1. Handle Management

- Always store handles (not raw encrypted values) in your account structures
- Handles are 128-bit references - treat them as opaque identifiers
- New handles are generated for each operation result

### 2. Access Control

- Plan your access control strategy before implementing
- Use the simulation pattern to get handles before transactions
- Always include necessary allowance PDAs in `remaining_accounts`
- Remember that both parties in a transfer get new handles

### 3. Account Space

- Calculate account space carefully, including all encrypted fields
- `Euint128` and `Ebool` each take 32 bytes
- Add 8 bytes for the account discriminator
- Consider using constants for account sizes

### 4. Error Handling

- Always check that accounts are initialized before operations
- Verify account states (not frozen) before transfers
- Ensure mint matches between accounts and operations
- Validate authorities before privileged operations

### 5. Client-Side Operations

- Encrypt data on the client before sending to the program
- Verify access rights before attempting decryption
- Use appropriate commitment levels for transaction confirmation
- Handle pending balances appropriately

### 6. Testing

- Test with simulated transactions to verify handle generation
- Test access control scenarios thoroughly
- Verify frozen account behavior
- Test authority changes and edge cases

---

## Error Handling

### Common Error Codes

```rust
#[error_code]
pub enum CustomError {
    #[msg("Lamport balance below rent-exempt threshold")]
    NotRentExempt,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid Mint")]
    InvalidMint,
    #[msg("Account not associated with this Mint")]
    MintMismatch,
    #[msg("Owner does not match")]
    OwnerMismatch,
    #[msg("Fixed supply. Token mint cannot mint additional tokens")]
    FixedSupply,
    #[msg("The account cannot be initialized because it is already being used")]
    AlreadyInUse,
    #[msg("Invalid number of provided signers")]
    InvalidNumberOfProvidedSigners,
    #[msg("Invalid number of required signers")]
    InvalidNumberOfRequiredSigners,
    #[msg("State is uninitialized")]
    UninitializedState,
    #[msg("Instruction does not support native tokens")]
    NativeNotSupported,
    #[msg("Non-native account can only be closed if its balance is zero")]
    NonNativeHasBalance,
    #[msg("Invalid instruction")]
    InvalidInstruction,
    #[msg("Invalid state")]
    InvalidState,
    #[msg("Operation overflowed")]
    Overflow,
    #[msg("Account does not support specified authority type")]
    AuthorityTypeNotSupported,
    #[msg("This token mint cannot freeze accounts")]
    MintCannotFreeze,
    #[msg("The account is frozen")]
    AccountFrozen,
    #[msg("The provided decimals value different from the Mint decimals")]
    MintDecimalsMismatch,
    #[msg("Instruction does not support non-native tokens")]
    NonNativeNotSupported,
}
```

### Error Handling Patterns

```rust
// Check initialization
require!(
    account.state == AccountState::Initialized,
    CustomError::UninitializedState
);

// Check not frozen
require!(
    account.state != AccountState::Frozen,
    CustomError::AccountFrozen
);

// Verify mint match
require!(
    account.mint == mint.key(),
    CustomError::MintMismatch
);

// Verify owner
require!(
    account.owner == owner.key(),
    CustomError::OwnerMismatch
);
```

---

## Example Use Cases

### 1. Confidential Payments

Build payment systems where transaction amounts remain private:

```rust
#[account]
pub struct ConfidentialWallet {
    pub owner: Pubkey,
    pub balance: Euint128,
}

pub fn transfer(
    ctx: Context<Transfer>,
    encrypted_amount: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    // Convert ciphertext to handle
    let amount_handle = new_euint128(cpi_ctx, encrypted_amount, input_type)?;
    
    // Subtract from source
    let new_source_balance = e_sub(
        cpi_ctx,
        ctx.accounts.source.balance,
        amount_handle
    )?;
    
    // Add to destination
    let new_dest_balance = e_add(
        cpi_ctx,
        ctx.accounts.destination.balance,
        amount_handle
    )?;
    
    // Update balances
    ctx.accounts.source.balance = new_source_balance;
    ctx.accounts.destination.balance = new_dest_balance;
    
    Ok(())
}
```

### 2. Private Voting/Governance

Implement voting systems where votes are encrypted:

```rust
#[account]
pub struct Proposal {
    pub yes_votes: Euint128,
    pub no_votes: Euint128,
    pub end_time: i64,
}

pub fn vote(
    ctx: Context<Vote>,
    encrypted_vote: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let vote_handle = new_euint128(cpi_ctx, encrypted_vote, input_type)?;
    
    // vote_handle represents either 1 (yes) or 0 (no)
    // Update counts accordingly
    
    Ok(())
}
```

### 3. Confidential Gaming

Create games with hidden state:

```rust
#[account]
pub struct GameState {
    pub player_health: Euint128,
    pub player_score: Euint128,
    pub boss_health: Euint128,
}

pub fn attack(
    ctx: Context<Attack>,
    encrypted_damage: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let damage_handle = new_euint128(cpi_ctx, encrypted_damage, input_type)?;
    
    let new_boss_health = e_sub(
        cpi_ctx,
        ctx.accounts.game.boss_health,
        damage_handle
    )?;
    
    ctx.accounts.game.boss_health = new_boss_health;
    
    Ok(())
}
```

### 4. Private DeFi

Build DeFi protocols with confidential balances:

```rust
#[account]
pub struct LendingPool {
    pub total_deposits: Euint128,
    pub total_borrows: Euint128,
}

#[account]
pub struct UserPosition {
    pub deposited: Euint128,
    pub borrowed: Euint128,
}
```

---

## Development Workflow

### 1. Setup

```bash
# Create new Anchor project
anchor init my-confidential-app
cd my-confidential-app

# Add inco-lightning dependency
# Edit Cargo.toml to add:
# inco-lightning = { version = "0.1.4", features = ["cpi"] }

# Edit Anchor.toml to add:
# [programs.devnet]
# inco_lightning = "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
```

### 2. Build

```bash
anchor build
```

### 3. Test

```bash
anchor test
```

### 4. Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet
```

---

## Resources

### Official Links

- **Documentation:** https://docs.inco.org/svm/
- **Demo Applications:** https://comfy-solana-ten.vercel.app/
- **Discord Support:** https://discord.com/invite/inco
- **GitHub:** https://github.com/Inco-fhevm
- **Twitter:** https://x.com/inconetwork
- **Feedback Form:** https://docs.google.com/forms/d/e/1FAIpQLSetj4PsvNUSTP7nQYun9D-VF1cXX6YtYctjKkzC4j-x_g2wXg/viewform

### Learning Resources

- **Quickstart Guide:** https://docs.inco.org/svm/rust-sdk/overview
- **Concepts Guide:** https://docs.inco.org/svm/guide/intro
- **Confidential SPL Token Tutorial:** https://docs.inco.org/svm/tutorials/confidential-spl-token/overview
- **Library Reference:** https://docs.inco.org/svm/rust-sdk/lib-reference

### Related Technologies

**Inco Products:**
- **Inco Lightning:** TEE-based confidential computing (this document)
- **Inco Atlas:** FHE and MPC-based solution for maximum privacy

**Solana Resources:**
- **Solana Documentation:** https://solana.com/docs
- **Anchor Framework:** https://www.anchor-lang.com/
- **Solana Cookbook:** https://solana.com/developers/cookbook

---

## Important Notes

### Beta Status

- The SVM integration is currently in **beta**
- Features are subject to change
- Currently live on Solana **Devnet** only
- Not recommended for production use yet

### Limitations & Considerations

1. **Network:** Currently only available on Solana Devnet
2. **Testing:** Extensive testing required before any mainnet deployment
3. **Documentation:** Some SDK features may not be fully documented yet
4. **Performance:** Off-chain processing may introduce latency
5. **Storage:** Encrypted values are stored as handles, actual data is off-chain

### Security Considerations

1. **TEE Trust:** System relies on Trusted Execution Environments
2. **Key Management:** Proper key management is critical on client side
3. **Access Control:** Carefully design who can decrypt what data
4. **Audits:** Ensure your program logic is audited for security
5. **Testing:** Test all encryption/decryption flows thoroughly

---

##