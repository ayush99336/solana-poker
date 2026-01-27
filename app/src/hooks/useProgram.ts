"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import { getProgram } from "@/lib/program";

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    const publicKey = wallet?.publicKey;
    const signTransaction = wallet?.signTransaction;
    const signAllTransactions = wallet?.signAllTransactions;

    if (!publicKey || !signTransaction || !signAllTransactions) return null;

    return getProgram(connection, {
      publicKey,
      signTransaction,
      signAllTransactions,
    });
  }, [
    connection,
    wallet?.publicKey,
    wallet?.signTransaction,
    wallet?.signAllTransactions,
  ]);

  return program;
}
