import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"
import { createPublicClient, http, erc20Abi } from "viem"

const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1)
const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms))])

async function main() {
  const pub = createPublicClient({ chain: hidekiTestnet as any, transport: http("https://api.hideki2.infra.testnet.somnia.network") })
  console.log("rpc chainId:", await withTimeout(pub.getChainId(), 15000, "chainId"))
  for (const [name, addr] of [["doc Collateral (USDso)", "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72"], ["SDK collateral/testUsdc", SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral]] as const) {
    try {
      const [sym, dec, code] = await Promise.all([
        pub.readContract({ address: addr as any, abi: erc20Abi, functionName: "symbol" }),
        pub.readContract({ address: addr as any, abi: erc20Abi, functionName: "decimals" }),
        pub.getCode({ address: addr as any }),
      ])
      console.log(name, addr, "symbol", sym, "decimals", dec, "codeLen", code?.length)
    } catch (e: any) { console.log(name, addr, "ERR", e.shortMessage || e.message) }
  }
  const markets = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES } as any)
  try {
    const cfg = await withTimeout(markets.client.getPerpSystemConfig("0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as any), 30000, "getPerpSystemConfig")
    console.log("getPerpSystemConfig:", j(cfg))
  } catch (e: any) { console.log("getPerpSystemConfig ERR", e.shortMessage || e.message) }
  process.exit(0)
}
main().catch((e) => { console.error("ERROR", e?.shortMessage || e?.message || e); process.exit(1) })
