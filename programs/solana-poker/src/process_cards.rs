use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Operation;
use inco_lightning::cpi::{self, e_add, e_rand, e_rem, new_euint128};
use inco_lightning::program::IncoLightning;
use inco_lightning::types::Euint128;
use crate::state::{PokerTable, PokerGame, GameStage};
use crate::error::PokerError;

/// Process cards in mini-batches (2 cards per batch, 8 batches total)
/// 
/// Flow:
/// - Batch 0: Cards 0-1, generates random offset + shuffle
/// - Batch 1-6: Cards 2-13
/// - Batch 7: Cards 14, finalizes processing
/// 
/// Each batch:
/// 1. Converts backend ciphertext to Eu128 handles
/// 2. Applies value offset with e_add
/// 3. Stores in deal_cards or community_cards (shuffled)
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ProcessCardsBatch<'info>>,
    batch_index: u8,
    card_0: Vec<u8>,
    card_1: Vec<u8>,
    input_type: u8,
) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // ===== VALIDATION =====
    require!(game.stage == GameStage::Waiting, PokerError::InvalidGameStage);
    require!(!game.cards_processed, PokerError::CardsAlreadyProcessed);
    require!(batch_index < 8, PokerError::InvalidBatchIndex);

    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    // Inco CPI uses invoke (no invoke_signed), so signer must be a real signer
    let authority = ctx.accounts.admin.to_account_info();
    
    let op_accounts = Operation {
        signer: authority.clone(),
    };

    // ===== BATCH 0: Generate random and shuffle indices =====
    if batch_index == 0 {
        let random: Euint128 = e_rand(
            CpiContext::new(
                cpi_program.clone(),
                op_accounts.clone(),
            ),
            16,
        )?;
        
        game.shuffle_random = random;
        game.shuffled_indices = do_simple_shuffle(random)?;
        msg!("Generated random, shuffled: {:?}", game.shuffled_indices);
    }
    
    // Refresh ref after mutable borrow? No, e_rand returned Euint.
    // We need to re-borrow game if we need it? No, game is ctx.accounts.game.
    // But e_rand required CpiContext.
    // Note: e_rand doesn't borrow game mutably?
    // Wait, game is &mut Account.
    // The previous code had:
    // game.shuffle_random = random;
    // So we are rewriting the logic.

    let random = game.shuffle_random;
    let fifty_two: Euint128 = cpi::as_euint128(
        CpiContext::new(
            cpi_program.clone(),
            op_accounts.clone(),
        ),
        52u128,
    )?;
    let bounded_offset: Euint128 = e_rem(
        CpiContext::new(
            cpi_program.clone(),
            op_accounts.clone(),
        ),
        random,
        fifty_two,
        16,
    )?;
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
            CpiContext::new(
                cpi_program.clone(),
                op_accounts.clone(),
            ),
            cards[i].clone(),
            input_type,
        )?;
        
        // Apply value offset
        let enc_offset_crd: Euint128 = e_add(
            CpiContext::new(
                cpi_program.clone(),
                op_accounts.clone(),
            ),
            enc_bck_crd,
            bounded_offset,
            16,
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
            // Community cards (10-14)
            let comm_idx = actual_idx - 10;
            let shuffled_comm = game.shuffled_indices[comm_idx] as usize;
            game.community_cards[shuffled_comm] = enc_offset_crd;
            msg!("Comm {} -> slot {}", actual_idx, shuffled_comm);
        }
    }

    // ===== FINALIZE AFTER BATCH 7 (card 14) =====
    if batch_index == 7 {
        game.cards_processed = true;
        game.stage = GameStage::PreFlop;
        msg!("All cards processed! -> PreFlop");
    } else {
        msg!("Batch {} done", batch_index);
    }

    Ok(())
}

/// Simple shuffle using random handle as seed
fn do_simple_shuffle(random: Euint128) -> Result<[u8; 5]> {
    let seed = random.0;
    let mut indices: [u8; 5] = [0, 1, 2, 3, 4];
    let seed_bytes = seed.to_le_bytes();
    
    for i in (1..5).rev() {
        let j = (seed_bytes[i % 16] as usize) % (i + 1);
        indices.swap(i, j);
    }
    
    Ok(indices)
}

#[derive(Accounts)]
#[instruction(batch_index: u8)]
pub struct ProcessCardsBatch<'info> {
    #[account(
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        constraint = game.table == table.key() @ PokerError::NoActiveGame,
        constraint = game.stage == GameStage::Waiting @ PokerError::InvalidGameStage
    )]
    pub game: Account<'info, PokerGame>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}
