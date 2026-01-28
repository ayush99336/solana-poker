use crate::error::PokerError;
use crate::state::{GameStage, PokerGame, PokerTable};
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Allow;
use inco_lightning::cpi::allow;
use inco_lightning::program::IncoLightning;

/// Advance game to next stage (PreFlop -> Flop -> Turn -> River -> Showdown)
/// Called by admin after betting round completes
///
/// Pass accounts via remaining_accounts:
/// - First N accounts: allowance accounts for newly revealed community cards
/// - Remaining accounts: PlayerSeat accounts for this game (to reset their bets)
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, AdvanceStage<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Validate stage
    require!(
        game.stage != GameStage::Waiting && game.stage != GameStage::Finished,
        PokerError::InvalidGameStage
    );

    // Check if only one player remains (everyone else folded)
    if game.players_remaining == 1 {
        game.stage = GameStage::Showdown;
        msg!("Only one player remaining, moving to showdown");
        return Ok(());
    }

    // Determine next stage
    let next_stage = game.stage.next().ok_or(PokerError::InvalidGameStage)?;

    // ===== GRANT FRONTEND DECRYPT ACCESS FOR NEW COMMUNITY CARDS =====
    require!(
        game.frontend_account != Pubkey::default(),
        PokerError::FrontendAccountNotSet
    );
    require!(
        ctx.accounts.frontend.key() == game.frontend_account,
        PokerError::FrontendAccountNotSet
    );

    let (reveal_indices, allowance_count): (Vec<usize>, usize) = match next_stage {
        GameStage::Flop => (vec![0, 1, 2], 3),
        GameStage::Turn => (vec![3], 1),
        GameStage::River => (vec![4], 1),
        _ => (vec![], 0),
    };

    if allowance_count > 0 {
        require!(
            ctx.remaining_accounts.len() >= allowance_count,
            PokerError::MissingAllowanceAccounts
        );

        let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
        let authority = ctx.accounts.admin.to_account_info();
        let allowed_frontend = ctx.accounts.frontend.to_account_info();

        for (idx, card_index) in reveal_indices.iter().enumerate() {
            let allowance_acc = &ctx.remaining_accounts[idx];
            let handle = game.community_cards[*card_index];
            let cpi_ctx = CpiContext::new(
                cpi_program.clone(),
                Allow {
                    allowance_account: allowance_acc.clone(),
                    signer: authority.clone(),
                    allowed_address: allowed_frontend.clone(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            );
            allow(cpi_ctx, handle.0, true, game.frontend_account)?;
        }
    }

    // Update revealed community cards based on stage
    match next_stage {
        GameStage::Flop => {
            game.community_revealed |= 0b00000111;
            msg!("Flop revealed (3 community cards)");
        }
        GameStage::Turn => {
            game.community_revealed |= 0b00001000;
            msg!("Turn revealed (4th community card)");
        }
        GameStage::River => {
            game.community_revealed |= 0b00010000;
            msg!("River revealed (5th community card)");
        }
        _ => {}
    }

    // ===== RESET BETTING STATE FOR NEW ROUND =====
    game.current_bet = 0;
    game.players_acted = 0;
    game.last_raiser = 0;
    game.last_raise_amount = 0;
    game.round_bets = [0; 5];
    game.acted_mask = 0;

    // Action starts with first active player after dealer
    let sb_position = (game.dealer_position + 1) % game.player_count;
    let mut action_pos = sb_position;
    let mut checked = 0;

    while checked < game.player_count {
        if game.is_active(action_pos) {
            break;
        }
        action_pos = (action_pos + 1) % game.player_count;
        checked += 1;
    }

    game.action_on = action_pos;
    game.stage = next_stage;

    msg!(
        "Game advanced to {:?}, action on seat {}",
        next_stage,
        action_pos
    );
    Ok(())
}

#[derive(Accounts)]
pub struct AdvanceStage<'info> {
    #[account(
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    pub admin: Signer<'info>,

    /// CHECK: verified against game.frontend_account
    pub frontend: UncheckedAccount<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}

//join room
//backend needs erand
// start game
// shuffled and dealt

//do blind bets before shuffle and deal
// 8 *2 =16
//1st thing save the state once the 8th transaction goes in pokergame pda , pokergame.cardProcessing= true
// either check for the confirmation of last (8th) transactionid if block state = confirmed
//
