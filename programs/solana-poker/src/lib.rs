#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod state;

pub mod advance_stage;
pub mod create_table;
pub mod join_table;
pub mod leave_table;
pub mod process_cards;
pub mod reveal_card_offset;
pub mod reveal_shuffle_random;
pub mod settle_game;
pub mod start_game;
pub mod update_round;

use crate::state::RoundSummary;
use advance_stage::*;
use create_table::*;
use join_table::*;
use leave_table::*;
use process_cards::*;
use reveal_card_offset::*;
use reveal_shuffle_random::*;
use settle_game::*;
use start_game::*;
use update_round::*;

pub mod reveal_hand;
use reveal_hand::*;

declare_id!("7EZ1zWNMjuHh62dikk9TAo478VMzAiLkvg8S7Vm85T7s");

#[program]
pub mod solana_poker {
    use super::*;

    /// Creates a new poker table
    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        max_players: u8,
        buy_in_min: u64,
        buy_in_max: u64,
        small_blind: u64,
    ) -> Result<()> {
        create_table::handler(
            ctx,
            table_id,
            max_players,
            buy_in_min,
            buy_in_max,
            small_blind,
        )
    }

    /// Player joins a table with a buy-in
    pub fn join_table(ctx: Context<JoinTable>, buy_in: u64) -> Result<()> {
        join_table::handler(ctx, buy_in)
    }

    /// Player leaves table and withdraws chips
    pub fn leave_table(ctx: Context<LeaveTable>, amount: u64) -> Result<()> {
        leave_table::handler(ctx, amount)
    }

    /// Admin starts a new game
    pub fn start_game(
        ctx: Context<StartGame>,
        game_id: u64,
        frontend_account: Pubkey,
    ) -> Result<()> {
        start_game::handler(ctx, game_id, frontend_account)
    }

    /// ============================================
    /// NEW: Process cards in mini-batches (2 cards per batch)
    /// ============================================
    ///
    /// Batch 0: Cards 0-1, generates random + shuffle
    /// Batch 1-6: Cards 2-13
    /// Batch 7: Card 14-15, finalizes
    ///
    /// Replaces: submit_cards + apply_offset_batch + generate_offset + deal_cards
    pub fn process_cards_batch<'info>(
        ctx: Context<'_, '_, '_, 'info, ProcessCardsBatch<'info>>,
        batch_index: u8,
        card_0: Vec<u8>,
        card_1: Vec<u8>,
        input_type: u8,
    ) -> Result<()> {
        process_cards::handler(ctx, batch_index, card_0, card_1, input_type)
    }

    /// Player reveals their hand (grants decrypt access to themselves)
    pub fn reveal_hand<'info>(ctx: Context<'_, '_, '_, 'info, RevealHand<'info>>) -> Result<()> {
        reveal_hand::handler(ctx)
    }

    /// Admin allows a player to decrypt the shuffle_random handle
    pub fn reveal_shuffle_random<'info>(
        ctx: Context<'_, '_, '_, 'info, RevealShuffleRandom<'info>>,
    ) -> Result<()> {
        reveal_shuffle_random::handler(ctx)
    }

    /// Admin allows a player to decrypt the card_offset handle
    /// Used to verify the bounded offset (0-51) is consistent
    pub fn reveal_card_offset<'info>(
        ctx: Context<'_, '_, '_, 'info, RevealCardOffset<'info>>,
    ) -> Result<()> {
        reveal_card_offset::handler(ctx)
    }

    /// Apply an aggregated betting round summary (one tx per stage)
    pub fn update_round<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateRound<'info>>,
        summary: RoundSummary,
    ) -> Result<()> {
        update_round::handler(ctx, summary)
    }

    /// Advance game to next stage
    /// Pass PlayerSeat accounts via remaining_accounts to reset bets
    pub fn advance_stage<'info>(
        ctx: Context<'_, '_, '_, 'info, AdvanceStage<'info>>,
    ) -> Result<()> {
        advance_stage::handler(ctx)
    }

    /// Settle the game and pay the winner
    pub fn settle_game(ctx: Context<SettleGame>, winner_seat_index: u8) -> Result<()> {
        settle_game::handler(ctx, winner_seat_index)
    }
}
