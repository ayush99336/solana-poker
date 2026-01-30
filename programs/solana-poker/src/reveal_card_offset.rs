use crate::error::PokerError;
use crate::state::{PokerGame, PokerTable};
use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Allow;
use inco_lightning::cpi::allow;
use inco_lightning::program::IncoLightning;

/// Admin allows a player to decrypt the card_offset handle
/// This is useful for verifying that the bounded offset (0-51) is consistent
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, RevealCardOffset<'info>>) -> Result<()> {
    require!(
        ctx.remaining_accounts.len() >= 1,
        PokerError::MissingAllowanceAccounts
    );

    let game = &ctx.accounts.game;
    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    let authority = ctx.accounts.backend.to_account_info();
    let allowed_player = ctx.accounts.player.to_account_info();
    let allowance_acc = &ctx.remaining_accounts[0];

    let cpi_ctx = CpiContext::new(
        cpi_program,
        Allow {
            allowance_account: allowance_acc.clone(),
            signer: authority,
            allowed_address: allowed_player,
            system_program: ctx.accounts.system_program.to_account_info(),
        },
    );

    allow(cpi_ctx, game.card_offset.0, true, ctx.accounts.player.key())?;
    msg!(
        "Allowed card_offset decrypt for {}",
        ctx.accounts.player.key()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RevealCardOffset<'info> {
    pub table: Account<'info, PokerTable>,

    #[account(
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    /// CHECK: player receiving decrypt access
    pub player: UncheckedAccount<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}
