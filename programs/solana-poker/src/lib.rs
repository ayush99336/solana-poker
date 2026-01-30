#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod state;

pub mod create_table;
pub mod join_table;
pub mod refund_all;
pub mod process_cards;
pub mod reveal_card_offset;
pub mod reveal_community;
pub mod reveal_hand;
pub mod settle_game;
pub mod start_game;

use create_table::*;
use join_table::*;
use refund_all::*;
use process_cards::*;
use reveal_card_offset::*;
use reveal_community::*;
use reveal_hand::*;
use settle_game::*;
use start_game::*;

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
        backend_account: Pubkey,
    ) -> Result<()> {
        create_table::handler(
            ctx,
            table_id,
            max_players,
            buy_in_min,
            buy_in_max,
            small_blind,
            backend_account,
        )
    }

    /// Player joins a table with a buy-in
    pub fn join_table(ctx: Context<JoinTable>, buy_in: u64) -> Result<()> {
        join_table::handler(ctx, buy_in)
    }

    /// Backend refunds all players and clears table
    pub fn refund_all<'info>(
        ctx: Context<'_, '_, 'info, 'info, RefundAll<'info>>,
    ) -> Result<()> {
        refund_all::handler(ctx)
    }

    /// Admin starts a new game with blind bets
    ///
    /// Pass small_blind and big_blind seat accounts via remaining_accounts
    /// to collect blind bets at game start.
    pub fn start_game<'info>(
        ctx: Context<'_, '_, 'info, 'info, StartGame<'info>>,
        game_id: u64,
        backend_account: Pubkey,
        small_blind_amount: u64,
        big_blind_amount: u64,
    ) -> Result<()> {
        start_game::handler(
            ctx,
            game_id,
            backend_account,
            small_blind_amount,
            big_blind_amount,
        )
    }

    /// Process cards in mini-batches (2 cards per batch, 8 batches total)
    ///
    /// Batch 0: Uses blockhash for shuffle seed and offset
    /// Batch 1-6: Process cards 2-13
    /// Batch 7: Process card 14, sets cards_processed = true, stage = Playing
    ///
    /// After batch 7, backend can proceed with off-chain gameplay.
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

    /// Admin allows a player to decrypt the card_offset handle
    /// Used to verify the offset value (0-51)
    pub fn reveal_card_offset<'info>(
        ctx: Context<'_, '_, '_, 'info, RevealCardOffset<'info>>,
    ) -> Result<()> {
        reveal_card_offset::handler(ctx)
    }

    /// Backend reveals all 5 community cards for off-chain gameplay
    ///
    /// Pass 5 allowance accounts via remaining_accounts (one per community card).
    /// Backend can then decrypt and reveal cards progressively during gameplay.
    pub fn reveal_community<'info>(
        ctx: Context<'_, '_, '_, 'info, RevealCommunity<'info>>,
    ) -> Result<()> {
        reveal_community::handler(ctx)
    }

    /// Settle the game and pay the winner
    ///
    /// Called by backend after off-chain gameplay completes.
    /// Transfers final_pot from vault to winner's wallet.
    pub fn settle_game(
        ctx: Context<SettleGame>,
        winner_seat_index: u8,
        final_pot: u64,
    ) -> Result<()> {
        settle_game::handler(ctx, winner_seat_index, final_pot)
    }
}
