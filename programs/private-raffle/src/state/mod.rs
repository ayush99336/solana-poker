use anchor_lang::prelude::*;

/// Raffle account
#[account]
pub struct Raffle {
    pub authority: Pubkey,
    pub raffle_id: u64,
    pub ticket_price: u64,
    pub participant_count: u32,
    pub is_open: bool,
    pub prize_claimed: bool,                // True when a winner has withdrawn
    pub winning_number_handle: u128,        // Encrypted winning number (1-100)
    pub bump: u8,
}

impl Raffle {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 4 + 1 + 1 + 16 + 1 + 32;
}

/// Ticket account
#[account]
pub struct Ticket {
    pub raffle: Pubkey,
    pub owner: Pubkey,
    pub guess_handle: u128,       // Encrypted guess (1-100)
    pub is_winner_handle: u128,   // Encrypted: guess == winning?
    pub claimed: bool,            // Whether this ticket holder has withdrawn
    pub bump: u8,
}

impl Ticket {
    pub const SIZE: usize = 8 + 32 + 32 + 16 + 16 + 1 + 1 + 32;
}
