"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";

const WalletButton = dynamic(() => import("./wallet-button"), {
  ssr: false,
  loading: () => (
    <div className="w-24 h-9 bg-white/5 rounded-lg animate-pulse" />
  ),
});

export default function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-8 py-6 bg-[#0a0a0b]/80 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-xl font-medium tracking-tight">
          raffle<span className="text-[#3673F5]">.</span>
        </Link>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full">
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            Powered by
          </span>
          <Link href="https://inco.org" target="_blank" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Inco"
            width={16}
            height={16}
            className="opacity-80"
          /><p className="text-xs text-white/40">Inco</p></Link>
        </div>
      </div>
      <div className="flex items-center gap-8">
        <div className="flex gap-6 text-sm text-white/60">
          <Link href="/" className="hover:text-white transition-colors">
            Raffles
          </Link>
          <Link href="/create" className="hover:text-white transition-colors">
            Create
          </Link>
        </div>
        <WalletButton />
      </div>
    </nav>
  );
}
