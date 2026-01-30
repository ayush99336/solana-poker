use crate::error::PokerError;
use crate::state::{PokerGame, PokerTable};
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Allow;
use inco_lightning::cpi::allow;
use inco_lightning::program::IncoLightning;

/// Backend reveals all 5 community cards for off-chain gameplay management
///
/// This instruction allows the backend account to decrypt all community cards
/// so it can reveal them progressively (flop, turn, river) during off-chain gameplay.
///
/// Requires 5 allowance accounts in remaining_accounts (one per community card).
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, RevealCommunity<'info>>) -> Result<()> {
    require!(
        ctx.remaining_accounts.len() >= 5,
        PokerError::MissingAllowanceAccounts
    );

    let game = &ctx.accounts.game;

    // Validate cards have been processed
    require!(game.cards_processed, PokerError::CardsNotProcessed);

    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    let authority = ctx.accounts.backend.to_account_info();
    let backend = ctx.accounts.backend.to_account_info();

    // Allow backend to decrypt all 5 community cards
    for i in 0..5 {
        let handle = game.community_cards[i];
        let allowance_acc = &ctx.remaining_accounts[i];

        let cpi_ctx = CpiContext::new(
            cpi_program.clone(),
            Allow {
                allowance_account: allowance_acc.clone(),
                signer: authority.clone(),
                allowed_address: backend.clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );

        allow(cpi_ctx, handle.0, true, ctx.accounts.backend.key())?;
        msg!("Allowed community card {} decrypt for backend", i);
    }

    msg!(
        "All 5 community cards revealed to backend: {}",
        ctx.accounts.backend.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RevealCommunity<'info> {
    #[account(
        constraint = table.backend == backend.key() @ PokerError::NotBackend
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        constraint = game.table == table.key() @ PokerError::NoActiveGame,
        constraint = game.cards_processed @ PokerError::CardsNotProcessed
    )]
    pub game: Account<'info, PokerGame>,

    /// CHECK: Backend signer receiving decrypt access for all community cards
    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}
