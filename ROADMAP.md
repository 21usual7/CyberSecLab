# CPU Labs — Roadmap

Living plan for the project. Status as of **2026-11-15**.

- **Repo:** https://github.com/21usual7/CyberSecLab
- **Live:** https://21usual7.github.io/CyberSecLab/
- **Stack:** Vite 8 · React 19 · TypeScript · Tailwind 4 · CodeMirror 6 · framer-motion · Vitest

---

## 1. Vision

An interactive, in-browser "microscope" for CPU microarchitecture. You write
assembly for a small invented out-of-order CPU and watch, tick by tick, what the
pipeline, micro-ops, branch predictor, reorder buffer and L1 cache actually do —
stepping forward *and backward* through time. On top of that foundation sit
guided labs on speculative-execution vulnerabilities (Spectre, Meltdown, …) and
their mitigations.

**Goal:** make the mechanism of these bugs *understandable*, not reproducible on
real hardware.

## 2. Safety model (non-negotiable, by design)

- Assembly is parsed to a data structure and **interpreted** by a synthetic
  core. It never becomes JS/WASM/machine code and never runs on a real CPU.
- Cache geometry, latencies and µop timings are **invented teaching numbers**;
  they do not match any physical processor, so nothing here can characterise or
  tune a real-world attack.
- `rdtsc` returns the **simulated** cycle counter. No `performance.now`, no
  network, no host memory.
- The static analyzer **teaches** the gadget and its defences — it never blocks,
  because the gadget is the subject of study.
- Hard execution limits (program size, data size, tick budget).

Every new feature must preserve this. New labs explain concepts and defences;
they never add a path to real hardware, real timers, or code generation.

---

## Networking expansion — 2026-11-15

Eight live networking modules are available at `#/network`: Ethernet/ARP/ICMP,
subnetting, IPv4 routing/TTL, NAT, TCP/HTTP, DNS, unknown-fault diagnosis and a
final Cisco-style configuration / ACL lab. There are 19
original experiments aligned with networking topics from HTB Foundations and
Penetration Tester, with editable packets, continuous pausable flight, layer
inspection, device-state rewind, predictions, attempt comparison, internal
processing views and observation checks. The final lab proves five explicit
connectivity/access requirements using the same packet model. See
[`src/network/README.md`](src/network/README.md) for contracts and boundaries.

Next networking foundations: DHCP, DNS recursion, TCP loss /
retransmission, stateful firewall rules, VLAN/trunk models and multi-router segmentation. Preserve
the sequence: manipulate a mechanism, observe consequences, explain why.

## 3. Current status — v0.1 (shipped)

### Engine — `src/engine/` (pure, deterministic, no React)
- `isa.ts` — x86-flavoured teaching ISA: `mov, add, sub, and, or, xor, shl, shr,
  cmp, test, jmp/jcc, clflush, lfence, mfence, rdtsc, nop, hlt`; 8 registers;
  ZF/CF/SF/OF.
- `assembler.ts` — source → program: `.data`/`.text`, labels, `db/dq/times`,
  `[base+index*scale+disp]`, `byte/qword ptr`, friendly per-line errors, limits.
- `microcode.ts` — instruction → µops (e.g. `add rax,[m]` → `LOAD`+`ALU`).
- `memory.ts` — isolated flat address space with user/kernel region attributes.
- `cache.ts` — set-associative L1D (64×4, 64 B lines, LRU) with a
  **speculative-fill** flag and an event log.
- `predictor.ts` — 2-bit (default), 1-bit, static predictors behind one interface.
- `core.ts` — out-of-order core: fetch → rename (RAT + physical regs) → ROB →
  issue → execute → commit; branch misprediction **squashes younger µops without
  rolling back the cache**; `lfence` acts as a dispatch barrier.
- `reference.ts` — plain in-order interpreter = architectural ground truth.
- `analyzer.ts` — static detection + explanation of the v1 gadget and the timing
  probe, with mitigation hints.
- `trace.ts` — per-tick snapshots for forward/back stepping.

### UI — `src/components/`, `src/pages/`, `src/hooks/`
- `useSimulator` hook; `CodeEditor` (asm highlighting, current-fetch marker,
  analyzer underlines), `Controls` (run/step/back/play/scrub/speed),
  `PipelineView` (ROB µop chips), `RegisterFile`, `PredictorView`, `CacheView`
  (speculative residue highlighted), `Timeline` (µop×tick Gantt), `AnalyzerPanel`.
- Pages: `Home`, `LabPage`, `Sandbox`. Hash routing, dark/light theme.

