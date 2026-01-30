use crate::constants::MIN_PLAYERS;
use crate::error::PokerError;
use crate::state::{GameStage, PlayerSeat, PokerGame, PokerTable};
use anchor_lang::prelude::*;
use inco_lightning::types::Euint128;

/// Start a new game at the table
///
/// Flow:
/// 1. Admin calls start_game with blind amounts
/// 2. Blind bets are collected from small blind and big blind players
/// 3. Game is initialized in Waiting stage
/// 4. Next: process_cards (8 batches) to shuffle and deal
/// 5. After cards processed: backend manages off-chain gameplay
/// 6. Finally: settle_game to pay winner
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, StartGame<'info>>,
    game_id: u64,
    backend_account: Pubkey,
    small_blind_amount: u64,
    big_blind_amount: u64,
) -> Result<()> {
    let table = &mut ctx.accounts.table;
    let game = &mut ctx.accounts.game;

    // Validate backend authority
    require!(
        ctx.accounts.backend.key() == table.backend,
        PokerError::NotBackend
    );
    require!(
        backend_account == ctx.accounts.backend.key(),
        PokerError::NotBackend
    );
    require!(table.current_game.is_none(), PokerError::GameInProgress);
    require!(
        table.player_count >= MIN_PLAYERS,
        PokerError::NotEnoughPlayers
    );

    // Initialize game state
    game.table = table.key();
    game.game_id = game_id;
    game.stage = GameStage::Waiting;
    game.player_count = table.player_count;

    // Initialize card state
    game.shuffle_seed = 0;
    game.card_offset = Euint128::default();
    game.shuffled_indices = [0, 1, 2, 3, 4];
    game.deal_cards = [Euint128::default(); 10];
    game.community_cards = [Euint128::default(); 5];
    game.cards_processed = false;

    // Backend account for off-chain gameplay management
    game.backend_account = backend_account;

    // Result state
    game.winner_seat = None;
    game.payouts = [0; 5];
    game.bump = ctx.bumps.game;

    // Collect blind bets from players via remaining_accounts
    // Expected: [small_blind_seat, big_blind_seat]
    let mut initial_pot: u64 = 0;

    if ctx.remaining_accounts.len() >= 2 {
        // Small blind (seat index 0 relative to dealer, which is seat 0)
        let small_blind_seat_info = &ctx.remaining_accounts[0];
        let mut small_blind_seat: Account<PlayerSeat> = Account::try_from(small_blind_seat_info)?;

        require!(
            small_blind_seat.chips >= small_blind_amount,
            PokerError::InsufficientChips
        );
        small_blind_seat.chips -= small_blind_amount;
        initial_pot += small_blind_amount;

        small_blind_seat.exit(&crate::ID)?;

        // Big blind (seat index 1 relative to dealer)
        let big_blind_seat_info = &ctx.remaining_accounts[1];
        let mut big_blind_seat: Account<PlayerSeat> = Account::try_from(big_blind_seat_info)?;

        require!(
            big_blind_seat.chips >= big_blind_amount,
            PokerError::InsufficientChips
        );
        big_blind_seat.chips -= big_blind_amount;
        initial_pot += big_blind_amount;

        big_blind_seat.exit(&crate::ID)?;

        msg!(
            "Blinds collected: small={} big={} total={}",
            small_blind_amount,
            big_blind_amount,
            initial_pot
        );
    }

    game.pot = initial_pot;

    // Link game to table
    table.current_game = Some(game.key());

    msg!(
        "Game {} started at table {} with {} players, pot={}",
        game_id,
        table.table_id,
        table.player_count,
        game.pot
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct StartGame<'info> {
    #[account(
        mut,
        constraint = table.backend == backend.key() @ PokerError::NotBackend
    )]
    pub table: Account<'info, PokerTable>,

    #[account(
        init,
        payer = backend,
        space = PokerGame::LEN,
        seeds = [b"game", table.key().as_ref(), &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, PokerGame>,

    #[account(mut)]
    pub backend: Signer<'info>,

    pub system_program: Program<'info, System>,
}
