use anchor_lang::prelude::*;

#[error_code]
pub enum PokerError {
    #[msg("Invalid buy-in amount")]
    InvalidBuyIn,

    #[msg("Table is full")]
    TableFull,

    #[msg("Not enough players to start")]
    NotEnoughPlayers,

    #[msg("Game already in progress")]
    GameInProgress,

    #[msg("No active game")]
    NoActiveGame,

    #[msg("Not your turn")]
    NotYourTurn,

    #[msg("Insufficient chips")]
    InsufficientChips,

    #[msg("Invalid bet amount")]
    InvalidBetAmount,

    #[msg("Player already folded")]
    PlayerFolded,

    #[msg("Player already acted")]
    PlayerAlreadyActed,

    #[msg("Betting round not complete")]
    BettingNotComplete,

    #[msg("Invalid game stage")]
    InvalidGameStage,

    #[msg("Player not at table")]
    PlayerNotAtTable,

    #[msg("Only admin can perform this action")]
    NotAdmin,

    #[msg("Only backend can perform this action")]
    NotBackend,

    #[msg("Cards not processed yet")]
    CardsNotSubmitted,

    #[msg("Cards not processed - all 8 batches must complete")]
    CardsNotProcessed,

    #[msg("Invalid card count")]
    InvalidCardCount,

    #[msg("Seat already taken")]
    SeatTaken,

    #[msg("Player already seated")]
    PlayerAlreadySeated,

    #[msg("Cannot leave during active game")]
    CannotLeaveDuringGame,

    #[msg("Game not finished")]
    GameNotFinished,

    #[msg("Cannot check - must call or fold")]
    CannotCheck,

    #[msg("Raise amount too small")]
    RaiseTooSmall,

    #[msg("Winner not determined")]
    WinnerNotDetermined,

    #[msg("Invalid seat index")]
    InvalidSeatIndex,

    #[msg("Blinds already posted for this hand")]
    BlindsAlreadyPosted,

    #[msg("Invalid batch index (must be 0, 1, or 2)")]
    InvalidBatchIndex,

    #[msg("Cards already processed")]
    CardsAlreadyProcessed,

    #[msg("Frontend account not set")]
    FrontendAccountNotSet,

    #[msg("Not enough allowance accounts provided")]
    MissingAllowanceAccounts,

    #[msg("Invalid refund accounts provided")]
    InvalidRefundAccounts,
}
