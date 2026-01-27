"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export default function WalletButton() {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (!connected) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="text-sm px-4 py-2 rounded-lg bg-[#3673F5] hover:bg-[#3673F5]/90 transition-colors"
      >
        Connect
      </button>
    );
  }

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : "";

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-white/60 bg-white/5 px-3 py-1.5 rounded-lg">
        {shortAddress}
      </span>
      <button
        onClick={() => disconnect()}
        className="text-sm px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all"
      >
        Disconnect
      </button>
    </div>
  );
}
