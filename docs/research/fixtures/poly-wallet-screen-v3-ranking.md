---
id: poly-wallet-screen-v3-ranking
type: research
title: "Polymarket wallet screen v3 — 8-category resolved ranking"
status: active
trust: draft
summary: "Output of slim v3 screener (top-10 per combo, 8 cats × 2 windows × 2 rankings, 160 wallets, 5281 closed markets resolved via disk-cached CLOB). 11 wallets pass filters; tech/weather/finance dominate."
read_when: Choosing v0 copy-trade candidates across all Polymarket categories.
owner: derekg1729
created: 2026-04-18
verified: 2026-04-18
tags: [polymarket, copy-trading, wallet-selection, screen-v3]
---

## v3 full screen — 8 categories, 160 wallets, 5281 closed markets

**Filters:** t/day≥1 · active≤7d · resolved≥10 · WR≥55% · ROI≥10% · med dur ≤9h · DD≤30%

**Survivors: 11** out of 150 scored

| rank | wallet        | name             | lb cats | t/day | resolved |        WR |     ROI |   PnL |   DD% | med dur | top market                           |
| ---: | ------------- | ---------------- | ------- | ----: | -------: | --------: | ------: | ----: | ----: | ------: | ------------------------------------ |
|    1 | `0x02b4401a…` | alohaa           | culture |  6.67 |      117 | **98.3%** | 1225.1% |   $2k |  3.2% |   3.24h | Will Elon Musk post 380-399 tweets f |
|    2 | `0xc6dd7225…` | tourists         | tech    |  6.67 |       14 | **85.7%** |   47.9% | $193k |    0% |    0.1h | US x Iran ceasefire by April 7?      |
|    3 | `0x22e4248b…` | ProfessionalPunt | tech    |  3.13 |       37 | **83.8%** |   97.4% | $148k |  5.6% |   1.08h | Will the next Prime Minister of Hung |
|    4 | `0x00425c69…` | 99problems123    | tech    |  6.67 |       17 | **58.8%** |  101.1% | $262k |  2.2% |   1.41h | US x Iran ceasefire by April 7?      |
|    5 | `0xa8fac068…` | 0xA8fAC068d32639 | culture |  6.67 |       34 | **79.4%** |   33.1% |  $42k |  1.8% |   6.38h | Will MrBeast's next video get betwee |
|    6 | `0xff30ac5b…` | aldynspeedruns   | finance |  1.07 |       72 | **63.9%** |   50.8% | $109k |  8.8% |   0.91h | US government shutdown Saturday?     |
|    7 | `0xb8865806…` | 0xB886580698eDE4 | culture |   3.3 |       62 | **62.9%** |   79.9% |  $10k | 17.4% |   0.43h | Russia x Ukraine ceasefire by end of |
|    8 | `0x331bf91c…` | BeefSlayer       | weather |  6.67 |      118 |   **78%** |   27.3% |   $5k | 10.7% |   0.48h | Will the highest temperature in Aust |
|    9 | `0x9c610b56…` | 0x9C610b56C486B9 | culture |  6.67 |       73 | **68.5%** |   19.8% |  $28k |  7.1% |    7.6h | Will MrBeast hit 474 Million subscri |
|   10 | `0x04821530…` | dumbfuqLIQUIDITY | tech    |  6.67 |       23 | **69.6%** |   22.5% |   $2k |   20% |   1.43h | Will Anthropic have the #3 AI model  |
|   11 | `0xb27bc932…` | 0xB27BC932bf8110 | crypto  |  6.67 |       97 | **61.9%** |   13.5% |   $3k | 28.6% |   0.01h | Bitcoin Up or Down - April 16, 8:55P |

## Top 15 by realized PnL (filters ignored)

| wallet        | name             | lb cats            | resolved |    WR |    ROI |    PnL |    DD% | med dur | passes |
| ------------- | ---------------- | ------------------ | -------: | ----: | -----: | -----: | -----: | ------: | ------ |
| `0xefbc5fec…` | reachingthesky   | sports             |        9 | 44.4% |  75.2% | $2935k |  14.7% |   0.39h | —      |
| `0x5d58e38c…` | Dhdhsjsj         | sports             |       38 | 42.1% |  48.1% | $1918k |    28% |   0.54h | —      |
| `0x0e5bd767…` | JAHODA           | economics          |       35 | 88.6% |  52.1% | $1629k |   0.4% |  44.15h | —      |
| `0x8c80d213…` | SecondWindCapita | politics           |       45 | 42.2% |  85.3% | $1522k |   6.7% |  41.17h | —      |
| `0x02227b8f…` | HorizonSplendidV | sports             |       20 |   50% |    20% | $1475k | 162.9% |   0.17h | —      |
| `0x2785e702…` | poorsob          | politics/economics |       92 | 91.3% |   8.3% | $1347k |   1.7% |   7.71h | —      |
| `0x9d84ce03…` | ImJustKen        | economics          |       70 | 51.4% |  75.5% |  $810k |   3.7% |  21.73h | —      |
| `0x51165347…` | CAR-AyatollahVer | politics           |        9 |  100% |  10.3% |  $712k |     0% |  42.91h | —      |
| `0x492442ea…` | 0x492442EaB586F2 | sports             |       62 | 54.8% |    17% |  $697k |    94% |    0.1h | —      |
| `0xed107a85…` | bobe2            | economics          |       81 | 81.5% |  40.1% |  $649k |   2.9% |  37.28h | —      |
| `0xc6587b11…` | Erasmus.         | politics           |       25 |   72% |  52.9% |  $646k |   2.8% | 241.62h | —      |
| `0xdc4f0872…` | third-eye        | economics          |       93 |   72% |  34.3% |  $538k |   1.6% |   4.59h | —      |
| `0x96489abc…` | anoin123         | tech               |       39 |   59% | 504.8% |  $533k |   1.6% | 138.45h | —      |
| `0xc4d1a863…` | rdba             | culture            |       65 | 76.9% |  12.7% |  $482k |   7.4% |   2.52h | —      |
| `0xd7375270…` | Fernandoinfante  | politics           |       29 | 13.8% | 454.4% |  $439k |   3.9% |  42.46h | —      |
