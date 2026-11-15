# Network module 01 — local delivery

Open `#/network` in the existing app. The CPU labs remain available.

This is a deterministic teaching model, not a host-network integration.

## Boundaries

- `engine.ts`: Ethernet frames, ARP resolution, ICMP Echo, switch learning and
  forwarding, and isolated snapshots. No React, DOM, real timers or sockets.
- `NetworkScene.tsx`: replaceable SVG 2D renderer of a snapshot. It does not
  determine protocol behaviour. Another renderer can consume the same state.
- `../pages/NetworkLab.tsx`: scenario selection, playback cursor, device
  inspection, event explanations and history. Playback speed is presentation
  time; one step is an event, not a simulated millisecond.

`simulatePing(network)` clones its input and returns an ordered trace. Each
snapshot owns its state. The UI can rewind without recomputing or mutating later
states. Subsequent pings start from the currently displayed state and retain
ARP/MAC entries. Changing a scenario or resetting clears all learned state.

## Experiments

1. Cold ping: ARP broadcast, unicast reply, ICMP request/reply, MAC learning.
2. Warm ping: learned ARP entries remove the resolution exchange.
3. Disconnected B: forwarding stops at the disconnected port.
4. B in another /24: A has no default route, so it emits no Ethernet frame.

Inspect both host ARP tables and the switch MAC table at any history step.

## Deliberate limits

Exactly two hosts and one learning switch; fixed IPv4 /24 connected routes;
no gateway, NAT, VLANs, TTL processing, FCS, ARP expiry, packet loss, retries,
background traffic or measured RTT. One attempt ends when the event queue is
empty. ARP is carried directly by Ethernet; ICMP is carried by IPv4 inside
Ethernet. Explanations expose these boundaries in the interface.

The next module can introduce a router and route selection, followed by NAT.
Do not invent hidden router behaviour in this module to make remote IPs work.

## Checks

`npx vitest run src/network/__tests__/engine.test.ts`
