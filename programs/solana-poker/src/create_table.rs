use anchor_lang::prelude::*;
use crate::state::PokerTable;
use crate::error::PokerError;
use crate::constants::MAX_PLAYERS;

/// Creates a new poker table with configuration
pub fn handler(
    ctx: Context<CreateTable>,
    table_id: u64,
    max_players: u8,
    buy_in_min: u64,
    buy_in_max: u64,
    small_blind: u64,
    backend_account: Pubkey,
) -> Result<()> {
    require!(max_players >= 2 && max_players <= MAX_PLAYERS, PokerError::InvalidBuyIn);
    require!(buy_in_min > 0 && buy_in_min <= buy_in_max, PokerError::InvalidBuyIn);
    require!(small_blind > 0, PokerError::InvalidBuyIn);

    let table = &mut ctx.accounts.table;
    table.creator = ctx.accounts.creator.key();
    table.backend = backend_account;
    table.table_id = table_id;
    table.max_players = max_players;
    table.buy_in_min = buy_in_min;
    table.buy_in_max = buy_in_max;
    table.small_blind = small_blind;
    table.current_game = None;
    table.player_count = 0;
    table.bump = ctx.bumps.table;

    msg!("Poker table {} created by {} with backend {}", table_id, ctx.accounts.creator.key(), backend_account);
    Ok(())
}

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(
        init,
        payer = creator,
        space = PokerTable::LEN,
        seeds = [b"table", creator.key().as_ref(), &table_id.to_le_bytes()],
        bump
    )]
    pub table: Account<'info, PokerTable>,

    /// Table vault PDA for holding SOL
    #[account(
        seeds = [b"vault", table.key().as_ref()],
        bump
    )]
    /// CHECK: This is a PDA vault that will hold SOL
    pub vault: AccountInfo<'info>,

    /// Player creating the table
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
