use anchor_lang::prelude::*;
use crate::state::Raffle;

#[derive(Accounts)]
#[instruction(raffle_id: u64)]
pub struct CreateRaffle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Raffle::SIZE,
        seeds = [b"raffle", raffle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub raffle: Account<'info, Raffle>,

    /// CHECK: vault PDA
    #[account(mut, seeds = [b"vault", raffle.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateRaffle>, raffle_id: u64, ticket_price: u64) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    raffle.authority = ctx.accounts.authority.key();
    raffle.raffle_id = raffle_id;
    raffle.ticket_price = ticket_price;
    raffle.participant_count = 0;
    raffle.is_open = true;
    raffle.prize_claimed = false;
    raffle.winning_number_handle = 0;
    raffle.bump = ctx.bumps.raffle;

    msg!("Raffle {} created", raffle_id);
    msg!("   Ticket price: {} lamports", ticket_price);
    msg!("   Guess range: 1-100");
    Ok(())
}
