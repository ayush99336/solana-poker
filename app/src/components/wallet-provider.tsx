"use client";

import {
  WalletProvider,
  ConnectionProvider,
} from "@solana/wallet-adapter-react";
import {
  AlphaWalletAdapter,
  LedgerWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { useMemo, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

import "@solana/wallet-adapter-react-ui/styles.css";

const WalletModalProvider = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      ({ WalletModalProvider }) => WalletModalProvider
    ),
  { ssr: false }
);

const Navbar = dynamic(() => import("./navbar"), { ssr: false });

const WalletConnectionWrapper = dynamic(
  () =>
    import("./wallet-connection-wrapper").then(
      (mod) => mod.WalletConnectionWrapper
    ),
  { ssr: false }
);

const emptySubscribe = () => () => {};

// Loading skeleton while wallet provider initializes
function LoadingSkeleton() {
  return (
    <main className="pt-32 px-8 pb-20 max-w-6xl mx-auto">
      <div className="animate-pulse">
        <div className="h-16 bg-white/5 rounded w-1/2 mb-6" />
        <div className="h-6 bg-white/5 rounded w-1/3 mb-16" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-6"
            >
              <div className="h-6 bg-white/5 rounded w-1/3 mb-4" />
              <div className="h-4 bg-white/5 rounded w-2/3 mb-6" />
              <div className="h-8 bg-white/5 rounded w-1/4" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export const Wallet = ({ children }: { children: React.ReactNode }) => {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

  const config = {
    commitment: "confirmed" as const,
    wsEndpoint: endpoint.replace("https", "wss"),
    confirmTransactionInitialTimeout: 60000,
  };

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new AlphaWalletAdapter(),
      new LedgerWalletAdapter(),
    ],
    []
  );

  // During SSR or before mount, show loading skeleton instead of rendering children without context
  if (!mounted) {
    return <LoadingSkeleton />;
  }

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect={true}>
        <WalletModalProvider>
          <Navbar />
          <WalletConnectionWrapper>{children}</WalletConnectionWrapper>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default Wallet;
