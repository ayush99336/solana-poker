use anchor_lang::prelude::*;

/// Inco Lightning program ID on devnet
pub const INCO_LIGHTNING_ID: Pubkey = pubkey!("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");


pub const MAX_PLAYERS: u8 = 5;
pub const MIN_PLAYERS: u8 = 2;


pub const HOLE_CARDS_PER_PLAYER: u8 = 2;


pub const COMMUNITY_CARDS: u8 = 5;

pub const TOTAL_CARDS_NEEDED: u8 = 15;

pub const SMALL_BLIND_MULTIPLIER: u64 = 1;
pub const BIG_BLIND_MULTIPLIER: u64 = 2;
