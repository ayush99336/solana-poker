import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaPoker } from "../target/types/solana_poker";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import nacl from "tweetnacl";

const INCO_LIGHTNING_ID = new anchor.web3.PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

describe("solana-poker: Round Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaPoker as Program<SolanaPoker>;
  const connection = provider.connection;
  const admin = provider.wallet;
  const player2 = anchor.web3.Keypair.generate();

  const tableId = new anchor.BN(Math.floor(Date.now() / 1000));
  const gameId = tableId.add(new anchor.BN(1));

  const maxPlayers = 5;
  const buyInMin = new anchor.BN(1_000_000);
  const buyInMax = new anchor.BN(1_000_000_000);
  const smallBlind = new anchor.BN(100);
  const playerBuyIn = new anchor.BN(50_000_000);

  let tablePda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let gamePda: anchor.web3.PublicKey;
  let adminSeatPda: anchor.web3.PublicKey;
  let player2SeatPda: anchor.web3.PublicKey;

  async function sendAndConfirm(fn: () => Promise<string>, desc: string) {
    const sig = await fn();
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function decryptWithRetry(
    handles: string[],
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
    label: string,
    attempts = 5,
    baseDelayMs = 200
  ) {
    let lastError: any;
    for (let i = 0; i < attempts; i++) {
      try {
        if (i > 0) {
          const delay = baseDelayMs * Math.pow(2, i - 1);
          console.log(`${label}: retry ${i}/${attempts - 1} after ${delay}ms`);
          await sleep(delay);
        }
        const result = await decrypt(handles, {
          address: admin.publicKey,
          signMessage,
        });
        return result;
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError;
  }

  const getSignMessage = () => {
    if (admin.signMessage) {
      return admin.signMessage.bind(admin);
    }
    const payer = (admin as any).payer;
    if (payer?.secretKey) {
      return async (msg: Uint8Array) => nacl.sign.detached(msg, payer.secretKey);
    }
    return null;
  };

  const toHandleBigInt = (val: any): bigint => {
      if (typeof val === "bigint") return val;
      if (typeof val === "number") return BigInt(val);
      if (typeof val === "string") {
        const clean = val.startsWith("0x") ? val.slice(2) : val;
        if (/^[0-9]+$/.test(clean)) return BigInt(clean);
        return BigInt("0x" + clean);
      }
      if (Buffer.isBuffer(val)) return BigInt("0x" + val.toString("hex"));
      if (val instanceof Uint8Array) return BigInt("0x" + Buffer.from(val).toString("hex"));
      if (Array.isArray(val)) return BigInt("0x" + Buffer.from(val).toString("hex"));
      if (typeof val === "object" && Array.isArray(val.data)) {
        return BigInt("0x" + Buffer.from(val.data).toString("hex"));
      }
      if (typeof val === "object" && val["0"]) return toHandleBigInt(val["0"]);
      return BigInt(val.toString());
    };

  const handleToBytesLE = (handle: any) => {
    let v = toHandleBigInt(handle);
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      buf[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return buf;
  };

  const handleToDecimalString = (handle: any) => toHandleBigInt(handle).toString();

  const extractHandle = (h: any) => h;

  const buildRoundSummary = (args: {
    roundId: number;
    betsByPlayer: Array<number | anchor.BN>;
    potDelta: number | anchor.BN;
    currentBet: number | anchor.BN;
    lastRaiser: number;
    actedMask: number;
    actionOn: number;
    foldedMask?: number;
    allInMask?: number;
  }) => ({
    roundId: args.roundId,
    betsByPlayer: [
      new anchor.BN(args.betsByPlayer[0] ?? 0),
      new anchor.BN(args.betsByPlayer[1] ?? 0),
      new anchor.BN(args.betsByPlayer[2] ?? 0),
      new anchor.BN(args.betsByPlayer[3] ?? 0),
      new anchor.BN(args.betsByPlayer[4] ?? 0),
    ],
    foldedMask: args.foldedMask ?? 0,
    allInMask: args.allInMask ?? 0,
    potDelta: new anchor.BN(args.potDelta),
    currentBet: new anchor.BN(args.currentBet),
    lastRaiser: args.lastRaiser,
    actedMask: args.actedMask,
    actionOn: args.actionOn,
  });

  it("1. Setup table and game", async () => {
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

    [adminSeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_seat"), tablePda.toBuffer(), admin.publicKey.toBuffer()],
      program.programId
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
      "joinTable (admin)"
    );

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: player2.publicKey,
          lamports: Math.floor(anchor.web3.LAMPORTS_PER_SOL / 10),
        })
      )
    );

    [player2SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("player_seat"), tablePda.toBuffer(), player2.publicKey.toBuffer()],
      program.programId
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
      "joinTable (player2)"
    );

    await sendAndConfirm(
      () =>
        program.methods
          .startGame(gameId, admin.publicKey)
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
  });

  it("2. Process cards (8 batches)", async () => {
    const shuffledDeck = [7, 42, 21, 3, 15, 28, 9, 36, 44, 12, 5, 33, 18, 25, 49];
    console.log("Shuffled deck (first 15):", shuffledDeck);
    const encryptedCards: Buffer[] = [];

    for (let i = 0; i < 15; i++) {
      const hex = await encryptValue(BigInt(shuffledDeck[i]));
      encryptedCards.push(Buffer.from(hex, "hex"));
      if (i < 4) {
        console.log(`  card[${i}] value=${shuffledDeck[i]} encrypted_len=${hex.length}`);
      }
    }

    for (let batch = 0; batch < 8; batch++) {
      const idx0 = batch * 2;
      const idx1 = batch * 2 + 1;
      const card0 = encryptedCards[idx0] || encryptedCards[0];
      const card1 = idx1 < 15 ? encryptedCards[idx1] : encryptedCards[0];

      await sendAndConfirm(
        () =>
          program.methods
            .processCardsBatch(batch, card0, card1, 0)
            .accounts({
              table: tablePda,
              game: gamePda,
              admin: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc(),
        `processCardsBatch(${batch})`
      );
    }
  });

  it("3. Reveal admin hand (allow decryption access)", async () => {
    const game = await program.account.pokerGame.fetch(gamePda);

    const pairIndex = game.shuffledIndices.findIndex((seat: number) => seat === 0);
    if (pairIndex === -1) throw new Error("seat 0 not found in shuffled indices");

    const h1 = extractHandle(game.dealCards[pairIndex * 2]);
    const h2 = extractHandle(game.dealCards[pairIndex * 2 + 1]);

    console.log("Admin deal handles:", handleToDecimalString(h1).slice(0, 16), handleToDecimalString(h2).slice(0, 16));

    const allowance1 = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(h1), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];
    const allowance2 = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(h2), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];

    await sendAndConfirm(
      () =>
        program.methods
          .revealHand()
          .accounts({
            table: tablePda,
            game: gamePda,
            playerSeat: adminSeatPda,
            player: admin.publicKey,
            admin: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: allowance1, isWritable: true, isSigner: false },
            { pubkey: allowance2, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "revealHand"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      const handles = [handleToDecimalString(h1), handleToDecimalString(h2)];
      try {
        await sleep(400);
        const result = await decryptWithRetry(handles, signMessage, "admin hole cards", 6, 250);
        console.log("Decrypted admin hole cards:", result.plaintexts);
      } catch (err: any) {
        console.log("Decrypt failed (admin hole cards):", err?.message ?? String(err));
      }
    } else {
      console.log("signMessage not available; skipping decrypt");
    }
  });

  it("4. PreFlop round summary", async () => {
    const summary = buildRoundSummary({
      roundId: 1,
      betsByPlayer: [100, 100],
      potDelta: 200,
      currentBet: 100,
      lastRaiser: 1,
      actedMask: 0b00000011,
      actionOn: 0,
    });

    await sendAndConfirm(
      () =>
        program.methods
          .updateRound(summary)
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
          })
          .remainingAccounts([
            { pubkey: adminSeatPda, isWritable: true, isSigner: false },
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (PreFlop)"
    );
  });

  it("5. Advance to Flop and update round", async () => {
    const game = await program.account.pokerGame.fetch(gamePda);

    const commHandles = [
      extractHandle(game.communityCards[0]),
      extractHandle(game.communityCards[1]),
      extractHandle(game.communityCards[2]),
    ];

    console.log("Flop handles:", commHandles.map((h) => handleToDecimalString(h).slice(0, 16)));

    const allowance1 = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(commHandles[0]), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];
    const allowance2 = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(commHandles[1]), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];
    const allowance3 = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(commHandles[2]), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];

    await sendAndConfirm(
      () =>
        program.methods
          .advanceStage()
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
            frontend: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: allowance1, isWritable: true, isSigner: false },
            { pubkey: allowance2, isWritable: true, isSigner: false },
            { pubkey: allowance3, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "advanceStage (Flop)"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      const handles = commHandles.map((h) => handleToDecimalString(h));
      try {
        await sleep(200);
        const result = await decryptWithRetry(handles, signMessage, "flop", 5, 200);
        console.log("Decrypted flop cards:", result.plaintexts);
      } catch (err: any) {
        console.log("Decrypt failed (flop):", err?.message ?? String(err));
      }
    }

    const summary = buildRoundSummary({
      roundId: 2,
      betsByPlayer: [50, 50],
      potDelta: 100,
      currentBet: 50,
      lastRaiser: 0,
      actedMask: 0b00000011,
      actionOn: 1,
    });

    await sendAndConfirm(
      () =>
        program.methods
          .updateRound(summary)
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
          })
          .remainingAccounts([
            { pubkey: adminSeatPda, isWritable: true, isSigner: false },
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (Flop)"
    );
  });

  it("6. Advance to Turn and update round", async () => {
    const game = await program.account.pokerGame.fetch(gamePda);
    const handle = extractHandle(game.communityCards[3]);

    console.log("Turn handle:", handleToDecimalString(handle).slice(0, 16));

    const allowance = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(handle), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];

    await sendAndConfirm(
      () =>
        program.methods
          .advanceStage()
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
            frontend: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts([{ pubkey: allowance, isWritable: true, isSigner: false }])
          .rpc(),
      "advanceStage (Turn)"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      try {
        await sleep(200);
        const result = await decryptWithRetry([handleToDecimalString(handle)], signMessage, "turn", 5, 200);
        console.log("Decrypted turn card:", result.plaintexts[0]);
      } catch (err: any) {
        console.log("Decrypt failed (turn):", err?.message ?? String(err));
      }
    }

    const summary = buildRoundSummary({
      roundId: 3,
      betsByPlayer: [25, 25],
      potDelta: 50,
      currentBet: 25,
      lastRaiser: 1,
      actedMask: 0b00000011,
      actionOn: 0,
    });

    await sendAndConfirm(
      () =>
        program.methods
          .updateRound(summary)
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
          })
          .remainingAccounts([
            { pubkey: adminSeatPda, isWritable: true, isSigner: false },
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (Turn)"
    );
  });

  it("7. Advance to River and update round", async () => {
    const game = await program.account.pokerGame.fetch(gamePda);
    const handle = extractHandle(game.communityCards[4]);

    console.log("River handle:", handleToDecimalString(handle).slice(0, 16));

    const allowance = anchor.web3.PublicKey.findProgramAddressSync(
      [handleToBytesLE(handle), admin.publicKey.toBuffer()],
      INCO_LIGHTNING_ID
    )[0];

    await sendAndConfirm(
      () =>
        program.methods
          .advanceStage()
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
            frontend: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts([{ pubkey: allowance, isWritable: true, isSigner: false }])
          .rpc(),
      "advanceStage (River)"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      try {
        await sleep(200);
        const result = await decryptWithRetry([handleToDecimalString(handle)], signMessage, "river", 5, 200);
        console.log("Decrypted river card:", result.plaintexts[0]);
      } catch (err: any) {
        console.log("Decrypt failed (river):", err?.message ?? String(err));
      }
    }

    const summary = buildRoundSummary({
      roundId: 4,
      betsByPlayer: [25, 25],
      potDelta: 50,
      currentBet: 25,
      lastRaiser: 0,
      actedMask: 0b00000011,
      actionOn: 1,
    });

    await sendAndConfirm(
      () =>
        program.methods
          .updateRound(summary)
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
          })
          .remainingAccounts([
            { pubkey: adminSeatPda, isWritable: true, isSigner: false },
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (River)"
    );
  });

  it("8. Advance to Showdown and settle", async () => {
    await sendAndConfirm(
      () =>
        program.methods
          .advanceStage()
          .accounts({
            table: tablePda,
            game: gamePda,
            admin: admin.publicKey,
            frontend: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "advanceStage (Showdown)"
    );

    await sendAndConfirm(
      () =>
        program.methods
          .settleGame(0)
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
  });
});
