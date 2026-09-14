# Graph Report - IndicAlerts1.0  (2026-09-14)

## Corpus Check
- 36 files · ~615,051 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: (none) 5, .zip 1, .ini 1)

## Summary
- 369 nodes · 561 edges · 33 communities (23 shown, 6 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `10db061d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- bot.js
- package.json
- mongo.js
- server.js
- dashboard.js
- customPrompt
- What You Must Do When Invoked
- youtube.js
- customAlert
- loadDitoxIdea
- loadTraders
- closeShareOverlay
- updateCarouselUI
- applyTangenteToEl
- clean_index.js
- 3. Convenciones y Buenas Prácticas
- graphify reference: extra exports and benchmark
- state.js
- axios
- mexc.js
- graphify reference: query, path, explain
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- rules/graphify.md
- extraction-spec.md
- workflows/graphify.md

## God Nodes (most connected - your core abstractions)
1. `setupListeners()` - 16 edges
2. `procesarMercado()` - 14 edges
3. `customPrompt()` - 12 edges
4. `What You Must Do When Invoked` - 12 edges
5. `loadDitoxIdea()` - 10 edges
6. `main()` - 10 edges
7. `enviarTelegram()` - 10 edges
8. `/graphify` - 10 edges
9. `graphify reference: extra exports and benchmark` - 8 edges
10. `loadTraders()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `enviarTelegram()`  [INFERRED]
  index.js → src/bot.js
- `main()` --indirect_call--> `procesarMercado()`  [INFERRED]
  index.js → src/engine/loop.js
- `main()` --calls--> `initBot()`  [EXTRACTED]
  index.js → src/bot.js
- `main()` --calls--> `setProcesarMercado()`  [EXTRACTED]
  index.js → src/bot.js
- `main()` --calls--> `connectDB()`  [EXTRACTED]
  index.js → src/db/mongo.js

## Import Cycles
- 2-file cycle: `src/bot.js -> src/engine/loop.js -> src/bot.js`

## Communities (33 total, 6 thin omitted)

### Community 0 - "bot.js"
Cohesion: 0.05
Nodes (67): { connectDB, loadUsers }, { enviarTelegram }, { initBot, setProcesarMercado }, main(), { startMarketLoop, procesarMercado }, { startServer }, { startYoutubePolling }, technicalindicators (+59 more)

### Community 1 - "package.json"
Cohesion: 0.06
Nodes (32): dependencies, axios, dotenv, express, @google/genai, @google/generative-ai, mongoose, node-telegram-bot-api (+24 more)

### Community 2 - "mongo.js"
Cohesion: 0.11
Nodes (19): Audio, AudioSchema, BitacoraTradeSchema, DitoxConfig, DitoxConfigSchema, DitoxIdea, DitoxIdeaPhaseSchema, DitoxIdeaSchema (+11 more)

### Community 3 - "server.js"
Cohesion: 0.11
Nodes (16): getBot(), TargetGroup, User, app, { BitacoraTrade }, { checkConsolidatedAlerts }, DEFAULT_TARGET_GROUPS, { exec } (+8 more)

### Community 4 - "dashboard.js"
Cohesion: 0.09
Nodes (12): audioContext, AURA_STYLES, broadcastFileInput, carouselQuotes, closePrompt(), createParticles(), handlePromptConfirm(), mobNavClick() (+4 more)

### Community 5 - "customPrompt"
Cohesion: 0.16
Nodes (14): addGroup(), addYoutubeChannel(), archiveIdea(), customPrompt(), deleteGroup(), deleteYoutubeChannel(), editGroup(), editYoutubeChannel() (+6 more)

### Community 6 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 7 - "youtube.js"
Cohesion: 0.14
Nodes (19): YoutubeChannel, axios, buildPrompt(), CACHE_DIR, cleanOldCache(), fs, generarResumenIA(), getDurationInSeconds() (+11 more)

### Community 8 - "customAlert"
Cohesion: 0.18
Nodes (11): calculateConfidence(), customAlert(), deleteBitacoraTrade(), deleteIdeaHistory(), fetchDashboardData(), loadBitacoraTrades(), loadIdeasHistory(), renderBitacora() (+3 more)

### Community 9 - "loadDitoxIdea"
Cohesion: 0.22
Nodes (10): createNewIdea(), deleteIdea(), hidePhaseModal(), loadDitoxIdea(), mobilePhaseNav(), saveCurrentPhase(), showPhase(), showPhaseModalDirect() (+2 more)

### Community 10 - "loadTraders"
Cohesion: 0.25
Nodes (8): addTrader(), deleteTrader(), editTraderIdea(), loadTraders(), renderTraderCard(), resolveTrader(), setTraderState(), stateDisplay()

### Community 11 - "closeShareOverlay"
Cohesion: 0.25
Nodes (11): closeShareOverlay(), closeShareOverlayFromBackdrop(), copyShareImage(), downloadShareImage(), generateShareImage(), openShareOverlay(), setShareButtonBusy(), showShareLoader() (+3 more)

### Community 12 - "updateCarouselUI"
Cohesion: 0.40
Nodes (6): goToSlide(), initCarousel(), moveCarousel(), startCarouselAutoPlay(), updateCarouselUI(), updateQuote()

### Community 13 - "applyTangenteToEl"
Cohesion: 0.40
Nodes (4): applyTangenteToEl(), drawMiniGraph(), getTangenteStyle(), openReviewModal()

### Community 18 - "3. Convenciones y Buenas Prácticas"
Cohesion: 0.17
Nodes (11): 1. Descripción del Proyecto, 2. Arquitectura y Módulos, 3. Convenciones y Buenas Prácticas, 4. Uso de Herramientas de Contexto (Graphify), AGENTS.md - Reglas y Contexto del Proyecto, Lenguajes y Frameworks Detectados:, Manejo de Errores:, Objetivos Principales: (+3 more)

### Community 19 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 20 - "state.js"
Cohesion: 0.22
Nodes (8): audioDatabase, estadoAlertas, history, marketSummary, stickyDatabase, terrainAlertsTracker, userDatabase, waitingForNickname

### Community 21 - "axios"
Cohesion: 0.29
Nodes (3): axios, axios, axios

### Community 22 - "mexc.js"
Cohesion: 0.38
Nodes (6): axios, { BitacoraTrade }, crypto, generateSignature(), syncMexcTrades(), BitacoraTrade

### Community 23 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 24 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 25 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 26 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

## Knowledge Gaps
- **156 isolated node(s):** `axios`, `fs`, `content`, `audioContext`, `broadcastFileInput` (+151 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 195 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `axios` connect `axios` to `bot.js`, `package.json`, `server.js`, `youtube.js`, `mexc.js`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `mongoose` connect `package.json` to `mongo.js`, `server.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `procesarMercado()` (e.g. with `main()` and `loop.js`) actually correct?**
  _`procesarMercado()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `axios`, `fs`, `content` to the rest of the system?**
  _156 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `bot.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05092276144907724 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `mongo.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._