### Lab 1 — Spectre v1 (bounds check bypass)
Theory, 5 guided steps, starter + mitigated variants (`lfence`, index masking).

### Quality & infra
- Tests (Vitest, 19): assembler, cache, predictor, **differential OoO vs
  reference**, Spectre lab (line survives squash; mitigations close it; analyzer
  detects then goes quiet).
- `npm run lint` clean, `npm run build` clean.
- Deployed to GitHub Pages from the `gh-pages` branch (manual publish for now).

---

## 4. Roadmap

### M1 — Foundation ✅ (done)
Engine, UI, Lab 1, tests, deploy. See §3.

### M2 — More labs
- [ ] **Spectre v2** (branch target injection) — add a BTB to the predictor;
      mistrain an indirect branch; show the speculative call to a wrong target.
- [ ] **ret2spec / RSB** — a return stack buffer and its underflow.
- [ ] **Spectre v4** (speculative store bypass) — requires the store buffer (M3);
      a load speculatively bypasses an older, unresolved store.
- [ ] **Meltdown** — use the existing user/kernel region attribute; defer the
      privilege-check fault to retire so the out-of-bounds byte is used
      speculatively. Show KPTI-style separation as the defence.
- [ ] Mitigation catalogue page: lfence/masking, retpoline (concept), IBRS/KPTI
      (concept), explained against the labs that motivate them.

### M3 — Engine depth
- [ ] **Store buffer + store-to-load forwarding** (replaces today's conservative
      "load waits for all older stores"); unlocks Spectre v4.
- [ ] **gshare** predictor (global history) alongside the per-PC counters.
- [ ] **BTB** for indirect-branch target prediction (shared with v2).
- [ ] **Configurable CPU presets** — ROB depth, fetch/issue width, cache
      latencies, predictor choice; "vulnerable" vs "hardened" presets to show how
      the speculation-window size changes the leak.
- [ ] Optional L2 / multi-level cache for richer timing stories.

### M4 — UX & learning
- [ ] **Diff mode** — run with/without a mitigation side by side, highlight the
      ticks where behaviour diverges.
- [ ] **Per-µop inspector** — click a µop to see why it's in its current stage
      and what it waits on.
- [ ] **Timing-probe view** — the rdtsc histogram that reads the secret back out
      of the cache, as a first-class panel.
- [ ] **Quizzes / goal auto-check** — verify a lab step's goal against the trace;
      persist progress in `localStorage`.
- [ ] **Shareable programs** — encode the source in the URL hash.
- [ ] **i18n** — RU/UA/EN switch (UI currently English).

### M5 — Infra & polish
- [ ] **CI auto-deploy** — add `.github/workflows/deploy.yml` (lint + test +
      build → Pages). Blocked: the `gh` token needs `workflow` scope
      (`gh auth refresh -s workflow`); until then deploys are manual to
      `gh-pages`.
- [ ] Bundle **code-splitting** (CodeMirror + framer-motion push the main chunk
      over 500 KB).
- [ ] Repo description + topics; a short screencast/GIF in the README.

---

## 5. Known limitations / tech debt

- Memory ordering is conservative (loads wait for all older stores to commit);
  faithful enough for v1 but must change for v4 — see M3.
- Values are 32-bit (`>>> 0`) for exact JS math; the ISA is "64-bit" in name only.
- Per-tick snapshots keep a full cache image; fine for teaching-sized programs,
  capped by `maxTicks`. Revisit if larger programs are needed.
- Deploy is manual until the CI workflow lands (M5).
- Editor syntax colors come from CodeMirror's default dark highlight, not the
  custom token palette (cosmetic).

## 6. Dev commands

```bash
npm install
npm run dev        # Vite dev server (base '/')
npm run build      # typecheck + production build (base '/CyberSecLab/')
npm run lint       # oxlint
npx vitest run     # engine + lab tests
```

Manual Pages publish (until M5 CI):

```bash
npm run build
cd dist && touch .nojekyll && git init -q && git checkout -b gh-pages \
  && git add -A && git commit -qm deploy \
  && git push -fq https://github.com/21usual7/CyberSecLab.git gh-pages \
  && rm -rf .git
```

## 7. Contributing conventions

- New instructions: one entry in `isa.ts` + decoding in `microcode.ts` (+ the
  in-order path in `reference.ts` so the differential test still passes).
- New labs: a module under `src/labs/labNN/`, registered in `src/labs/index.ts`.
- New checks in the analyzer return annotations (severity + explanation); they
  never block or rewrite user code.
- Keep the engine pure and deterministic; keep React out of `src/engine/`.
