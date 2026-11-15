# Network Labs — a live, inspectable networking model

Open `#/network` using the **Сети** button. CPU labs remain available.
All experiments run in isolated JavaScript data structures, with no host-network
access, timers for latency measurements, or executable user code.

## Modules and original practical exercises

| Module | Modelled mechanisms | Experiments |
| --- | --- | --- |
| Ethernet | learning switch, flooding, ARP, ICMP Echo | user payload round trip; wrong MAC; disconnected cable |
| Subnetting | editable client prefix, binary network boundary | /24 direct delivery; /25 changes route selection |
| Routing | connected/default routes, longest-prefix match, next hop, TTL | changing Ethernet envelope; TTL 1 / Time Exceeded; absent gateway |
| NAT | outbound source translation and reverse mapping | inspect server-visible source; failure of the return route without NAT |
| TCP | SYN/ACK/RST, listener/connection state, data ACK, small HTTP service | open SYN probe; closed port; firewall DROP; full handshake + HTTP |
| DNS | UDP query/reply, A record, NXDOMAIN, client cache | first lookup; cache hit without frames; negative answer versus unavailable service |
| Diagnosis | one unknown route, cable or filter fault | test a hypothesis, repair one condition, prove TCP/80 works |
| Final workshop | interface IP/mask/up state, static routes, ordered ingress ACL | configure the gateway in a Cisco-style CLI, prove two allowed and three denied flows |

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
- `labs.ts`: 19 experiments and evidence-based observation checks.
- `learning.ts` / `LearningPanels.tsx`: trace-derived predictions, semantic
  comparison of two attempts, binary subnet boundaries and device processing.
  Prediction feedback is gated by the evidence event reached by the playhead.
  Comparison is shown only after the current attempt completes.
- `workshop.ts` / `WorkshopPanels.tsx`: bounded CLI parser and independent
  policy probes; no shell execution or real device integration.
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
used; the client prefix is editable in subnet experiments, and router interface
prefixes are configurable in the final workshop. Route selection uses
longest-prefix matching.
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
cache reuse, all 19 missions, forecasts, attempt comparison, diagnosis/repair, CLI configuration
and five policy probes, NAT table inspection, validation, narrow-screen
layout, persisted observation progress, and runtime exceptions. Screenshots are
written to the system temporary directory. An optional URL argument can point
the same check at a deployed build.

## Final workshop contract

The final module is a teaching subset of Cisco-style IOS CLI, not Cisco IOS or
Packet Tracer. Reference syntax:
[Cisco interface configuration](https://www.cisco.com/c/en/us/td/docs/routers/ios-xe/ip-addressing/ip-addressing/m_config-ipv4-addr-0.html)
and [Cisco ACL configuration](https://www.cisco.com/c/en/us/support/docs/security/ios-firewall/23602-confaccesslists.html).

Start with an incorrect, administratively down LAN interface. Configure
GigabitEthernet0/0 (`lan0`) and GigabitEthernet0/1 (`wan0`), IPv4 masks, connected
and static routes. Supported commands and modes are listed by `?`. `ping` and
`probe tcp` intentionally originate from client A, not the router; the console
labels that behaviour. Config changes clear learned tables and active audit
results; they remain in the current module session until reset or navigation.

Extended numbered ACLs (100–199) support ip/tcp/udp/icmp, any/host/wildcard address
matches, and destination `eq` ports for TCP/UDP. They apply only when attached
with `ip access-group <id> in`. Rules are evaluated in order, first match wins,
unmatched traffic is implicitly denied. ACL hits are part of trace state.
Outbound ACLs, VTY access, VLANs, routing protocols, real IOS abbreviations and
configuration persistence across reloads are outside the current subset.

The verifier independently probes a cold copy of the configured world:

- client 192.168.1.10 must get ICMP Echo Reply;
- that client must complete TCP and receive HTTP 200 on port 80;
- its TCP/22 and UDP/53 requests must be stopped by the router ACL;
- a different client at .30 must be stopped when requesting HTTP/80.

Negative checks require an ACL deny of the *outgoing request*, before the server
receives it. A broken link, missing route, unavailable service, or a blocked
return packet does not count as satisfying a deny policy. Every probe has a
replayable trace. Passing proves these five properties in this model only.

The diagnosis module chooses one of three faults in the UI; simulation remains
deterministic for a given world and draft. Network-condition controls are hidden
there. Observation completion requires a repair and a fresh successful TCP/80
handshake; merely observing a different working protocol does not complete it.
