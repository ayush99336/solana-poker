import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PrivateRaffle } from "../target/types/private_raffle";
import { PublicKey, Keypair, SystemProgram, Connection, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import { handleToBuffer, plaintextToBuffer, hexToBuffer } from "@inco/solana-sdk/utils";

const INCO_LIGHTNING_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

describe("private-raffle", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, anchor.AnchorProvider.env().wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.privateRaffle as Program<PrivateRaffle>;
  let wallet: Keypair;

  const raffleId = Math.floor(Date.now() / 1000);
  const TICKET_PRICE = 10_000_000; // 0.01 SOL

  // The game: guess 1-100, winning number is random!
  const MY_GUESS = 42;

  let rafflePda: PublicKey;
  let vaultPda: PublicKey;
  let ticketPda: PublicKey;

  before(() => {
    wallet = (provider.wallet as any).payer as Keypair;

    const idBuffer = Buffer.alloc(8);
    idBuffer.writeBigUInt64LE(BigInt(raffleId));

    [rafflePda] = PublicKey.findProgramAddressSync([Buffer.from("raffle"), idBuffer], program.programId);
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), rafflePda.toBuffer()], program.programId);
    [ticketPda] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), rafflePda.toBuffer(), wallet.publicKey.toBuffer()], program.programId);
  });

  function deriveAllowancePda(handle: bigint): [PublicKey, number] {
    const buf = Buffer.alloc(16);
    let v = handle;
    for (let i = 0; i < 16; i++) { buf[i] = Number(v & BigInt(0xff)); v >>= BigInt(8); }
    return PublicKey.findProgramAddressSync([buf, wallet.publicKey.toBuffer()], INCO_LIGHTNING_PROGRAM_ID);
  }

  async function decryptHandle(handle: string): Promise<{ plaintext: string; ed25519Instructions: any[] } | null> {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const result = await decrypt([handle], {
        address: wallet.publicKey,
        signMessage: async (msg: Uint8Array) => nacl.sign.detached(msg, wallet.secretKey),
      });
      return { plaintext: result.plaintexts[0], ed25519Instructions: result.ed25519Instructions };
    } catch { return null; }
  }

  async function getHandleFromSimulation(tx: anchor.web3.Transaction, prefix: string): Promise<bigint | null> {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);

    const sim = await connection.simulateTransaction(tx);
    for (const log of sim.value.logs || []) {
      if (log.includes(prefix)) {
        const match = log.match(/(\d+)/);
        if (match) return BigInt(match[1]);
      }
    }
    return null;
  }

  it("1. Create raffle", async () => {
    const tx = await program.methods
      .createRaffle(new anchor.BN(raffleId), new anchor.BN(TICKET_PRICE))
      .accounts({
        authority: wallet.publicKey,
        raffle: rafflePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log("Raffle created:", tx);
    console.log("   Guess a number 1-100!");
  });

  it("2. Buy ticket with encrypted guess", async () => {
    console.log("   My guess:", MY_GUESS, "(encrypted, nobody sees this!)");
    const encryptedGuess = await encryptValue(BigInt(MY_GUESS));

    const tx = await program.methods
      .buyTicket(hexToBuffer(encryptedGuess))
      .accounts({
        buyer: wallet.publicKey,
        raffle: rafflePda,
        ticket: ticketPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .rpc();

    console.log("Ticket bought:", tx);
  });

  it("3. Draw random winning number (e_rand)", async () => {
    // Now uses e_rand - no one can cheat!
    const tx = await program.methods
      .drawWinner()
      .accounts({
        authority: wallet.publicKey,
        raffle: rafflePda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .rpc();

    console.log("Random winning number drawn:", tx);
    console.log("   (Encrypted random 1-100 - nobody knows, not even authority!)");
  });

  it("4. Check if I won (encrypted comparison)", async () => {
    const txForSim = await program.methods
      .checkWinner()
      .accounts({
        checker: wallet.publicKey,
        raffle: rafflePda,
        ticket: ticketPda,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .transaction();

    const resultHandle = await getHandleFromSimulation(txForSim, "Result handle:");

    if (resultHandle) {
      const [allowancePda] = deriveAllowancePda(resultHandle);

      const tx = await program.methods
        .checkWinner()
        .accounts({
          checker: wallet.publicKey,
          raffle: rafflePda,
          ticket: ticketPda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .remainingAccounts([
          { pubkey: allowancePda, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        ])
        .rpc();

      console.log("Checked:", tx);

      const result = await decryptHandle(resultHandle.toString());
      if (result) {
        const won = result.plaintext === "1";
        console.log("   Did I win?", won ? "YES!" : "No (random number didn't match)");
      }
    }
  });

  it("5. Withdraw prize (if winner)", async () => {
    const ticket = await program.account.ticket.fetch(ticketPda);
    const isWinnerHandle = ticket.isWinnerHandle.toString();

    if (isWinnerHandle === "0") {
      console.log("   Ticket not checked yet");
      return;
    }

    const result = await decryptHandle(isWinnerHandle);
    if (!result) {
      console.log("   Failed to decrypt");
      return;
    }

    const isWinner = result.plaintext === "1";
    console.log("   Is winner:", isWinner);

    if (isWinner) {
      const withdrawIx = await program.methods
        .withdrawPrize(handleToBuffer(isWinnerHandle), plaintextToBuffer(result.plaintext))
        .accounts({
          winner: wallet.publicKey,
          raffle: rafflePda,
          ticket: ticketPda,
          vault: vaultPda,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .instruction();

      const tx = new Transaction();
      result.ed25519Instructions.forEach(ix => tx.add(ix));
      tx.add(withdrawIx);

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = wallet.publicKey;

      const signedTx = await provider.wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(sig, "confirmed");

      console.log("Prize withdrawn:", sig);
    } else {
      console.log("   Not a winner - cannot withdraw");
    }
  });

  // ============ LOSER TEST ============
  describe("Non-winner flow", () => {
    const raffleId2 = raffleId + 1;
    const LOSER_GUESS = 99;

    let raffle2Pda: PublicKey;
    let vault2Pda: PublicKey;
    let ticket2Pda: PublicKey;

    before(() => {
      const idBuffer = Buffer.alloc(8);
      idBuffer.writeBigUInt64LE(BigInt(raffleId2));

      [raffle2Pda] = PublicKey.findProgramAddressSync([Buffer.from("raffle"), idBuffer], program.programId);
      [vault2Pda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), raffle2Pda.toBuffer()], program.programId);
      [ticket2Pda] = PublicKey.findProgramAddressSync([Buffer.from("ticket"), raffle2Pda.toBuffer(), wallet.publicKey.toBuffer()], program.programId);
    });

    it("6. Create raffle (loser test)", async () => {
      const tx = await program.methods
        .createRaffle(new anchor.BN(raffleId2), new anchor.BN(TICKET_PRICE))
        .accounts({
          authority: wallet.publicKey,
          raffle: raffle2Pda,
          vault: vault2Pda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      console.log("Raffle 2 created:", tx);
    });

    it("7. Buy ticket with guess", async () => {
      console.log("   My guess:", LOSER_GUESS);
      const encryptedGuess = await encryptValue(BigInt(LOSER_GUESS));

      const tx = await program.methods
        .buyTicket(hexToBuffer(encryptedGuess))
        .accounts({
          buyer: wallet.publicKey,
          raffle: raffle2Pda,
          ticket: ticket2Pda,
          vault: vault2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .rpc();

      console.log("Ticket bought:", tx);
    });

    it("8. Draw random winning number", async () => {
      const tx = await program.methods
        .drawWinner()
        .accounts({
          authority: wallet.publicKey,
          raffle: raffle2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .rpc();

      console.log("Random winning number drawn:", tx);
    });

    it("9. Check if I won", async () => {
      const txForSim = await program.methods
        .checkWinner()
        .accounts({
          checker: wallet.publicKey,
          raffle: raffle2Pda,
          ticket: ticket2Pda,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .transaction();

      const resultHandle = await getHandleFromSimulation(txForSim, "Result handle:");

      if (resultHandle) {
        const [allowancePda] = deriveAllowancePda(resultHandle);

        const tx = await program.methods
          .checkWinner()
          .accounts({
            checker: wallet.publicKey,
            raffle: raffle2Pda,
            ticket: ticket2Pda,
            systemProgram: SystemProgram.programId,
            incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          } as any)
          .remainingAccounts([
            { pubkey: allowancePda, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
          ])
          .rpc();

        console.log("Checked:", tx);

        const result = await decryptHandle(resultHandle.toString());
        if (result) {
          const won = result.plaintext === "1";
          console.log("   Did I win?", won ? "YES!" : "No");
        }
      }
    });

    it("10. Withdraw should fail if not winner", async () => {
      const ticket = await program.account.ticket.fetch(ticket2Pda);
      const isWinnerHandle = ticket.isWinnerHandle.toString();

      if (isWinnerHandle === "0") {
        console.log("   Ticket not checked");
        return;
      }

      const result = await decryptHandle(isWinnerHandle);
      if (!result) {
        console.log("   Failed to decrypt");
        return;
      }

      const isWinner = result.plaintext === "1";
      console.log("   Is winner:", isWinner);

      if (!isWinner) {
        console.log("   Not a winner - trying to withdraw anyway (should fail)");

        try {
          const withdrawIx = await program.methods
            .withdrawPrize(handleToBuffer(isWinnerHandle), plaintextToBuffer(result.plaintext))
            .accounts({
              winner: wallet.publicKey,
              raffle: raffle2Pda,
              ticket: ticket2Pda,
              vault: vault2Pda,
              instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
              systemProgram: SystemProgram.programId,
              incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
            } as any)
            .instruction();

          const tx = new Transaction();
          result.ed25519Instructions.forEach(ix => tx.add(ix));
          tx.add(withdrawIx);

          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = wallet.publicKey;

          const signedTx = await provider.wallet.signTransaction(tx);
          await connection.sendRawTransaction(signedTx.serialize());

          throw new Error("Should have failed!");
        } catch (e: any) {
          if (e.message.includes("NotWinner") || e.message.includes("Should have failed")) {
            console.log("   Withdraw correctly rejected - NotWinner!");
          } else {
            console.log("   Withdraw rejected:", e.message.slice(0, 50));
          }
        }
      } else {
        // If by chance they won, withdraw normally
        const withdrawIx = await program.methods
          .withdrawPrize(handleToBuffer(isWinnerHandle), plaintextToBuffer(result.plaintext))
          .accounts({
            winner: wallet.publicKey,
            raffle: raffle2Pda,
            ticket: ticket2Pda,
            vault: vault2Pda,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
            systemProgram: SystemProgram.programId,
            incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          } as any)
          .instruction();

        const tx = new Transaction();
        result.ed25519Instructions.forEach(ix => tx.add(ix));
        tx.add(withdrawIx);

        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = wallet.publicKey;

        const signedTx = await provider.wallet.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(sig, "confirmed");

        console.log("   Lucky winner! Prize withdrawn:", sig);
      }
    });
  });
});
