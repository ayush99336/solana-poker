use crate::error::PokerError;
use crate::state::{GameStage, PlayerSeat, PokerGame, PokerTable};
use anchor_lang::prelude::*;

/// Settle the game and pay out the winner
///
/// Called by backend after off-chain gameplay completes.
/// Accepts the final pot amount and winner seat index.
///
/// Flow:
/// 1. Validate game is in Playing stage and cards are processed
/// 2. Transfer pot from vault to winner's wallet
/// 3. Update game state to Finished
/// 4. Clear table's current_game reference
pub fn handler(ctx: Context<SettleGame>, winner_seat_index: u8, final_pot: u64) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let game = &mut ctx.accounts.game;
    let winner_seat = &mut ctx.accounts.winner_seat;

    // Validate game state
    require!(
        game.stage == GameStage::Playing,
        PokerError::InvalidGameStage
    );
    require!(game.cards_processed, PokerError::CardsNotProcessed);
    require!(
        winner_seat.seat_index == winner_seat_index,
        PokerError::PlayerNotAtTable
    );

    // Use final_pot from backend (includes all bets collected off-chain)
    let payout_amount = final_pot;
    let winner = winner_seat.player;

    // Transfer pot to winner via vault PDA
    let table_key = table.key();
    let seeds = &[b"vault", table_key.as_ref(), &[ctx.bumps.vault]];
    let signer = &[&seeds[..]];

    // Only transfer if there's something to pay
    if payout_amount > 0 {
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.winner_wallet.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            payout_amount,
        )?;
    }

    // Update game state
    game.winner_seat = Some(winner_seat_index);
    game.stage = GameStage::Finished;
    game.pot = 0;
    game.payouts[winner_seat_index as usize] = payout_amount;

    // Clear table's current game
    table.current_game = None;

    msg!(
        "Game {} finished. Winner seat {} ({}) won {} lamports",
        game.game_id,
        winner_seat_index,
        winner,
        payout_amount
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(winner_seat_index: u8, final_pot: u64)]
pub struct SettleGame<'info> {
    #[account(
        mut
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        close = backend,
        constraint = game.table == table.key() @ PokerError::NoActiveGame,
        constraint = game.stage == GameStage::Playing @ PokerError::InvalidGameStage
    )]
    pub game: Account<'info, PokerGame>,

    #[account(
        mut,
        constraint = winner_seat.seat_index == winner_seat_index @ PokerError::PlayerNotAtTable
    )]
    pub winner_seat: Account<'info, PlayerSeat>,

    /// CHECK: Winner's wallet to receive payout
    #[account(
        mut,
        constraint = winner_wallet.key() == winner_seat.player @ PokerError::PlayerNotAtTable
    )]
    pub winner_wallet: AccountInfo<'info>,

    /// CHECK: Vault PDA to pay from
    #[account(
        mut,
        seeds = [b"vault", table.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    pub system_program: Program<'info, System>,
}
