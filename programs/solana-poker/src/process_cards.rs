use crate::error::PokerError;
use crate::state::{GameStage, PokerGame, PokerTable};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{self, e_add, new_euint128};
use inco_lightning::program::IncoLightning;
use inco_lightning::types::Euint128;

/// Process cards in mini-batches (2 cards per batch, 8 batches total)
///
/// NEW FLOW:
/// - Batch 0: Uses blockhash for shuffle seed and offset (no e_rand)
/// - Batch 1-6: Process cards 2-13
/// - Batch 7: Process card 14, set cards_processed = true, stage = Playing
///
/// Uses blockhash instead of e_rand to avoid oscillation issues:
/// - shuffle_seed = slot hash (for Fisher-Yates shuffle)
/// - card_offset = encrypted(slot % 52) (for card value offset)
///
/// After batch 7 completes, backend can proceed with off-chain gameplay.
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ProcessCardsBatch<'info>>,
    batch_index: u8,
    card_0: Vec<u8>,
    card_1: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // ===== VALIDATION =====
    require!(
        game.stage == GameStage::Waiting,
        PokerError::InvalidGameStage
    );
    require!(!game.cards_processed, PokerError::CardsAlreadyProcessed);
    require!(batch_index < 8, PokerError::InvalidBatchIndex);

    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    let authority = ctx.accounts.backend.to_account_info();

    let op_accounts = Operation {
        signer: authority.clone(),
    };

    // ===== BATCH 0: Generate shuffle seed and offset from blockhash =====
    if batch_index == 0 {
        // Get current slot as source of randomness
        let clock = Clock::get()?;
        let slot = clock.slot;

        // Use slot as shuffle seed (deterministic, based on when tx lands)
        game.shuffle_seed = slot;

        // Compute offset: slot % 52 (value between 0-51)
        let offset_value = (slot % 52) as u128;

        // Encrypt the offset value using as_euint128
        // This creates an encrypted handle for the offset
        let encrypted_offset: Euint128 = cpi::as_euint128(
            CpiContext::new(cpi_program.clone(), op_accounts.clone()),
            offset_value,
        )?;

        game.card_offset = encrypted_offset;
        game.shuffled_indices = do_simple_shuffle(slot);

        msg!(
            "Batch 0: slot={}, offset={}, shuffled_indices={:?}",
            slot,
            offset_value,
            game.shuffled_indices
        );
    }

    // Use stored encrypted offset for all batches
    let card_offset = game.card_offset;

    let cards = [card_0, card_1];
    let base_idx = (batch_index as usize) * 2;

    // ===== PROCESS 2 CARDS =====
    for i in 0..2 {
        let actual_idx = base_idx + i;

        // Skip card 15+ (only 15 cards total)
        if actual_idx >= 15 {
            continue;
        }

        // Convert ciphertext to Eu128
        let enc_bck_crd: Euint128 = new_euint128(
            CpiContext::new(cpi_program.clone(), op_accounts.clone()),
            cards[i].clone(),
            input_type,
        )?;

        // Apply encrypted offset (0-51) to card value
        // scalar_byte = 0 means both operands are ciphertexts
        let enc_offset_crd: Euint128 = e_add(
            CpiContext::new(cpi_program.clone(), op_accounts.clone()),
            enc_bck_crd,
            card_offset,
            0,
        )?;

        // Store based on card type
        if actual_idx < 10 {
            // Hole cards: apply shuffle to player assignment
            let pair_idx = actual_idx / 2;
            let shuffled_pair = game.shuffled_indices[pair_idx % 5] as usize;
            let card_slot = shuffled_pair * 2 + (actual_idx % 2);
            game.deal_cards[card_slot] = enc_offset_crd;
            msg!("Hole {} -> slot {}", actual_idx, card_slot);
        } else {
            // Community cards (10-14) - stored directly (no shuffle for community)
            let comm_idx = actual_idx - 10;
            game.community_cards[comm_idx] = enc_offset_crd;
            msg!("Community {} -> slot {}", actual_idx, comm_idx);
        }
    }

    // ===== FINALIZE AFTER BATCH 7 =====
    if batch_index == 7 {
        game.cards_processed = true;
        game.stage = GameStage::Playing;
        msg!("All cards processed! cards_processed=true, stage=Playing");
        msg!("Backend can now proceed with off-chain gameplay");
    } else {
        msg!("Batch {} done", batch_index);
    }

    Ok(())
}

/// Simple shuffle using slot as seed
/// Deterministic based on the slot when batch 0 transaction lands
fn do_simple_shuffle(slot: u64) -> [u8; 5] {
    let mut indices: [u8; 5] = [0, 1, 2, 3, 4];
    let seed_bytes = slot.to_le_bytes();

    // Fisher-Yates shuffle using slot bytes as source of randomness
    for i in (1..5).rev() {
        let j = (seed_bytes[i % 8] as usize) % (i + 1);
        indices.swap(i, j);
    }

    indices
}

#[derive(Accounts)]
#[instruction(batch_index: u8)]
pub struct ProcessCardsBatch<'info> {
    #[account(
        constraint = table.backend == backend.key() @ PokerError::NotBackend
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        constraint = game.table == table.key() @ PokerError::NoActiveGame,
        constraint = game.stage == GameStage::Waiting @ PokerError::InvalidGameStage
    )]
    pub game: Account<'info, PokerGame>,

    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}
