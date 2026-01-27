"use client";

interface TxLinkProps {
  txHash: string;
}

export function TxLink({ txHash }: TxLinkProps) {
  const explorerUrl = `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
  const shortHash = `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-[#3673F5] hover:text-[#3673F5]/80 transition-colors"
    >
      <span className="font-mono text-xs">{shortHash}</span>
      <svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}

interface TxStatusProps {
  status: string;
  txHash?: string | null;
  isError?: boolean;
  isSuccess?: boolean;
}

export function TxStatus({
  status,
  txHash,
  isError,
  isSuccess,
}: TxStatusProps) {
  return (
    <div
      className={`mb-6 p-4 rounded-xl text-sm ${
        isError
          ? "bg-red-500/10 border border-red-500/20 text-red-400"
          : isSuccess
          ? "bg-green-500/10 border border-green-500/20 text-green-400"
          : "bg-[#3673F5]/10 border border-[#3673F5]/20 text-[#3673F5]"
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <span>{status}</span>
        {txHash && <TxLink txHash={txHash} />}
      </div>
    </div>
  );
}
