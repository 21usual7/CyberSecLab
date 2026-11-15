# Network Labs — a live, inspectable networking model

Open `#/network` using the **Сети** button. CPU labs remain available.
All experiments run in isolated JavaScript data structures, with no host-network
access, timers for latency measurements, or executable user code.

## Modules and original practical exercises

| Module | Modelled mechanisms | Experiments |
| --- | --- | --- |
| Ethernet | learning switch, flooding, ARP, ICMP Echo | user payload round trip; wrong MAC; disconnected cable |
| Routing | connected/default routes, longest-prefix match, next hop, TTL | changing Ethernet envelope; TTL 1 / Time Exceeded; absent gateway |
| NAT | outbound source translation and reverse mapping | inspect server-visible source; failure of the return route without NAT |
| TCP | SYN/ACK/RST, listener/connection state, data ACK, small HTTP service | open SYN probe; closed port; firewall DROP; full handshake + HTTP |
| DNS | UDP query/reply, A record, NXDOMAIN, client cache | first lookup; cache hit without frames; negative answer versus unavailable service |

These are original exercises aligned with the networking topics in HTB
[Information Security Foundations](https://academy.hackthebox.com/path/preview/information-security-foundations)
and [Penetration Tester](https://academy.hackthebox.com/path/preview/penetration-tester).
They supplement those paths; they do not reproduce HTB lessons, targets, flags,
or claim complete coverage of either path. Relevant course references:
[Introduction to Networking](https://academy.hackthebox.com/course/preview/introduction-to-networking)
and [Network Enumeration with Nmap](https://academy.hackthebox.com/course/preview/network-enumeration-with-nmap).

## Architecture

- `types.ts`: world, devices, interfaces, routes, frames, packets and event contract.
- `topology.ts`: module-specific worlds and longest-prefix route selection.
- `engine.ts`: pure `simulate(world, draft) -> Snapshot[]`. Every snapshot owns
  its state. Ethernet follows links and switch forwarding tables; ARP resolves
  the chosen next hop; IP delivery rebuilds frames at the router; responses
  independently select a return route. User fields affect the actual model.
- `usePlayback.ts`: one continuous requestAnimationFrame playhead. Pause freezes
  both packet motion and state progression. Seeking can stop within a link.
  Reduced-motion users see packets at their destination without travelling.
- `NetworkScene.tsx`: replaceable SVG renderer; it makes no protocol decisions.
- `PacketBuilder.tsx`: editable protocol, target, TTL, ports, flags, payload,
  manual first-hop MAC, DNS name and client behaviour. Network-condition changes
  create a fresh world; packet edits retain learned state.
- `Inspectors.tsx`: Ethernet/IP/transport/data inspection and device tables.
- `labs.ts`: 15 experiments and evidence-based observation checks.
- `../pages/NetworkLab.tsx`: playback, branching history, module/mission selection,
  exchange comparison, and optional localStorage observation progress. The default
  view shows one experiment, the scene, and the current explanation. Module
  navigation is opened on demand; crafting, packet inspection, device state and
  history share a single optional tool panel. Clicking a device opens its state
  and pauses playback. Closing the panel restores focus to its toolbar button.

Only events reached by the playhead contribute to observation checks. Checking
an observation is not a claim of learner mastery. Cached state survives repeated
sends; rewind restores historical tables. New sends retain at most 500 prior
events. Each simulation is capped at 240 events and eight IP forwarding steps.

## Deliberate limits

The worlds have two hosts, a learning switch, and at most one router. IPv4 is
used; link prefixes are /24, while route selection accepts arbitrary prefixes.
There is no VLAN, ARP/FDB expiry, FCS/checksum validation, fragmentation, ICMP
retransmission, route discovery or dynamic routing. Unknown neighbours produce
one ARP attempt. Failed attempts end when deterministic delivery finishes;
presentation time is not RTT and does not reproduce physical network timing.

NAT uses one stateful mapping per outbound tuple. For ICMP the transport-number
field represents the Echo Identifier, not a real port. No mapping expiry or
inbound port forwarding is implemented. The external network is the reserved
203.0.113.0/24 documentation range, not the internet.

TCP has listeners at 22 and 80, controllable DROP at port 80, and illustrative
SYN/ACK/RST and connection states. There is no retransmission, teardown timer,
window/congestion control, stream segmentation or TLS. Exchanges are teaching
transactions, not a full TCP stack; repeated probes reuse/replace tuple state.
HTTP is one synthetic GET / service (200 or 400), not a general HTTP parser.
DNS serves A for lab.test, with NXDOMAIN for other names; no recursive lookup,
negative caching, DNSSEC, TCP fallback, or cache expiry is implemented.

## Verification

```bash
npx vitest run                 # CPU and networking regression tests
npm run lint
npm run build
npm run dev -- --host 127.0.0.1
# Optional; requires Chromium on PATH:
node scripts/check-network-browser.mjs
```

Browser checks cover the focused initial layout, single-panel navigation,
device inspection and focus restoration, real packet motion, pause/resume,
custom payload, rewind,
cache reuse, all 15 missions, NAT table inspection, validation, narrow-screen
layout, persisted observation progress, and runtime exceptions. Screenshots are
written to the system temporary directory. An optional URL argument can point
the same check at a deployed build.
