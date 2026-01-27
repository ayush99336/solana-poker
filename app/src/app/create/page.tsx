"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useRaffle } from "@/hooks/useRaffle";
import { TxStatus } from "@/components/tx-link";

export default function CreatePage() {
  const router = useRouter();
  const { createRaffle, loading, error } = useRaffle();
  const [price, setPrice] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!price) return;

    setTxStatus("Creating raffle...");
    setTxHash(null);

    // Generate a unique raffle ID from timestamp
    const raffleId = new BN(Date.now());

    // Convert price to lamports
    const ticketPrice = new BN(parseFloat(price) * LAMPORTS_PER_SOL);

    console.log("Creating raffle:", {
      raffleId: raffleId.toString(),
      ticketPrice: ticketPrice.toString(),
    });

    const tx = await createRaffle(raffleId, ticketPrice);

    if (tx) {
      console.log("Raffle created successfully:", tx);
      setTxHash(tx);
      setTxStatus("Raffle created successfully!");

      // Redirect after showing success
      setTimeout(() => {
        router.push("/");
      }, 3000);
    } else {
      setTxStatus(null);
    }
  };

  const inputClass =
    "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-[#3673F5]/50 transition-colors";
  const labelClass =
    "text-xs uppercase tracking-wider text-white/40 mb-2 block";

  return (
    <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto flex flex-col items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-light mb-2 text-center">Create Raffle</h1>
        <p className="text-white/40 mb-12 text-center">
          Set up a new raffle for your community
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {txStatus && (
          <TxStatus status={txStatus} txHash={txHash} isSuccess={!!txHash} />
        )}

        <div className="space-y-6">
          <div>
            <label className={labelClass}>Ticket Price (SOL)</label>
            <input
              type="number"
              placeholder="0.01"
              step="0.01"
              min="0"
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <p className="mt-2 text-xs text-white/30">
              Each participant pays this amount to enter
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !price || !!txHash}
            className={`w-full mt-8 px-6 py-3 bg-white text-black text-sm font-medium rounded-full hover:bg-white/90 transition-all duration-300 ${
              loading || !price || !!txHash
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            {loading
              ? "Creating..."
              : txHash
              ? "Redirecting..."
              : "Create Raffle"}
          </button>
        </div>
      </div>
    </main>
  );
}
