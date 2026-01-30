import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaPoker } from "../target/types/solana_poker";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import nacl from "tweetnacl";

const INCO_LIGHTNING_ID = new anchor.web3.PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

describe("solana-poker: Simplified Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaPoker as Program<SolanaPoker>;
  const connection = provider.connection;
  const admin = provider.wallet;
  const player2 = anchor.web3.Keypair.generate();
  const player3 = anchor.web3.Keypair.generate();
  const player4 = anchor.web3.Keypair.generate();
  const player5 = anchor.web3.Keypair.generate();

  // Card values to encrypt (will be offset by blockhash-derived value)
  const CARD_VALUES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];

  const tableId = new anchor.BN(Math.floor(Date.now() / 1000));
  const gameId = tableId.add(new anchor.BN(1));

  const maxPlayers = 5;
  const buyInMin = new anchor.BN(1_000_000);
  const buyInMax = new anchor.BN(1_000_000_000);
  const smallBlind = new anchor.BN(100_000); // 0.0001 SOL
  const bigBlind = new anchor.BN(200_000); // 0.0002 SOL
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
  console.log(`  ${desc} \n tx: ${sig} \n`);
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
  let decryptedCommunityCards: string[] = [];

  let cardOffsetAllowed = false;
  let lastCardOffsetPlaintext: string | null = null;
  const extractHandle = (h: any) => h;

  const logCardOffset = async (label: string) => {
    const game = await program.account.pokerGame.fetch(gamePda);
    const handle = extractHandle(game.cardOffset);
    const handleString = handleToDecimalString(handle);

    console.log(`card_offset ${label} handle:`, handleString.slice(0, 16));

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
              backend: admin.publicKey,
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
          plaintext
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

  // Compute all PDAs before tests run
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

    [player3SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        player3.publicKey.toBuffer(),
      ],
      program.programId
    );

    [player4SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        player4.publicKey.toBuffer(),
      ],
      program.programId
    );

    [player5SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_seat"),
        tablePda.toBuffer(),
        player5.publicKey.toBuffer(),
      ],
      program.programId
    );

    console.log("PDAs computed:");
    console.log("  tablePda:", tablePda.toBase58());
    console.log("  gamePda:", gamePda.toBase58());
  });

  // ========================================
  // TEST 1: Setup table and join players
  // ========================================
  it("1. Setup table and join players", async () => {
    // Create table
    await sendAndConfirm(
      () =>
        program.methods
          .createTable(tableId, maxPlayers, buyInMin, buyInMax, smallBlind, admin.publicKey)
          .accounts({
            table: tablePda,
            vault: vaultPda,
            creator: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "createTable"
    );
    console.log("Table created:", tablePda.toBase58());

    // Admin joins
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
    console.log("Admin joined");

    // Fund and join other players
    const extraPlayers = [player2, player3, player4, player5];
    const extraLabels = ["player2", "player3", "player4", "player5"];
    const extraSeatPdas = [
      player2SeatPda,
      player3SeatPda,
      player4SeatPda,
      player5SeatPda,
    ];

    for (let i = 0; i < extraPlayers.length; i++) {
      const player = extraPlayers[i];
      const label = extraLabels[i];
      const seatPda = extraSeatPdas[i];

      // Transfer SOL from admin instead of airdrop (rate limited on devnet)
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
          anchor.web3.SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: player.publicKey,
            lamports: 100_000_000,
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
              playerSeat: seatPda,
              player: player.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .signers([player])
            .rpc(),
        `${label} joinTable`
      );
      console.log(`${label} joined`);
    }
    console.log("All 5 players joined the table");
  });

  // ========================================
  // TEST 2: Start game with blind bets
  // ========================================
  it("2. Start game with blind bets", async () => {
    // Small blind = seat 1 (player2), Big blind = seat 2 (player3)
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
            { pubkey: player2SeatPda, isWritable: true, isSigner: false },
            { pubkey: player3SeatPda, isWritable: true, isSigner: false },
          ])
          .rpc(),
      "startGame"
    );

    const game = await program.account.pokerGame.fetch(gamePda);
    console.log("Game started:");
    console.log("  Game ID:", game.gameId.toString());
    console.log("  Stage:", game.stage);
    console.log("  Initial pot (blinds):", game.pot.toString());
    console.log("  Player count:", game.playerCount);
  });

  // ========================================
  // TEST 3: Process cards (8 batches)
  // ========================================
  it("3. Process cards (8 batches)", async () => {
    console.log("Card values to encrypt:", CARD_VALUES);

    const encryptedCards: Buffer[] = [];
    for (let i = 0; i < 15; i++) {
      const hex = await encryptValue(BigInt(CARD_VALUES[i]));
      encryptedCards.push(Buffer.from(hex, "hex"));
      if (i < 4) {
        console.log(`  card[${i}] value=${CARD_VALUES[i]} encrypted`);
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
              backend: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc(),
        `processCardsBatch(${batch})`
      );

      if (batch === 0 || batch === 7) {
        await logCardOffset(`after batch ${batch}`);
      }
    }

    const game = await program.account.pokerGame.fetch(gamePda);
    console.log("\nCards processed:");
    console.log("  cards_processed:", game.cardsProcessed);
    console.log("  stage:", game.stage);
    console.log("  shuffle_seed (slot):", game.shuffleSeed.toString());
    console.log("  shuffled_indices:", game.shuffledIndices);
  });

  // ========================================
  // TEST 4: Reveal hands (allow decryption)
  // ========================================
  it("4. Reveal all hands (allow decryption)", async () => {
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
      if (pairIndex === -1) {
        console.log(
          `${player.label}: seat ${seatIndex} not found in shuffled indices`
        );
        continue;
      }

      const h1 = extractHandle(game.dealCards[pairIndex * 2]);
      const h2 = extractHandle(game.dealCards[pairIndex * 2 + 1]);

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
              backend: admin.publicKey,
              incoLightningProgram: INCO_LIGHTNING_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts([
              { pubkey: allowance1, isWritable: true, isSigner: false },
              { pubkey: allowance2, isWritable: true, isSigner: false },
            ])
            .rpc(),
        `revealHand(${player.label})`
        
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
            `${player.label} hole cards:`,
            result.plaintexts.map(toCardIndex)
          );
        } catch (err: any) {
          console.log(
            `${player.label} decrypt failed:`,
            err?.message ?? String(err)
          );
        }
      }
    }
  });

  // ========================================
  // TEST 5: Backend decrypts community cards
  // ========================================
  it("5. Backend decrypts all community cards", async () => {
    const game = await program.account.pokerGame.fetch(gamePda);

    // Backend (admin in this test) needs access to all 5 community cards
    const communityHandles = game.communityCards.map((c: any) =>
      extractHandle(c)
    );

    // Build allowance accounts for all 5 community cards
    const allowanceAccounts = communityHandles.map((handle: any) => {
      const [allowance] = anchor.web3.PublicKey.findProgramAddressSync(
        [handleToBytesLE(handle), admin.publicKey.toBuffer()],
        INCO_LIGHTNING_ID
      );
      return { pubkey: allowance, isWritable: true, isSigner: false };
    });

    // Use reveal_community to allow backend to decrypt all 5 cards at once
    await sendAndConfirm(
      () =>
        program.methods
          .revealCommunity()
          .accounts({
            table: tablePda,
            game: gamePda,
            backend: admin.publicKey,
            incoLightningProgram: INCO_LIGHTNING_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .remainingAccounts(allowanceAccounts)
          .rpc(),
      "revealCommunity"
    );

    // Decrypt all community cards (add extra delay for allowance propagation)
    // NOTE: Backend created these handles, so it should have implicit access
    // The reveal_community call explicitly grants access as well
    await sleep(3000);
    const signMessage = getSignMessage();
    if (signMessage) {
      const handles = communityHandles.map((h: any) =>
        handleToDecimalString(h)
      );
      
      // Try decrypting one at a time to isolate issues
      for (let i = 0; i < handles.length; i++) {
        try {
          const result = await decryptWithRetry(
            [handles[i]],
            admin.publicKey,
            signMessage,
            `community card ${i}`,
            5,
            500
          );
          decryptedCommunityCards.push(result.plaintexts[0]);
          console.log(`Community card ${i}:`, toCardIndex(result.plaintexts[0]));
        } catch (err: any) {
          console.log(
            `Community card ${i} decrypt failed:`,
            err?.message ?? String(err)
          );
        }
      }
      
      if (decryptedCommunityCards.length === 5) {
        console.log("\nAll community cards decrypted:");
        console.log("  % 52:", decryptedCommunityCards.map(toCardIndex));
        console.log(
          "  Flop:",
          decryptedCommunityCards.slice(0, 3).map(toCardIndex)
        );
        console.log("  Turn:", toCardIndex(decryptedCommunityCards[3]));
        console.log("  River:", toCardIndex(decryptedCommunityCards[4]));
      }
    }
  });

  // ========================================
  // TEST 6: Settle game (pay winner)
  // ========================================
  it("6. Settle game and pay winner", async () => {
    // In a real game, backend would determine winner based on hand evaluation
    // For this test, we'll just pick admin (seat 0) as the winner
    const winnerSeatIndex = 0;

    // Final pot would include all bets collected during gameplay
    // For this test, use the initial pot (blinds only)
    const game = await program.account.pokerGame.fetch(gamePda);
    const finalPot = game.pot;

    console.log("\nSettling game:");
    console.log("  Winner: seat", winnerSeatIndex, "(admin)");
    console.log("  Final pot:", finalPot.toString());

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
            backend: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc(),
      "settleGame"
    );

    // Game PDA is closed after settlement, so we can't fetch it anymore
    console.log("\nGame settled:");
    console.log("  Game PDA closed (rent reclaimed to backend)");
    console.log("  Winner: seat", winnerSeatIndex);
    console.log("  Payout:", finalPot.toString(), "lamports");
  });

  // ========================================
  // TEST 7: Oscillation check (reliability test)
  // ========================================
  // it("7. Check for value oscillation (5 checks, 2s intervals)", async () => {
  //   const game = await program.account.pokerGame.fetch(gamePda);
  //   const signMessage = getSignMessage();

  //   if (!signMessage) {
  //     console.log("signMessage not available, skipping oscillation test");
  //     return;
  //   }

  //   console.log("\n========================================");
  //   console.log("OSCILLATION TEST - Checking value stability");
  //   console.log("========================================\n");

  //   // Test card_offset handle
  //   const cardOffsetHandle = extractHandle(game.cardOffset);
  //   const cardOffsetHandleStr = handleToDecimalString(cardOffsetHandle);

  //   // Find admin's hole cards (admin is seat 0)
  //   const adminSeatIndex = 0;
  //   const adminPairIndex = game.shuffledIndices.findIndex(
  //     (s: number) => s === adminSeatIndex
  //   );
  //   const adminHoleCard0 = game.dealCards[adminPairIndex * 2];
  //   const adminHoleCard1 = game.dealCards[adminPairIndex * 2 + 1];

  //   // Test handles that admin has access to
  //   const testHandles = [
  //     { name: "card_offset", handle: cardOffsetHandleStr },
  //     {
  //       name: "admin_hole_0",
  //       handle: handleToDecimalString(extractHandle(adminHoleCard0)),
  //     },
  //     {
  //       name: "admin_hole_1",
  //       handle: handleToDecimalString(extractHandle(adminHoleCard1)),
  //     },
  //     {
  //       name: "community_0",
  //       handle: handleToDecimalString(extractHandle(game.communityCards[0])),
  //     },
  //     {
  //       name: "community_4",
  //       handle: handleToDecimalString(extractHandle(game.communityCards[4])),
  //     },
  //   ];

  //   console.log(`Admin seat: ${adminSeatIndex}, pair index: ${adminPairIndex}`);

  //   const results: { [key: string]: string[] } = {};
  //   for (const t of testHandles) {
  //     results[t.name] = [];
  //   }

  //   // Check 5 times with 2-second intervals
  //   for (let check = 0; check < 5; check++) {
  //     if (check > 0) {
  //       console.log(`  Waiting 2 seconds before check ${check + 1}...`);
  //       await sleep(2000);
  //     }

  //     console.log(`\nCheck ${check + 1}/5:`);

  //     for (const t of testHandles) {
  //       try {
  //         const result = await decrypt([t.handle], {
  //           address: admin.publicKey,
  //           signMessage,
  //         });
  //         const plaintext = result.plaintexts[0];
  //         results[t.name].push(plaintext);

  //         const previousValue =
  //           results[t.name].length > 1
  //             ? results[t.name][results[t.name].length - 2]
  //             : null;
  //         const changed = previousValue && previousValue !== plaintext;

  //         if (changed) {
  //           console.log(
  //             `  ${t.name}: ${plaintext} ⚠️ CHANGED from ${previousValue}`
  //           );
  //         } else {
  //           console.log(`  ${t.name}: ${plaintext} ✓`);
  //         }
  //       } catch (err: any) {
  //         console.log(
  //           `  ${t.name}: decrypt failed - ${err?.message ?? String(err)}`
  //         );
  //         results[t.name].push("ERROR");
  //       }
  //     }
  //   }

  //   // Summary
  //   console.log("\n--- Oscillation Test Summary ---");
  //   let hasOscillation = false;

  //   for (const t of testHandles) {
  //     const values = results[t.name].filter((v) => v !== "ERROR");
  //     const uniqueValues = [...new Set(values)];

  //     if (uniqueValues.length > 1) {
  //       console.log(
  //         `❌ ${t.name}: OSCILLATING between ${uniqueValues.join(", ")}`
  //       );
  //       hasOscillation = true;
  //     } else if (uniqueValues.length === 1) {
  //       console.log(`✅ ${t.name}: STABLE at ${uniqueValues[0]}`);
  //     } else {
  //       console.log(`⚠️ ${t.name}: All decryptions failed`);
  //     }
  //   }

  //   if (hasOscillation) {
  //     console.log("\n⚠️ WARNING: Oscillation detected! Values are not stable.");
  //   } else {
  //     console.log("\n✅ All values are stable - no oscillation detected!");
  //   }
  // });

  // ========================================
  // TEST 8: Summary
  // ========================================
  it("8. Print summary", async () => {
    console.log("\n========================================");
    console.log("GAME SUMMARY");
    console.log("========================================");

    console.log("\nHole cards by seat:");
    for (const entry of decryptedHoleCardsBySeat) {
      console.log(
        `  Seat ${entry.seatIndex} (${entry.label}):`,
        entry.plaintexts.map(toCardIndex)
      );
    }

    console.log("\nCommunity cards:");
    console.log("  All 5:", decryptedCommunityCards.map(toCardIndex));
    if (decryptedCommunityCards.length === 5) {
      console.log(
        "  Flop:",
        decryptedCommunityCards.slice(0, 3).map(toCardIndex)
      );
      console.log("  Turn:", toCardIndex(decryptedCommunityCards[3]));
      console.log("  River:", toCardIndex(decryptedCommunityCards[4]));
    }

    console.log("\nAll 15 cards % 52:");
    const allCards = [
      ...decryptedHoleCardsBySeat.flatMap((e) => e.plaintexts),
      ...decryptedCommunityCards,
    ];
    console.log(
      " ",
      allCards.map(toCardIndex).sort((a, b) => a - b)
    );

    console.log("\n========================================");
    console.log("Tests complete!");
  });
});
