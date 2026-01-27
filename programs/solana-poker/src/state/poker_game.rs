use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;
use super::GameStage;

/// Active poker game state
#[account]
pub struct PokerGame {
    /// Reference to the parent table
    pub table: Pubkey,
    /// Game ID (incremented per new game)
    pub game_id: u64,
    /// Current game stage
    pub stage: GameStage,
    /// Betting round id (matches stage for betting rounds)
    pub round_id: u8,
    /// Total pot in lamports
    pub pot: u64,
    /// Current highest bet in this betting round
    pub current_bet: u64,
    /// Dealer position (0-indexed seat)
    pub dealer_position: u8,
    /// Current action position (whose turn)
    pub action_on: u8,
    /// Number of players remaining (not folded)
    pub players_remaining: u8,
    /// Number of players who have acted this round
    pub players_acted: u8,
    /// Total number of players in game
    pub player_count: u8,
    
    // ===== PLAYER STATUS BITMASKS =====
    /// Bitmask of folded players (bit N = player N folded)
    pub folded_mask: u8,
    /// Bitmask of all-in players (bit N = player N all-in)
    pub all_in_mask: u8,
    /// Bitmask of players who have posted blinds this hand
    pub blinds_posted: u8,
    /// Last player who raised (for action tracking)
    pub last_raiser: u8,
    /// Last raise amount (for minimum raise validation)
    pub last_raise_amount: u64,
    /// Bets per player for the current round (per stage summary)
    pub round_bets: [u64; 5],
    /// Bitmask of players who acted this round
    pub acted_mask: u8,
    
    // ===== NEW CARD STATE (Process Cards Architecture) =====
    /// Random value used for shuffling and offset
    pub shuffle_random: Euint128,
    /// Shuffled indices [0,1,2,3,4] in random order for player assignment
    pub shuffled_indices: [u8; 5],
    /// Deal cards (encrypted hole cards) - 10 cards, 2 per player
    pub deal_cards: [Euint128; 10],
    /// Community cards (encrypted) - 5 cards in shuffled order
    pub community_cards: [Euint128; 5],
    /// Whether cards have been processed
    pub cards_processed: bool,
    /// Frontend account that can decrypt community cards
    pub frontend_account: Pubkey,
    
    /// Which community cards have been revealed (bitmask: bit 0-4)
    pub community_revealed: u8,
    
    // ===== GAME RESULT =====
    /// Winner seat index (set during settlement)
    pub winner_seat: Option<u8>,
    /// Bump seed for PDA
    pub bump: u8,
}

impl PokerGame {
    /// Calculate space needed for account
    /// 8 (discriminator) + 32 (table) + 8 (game_id) + 1 (stage) + 1 (round_id)
    /// + 8 (pot) + 8 (current_bet) + 1 (dealer) + 1 (action) + 1 (remaining)
    /// + 1 (acted) + 1 (player_count) + 1 (folded_mask) + 1 (all_in_mask)
    /// + 1 (blinds_posted) + 1 (last_raiser) + 8 (last_raise_amount)
    /// + 40 (round_bets) + 1 (acted_mask)
    /// + 16 (shuffle_random) + 5 (shuffled_indices) + 160 (deal_cards) + 80 (community_cards)
    /// + 1 (cards_processed) + 32 (frontend_account)
    /// + 1 (community_revealed) + 2 (winner_seat) + 1 (bump)
    pub const LEN: usize = 8 + 32 + 8 + 1 + 1 + 8 + 8 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 8
        + 40 + 1
        + 16 + 5 + 160 + 80 + 1 + 32
        + 1 + 2 + 1;
    
    /// Check if a player has folded
    pub fn is_folded(&self, seat: u8) -> bool {
        (self.folded_mask >> seat) & 1 == 1
    }
    
    /// Check if a player is all-in
    pub fn is_all_in(&self, seat: u8) -> bool {
        (self.all_in_mask >> seat) & 1 == 1
    }
    
    /// Check if a player is active (not folded, not all-in)
    pub fn is_active(&self, seat: u8) -> bool {
        !self.is_folded(seat) && !self.is_all_in(seat)
    }
    
    /// Count active players (not folded, not all-in)
    pub fn active_player_count(&self) -> u8 {
        let mut count = 0;
        for i in 0..self.player_count {
            if self.is_active(i) {
                count += 1;
            }
        }
        count
    }
    
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
