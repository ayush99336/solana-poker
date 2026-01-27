use anchor_lang::prelude::*;
use crate::state::{PokerTable, PokerGame, PlayerSeat, GameStage};
use crate::error::PokerError;

/// Settle the game and pay out the winner
/// For MVP: winner is determined by highest hand_rank submitted
/// In future: will verify via Noir proofs
pub fn handler(ctx: Context<SettleGame>, winner_seat_index: u8) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let game = &mut ctx.accounts.game;
    let winner_seat = &mut ctx.accounts.winner_seat;

    // Validate
    require!(
        game.stage == GameStage::Showdown || game.players_remaining == 1,
        PokerError::InvalidGameStage
    );
    if winner_seat.game == Pubkey::default() {
        winner_seat.game = game.key();
        msg!("Attached winner seat {} to game", winner_seat.seat_index);
    }
    require!(winner_seat.game == game.key(), PokerError::PlayerNotAtTable);
    require!(!winner_seat.is_folded, PokerError::PlayerFolded);

    let pot = game.pot;
    let winner = winner_seat.player;

    // Transfer pot to winner via vault PDA
    let table_key = table.key();
    let seeds = &[
        b"vault",
        table_key.as_ref(),
        &[ctx.bumps.vault],
    ];
    
    let signer = &[&seeds[..]];

    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.winner_wallet.to_account_info(),
    };
    let cpi_program = ctx.accounts.system_program.to_account_info();
    
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
        pot,
    )?;

    // Update game state
    game.winner_seat = Some(winner_seat_index);
    game.stage = GameStage::Finished;
    game.pot = 0;

    // Clear table's current game
    table.current_game = None;

    msg!(
        "Game {} finished. Winner: {} won {} lamports",
        game.game_id,
        winner,
        pot
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(winner_seat_index: u8)]
pub struct SettleGame<'info> {
    #[account(
        mut,
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    #[account(
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

    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
