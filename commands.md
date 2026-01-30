# test Solana Poker Flow
ANCHOR_PROVIDER_URL="https://devnet.helius-rpc.com/?api-key=19e8e7a6-48a7-405a-95d6-27123b062c3d" \
ANCHOR_WALLET="$HOME/.config/solana/id.json" \
./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "tests/solana-poker.flow.ts"


# Build the Solana Poker Program
 anchor build --program-name solana-poker

# Deploy the Solana Poker Program
    anchor deploy --program-name solana-poker


    #Upgrade
    anchor upgrade --program-id 7EZ1zWNMjuHh62dikk9TAo478VMzAiLkvg8S7Vm85T7s target/deploy/solana_poker.so
