use super::GameStage;
use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;

/// Simplified poker game state for the new flow
/// - Cards are processed on-chain (shuffle + deal with encryption)
/// - Gameplay happens off-chain (backend manages stages)
/// - Settlement happens on-chain (winner gets pot)
#[account]
pub struct PokerGame {
    /// Reference to the parent table
    pub table: Pubkey,
    /// Game ID (incremented per new game)
    pub game_id: u64,
    /// Simplified game stage: Waiting, Playing, Finished
    pub stage: GameStage,
    /// Total pot in lamports
    pub pot: u64,
    /// Total number of players in game
    pub player_count: u8,

    // ===== CARD STATE =====
    /// Shuffle seed derived from blockhash (used for Fisher-Yates shuffle)
    pub shuffle_seed: u64,
    /// Encrypted offset (blockhash % 52, encrypted) applied to all cards
    pub card_offset: Euint128,
    /// Shuffled indices [0,1,2,3,4] in random order for player assignment
    pub shuffled_indices: [u8; 5],
    /// Deal cards (encrypted hole cards) - 10 cards, 2 per player
    pub deal_cards: [Euint128; 10],
    /// Community cards (encrypted) - 5 cards total
    pub community_cards: [Euint128; 5],
    /// Whether all 8 batches of cards have been processed
    pub cards_processed: bool,

    // ===== ACCESS CONTROL =====
    /// Backend account that can decrypt all community cards
    pub backend_account: Pubkey,

    // ===== GAME RESULT =====
    /// Winner seat index (set during settlement)
    pub winner_seat: Option<u8>,
    /// Final pot distribution amounts per player
    pub payouts: [u64; 5],
    /// Bump seed for PDA
    pub bump: u8,
}

impl PokerGame {
    /// Calculate space needed for account
    /// 8 (discriminator) + 32 (table) + 8 (game_id) + 1 (stage)
    /// + 8 (pot) + 1 (player_count)
    /// + 8 (shuffle_seed) + 16 (card_offset) + 5 (shuffled_indices)
    /// + 160 (deal_cards) + 80 (community_cards) + 1 (cards_processed)
    /// + 32 (backend_account)
    /// + 2 (winner_seat) + 40 (payouts) + 1 (bump)
    pub const LEN: usize = 8 + 32 + 8 + 1 + 8 + 1 + 8 + 16 + 5 + 160 + 80 + 1 + 32 + 2 + 40 + 1;

    /// Get hole cards for a specific player (using shuffled assignment)
    pub fn get_player_hole_cards(&self, player_idx: u8) -> Option<(Euint128, Euint128)> {
        if player_idx >= 5 {
            return None;
        }

        // Find which position in deal_cards corresponds to this player
        for (pos, &shuffled_player) in self.shuffled_indices.iter().enumerate() {
            if shuffled_player == player_idx {
                let card1_idx = pos * 2;
                let card2_idx = pos * 2 + 1;
                return Some((self.deal_cards[card1_idx], self.deal_cards[card2_idx]));
            }
        }
        None
    }
}
