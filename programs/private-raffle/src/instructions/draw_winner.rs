use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{self, accounts::Operation, e_rand, e_rem, e_add},
    program::IncoLightning,
    types::Euint128,
    ID as INCO_LIGHTNING_ID,
};
use crate::state::Raffle;
use crate::error::RaffleError;

#[derive(Accounts)]
pub struct DrawWinner<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub raffle: Account<'info, Raffle>,

    pub system_program: Program<'info, System>,

    #[account(address = INCO_LIGHTNING_ID)]
    pub inco_lightning_program: Program<'info, IncoLightning>,
}

/// Draw a random winning number (1-100) using on-chain randomness
/// This prevents the authority from cheating by choosing their own number
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DrawWinner<'info>>,
) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    require!(raffle.authority == ctx.accounts.authority.key(), RaffleError::Unauthorized);
    require!(raffle.is_open, RaffleError::RaffleClosed);

    raffle.is_open = false;

    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let signer = ctx.accounts.authority.to_account_info();

    // Generate encrypted random number
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let random: Euint128 = e_rand(cpi_ctx, 0)?;

    // Create encrypted 100 for modulo
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let hundred: Euint128 = cpi::as_euint128(cpi_ctx, 100u128)?;

    // random % 100 gives 0-99
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let bounded: Euint128 = e_rem(cpi_ctx, random, hundred, 0)?;

    // Create encrypted 1 to add
    let cpi_ctx = CpiContext::new(inco.clone(), Operation { signer: signer.clone() });
    let one: Euint128 = cpi::as_euint128(cpi_ctx, 1u128)?;

    // Add 1 to get 1-100 range
    let cpi_ctx = CpiContext::new(inco, Operation { signer });
    let winning_number: Euint128 = e_add(cpi_ctx, bounded, one, 0)?;

    raffle.winning_number_handle = winning_number.0;

    msg!("Winning number drawn randomly!");
    msg!("   Handle: {}", winning_number.0);
    msg!("   (Encrypted random 1-100 - nobody knows, not even the authority!)");
    Ok(())
}
