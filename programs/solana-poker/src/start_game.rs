use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;
use crate::state::{PokerTable, PokerGame, GameStage};
use crate::error::PokerError;
use crate::constants::MIN_PLAYERS;

/// Admin starts a new game at the table
pub fn handler(ctx: Context<StartGame>, game_id: u64, frontend_account: Pubkey) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let game = &mut ctx.accounts.game;

    // Validate
    require!(
        ctx.accounts.admin.key() == table.admin,
        PokerError::NotAdmin
    );
    require!(table.current_game.is_none(), PokerError::GameInProgress);
    require!(table.player_count >= MIN_PLAYERS, PokerError::NotEnoughPlayers);

    // Initialize game state
    game.table = table.key();
    game.game_id = game_id;
    game.stage = GameStage::Waiting;
    game.round_id = 0;
    game.pot = 0;
    game.current_bet = 0;
    game.dealer_position = 0;
    game.action_on = 0;
    game.players_remaining = table.player_count;
    game.players_acted = 0;
    game.player_count = table.player_count;
    
    // Player status tracking
    game.folded_mask = 0;
    game.all_in_mask = 0;
    game.blinds_posted = 0;
    game.last_raiser = 0;
    game.last_raise_amount = 0;
    game.round_bets = [0; 5];
    game.acted_mask = 0;
    
    // ===== NEW PROCESS CARDS STATE =====
    game.shuffle_random = Euint128::default();
    game.shuffled_indices = [0, 1, 2, 3, 4];  // Default order, will be shuffled
    game.deal_cards = [Euint128::default(); 10];
    game.community_cards = [Euint128::default(); 5];
    game.cards_processed = false;
    game.frontend_account = frontend_account;
    
    game.community_revealed = 0;
    
    // Result
    game.winner_seat = None;
    game.bump = ctx.bumps.game;

    // Link game to table
    table.current_game = Some(game.key());

    msg!("Game {} started at table {}", game_id, table.table_id);
    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct StartGame<'info> {
    #[account(
        mut,
        constraint = table.admin == admin.key() @ PokerError::NotAdmin
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        init,
        payer = admin,
        space = PokerGame::LEN,
        seeds = [b"game", table.key().as_ref(), &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, PokerGame>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
