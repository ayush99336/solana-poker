use anchor_lang::prelude::*;
use crate::state::{PokerTable, PokerGame, PlayerSeat, RoundSummary, GameStage};
use crate::error::PokerError;

/// Apply an aggregated betting round summary (one tx per stage)
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateRound<'info>>,
    summary: RoundSummary,
) -> Result<()> {
    let game = &mut ctx.accounts.game;

    msg!("Update round: stage={:?} round_id={} pot_delta={} current_bet={}", game.stage, summary.round_id, summary.pot_delta, summary.current_bet);

    // Validate stage
    require!(
        game.stage != GameStage::Waiting && game.stage != GameStage::Finished,
        PokerError::InvalidGameStage
    );

    // Round id must match current stage
    require!(summary.round_id == game.stage as u8, PokerError::InvalidGameStage);

    let previous_round_bets = game.round_bets;

    // Update game summary fields
    game.round_id = summary.round_id;
    game.round_bets = summary.bets_by_player;
    game.folded_mask = summary.folded_mask;
    game.all_in_mask = summary.all_in_mask;
    game.pot = game.pot.saturating_add(summary.pot_delta);
    game.current_bet = summary.current_bet;
    game.last_raiser = summary.last_raiser;
    game.acted_mask = summary.acted_mask;
    game.action_on = summary.action_on;
    game.players_acted = summary.acted_mask.count_ones() as u8;
    game.players_remaining = game.player_count.saturating_sub(summary.folded_mask.count_ones() as u8);

    // Optionally sync PlayerSeat accounts passed in remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        let mut seat: Account<PlayerSeat> = Account::try_from(account_info)?;
        if seat.game == Pubkey::default() {
            seat.game = game.key();
            msg!("Attached seat {} to game", seat.seat_index);
        }
        require!(seat.game == game.key(), PokerError::PlayerNotAtTable);

        let seat_index = seat.seat_index as usize;
        if seat_index >= summary.bets_by_player.len() {
            continue;
        }

        let new_round_bet = summary.bets_by_player[seat_index];
        let delta = new_round_bet.saturating_sub(previous_round_bets[seat_index]);

        msg!("Seat {} bet={} delta={} chips_before={}", seat.seat_index, new_round_bet, delta, seat.chips);

        seat.current_bet = new_round_bet;
        seat.total_bet = seat.total_bet.saturating_add(delta);
        seat.chips = seat.chips.saturating_sub(delta);

        seat.is_folded = ((summary.folded_mask >> seat_index) & 1) == 1;
        seat.is_all_in = ((summary.all_in_mask >> seat_index) & 1) == 1;
        seat.has_acted = ((summary.acted_mask >> seat_index) & 1) == 1;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateRound<'info> {
    #[account(
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    pub admin: Signer<'info>,
}