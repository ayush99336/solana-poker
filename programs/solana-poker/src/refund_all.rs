use anchor_lang::prelude::*;
use crate::error::PokerError;
use crate::state::{GameStage, PlayerSeat, PokerGame, PokerTable};

/// Backend refunds all players and clears table state
///
/// Remaining accounts: pairs of [player_seat, player_wallet] for each player.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, RefundAll<'info>>) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let game = &mut ctx.accounts.game;

    require!(table.current_game == Some(game.key()), PokerError::NoActiveGame);

    let remaining = &ctx.remaining_accounts;
    require!(
        !remaining.is_empty() && remaining.len() % 2 == 0,
        PokerError::InvalidRefundAccounts
    );

    let table_key = table.key();
    let seeds = &[b"vault", table_key.as_ref(), &[ctx.bumps.vault]];
    let signer = &[&seeds[..]];

    let mut refunded: u8 = 0;

    for i in (0..remaining.len()).step_by(2) {
        let seat_info = &remaining[i];
        let player_wallet = &remaining[i + 1];

        let mut seat: Account<PlayerSeat> = Account::try_from(seat_info)?;

        let (expected, _) = Pubkey::find_program_address(
            &[b"player_seat", table_key.as_ref(), seat.player.as_ref()],
            ctx.program_id,
        );
        require!(expected == *seat_info.key, PokerError::PlayerNotAtTable);
        require!(player_wallet.key == &seat.player, PokerError::PlayerNotAtTable);

        let amount = seat.chips;
        if amount > 0 {
            let cpi_accounts = anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: player_wallet.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
                amount,
            )?;
        }

        seat.chips = 0;
        seat.close(player_wallet.clone())?;
        refunded = refunded.saturating_add(1);
    }

    table.player_count = table.player_count.saturating_sub(refunded);
    table.current_game = None;
    game.stage = GameStage::Finished;
    game.pot = 0;
    game.winner_seat = None;

    msg!("Refunded {} player seats", refunded);

    Ok(())
}

#[derive(Accounts)]
pub struct RefundAll<'info> {
    #[account(mut)]
    pub table: Account<'info, PokerTable>,

    #[account(
        mut,
        close = backend,
        constraint = game.table == table.key() @ PokerError::NoActiveGame
    )]
    pub game: Account<'info, PokerGame>,

    /// CHECK: Vault PDA to pay refunds from
    #[account(
        mut,
        seeds = [b"vault", table.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        mut,
        constraint = backend.key() == game.backend_account @ PokerError::NotBackend
    )]
    pub backend: Signer<'info>,

    pub system_program: Program<'info, System>,
}