"use client";

import Image from "next/image";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export default function ConnectWallet() {
  const { setVisible } = useWalletModal();

  return (
    <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto min-h-screen flex flex-col items-center justify-center">
      <div className="text-center max-w-xl">
        <h1 className="text-6xl md:text-8xl font-light tracking-tight leading-none mb-6">
          Connect
          <br />
          <span className="text-[#3673F5]">Wallet</span>
        </h1>

        <p className="text-white/40 text-lg md:text-xl max-w-md mx-auto mb-12">
          Connect your Solana wallet to explore raffles, buy tickets, and win
          amazing prizes.
        </p>

        <button
          onClick={() => setVisible(true)}
          className="px-8 py-4 bg-white text-black text-sm font-medium rounded-full hover:bg-white/90 transition-all duration-300"
        >
          Connect Wallet
        </button>

        <div className="mt-16">
          <p className="text-xs uppercase tracking-[0.2em] text-white/30 mb-6">
            Supported Wallets
          </p>
          <div className="flex justify-center gap-3">
            {["Phantom", "Solflare", "Ledger", "Backpack"].map((wallet) => (
              <button
                key={wallet}
                onClick={() => setVisible(true)}
                className="px-4 py-2 bg-white/[0.02] border border-white/5 rounded-full text-xs text-white/40 hover:bg-white/[0.04] hover:border-white/10 hover:text-white/60 transition-all duration-300"
              >
                {wallet}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/30">Powered by</span>
            <Image
              src="/logo.png"
              alt="Inco"
              width={48}
              height={16}
              className="opacity-60"
            />
          </div>
          <p className="text-xs text-white/20">
            Privacy-preserving raffles with encrypted computation
          </p>
        </div>
      </div>
    </main>
  );
}
