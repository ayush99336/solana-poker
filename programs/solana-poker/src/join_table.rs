use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{PokerTable, PlayerSeat};
use crate::error::PokerError;

/// Player joins a table with a buy-in
pub fn handler(ctx: Context<JoinTable>, buy_in: u64) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let player_seat = &mut ctx.accounts.player_seat;
    
    // Validate buy-in amount
    require!(
        buy_in >= table.buy_in_min && buy_in <= table.buy_in_max,
        PokerError::InvalidBuyIn
    );
    
    // Check table isn't full
    require!(table.player_count < table.max_players, PokerError::TableFull);
    
    // Check no game in progress
    require!(table.current_game.is_none(), PokerError::GameInProgress);

    // Transfer SOL from player to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        buy_in,
    )?;

    // Initialize PlayerSeat
    player_seat.game = Pubkey::default(); // Will be set/used later
    player_seat.player = ctx.accounts.player.key();
    player_seat.seat_index = table.player_count; // Assign next available seat
    player_seat.chips = buy_in;
    player_seat.current_bet = 0;
    player_seat.total_bet = 0;
    player_seat.is_folded = false;
    player_seat.is_all_in = false;
    player_seat.has_acted = false;
    player_seat.hand_rank = 0;
    player_seat.bump = ctx.bumps.player_seat;

    table.player_count += 1;

    msg!(
        "Player {} joined table at seat {} with {} lamports. Players: {}/{}",
        ctx.accounts.player.key(),
        player_seat.seat_index,
        buy_in,
        table.player_count,
        table.max_players
    );

    Ok(())
}

#[derive(Accounts)]
pub struct JoinTable<'info> {
    #[account(mut)]
    pub table: Account<'info, PokerTable>,

    /// CHECK: Vault PDA to receive SOL
    #[account(
        mut,
        seeds = [b"vault", table.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        init,
        payer = player,
        space = PlayerSeat::LEN,
        seeds = [b"player_seat", table.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}
