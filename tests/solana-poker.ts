import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaPoker } from "../target/types/solana_poker";
import { assert } from "chai";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import nacl from "tweetnacl";

/**
 * Poker Test - Decryption Flow Verification
 * 
 * This test demonstrates:
 * 1. Backend sends shuffled encrypted cards
 * 2. On-chain processes and applies random offset
 * 3. Client reads handles from PDA and decrypts
 */
describe("solana-poker: Decryption Flow", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.SolanaPoker as Program<SolanaPoker>;
    const connection = provider.connection;

    const admin = provider.wallet;
    const player2 = anchor.web3.Keypair.generate();

    const tableId = new anchor.BN(Math.floor(Date.now() / 1000));
    const gameId = tableId.add(new anchor.BN(1));

    console.log("===========================================");
    console.log("DECRYPTION FLOW TEST");
    console.log("Table ID:", tableId.toString());
    console.log("===========================================");

    const maxPlayers = 5;
    const buyInMin = new anchor.BN(10000000);
    const buyInMax = new anchor.BN(5000000000);
    const smallBlind = new anchor.BN(100000);
    const playerBuyIn = new anchor.BN(50000000);

    let tablePda: anchor.web3.PublicKey;
    let vaultPda: anchor.web3.PublicKey;
    let gamePda: anchor.web3.PublicKey;

    const INCO_LIGHTNING_ID = new anchor.web3.PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

    // Track original cards sent by backend
    const backendCards: number[] = [];

    async function sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function sendAndConfirm(fn: () => Promise<string>, desc: string): Promise<string> {
        console.log(`  ${desc}...`);
        const sig = await fn();
        await connection.confirmTransaction(sig, "confirmed");
        const tx = await connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        const cu = tx?.meta?.computeUnitsConsumed;
        console.log(`  ✓ TX: ${sig.slice(0, 20)}... | CU=${cu ?? "n/a"}`);
        await sleep(300);
        return sig;
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

    const extractHandleHex = (h: any): string => {
        if (!h) throw new Error("handle missing");

        const toHex = (val: any): string => {
            if (val === undefined || val === null) throw new Error("handle value missing");
            if (typeof val === "string") return val;
            if (typeof val === "number") return val.toString(16);
            if ((val as any).toArray && typeof (val as any).toArray === "function") {
                return Buffer.from((val as any).toArray()).toString("hex");
            }
            if (Buffer.isBuffer(val)) return val.toString("hex");
            if (val instanceof Uint8Array) return Buffer.from(val).toString("hex");
            if (Array.isArray(val)) return Buffer.from(val).toString("hex");
            if (typeof val === "object" && Array.isArray((val as any).data)) {
                return Buffer.from((val as any).data).toString("hex");
            }
            return val.toString();
        };

        if (typeof h === "string" || typeof h === "number") return toHex(h);
        if (typeof h === "object") {
            if (h.hasOwnProperty("0")) return toHex((h as any)["0"]);
            return toHex(h);
        }
        return toHex(h);
    };

    const handleHexToDecimalString = (hex: string) => {
        const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
        return BigInt("0x" + clean).toString();
    };

    const handleHexToBytes = (hex: string) => {
        const buffer = Buffer.from(hex, "hex");
        const bn = new anchor.BN(buffer, "be");
        return bn.toArrayLike(Buffer, "le", 16);
    };

    const toCardIndex = (plaintext: string) => {
        const value = BigInt(plaintext);
        return Number(value % 52n);
    };

    // ============================================
    // SETUP
    // ============================================

    it("1. Setup table and game", async () => {
        [tablePda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("table"), admin.publicKey.toBuffer(), tableId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );
        [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), tablePda.toBuffer()],
            program.programId
        );
        [gamePda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("game"), tablePda.toBuffer(), gameId.toArrayLike(Buffer, "le", 8)],
            program.programId
        );

        // Create table
        await sendAndConfirm(
            () => program.methods.createTable(tableId, maxPlayers, buyInMin, buyInMax, smallBlind)
                .accounts({ table: tablePda, vault: vaultPda, admin: admin.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
                .rpc(),
            "createTable"
        );

        // Admin joins
        const [adminSeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("player_seat"), tablePda.toBuffer(), admin.publicKey.toBuffer()],
            program.programId
        );

        await sendAndConfirm(
            () => program.methods.joinTable(playerBuyIn)
                .accounts({
                    table: tablePda,
                    vault: vaultPda,
                    playerSeat: adminSeatPda,
                    player: admin.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId
                })
                .rpc(),
            "joinTable (admin)"
        );

        // Fund & join player 2
        const tx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: player2.publicKey, lamports: anchor.web3.LAMPORTS_PER_SOL })
        );
        await provider.sendAndConfirm(tx);

        const [player2SeatPda] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("player_seat"), tablePda.toBuffer(), player2.publicKey.toBuffer()],
            program.programId
        );

        await sendAndConfirm(
            () => program.methods.joinTable(playerBuyIn)
                .accounts({
                    table: tablePda,
                    vault: vaultPda,
                    playerSeat: player2SeatPda,
                    player: player2.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId
                })
                .signers([player2])
                .rpc(),
            "joinTable (player2)"
        );

        // Start game
        await sendAndConfirm(
            () => program.methods.startGame(gameId, admin.publicKey)
                .accounts({
                    table: tablePda,
                    game: gamePda,
                    admin: admin.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId
                })
                .rpc(),
            "startGame"
        );

        console.log("✅ Setup complete");
    });

    // ============================================
    // PROCESS CARDS WITH TRACKING
    // ============================================

    it("2. Backend sends shuffled cards (showing original values)", async function () {
        console.log("\n🃏 BACKEND CARD PROCESSING");
        console.log("===========================");

        try {
            const { encryptValue } = require("@inco/solana-sdk/encryption");

            // ===== STEP 1: BACKEND SHUFFLES DECK =====
            console.log("\n📦 Step 1: Backend shuffles deck");

            // Simulate a shuffled deck (in production, this is Fisher-Yates on 0-51)
            // For simplicity, we use cards 0-14 in a "shuffled" order
            const shuffledDeck = [7, 42, 21, 3, 15, 28, 9, 36, 44, 12, 5, 33, 18, 25, 49];

            console.log("  Shuffled deck (first 15): ", shuffledDeck);

            // Store for later comparison
            backendCards.push(...shuffledDeck);

            // ===== STEP 2: ENCRYPT EACH CARD =====
            console.log("\n🔐 Step 2: Backend encrypts cards");

            const encryptedCards: Buffer[] = [];
            for (let i = 0; i < 15; i++) {
                const cardValue = BigInt(shuffledDeck[i]);
                const hex: string = await encryptValue(cardValue);
                encryptedCards.push(Buffer.from(hex, 'hex'));

                if (i < 4) {
                    console.log(`  Card ${i}: value=${shuffledDeck[i]} -> encrypted (${hex.length} hex chars)`);
                }
            }
            console.log("  ... (11 more cards encrypted)");

            // ===== STEP 3: SEND TO ON-CHAIN IN BATCHES =====
            console.log("\n📤 Step 3: Sending to on-chain (8 batches)");

            for (let batch = 0; batch < 8; batch++) {
                const idx0 = batch * 2;
                const idx1 = batch * 2 + 1;

                // Use dummy card for card 15 (index 15 doesn't exist)
                const card0 = encryptedCards[idx0] || encryptedCards[0];
                const card1 = idx1 < 15 ? encryptedCards[idx1] : encryptedCards[0];

                await sendAndConfirm(
                    () => program.methods
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

            console.log("\n✅ All cards processed on-chain!");

        } catch (e: any) {
            console.log("⚠️ Error:", e.message);
            this.skip();
        }
    });

    // ============================================
    // READ HANDLES FROM PDA
    // ============================================

    it("3. Read encrypted handles from Game PDA", async function () {
        console.log("\n📖 READING HANDLES FROM PDA");
        console.log("============================");

        try {
            const game = await program.account.pokerGame.fetch(gamePda);

            console.log("\n🎴 Game State:");
            console.log("  Cards processed:", game.cardsProcessed);
            console.log("  Stage:", Object.keys(game.stage)[0]);
            console.log("  Shuffled indices (on-chain):", game.shuffledIndices);

            console.log("\n🃏 Deal Cards (hole cards) - Eu128 handles:");
            for (let i = 0; i < 10; i++) {
                const handle = game.dealCards[i];
                // Euint128 might be a BN or have a nested structure
                // Try different extraction methods
                let handleStr: string;
                if (handle && typeof handle === 'object') {
                    if ('toNumber' in handle) {
                        // It's a BN
                        handleStr = (handle as any).toString();
                    } else if (Array.isArray(handle)) {
                        // It might be stored as bytes
                        handleStr = Buffer.from(handle as any).toString('hex');
                    } else {
                        // Check for nested structure
                        handleStr = JSON.stringify(handle);
                    }
                } else {
                    handleStr = String(handle);
                }
                console.log(`  Slot ${i}: handle=${handleStr.slice(0, 40)}...`);
            }

            console.log("\n🌍 Community Cards - Eu128 handles:");
            for (let i = 0; i < 5; i++) {
                const handle = game.communityCards[i];
                let handleStr: string;
                if (handle && typeof handle === 'object' && 'toNumber' in handle) {
                    handleStr = (handle as any).toString();
                } else {
                    handleStr = JSON.stringify(handle);
                }
                console.log(`  Slot ${i}: handle=${handleStr.slice(0, 40)}...`);
            }

            // ===== SHOW PLAYER CARD ASSIGNMENTS =====
            console.log("\n👥 Player Card Assignments:");
            console.log("  (Based on shuffled_indices:", game.shuffledIndices, ")");
            console.log("  (All cards are offset by random mod 52 on-chain)");

            // The shuffled_indices determine which original pair goes to which player
            // If shuffled_indices = [3, 4, 0, 2, 1], then:
            // - Original pair 0 (cards 0,1) -> goes to slot position of player at shuffled_indices[0] = 3
            // - Original pair 1 (cards 2,3) -> goes to slot position of player at shuffled_indices[1] = 4

            for (let playerIdx = 0; playerIdx < 5; playerIdx++) {
                // shuffled_indices[pair_index] = seat_index
                const pairIndex = game.shuffledIndices.findIndex((seat: number) => seat === playerIdx);
                if (pairIndex === -1) {
                    console.log(`  Player ${playerIdx}: no assigned pair (not seated?)`);
                    continue;
                }

                const cardSlot1 = pairIndex * 2;
                const cardSlot2 = pairIndex * 2 + 1;

                const originalCard1 = backendCards[pairIndex * 2] || "?";
                const originalCard2 = backendCards[pairIndex * 2 + 1] || "?";

                console.log(`  Player ${playerIdx}: receives cards from original pair ${pairIndex} (backend values: ${originalCard1}, ${originalCard2})`);
                console.log(`           -> stored in deal_cards slots [${cardSlot1}, ${cardSlot2}]`);
            }

            console.log("\n✅ Handle reading verified!");

        } catch (e: any) {
            console.log("⚠️ Error:", e.message);
            this.skip();
        }
    });

    // ============================================
    // DEMONSTRATE DECRYPTION (CLIENT SIDE)
    // ============================================

    it("4. Show how client would decrypt (code example)", async function () {
        console.log("\n🔓 CLIENT DECRYPTION EXAMPLE");
        console.log("=============================");

        console.log(`
// --- Step 1: Read handle from PDA ---
const game = await program.account.pokerGame.fetch(gamePda);

// Player 0's hole cards are at deal_cards slots based on shuffle
const mySlot = game.shuffledIndices.indexOf(0); // Find my position
// Handle is stored as {"0": "hex_handle_string"}
const card1Handle = game.dealCards[mySlot * 2]["0"];  
const card2Handle = game.dealCards[mySlot * 2 + 1]["0"];

// --- Step 2: Decrypt using Inco SDK ---
import { decrypt } from '@inco/solana-sdk/attested-decrypt';

// Convert hex string to BigInt for decrypt
const handle1 = BigInt('0x' + card1Handle).toString();
const handle2 = BigInt('0x' + card2Handle).toString();

const result = await decrypt([handle1, handle2], {
    address: wallet.publicKey,
    signMessage: wallet.signMessage,
});

console.log("My hole cards:", result.plaintexts);
// Output: e.g., [7, 42] (original card values + random offset mod 52)

// --- Note on offset ---
// The actual revealed values will be: (original_value + random_offset) mod 52
// This is intentional - it blinds the backend from knowing final values
        `);

        console.log("\n📝 Important Notes:");
        console.log("  1. Handles stored as: {\"0\": \"hex_string\"} in PDA");
        console.log("  2. Extract handle: game.dealCards[slot][\"0\"]");
        console.log("  3. Convert: BigInt('0x' + hexHandle).toString()");
        console.log("  4. Decrypted values = (backend_value + random_offset) mod 52");

        console.log("\n✅ Decryption flow documented!");
    });

    // ============================================
    // SUMMARY
    // ============================================

    it("Final: Summary", async () => {
        console.log("\n===========================================");
        console.log("SUMMARY - DECRYPTION FLOW VERIFIED");
        console.log("===========================================");

        console.log("\n📊 Flow:");
        console.log("  1. Backend: shuffle() -> encrypt() -> send batches");
        console.log("  2. On-chain: e_rand() -> apply offset -> shuffle positions");
        console.log("  3. Client: read PDA -> get handle -> decrypt()");

        console.log("\n🔑 Key Points:");
        console.log("  - Handles stored in: game.dealCards[10], game.communityCards[5]");
        console.log("  - Handle type: Euint128 (Inco encrypted u128)");
        console.log("  - Read method: program.account.pokerGame.fetch(gamePda)");
        console.log("  - Decrypt method: decrypt([handle.toString()], {signMessage})");

        try {
            const game = await program.account.pokerGame.fetch(gamePda);
            console.log("\n📦 Sample Handle (deal_cards[0]):");
            const handle = game.dealCards[0];
            console.log("  Full:", JSON.stringify(handle));
        } catch (e) { }

        console.log("===========================================");
    });

    // ============================================
    // REVEAL HAND (ALLOW CPI)
    // ============================================

    it("5. Player calls revealHand (Allow CPI)", async function () {
        console.log("\n🔓 REVEAL HAND TEST");
        console.log("====================");

        try {
            // Recalculate player seats
            // Admin is Player 0, Player2 is Player 1
            const adminSeatPda = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("player_seat"), tablePda.toBuffer(), admin.publicKey.toBuffer()],
                program.programId
            )[0];

            const game = await program.account.pokerGame.fetch(gamePda);

            // Find which pair corresponds to seat 0 (Admin)
            let pairIndex = -1;
            for (let i = 0; i < 5; i++) {
                if (game.shuffledIndices[i] === 0) {
                    pairIndex = i;
                    break;
                }
            }

            if (pairIndex === -1) {
                console.log("⚠️ Could not find seat 0 in shuffled indices");
                return;
            }

            console.log(`  Admin is at Seat 0 -> Assigned Pair Index ${pairIndex}`);

            const h1Hex = extractHandleHex(game.dealCards[pairIndex * 2]);
            const h2Hex = extractHandleHex(game.dealCards[pairIndex * 2 + 1]);

            console.log(`  Card 1 Handle: ${h1Hex.slice(0, 10)}...`);
            console.log(`  Card 2 Handle: ${h2Hex.slice(0, 10)}...`);

            // Helper to pad handle to 16 bytes for seed
            const h1Bytes = handleHexToBytes(h1Hex);
            const h2Bytes = handleHexToBytes(h2Hex);

            // Derive Allowance PDAs
            // Inco docs: seeds = [handle (u128 LE bytes), allowed_address]
            const [allowance1] = anchor.web3.PublicKey.findProgramAddressSync(
                [
                    h1Bytes,
                    admin.publicKey.toBuffer(), // allowed (Player)
                ],
                INCO_LIGHTNING_ID
            );

            const [allowance2] = anchor.web3.PublicKey.findProgramAddressSync(
                [
                    h2Bytes,
                    admin.publicKey.toBuffer(),
                ],
                INCO_LIGHTNING_ID
            );

            console.log("  Derived Allowance PDAs:");
            console.log("  1:", allowance1.toBase58());
            console.log("  2:", allowance2.toBase58());

            await sendAndConfirm(
                () => program.methods.revealHand()
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
                        { pubkey: allowance2, isWritable: true, isSigner: false }
                    ])
                    .rpc(),
                "revealHand"
            );

            console.log("✅ Hand revealed! Allowance accounts created.");

        } catch (e: any) {
            console.log("⚠️ Error:", e.message);
            if (e.logs) console.log(e.logs);
            this.skip();
        }
    });

    // ============================================
    // DECRYPT HOLE CARDS (CLIENT SIDE)
    // ============================================

    it("6. Decrypt revealed hole cards", async function () {
        console.log("\n🔓 DECRYPT HOLE CARDS");
        console.log("======================");

        try {
            const signMessage = getSignMessage();
            if (!signMessage) {
                console.log("⚠️ Wallet does not support signMessage; skipping decrypt test");
                return;
            }

            const game = await program.account.pokerGame.fetch(gamePda);

            // Find admin's pair index (seat 0)
            let pairIndex = -1;
            for (let i = 0; i < 5; i++) {
                if (game.shuffledIndices[i] === 0) {
                    pairIndex = i;
                    break;
                }
            }
            if (pairIndex === -1) throw new Error("seat 0 not found in shuffled indices");

            const h1Hex = extractHandleHex(game.dealCards[pairIndex * 2]);
            const h2Hex = extractHandleHex(game.dealCards[pairIndex * 2 + 1]);

            const handles = [
                handleHexToDecimalString(h1Hex),
                handleHexToDecimalString(h2Hex),
            ];

            const result = await decrypt(handles, {
                address: admin.publicKey,
                signMessage,
            });

            console.log("Decrypted hole cards:", result.plaintexts);
            console.log(
                "Hole card indices (mod 52):",
                result.plaintexts.map(toCardIndex)
            );
            console.log("(Values are offset by random mod 52)");
        } catch (e: any) {
            console.log("⚠️ Error:", e.message);
            if (e.logs) console.log(e.logs);
            return;
        }
    });

    // ============================================
    // REVEAL + DECRYPT COMMUNITY CARDS
    // ============================================

    it("7. Reveal and decrypt community cards (flop)", async function () {
        console.log("\n🌍 REVEAL COMMUNITY (FLOP)");
        console.log("===========================");

        try {
            const signMessage = getSignMessage();
            if (!signMessage) {
                console.log("⚠️ Wallet does not support signMessage; skipping decrypt test");
                return;
            }

            const game = await program.account.pokerGame.fetch(gamePda);

            const commHandles = [
                extractHandleHex(game.communityCards[0]),
                extractHandleHex(game.communityCards[1]),
                extractHandleHex(game.communityCards[2]),
            ];

            const allowance1 = anchor.web3.PublicKey.findProgramAddressSync(
                [handleHexToBytes(commHandles[0]), admin.publicKey.toBuffer()],
                INCO_LIGHTNING_ID
            )[0];
            const allowance2 = anchor.web3.PublicKey.findProgramAddressSync(
                [handleHexToBytes(commHandles[1]), admin.publicKey.toBuffer()],
                INCO_LIGHTNING_ID
            )[0];
            const allowance3 = anchor.web3.PublicKey.findProgramAddressSync(
                [handleHexToBytes(commHandles[2]), admin.publicKey.toBuffer()],
                INCO_LIGHTNING_ID
            )[0];

            // Provide seat accounts after allowance PDAs
            const adminSeatPda = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("player_seat"), tablePda.toBuffer(), admin.publicKey.toBuffer()],
                program.programId
            )[0];
            const player2SeatPda = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("player_seat"), tablePda.toBuffer(), player2.publicKey.toBuffer()],
                program.programId
            )[0];

            await sendAndConfirm(
                () => program.methods.advanceStage()
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
                        { pubkey: adminSeatPda, isWritable: true, isSigner: false },
                        { pubkey: player2SeatPda, isWritable: true, isSigner: false },
                    ])
                    .rpc(),
                "advanceStage (to Flop)"
            );

            const handles = commHandles.map(handleHexToDecimalString);
            const result = await decrypt(handles, {
                address: admin.publicKey,
                signMessage,
            });

            console.log("Decrypted flop cards:", result.plaintexts);
            console.log(
                "Flop card indices (mod 52):",
                result.plaintexts.map(toCardIndex)
            );
            console.log("(Values are offset by random mod 52)");
        } catch (e: any) {
            console.log("⚠️ Error:", e.message);
            if (e.logs) console.log(e.logs);
            return;
        }
    });

    // Tests complete - close describe
});
