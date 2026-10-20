import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
const m: any = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
const fn = m.client.getSystemInfo ?? m.getSystemInfo
Promise.race([fn.call(m.client.getSystemInfo ? m.client : m), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 40000))])
  .then((s: any) => { console.log("usdc:", JSON.stringify(s.usdc)); process.exit(0) })
  .catch((e: any) => { console.log("ERR", e.shortMessage || e.message); process.exit(1) })
