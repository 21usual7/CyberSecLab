// lab01 — Spectre v1 (bounds check bypass), as a guided experiment on the
// simulated CPU. Everything here runs on the invented teaching core; the code
// is illustrative of the CONCEPT and its defences, not a recipe against any
// real system (the simulator has no real timers, cache or memory to attack).

export interface LabStep {
  title: string
  body: string // markdown-ish plain text
  goal?: string // what the user should observe
}

export interface Lab {
  id: string
  title: string
  summary: string
  theory: string
  steps: LabStep[]
  starter: string
}

// Shared memory layout used by the sample programs:
//   arr    : 8-byte array, the "in bounds" region (offset 0..7)
//   secret : one byte just past the array (offset 8) — out of bounds
//   probe  : 64-byte-aligned buffer; a load of probe[v*64] caches a line
//            whose index reveals v to a later timing measurement
//   bound  : the array length (8), kept in memory so the check can be made slow
const LAYOUT = `.data
arr:    db 0,1,2,3,4,5,6,7     ; the array; valid indices are 0..7
secret: db 42                  ; one byte PAST the array (out of bounds)
pad:    times 55 db 0          ; pad so 'probe' starts on a cache-line boundary
probe:  times 8192 db 0        ; timing-probe buffer (128 lines of 64 bytes)
bound:  dq 8                   ; the array length, kept in memory
`

// The vulnerable gadget. The bounds-check branch is slow to resolve (its
// operand is flushed), so the two loads run speculatively and the second one
// leaves probe[secret*64] in the cache even after the branch squashes them.
export const VULNERABLE = `${LAYOUT}.text
        ; --- setup ---
        mov rax, [arr]            ; cache the array line (fast load for the gadget)
        clflush [bound]           ; make the bounds check SLOW to resolve
        clflush [probe + 2688]    ; 42*64: make the target probe line start absent
        lfence                    ; finish setup before the gadget runs

        ; --- victim gadget, called with an out-of-bounds index ---
        mov rsi, 8                ; i = 8  (one past the end: out of bounds)
        mov rcx, [bound]          ; slow load -> long speculation window
        cmp rsi, rcx              ; i < bound ?
        jae done                  ; architecturally TAKEN (skip); predicted not-taken
        mov rax, [arr + rsi]      ; speculative: reads 'secret' (42)
        mov rbx, [probe + rax*64] ; speculative: caches probe line 42
done:
        hlt
`

// The line we insert a mitigation in front of (unique in the program).
const GADGET_LOAD = `        mov rax, [arr + rsi]      ; speculative: reads 'secret' (42)`

// Mitigated with a serialising fence after the branch: the loads cannot run
// until the branch has resolved, so no attacker-chosen line is left behind.
export const MITIGATED_FENCE = VULNERABLE.replace(
  GADGET_LOAD,
  `        lfence                    ; barrier: stop speculation here\n${GADGET_LOAD}`,
)

// Mitigated by masking the index so even a speculative load stays in bounds.
export const MITIGATED_MASK = VULNERABLE.replace(
  GADGET_LOAD,
  `        and rsi, 7                ; mask index into 0..7 (in bounds)\n${GADGET_LOAD}`,
)

export const lab01: Lab = {
  id: 'lab01',
  title: 'Spectre v1 — bounds check bypass',
  summary:
    'Watch a bounds-checked load run speculatively past a mispredicted branch and leave a measurable trace in the cache — then close the gap.',
  theory: `A conditional branch guards an array access: "if (i < length) use arr[i]". The
branch predictor guesses the branch direction before the length is known. If the
length value is slow to arrive (not in cache), the core keeps going on the
predicted path and performs the load with an out-of-range index. When the branch
finally resolves and the guess was wrong, those instructions are squashed — their
register results are thrown away, but a cache line they fetched stays resident.
A second, dependent load turns the secret value into a cache-set index, and a
later timing measurement reads it back. The fix is to stop speculation at the
check (a serialising fence) or to make the index safe even when speculated
(masking), so no secret-dependent line can be installed.`,
  steps: [
    {
      title: '1. Run it and find the misprediction',
      body: 'Press Run. Watch the ROB: the bounds-check branch stays unresolved while the slow `mov rcx, [bound]` load is in flight, and the two loads below it execute speculatively.',
      goal: 'The timeline marks a misprediction on the `jae` branch and shows the two loads as squashed (red).',
    },
    {
      title: '2. See the leftover cache line',
      body: 'Open the Cache view. Even though the loads were squashed, the line for `probe + 42*64` (set 43) is present and marked as a speculative fill.',
      goal: 'Set 43 holds a valid, speculatively-filled line after the run.',
    },
    {
      title: '3. Read it back with timing',
      body: 'A `rdtsc`-bracketed load of each probe line would be fast only for line 43 — that is how the secret value (42) is recovered. Here rdtsc reads the simulated cycle counter, so you see the hit/miss gap directly.',
      goal: 'Understand how a cache set index maps back to the secret byte.',
    },
    {
      title: '4. Mitigate with lfence',
      body: 'Add `lfence` right after `jae done`. Re-run: the loads now wait for the branch to resolve, get squashed before executing, and leave no line behind.',
      goal: 'Set 43 stays empty; the analyzer marks the gadget as mitigated.',
    },
    {
      title: '5. Mitigate by masking',
      body: 'Alternatively replace the fence with `and rsi, 7`. The index can never leave the array, even speculatively, so the secret is never loaded.',
      goal: 'The dependent load only ever touches in-bounds lines.',
    },
  ],
  starter: VULNERABLE,
}
