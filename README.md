# CPU Labs

An interactive, in-browser microarchitecture simulator for learning how a CPU
really works — pipeline, micro-ops, branch predictor, reorder buffer and L1
cache — and, on top of that, how speculative-execution vulnerabilities arise and
how they are mitigated. Write assembly, press Run, and step forward and backward
through time to watch every tick under a microscope.

The first lab walks through **Spectre v1 (bounds check bypass)**: a bounds-checked
load that runs speculatively past a mispredicted branch and leaves a measurable
trace in the cache — and the two standard fixes (`lfence` and index masking).

## Safety model — why you can't build a real exploit here

This is a teaching tool, and it is safe by construction, not by a blocklist:

- **Nothing real executes.** Your assembly is parsed into a data structure and
  interpreted by an invented teaching core. It never becomes JavaScript, WASM or
  machine code, and it never runs on a real CPU.
- **The microarchitecture is synthetic.** Cache geometry, hit/miss latencies and
  the micro-op timings are made-up round numbers chosen for clarity. They do not
  match any physical processor, so measurements here cannot characterise or tune
  an attack against real hardware.
- **No real side channels.** `rdtsc` returns the *simulated* cycle counter. There
  is no access to `performance.now`, the network, or host memory.
- **The analyzer teaches, it does not block.** It highlights the gadget pattern
  and explains the defences — because the gadget is the subject being studied.
- **Hard execution limits** (program size, data size, tick budget) keep runs
  bounded.

## Architecture

```
src/engine/      pure, deterministic simulator (no React)
  isa.ts         instruction table of the x86-flavoured teaching ISA
  assembler.ts   source -> program (labels, .data/.text, friendly errors)
  microcode.ts   instruction -> µops (the "microcode" layer)
  memory.ts      isolated simulated address space
  cache.ts       set-associative L1D with a speculative-fill flag
  predictor.ts   branch predictors (2-bit default, 1-bit, static)
  core.ts        out-of-order core: fetch/rename/ROB/issue/execute/commit
  reference.ts   plain in-order interpreter = architectural ground truth
  analyzer.ts    static detection + explanation of gadgets and mitigations
  trace.ts       per-tick snapshots for stepping through time
src/components/  React views (editor, pipeline, cache, predictor, timeline…)
src/pages/       Home, LabPage, Sandbox
src/labs/        lab definitions (lab01 = Spectre v1)
```

The out-of-order core is checked against `reference.ts` by a differential test:
for every sample program their final register and memory state must agree, so
speculation never changes the architectural result — only the cache side effect.

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm run build      # typecheck + production build
npm run lint       # oxlint
npx vitest run     # engine + lab tests
```

## Roadmap

Spectre v2 (BTB) and RSB labs, Meltdown (deferred privilege check), a
with/without-mitigation diff view, configurable CPU presets (ROB depth, fetch
width, cache latency), per-µop explanations, and shareable programs in the URL.
