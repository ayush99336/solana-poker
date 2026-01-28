pub mod player_seat;
pub mod poker_game;
pub mod poker_table;

pub use player_seat::PlayerSeat;
pub use poker_game::PokerGame;
pub use poker_table::PokerTable;

use anchor_lang::prelude::*;

/// Simplified game stages for the new flow
/// - Waiting: Game created, waiting for cards to be processed
/// - Playing: Cards processed, gameplay happening off-chain
/// - Finished: Game settled, winner paid
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum GameStage {
    #[default]
    Waiting,
    Playing,
    Finished,
}

/// Round summary for final settlement
/// Contains the final state of bets when game ends
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RoundSummary {
    pub round_id: u8,
    pub bets_by_player: [u64; 5],
    pub folded_mask: u8,
    pub all_in_mask: u8,
    pub pot_delta: u64,
    pub current_bet: u64,
    pub last_raiser: u8,
    pub acted_mask: u8,
    pub action_on: u8,
}
