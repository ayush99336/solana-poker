use crate::error::PokerError;
use crate::state::{PlayerSeat, PokerGame, PokerTable};
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Allow;
use inco_lightning::cpi::allow;
use inco_lightning::program::IncoLightning;

/// Player reveals their hand by granting themselves decrypt permission
///
/// The player calls this after cards have been processed to get access
/// to their specific hole cards based on the on-chain shuffle.
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, RevealHand<'info>>) -> Result<()> {
    let game = &ctx.accounts.game;
    let seat = &ctx.accounts.player_seat;
    let player = &ctx.accounts.player;

    // Validate game has processed cards
    require!(game.cards_processed, PokerError::CardsNotProcessed);

    // Validate seat belongs to this player
    require!(seat.player == player.key(), PokerError::PlayerNotAtTable);

    // Validate player hasn't folded
    require!(!seat.is_folded, PokerError::PlayerFolded);

    let seat_index = seat.seat_index;

    // Find which card pair is assigned to this seat
    // shuffled_indices[pair_index] = seat_index
    let mut pair_index: usize = 99;
    for (i, &assigned_seat) in game.shuffled_indices.iter().enumerate() {
        if assigned_seat == seat_index {
            pair_index = i;
            break;
        }
    }

    // Validate seat is in the shuffled mapping
    require!(pair_index < 5, PokerError::InvalidGameStage);

    let card_1_idx = pair_index * 2;
    let card_2_idx = pair_index * 2 + 1;

    let handle_1 = game.deal_cards[card_1_idx];
    let handle_2 = game.deal_cards[card_2_idx];

    msg!(
        "Revealing hand for seat {} (pair idx {}): slots {}, {}",
        seat_index,
        pair_index,
        card_1_idx,
        card_2_idx
    );

    // CPI to Inco to allow access (backend is the handle owner)
    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    let authority = ctx.accounts.backend.to_account_info();
    let allowed_player = ctx.accounts.player.to_account_info();

    // Allow Card 1
    if ctx.remaining_accounts.len() >= 1 {
        let allowance_acc = &ctx.remaining_accounts[0];
        let cpi_ctx = CpiContext::new(
            cpi_program.clone(),
            Allow {
                allowance_account: allowance_acc.clone(),
                signer: authority.clone(),
                allowed_address: allowed_player.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        allow(cpi_ctx, handle_1.0, true, player.key())?;
        msg!("Allowed card 1 decrypt access");
    }

    // Allow Card 2
    if ctx.remaining_accounts.len() >= 2 {
        let allowance_acc = &ctx.remaining_accounts[1];
        let cpi_ctx = CpiContext::new(
            cpi_program.clone(),
            Allow {
                allowance_account: allowance_acc.clone(),
                signer: authority.clone(),
                allowed_address: allowed_player.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        allow(cpi_ctx, handle_2.0, true, player.key())?;
        msg!("Allowed card 2 decrypt access");
    }

    Ok(())
}

#[derive(Accounts)]
pub struct RevealHand<'info> {
    pub table: Account<'info, PokerTable>,

    #[account(
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    #[account(
        seeds = [b"player_seat", table.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_seat: Account<'info, PlayerSeat>,

    /// CHECK: player receiving decrypt access
    pub player: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}
