use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::VerifySignature},
    program::IncoLightning,
    ID as INCO_LIGHTNING_ID,
};
use crate::state::{Raffle, Ticket};
use crate::error::RaffleError;

#[derive(Accounts)]
pub struct WithdrawPrize<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(mut)]
    pub raffle: Account<'info, Raffle>,

    #[account(mut)]
    pub ticket: Account<'info, Ticket>,

    /// CHECK: vault PDA - we need the bump to sign
    #[account(
        mut,
        seeds = [b"vault", raffle.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

/// Withdraw prize by proving winner status via is_winner_handle decryption
/// First-come-first-serve: first verified winner takes the vault
pub fn handler(
    ctx: Context<WithdrawPrize>,
    handle: Vec<u8>,
    plaintext: Vec<u8>,
) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    let raffle = &mut ctx.accounts.raffle;

    require!(ticket.owner == ctx.accounts.winner.key(), RaffleError::NotOwner);
    require!(ticket.is_winner_handle != 0, RaffleError::NotChecked);
    require!(!ticket.claimed, RaffleError::AlreadyClaimed);
    require!(!raffle.prize_claimed, RaffleError::AlreadyClaimed);

    // Verify the decryption signature on-chain for is_winner_handle
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        VerifySignature {
            instructions: ctx.accounts.instructions.to_account_info(),
            signer: ctx.accounts.winner.to_account_info(),
        },
    );

    cpi::is_validsignature(
        cpi_ctx,
        1,
        Some(vec![handle]),
        Some(vec![plaintext.clone()]),
    )?;

    // Parse the verified plaintext - should be non-zero for winner
    msg!("Plaintext bytes: {:?}", plaintext);
    let is_winner = parse_plaintext_to_bool(&plaintext)?;
    msg!("Parsed is_winner: {}", is_winner);
    require!(is_winner, RaffleError::NotWinner);

    // Mark as claimed to prevent double-withdraw
    ticket.claimed = true;
    raffle.prize_claimed = true;

    // Transfer entire vault to winner (first-come-first-serve)
    let prize = ctx.accounts.vault.lamports();
    require!(prize > 0, RaffleError::NoFunds);

    // Use invoke_signed with vault PDA seeds
    let raffle_key = raffle.key();
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        raffle_key.as_ref(),
        &[ctx.bumps.vault],
    ];

    anchor_lang::solana_program::program::invoke_signed(
        &anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault.key(),
            &ctx.accounts.winner.key(),
            prize,
        ),
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.winner.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;

    msg!("Prize withdrawn: {} lamports!", prize);
    Ok(())
}

/// Parse decrypted boolean plaintext
/// Handles multiple formats: raw bytes (u128 LE), single byte, or string "0"/"1"
fn parse_plaintext_to_bool(plaintext: &[u8]) -> Result<bool> {
    if plaintext.is_empty() {
        return Ok(false);
    }

    // Check if any byte is non-zero (handles u128 LE format where 1 = [1,0,0,0,...])
    let any_nonzero = plaintext.iter().any(|&b| b != 0 && b != b'0');

    // Also check for string "0" which should be false
    if let Ok(s) = std::str::from_utf8(plaintext) {
        if s == "0" || s == "false" {
            return Ok(false);
        }
        if s == "1" || s == "true" {
            return Ok(true);
        }
    }

    Ok(any_nonzero)
}
