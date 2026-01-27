use anchor_lang::prelude::*;
use crate::state::PokerTable;
use crate::error::PokerError;

/// Player leaves table and withdraws their chips
pub fn handler(ctx: Context<LeaveTable>, amount: u64) -> Result<()> {
    let table = &ctx.accounts.table;
    
    // Check no game in progress
    require!(table.current_game.is_none(), PokerError::CannotLeaveDuringGame);
    require!(amount > 0, PokerError::InvalidBetAmount);

    // Transfer SOL from vault to player
    let table_key = table.key();
    let seeds = &[
        b"vault",
        table_key.as_ref(),
        &[ctx.bumps.vault],
    ];
    let signer_seeds = &[&seeds[..]];

    **ctx.accounts.vault.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.player.try_borrow_mut_lamports()? += amount;

    msg!(
        "Player {} withdrew {} lamports from table",
        ctx.accounts.player.key(),
        amount
    );

    Ok(())
}

#[derive(Accounts)]
pub struct LeaveTable<'info> {
    #[account(mut)]
    pub table: Account<'info, PokerTable>,

    /// CHECK: Vault PDA to withdraw from
    #[account(
        mut,
        seeds = [b"vault", table.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}
