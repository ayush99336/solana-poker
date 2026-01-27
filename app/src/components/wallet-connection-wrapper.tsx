"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWallet from "./connect-wallet";

export const WalletConnectionWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { connected } = useWallet();

  if (!connected) {
    return <ConnectWallet />;
  }

  return <>{children}</>;
};

export default WalletConnectionWrapper;
