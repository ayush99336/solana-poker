use anchor_lang::prelude::*;
use inco_lightning::cpi::accounts::Allow;
use inco_lightning::cpi::allow;
use inco_lightning::program::IncoLightning;
use crate::state::{PokerTable, PokerGame};
use crate::error::PokerError;

/// Admin allows a player to decrypt the shuffle_random handle
pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, RevealShuffleRandom<'info>>) -> Result<()> {
    require!(ctx.remaining_accounts.len() >= 1, PokerError::MissingAllowanceAccounts);

    let game = &ctx.accounts.game;
    let cpi_program = ctx.accounts.inco_lightning_program.to_account_info();
    let authority = ctx.accounts.admin.to_account_info();
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

    allow(cpi_ctx, game.shuffle_random.0, true, ctx.accounts.player.key())?;
    msg!("Allowed shuffle_random decrypt for {}", ctx.accounts.player.key());
    Ok(())
}

#[derive(Accounts)]
pub struct RevealShuffleRandom<'info> {
    #[account(
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: player receiving decrypt access
    pub player: UncheckedAccount<'info>,

    pub inco_lightning_program: Program<'info, IncoLightning>,

    pub system_program: Program<'info, System>,
}