use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;

/// Player seat in an active game
/// Each player has their own seat account with encrypted hole cards
#[account]
pub struct PlayerSeat {
    /// Reference to the game
    pub game: Pubkey,
    /// Player's wallet address
    pub player: Pubkey,
    /// Seat index (0-4)
    pub seat_index: u8,
    /// Player's current chip count in lamports
    pub chips: u64,
    /// First hole card (encrypted)
    pub hole_card_1: Euint128,
    /// Second hole card (encrypted)
    pub hole_card_2: Euint128,
    /// Player's bet in current betting round
    pub current_bet: u64,
    /// Total bet across all rounds
    pub total_bet: u64,
    /// Whether player has folded
    pub is_folded: bool,
    /// Whether player is all-in
    pub is_all_in: bool,
    /// Whether player has acted in current round
    pub has_acted: bool,
    /// Hand rank for showdown (0 = not submitted, higher = better)
    pub hand_rank: u64,
    /// Bump seed for PDA
    pub bump: u8,
}

impl PlayerSeat {
    /// 8 (discriminator) + 32 (game) + 32 (player) + 1 (seat_index) + 8 (chips)
    /// + 16 (hole_card_1) + 16 (hole_card_2) + 8 (current_bet) + 8 (total_bet)
    /// + 1 (is_folded) + 1 (is_all_in) + 1 (has_acted) + 8 (hand_rank) + 1 (bump)
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 16 + 16 + 8 + 8 + 1 + 1 + 1 + 8 + 1;
}
