use anchor_lang::prelude::*;

/// Poker table configuration account
/// Stores table settings and current game reference
#[account]
pub struct PokerTable {
    /// Admin who created and manages the table
    pub admin: Pubkey,
    /// Unique table identifier
    pub table_id: u64,
    /// Maximum players allowed (2-5)
    pub max_players: u8,
    /// Minimum buy-in in lamports
    pub buy_in_min: u64,
    /// Maximum buy-in in lamports
    pub buy_in_max: u64,
    /// Small blind amount in lamports
    pub small_blind: u64,
    /// Current active game (if any)
    pub current_game: Option<Pubkey>,
    /// Number of players currently at table
    pub player_count: u8,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl PokerTable {
    /// Account discriminator (8) + admin (32) + table_id (8) + max_players (1) 
    /// + buy_in_min (8) + buy_in_max (8) + small_blind (8) + current_game (1 + 32) 
    /// + player_count (1) + bump (1)
    pub const LEN: usize = 8 + 32 + 8 + 1 + 8 + 8 + 8 + 33 + 1 + 1;
}
