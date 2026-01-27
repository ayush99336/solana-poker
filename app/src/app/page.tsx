"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRaffle } from "@/hooks/useRaffle";
import { RaffleAccount } from "@/lib/program";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

export default function HomePage() {
  const { fetchRaffles } = useRaffle();
  const [raffles, setRaffles] = useState<
    { publicKey: PublicKey; account: RaffleAccount }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchRaffles();
      setRaffles(data);
      setLoading(false);
    };
    load();
  }, [fetchRaffles]);

  return (
    <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto">
      <h1 className="text-6xl md:text-8xl font-light tracking-tight leading-none mb-6">
        Win <span className="text-[#3673F5]">Big</span>
        <br />
        Tonight
      </h1>
      <p className="text-white/40 text-lg md:text-xl max-w-xl mb-16">
        Premium raffles with transparent odds. Pick your lucky number and change
        your life.
      </p>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-white/30 mb-8">
          Active Raffles
        </h2>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 animate-pulse"
              >
                <div className="h-6 bg-white/5 rounded w-1/3 mb-4" />
                <div className="h-4 bg-white/5 rounded w-2/3 mb-6" />
                <div className="h-8 bg-white/5 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : raffles.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/40 mb-4">No raffles yet</p>
            <Link
              href="/create"
              className="inline-block px-6 py-3 bg-[#3673F5] text-white text-sm font-medium rounded-full hover:bg-[#3673F5]/90 transition-all"
            >
              Create the first raffle
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {raffles.map((raffle) => (
              <Link
                key={raffle.publicKey.toBase58()}
                href={`/raffle/${raffle.publicKey.toBase58()}`}
                className="group relative bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-500"
              >
                <div className="absolute top-6 right-6">
                  <span
                    className={`text-xs px-3 py-1 rounded-full border ${
                      raffle.account.isOpen
                        ? "bg-[#3673F5]/10 text-[#3673F5] border-[#3673F5]/20"
                        : "bg-white/5 text-white/40 border-white/10"
                    }`}
                  >
                    {raffle.account.isOpen ? "Open" : "Closed"}
                  </span>
                </div>
                <h3 className="text-2xl font-light mb-2 group-hover:text-[#3673F5] transition-colors">
                  Raffle #{raffle.account.raffleId.toString().slice(-6)}
                </h3>
                <p className="text-white/40 text-sm mb-6">
                  {raffle.account.participantCount} participant
                  {raffle.account.participantCount !== 1 ? "s" : ""}
                </p>
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-3xl font-light">
                      {(
                        raffle.account.ticketPrice.toNumber() / LAMPORTS_PER_SOL
                      ).toFixed(2)}{" "}
                      SOL
                    </span>
                    <span className="text-xs text-white/30 ml-1">/ ticket</span>
                  </div>
                  <span className="text-xs text-white/30">
                    ID: {raffle.account.raffleId.toString().slice(-8)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
