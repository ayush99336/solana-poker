import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaPoker } from "../target/types/solana_poker";

// Minimal demo flow: create table -> join 2 players -> start game -> settle
// No card processing or backend steps.
describe("solana-poker: Demo Flow (no backend)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaPoker as Program<SolanaPoker>;
  const connection = provider.connection;
  const admin = provider.wallet;
  const player2 = anchor.web3.Keypair.generate();

  const tableId = new anchor.BN(Math.floor(Date.now() / 1000));
  const gameId = tableId.add(new anchor.BN(1));

  const maxPlayers = 2;
  const buyInMin = new anchor.BN(1_000_000);
  const buyInMax = new anchor.BN(1_000_000_000);
  const smallBlind = new anchor.BN(100_000);
  const bigBlind = new anchor.BN(200_000);
  const playerBuyIn = new anchor.BN(10_000_000);

  let tablePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let gamePda: anchor.web3.PublicKey;
  let adminSeatPda: anchor.web3.PublicKey;
  let player2SeatPda: anchor.web3.PublicKey;

  async function sendAndConfirm(fn: () => Promise<string>, desc: string) {
    const sig = await fn();
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`${desc}: ${sig}`);
  }

  before(async () => {
    [tablePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("table"),
        admin.publicKey.toBuffer(),
        tableId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tablePda.toBuffer()],
      program.programId
    );

    [gamePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("game"),
        tablePda.toBuffer(),
        gameId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [adminSeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );

    [player2SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        player2.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  it("demo flow", async () => {
    await sendAndConfirm(
      () =>
        program.methods
          .createTable(tableId, maxPlayers, buyInMin, buyInMax, smallBlind)
          .accounts({
            table: tablePda,
            vault: vaultPda,
            admin: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "createTable"
    );

    await sendAndConfirm(
      () =>
        program.methods
          .joinTable(playerBuyIn)
          .accounts({
            table: tablePda,
            vault: vaultPda,
            playerSeat: adminSeatPda,
            player: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "admin joinTable"
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: player2.publicKey,
          lamports: 50_000_000,
        })
      )
    );

    await sendAndConfirm(
      () =>
        program.methods
          .joinTable(playerBuyIn)
          .accounts({
            table: tablePda,
            vault: vaultPda,
            playerSeat: player2SeatPda,
            player: player2.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player2])
          .rpc(),
      "player2 joinTable"
    );

    await sendAndConfirm(
      () =>
        program.methods
          .startGame(gameId, admin.publicKey, smallBlind, bigBlind)
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: adminSeatPda, isWritable: true, isSigner: false },
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "startGame"
    );

    const game = await program.account.pokerGame.fetch(gamePda);
    const winnerSeatIndex = 0; // admin
    const finalPot = game.pot;

    await sendAndConfirm(
      () =>
        program.methods
          .settleGame(winnerSeatIndex, finalPot)
          .accounts({
            table: tablePda,
            game: gamePda,
            winnerSeat: adminSeatPda,
            winnerWallet: admin.publicKey,
            vault: vaultPda,
            admin: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "settleGame"
    );

    const settledGame = await program.account.pokerGame.fetch(gamePda);
    console.log("settled stage:", settledGame.stage);
    console.log("winner seat:", settledGame.winnerSeat);
  });
});
