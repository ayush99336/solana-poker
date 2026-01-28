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
  const player3 = anchor.web3.Keypair.generate();
  const player4 = anchor.web3.Keypair.generate();
  const player5 = anchor.web3.Keypair.generate();

  const SHUFFLED_DECK = [
    2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
  ];

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
  let player3SeatPda: anchor.web3.PublicKey;
  let player4SeatPda: anchor.web3.PublicKey;
  let player5SeatPda: anchor.web3.PublicKey;

  async function sendAndConfirm(fn: () => Promise<string>, desc: string) {
    const sig = await fn();
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const firstDecryptDelayMs = 1200;
  const betweenDecryptDelayMs = 500;
  let hasDecryptedOnce = false;

  const waitBeforeDecrypt = async () => {
    if (!hasDecryptedOnce) {
      hasDecryptedOnce = true;
      await sleep(firstDecryptDelayMs);
    } else {
      await sleep(betweenDecryptDelayMs);
    }
  };

  async function decryptWithRetry(
    handles: string[],
    address: anchor.web3.PublicKey,
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
    label: string,
    attempts = 5,
    baseDelayMs = 200
  ) {
    let lastError: any;
    await waitBeforeDecrypt();
    for (let i = 0; i < attempts; i++) {
      try {
        if (i > 0) {
          const delay = baseDelayMs * Math.pow(2, i - 1);
          console.log(`${label}: retry ${i}/${attempts - 1} after ${delay}ms`);
          await sleep(delay);
        }
        const result = await decrypt(handles, {
          address,
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
      return async (msg: Uint8Array) =>
        nacl.sign.detached(msg, payer.secretKey);
    }
    return null;
  };

  const getKeypairSignMessage =
    (keypair: anchor.web3.Keypair) => async (msg: Uint8Array) =>
      nacl.sign.detached(msg, keypair.secretKey);

  const toHandleBigInt = (val: any): bigint => {
    if (typeof val === "bigint") return val;
    if (typeof val === "number") return BigInt(val);
    if (typeof val === "string") {
      const clean = val.startsWith("0x") ? val.slice(2) : val;
      if (/^[0-9]+$/.test(clean)) return BigInt(clean);
      return BigInt("0x" + clean);
    }
    if (Buffer.isBuffer(val)) return BigInt("0x" + val.toString("hex"));
    if (val instanceof Uint8Array)
      return BigInt("0x" + Buffer.from(val).toString("hex"));
    if (Array.isArray(val))
      return BigInt("0x" + Buffer.from(val).toString("hex"));
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

  const handleToDecimalString = (handle: any) =>
    toHandleBigInt(handle).toString();

  const toCardIndex = (plaintext: string) => Number(BigInt(plaintext) % 52n);

  let decryptedHoleCards: string[] = [];
  let decryptedHoleCardsBySeat: Array<{
    label: string;
    seatIndex: number;
    plaintexts: string[];
  }> = [];
  let decryptedFlopCards: string[] = [];
  let decryptedTurnCard: string | null = null;
  let decryptedRiverCard: string | null = null;
  let shuffleRandomAllowed = false;
  let lastShuffleRandomHandle: string | null = null;
  let lastShuffleRandomPlaintext: string | null = null;
  let cardOffsetAllowed = false;
  let lastCardOffsetHandle: string | null = null;
  let lastCardOffsetPlaintext: string | null = null;
  const extractHandle = (h: any) => h;

  const logShuffleRandom = async (label: string) => {
    const game = await program.account.pokerGame.fetch(gamePda);
    const handle = extractHandle(game.shuffleRandom);

    const handleString = handleToDecimalString(handle);
    if (lastShuffleRandomHandle && lastShuffleRandomHandle !== handleString) {
      console.log(
        `shuffle_random ${label}: HANDLE CHANGED`,
        lastShuffleRandomHandle,
        "->",
        handleString
      );
    } else {
      console.log(`shuffle_random ${label} handle:`, handleString.slice(0, 16));
    }
    lastShuffleRandomHandle = handleString;

    if (!shuffleRandomAllowed) {
      const allowance = anchor.web3.PublicKey.findProgramAddressSync(
        [handleToBytesLE(handle), admin.publicKey.toBuffer()],
        INCO_LIGHTNING_ID
      )[0];

      await sendAndConfirm(
        () =>
          program.methods
            .revealShuffleRandom()
            .accounts({
              table: tablePda,
              game: gamePda,
              admin: admin.publicKey,
              player: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: allowance, isWritable: true, isSigner: false },
            ])
            .rpc(),
        "revealShuffleRandom"
      );

      shuffleRandomAllowed = true;
    }

    const signMessage = getSignMessage();
    if (!signMessage) {
      console.log(`shuffle_random ${label}: signMessage not available`);
      return;
    }

    try {
      const result = await decryptWithRetry(
        [handleToDecimalString(handle)],
        admin.publicKey,
        signMessage,
        `shuffle_random ${label}`,
        5,
        200
      );
      const plaintext = result.plaintexts[0];
      if (
        lastShuffleRandomPlaintext &&
        lastShuffleRandomPlaintext !== plaintext
      ) {
        console.log(
          `shuffle_random ${label}: PLAINTEXT CHANGED`,
          lastShuffleRandomPlaintext,
          "->",
          plaintext,
          "% 52:",
          toCardIndex(plaintext)
        );
      } else {
        console.log(
          `shuffle_random ${label}:`,
          plaintext,
          "% 52:",
          toCardIndex(plaintext)
        );
      }
      lastShuffleRandomPlaintext = plaintext;
    } catch (err: any) {
      console.log(
        `shuffle_random ${label} decrypt failed:`,
        err?.message ?? String(err)
      );
    }
  };

  const logCardOffset = async (label: string) => {
    const game = await program.account.pokerGame.fetch(gamePda);
    const handle = extractHandle(game.cardOffset);

    const handleString = handleToDecimalString(handle);
    if (lastCardOffsetHandle && lastCardOffsetHandle !== handleString) {
      console.log(
        `card_offset ${label}: HANDLE CHANGED`,
        lastCardOffsetHandle,
        "->",
        handleString
      );
    } else {
      console.log(`card_offset ${label} handle:`, handleString.slice(0, 16));
    }
    lastCardOffsetHandle = handleString;

    if (!cardOffsetAllowed) {
      const allowance = anchor.web3.PublicKey.findProgramAddressSync(
        [handleToBytesLE(handle), admin.publicKey.toBuffer()],
        INCO_LIGHTNING_ID
      )[0];

      await sendAndConfirm(
        () =>
          program.methods
            .revealCardOffset()
            .accounts({
              table: tablePda,
              game: gamePda,
              admin: admin.publicKey,
              player: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: allowance, isWritable: true, isSigner: false },
            ])
            .rpc(),
        "revealCardOffset"
      );

      cardOffsetAllowed = true;
    }

    const signMessage = getSignMessage();
    if (!signMessage) {
      console.log(`card_offset ${label}: signMessage not available`);
      return;
    }

    try {
      const result = await decryptWithRetry(
        [handleToDecimalString(handle)],
        admin.publicKey,
        signMessage,
        `card_offset ${label}`,
        5,
        200
      );
      const plaintext = result.plaintexts[0];
      if (lastCardOffsetPlaintext && lastCardOffsetPlaintext !== plaintext) {
        console.log(
          `card_offset ${label}: PLAINTEXT CHANGED`,
          lastCardOffsetPlaintext,
          "->",
          plaintext,
          "(should be 0-51)"
        );
      } else {
        console.log(`card_offset ${label}:`, plaintext, "(should be 0-51)");
      }
      lastCardOffsetPlaintext = plaintext;
    } catch (err: any) {
      console.log(
        `card_offset ${label} decrypt failed:`,
        err?.message ?? String(err)
      );
    }
  };

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
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        admin.publicKey.toBuffer(),
      ],
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

    const extraPlayers = [player2, player3, player4, player5];
    const extraLabels = ["player2", "player3", "player4", "player5"];
    const extraSeatPdas: anchor.web3.PublicKey[] = [];

    for (let i = 0; i < extraPlayers.length; i++) {
      const player = extraPlayers[i];
      const label = extraLabels[i];

      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: player.publicKey,
            lamports: Math.floor(anchor.web3.LAMPORTS_PER_SOL / 10),
          })
        )
      );

      const [seatPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("player_seat"),
          tablePda.toBuffer(),
          player.publicKey.toBuffer(),
        ],
        program.programId
      );

      extraSeatPdas.push(seatPda);

      await sendAndConfirm(
        () =>
          program.methods
            .joinTable(playerBuyIn)
            .accounts({
              table: tablePda,
              vault: vaultPda,
              playerSeat: seatPda,
              player: player.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([player])
            .rpc(),
        `joinTable (${label})`
      );
    }

    [player2SeatPda, player3SeatPda, player4SeatPda, player5SeatPda] =
      extraSeatPdas;

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
    const shuffledDeck = SHUFFLED_DECK;
    console.log("Shuffled deck (first 15):", shuffledDeck);
    console.log("  hole originals:", shuffledDeck.slice(0, 10));
    console.log("  community originals:", shuffledDeck.slice(10, 15));
    const encryptedCards: Buffer[] = [];

    for (let i = 0; i < 15; i++) {
      const hex = await encryptValue(BigInt(shuffledDeck[i]));
      encryptedCards.push(Buffer.from(hex, "hex"));
      if (i < 4) {
        console.log(
          `  card[${i}] value=${shuffledDeck[i]} encrypted_len=${hex.length}`
        );
      }
    }

    for (let batch = 0; batch < 8; batch++) {
      const idx0 = batch * 2;
      const idx1 = batch * 2 + 1;
      const card0 = encryptedCards[idx0] || encryptedCards[0];
      const card1 =
        idx1 < 15
          ? encryptedCards[idx1]
          : Buffer.from(await encryptValue(0n), "hex");

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

      await logShuffleRandom(`after batch ${batch}`);
      await logCardOffset(`after batch ${batch}`);
    }
  });

  it("3. Reveal all hands (allow decryption access)", async () => {
    await logShuffleRandom("step 3");
    const game = await program.account.pokerGame.fetch(gamePda);
    const players = [
      {
        label: "admin",
        publicKey: admin.publicKey,
        seatPda: adminSeatPda,
        signMessage: getSignMessage(),
      },
      {
        label: "player2",
        publicKey: player2.publicKey,
        seatPda: player2SeatPda,
        signMessage: getKeypairSignMessage(player2),
      },
      {
        label: "player3",
        publicKey: player3.publicKey,
        seatPda: player3SeatPda,
        signMessage: getKeypairSignMessage(player3),
      },
      {
        label: "player4",
        publicKey: player4.publicKey,
        seatPda: player4SeatPda,
        signMessage: getKeypairSignMessage(player4),
      },
      {
        label: "player5",
        publicKey: player5.publicKey,
        seatPda: player5SeatPda,
        signMessage: getKeypairSignMessage(player5),
      },
    ];

    decryptedHoleCardsBySeat = [];

    for (const player of players) {
      const seat = await program.account.playerSeat.fetch(player.seatPda);
      const seatIndex = seat.seatIndex as number;
      const pairIndex = game.shuffledIndices.findIndex(
        (s: number) => s === seatIndex
      );
      if (pairIndex === -1)
        throw new Error(`seat ${seatIndex} not found in shuffled indices`);

      const h1 = extractHandle(game.dealCards[pairIndex * 2]);
      const h2 = extractHandle(game.dealCards[pairIndex * 2 + 1]);

      console.log(
        `${player.label} deal handles:`,
        handleToDecimalString(h1).slice(0, 16),
        handleToDecimalString(h2).slice(0, 16)
      );

      const allowance1 = anchor.web3.PublicKey.findProgramAddressSync(
        [handleToBytesLE(h1), player.publicKey.toBuffer()],
        INCO_LIGHTNING_ID
      )[0];
      const allowance2 = anchor.web3.PublicKey.findProgramAddressSync(
        [handleToBytesLE(h2), player.publicKey.toBuffer()],
        INCO_LIGHTNING_ID
      )[0];

      await sendAndConfirm(
        () =>
          program.methods
            .revealHand()
            .accounts({
              table: tablePda,
              game: gamePda,
              playerSeat: player.seatPda,
              player: player.publicKey,
              admin: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: allowance1, isWritable: true, isSigner: false },
              { pubkey: allowance2, isWritable: true, isSigner: false },
            ])
            .rpc(),
        `revealHand (${player.label})`
      );

      if (player.signMessage) {
        const handles = [handleToDecimalString(h1), handleToDecimalString(h2)];
        try {
          const result = await decryptWithRetry(
            handles,
            player.publicKey,
            player.signMessage,
            `${player.label} hole cards`,
            5,
            200
          );
          decryptedHoleCardsBySeat.push({
            label: player.label,
            seatIndex,
            plaintexts: result.plaintexts,
          });
          if (player.label === "admin") {
            decryptedHoleCards = result.plaintexts;
          }
          console.log(
            `Decrypted ${player.label} hole cards:`,
            result.plaintexts
          );
          console.log(
            `${player.label} hole cards % 52:`,
            result.plaintexts.map(toCardIndex)
          );
        } catch (err: any) {
          console.log(
            `Decrypt failed (${player.label} hole cards):`,
            err?.message ?? String(err)
          );
        }
      } else {
        console.log(
          `signMessage not available for ${player.label}; skipping decrypt`
        );
      }
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
            { pubkey: player3SeatPda, isWritable: true, isSigner: false },
            { pubkey: player4SeatPda, isWritable: true, isSigner: false },
            { pubkey: player5SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (PreFlop)"
    );
  });

  it("5. Advance to Flop and update round", async () => {
    await logShuffleRandom("step 5");
    const game = await program.account.pokerGame.fetch(gamePda);

    const commHandles = [
      extractHandle(game.communityCards[0]),
      extractHandle(game.communityCards[1]),
      extractHandle(game.communityCards[2]),
    ];

    console.log(
      "Flop handles:",
      commHandles.map((h) => handleToDecimalString(h).slice(0, 16))
    );

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
        const result = await decryptWithRetry(
          handles,
          admin.publicKey,
          signMessage,
          "flop",
          5,
          200
        );
        decryptedFlopCards = result.plaintexts;
        const flopMod = result.plaintexts.map(toCardIndex);
        console.log("Decrypted flop cards:", result.plaintexts);
        console.log("Flop cards % 52:", flopMod);
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
            { pubkey: player3SeatPda, isWritable: true, isSigner: false },
            { pubkey: player4SeatPda, isWritable: true, isSigner: false },
            { pubkey: player5SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (Flop)"
    );
  });

  it("6. Advance to Turn and update round", async () => {
    await logShuffleRandom("step 6");
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
          .remainingAccounts([
            { pubkey: allowance, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "advanceStage (Turn)"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      try {
        const result = await decryptWithRetry(
          [handleToDecimalString(handle)],
          admin.publicKey,
          signMessage,
          "turn",
          5,
          200
        );
        decryptedTurnCard = result.plaintexts[0];
        const turnMod = toCardIndex(result.plaintexts[0]);
        console.log("Decrypted turn card:", result.plaintexts[0]);
        console.log("Turn card % 52:", turnMod);
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
            { pubkey: player3SeatPda, isWritable: true, isSigner: false },
            { pubkey: player4SeatPda, isWritable: true, isSigner: false },
            { pubkey: player5SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "updateRound (Turn)"
    );
  });

  it("7. Advance to River and update round", async () => {
    await logShuffleRandom("step 7");
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
          .remainingAccounts([
            { pubkey: allowance, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "advanceStage (River)"
    );

    const signMessage = getSignMessage();
    if (signMessage) {
      try {
        const result = await decryptWithRetry(
          [handleToDecimalString(handle)],
          admin.publicKey,
          signMessage,
          "river",
          5,
          200
        );
        decryptedRiverCard = result.plaintexts[0];
        const riverMod = toCardIndex(result.plaintexts[0]);
        console.log("Decrypted river card:", result.plaintexts[0]);
        console.log("River card % 52:", riverMod);
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
            { pubkey: player3SeatPda, isWritable: true, isSigner: false },
            { pubkey: player4SeatPda, isWritable: true, isSigner: false },
            { pubkey: player5SeatPda, isWritable: true, isSigner: false },
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

    console.log("\nDecrypted summary:");
    console.log("  hole (admin):", decryptedHoleCards);
    console.log("  hole (admin) % 52:", decryptedHoleCards.map(toCardIndex));
    console.log("  hole by seat:");
    for (const entry of decryptedHoleCardsBySeat) {
      console.log(
        `    seat ${entry.seatIndex} (${entry.label}):`,
        entry.plaintexts,
        "% 52:",
        entry.plaintexts.map(toCardIndex)
      );
    }
    const holeBySeat = [...decryptedHoleCardsBySeat]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .flatMap((entry) => entry.plaintexts);
    const communityAll = [
      ...(decryptedFlopCards ?? []),
      decryptedTurnCard ?? "null",
      decryptedRiverCard ?? "null",
    ];
    console.log("  all 15 decrypted:", [...holeBySeat, ...communityAll]);
    console.log("  flop:", decryptedFlopCards);
    console.log("  flop % 52:", decryptedFlopCards.map(toCardIndex));
    console.log("  turn:", decryptedTurnCard);
    console.log(
      "  turn % 52:",
      decryptedTurnCard ? toCardIndex(decryptedTurnCard) : null
    );
    console.log("  river:", decryptedRiverCard);
    console.log(
      "  river % 52:",
      decryptedRiverCard ? toCardIndex(decryptedRiverCard) : null
    );
  });
});
