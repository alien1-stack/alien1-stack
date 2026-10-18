# Daejin research (fetched 2026-10-19)

## Access caveat
www.daejin.xyz and /prediction return "not available in your region (US)" from the research sandbox, so the live featured-markets list could NOT be read. Facts below come from the developer docs (docs.daejin.xyz, reachable), the public engine API, and the Superteam Earn listing. The entrant must open /prediction themselves and pick a featured market for {MARKET_NAME}.

## Bounty facts (Superteam Earn listing API, slug launch-and-trade-on-daejin-write-a-twitter-thread-and-create-a-market)
- Deadline: 2026-10-23 21:59 UTC (4 days from today). Prizes 200/150/110/90/70 USDC (620 total). Global.
- Eligibility, ALL required: position >= $5 in a featured market (or another creator's market); own market created; screenshots of both in thread; tag @Daejinxyz AND @Superteam; thread must explain how Daejin works (screenshot/link-only threads not judged); original, public until winners announced.
- Form asks for: link to market created (and market where position was taken). Wallet address collected at submit: do NOT post it in the thread.
- Scoring /100: Reach+engagement 30 (reach 15, engagement rate vs followers 15); Clarity 25 (newcomer must understand how prices form and how winners split the pool); Hands-on depth 25 (real thesis + well-designed market; liquidity seed = bonus); Writing/visuals 20.
- Disqualified: botted views, paid engagement, pods, "like & RT to win".
- Creating a market is free; you cannot take a position in your own market. Optional bonus: seed liquidity + screenshot.

## Concrete product facts
1. Prices are probabilities in cents; tick 1000 = $1.00; a winning share pays $1. Walkthrough: buy 10 YES at 50c = $5 cost, resolves YES, $10 payout; net $4.95 after fee. Source: docs.daejin.xyz/docs/solana-walkthrough
2. Fee: "1% of the trade" (in the walkthrough example; confirm in UI before quoting as a general rule). Same source.
3. Price moves with buying: AMM quote starts yes 500 / no 500; after a 5 USDC-share buy it shows yes 667 / no 333 ("the AMM sold YES, so YES got dearer"). Same source.
4. Anyone can add liquidity to a market and withdraw; LPs can lose vs. resolution (example: removing $25 returns $24.50 because the pool sold shares that settled at par). Same source. Useful for the "bonus liquidity" tweet: liquidity is not free money.
5. Resolution is an "operator action", not something traders call; payout is claimed on-chain afterwards (claim, then withdraw). Settlement program on Solana mainnet: EJMhw3BibsxMj8az8DsE1D8qUpUDyPSssX2tKpWQ3jeM. Sources: docs.daejin.xyz/docs/solana-walkthrough, /docs/contracts
6. Also (extra): docs list Ethereum and BSC contracts alongside Solana, so "Solana only" is not strictly what the docs describe; stick to "on Solana" for the entrant's own experience. Order book + AMM both exist (limit orders on a CLOB; market orders against the AMM). Public engine API at api-prediction.daejin.xyz/clob-engine/v1/markets lists ~15 books, only one (id 397) with open orders at fetch time: thin liquidity, so expect to move the price with $5-ish. Don't claim volume.

## Gaps / do-not-claim
- Could not verify UI details (market creation form fields, min liquidity, creator fee share, dispute process). Thread uses only the listing text ("resolves with published, evidence-based proof, verifiable on-chain") for resolution.

## Market idea (verified inputs: SOL ~ $103.1 on CoinGecko/Crypto.com, 2026-10-19)
Title: Will SOL close above $110 on 14 Nov 2026 (UTC)?
Resolution: YES if the CoinMarketCap historical-data "Close" for SOL on 14 Nov 2026 (UTC daily candle) is > $110.00; otherwise NO.
Source: https://coinmarketcap.com/currencies/solana/historical-data/ (screenshot attached as evidence). Backup source if CMC unavailable: CoinGecko daily close.
Resolution date: 15 Nov 2026 (26 days out, inside the 2-4 week window). ~6.7% above spot: near coin-flip, good for a newcomer story, no private person involved.
Note the market only needs to be created before the Oct 23 deadline; it does not need to resolve by then.
