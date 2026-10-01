<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## NEXA architecture rules
- All production UI state comes from normalized verifiable events; unavailable data remains unavailable rather than synthetic.
- Browser code consumes the central SSE/provider store and never polls BSC RPC directly, preventing duplicated RPC load.
- Trader creates intents only; policy, executor, and signer remain server-side boundaries, with execution disabled by default.
- Flap discovery uses the officially documented Portal and TokenCreated event; other protocol inputs require verified configuration.
- Hard policy limits come only from server env (clamped in policy-config.server.ts); adaptive risk is a bounded multiplier and can never raise them.
- Execution modes are computed server-side each tick from readiness checks; LIVE modes require every check to pass and the signer address to equal NEXA_WALLET_ADDRESS.
- Position ownership comes only from confirmed live receipts with verified token Transfer logs; intents and dry runs can never create positions.
- Token images use only the CID declared by verified Flap metadata; trusted IPFS gateways may fail over as transport without changing identity provenance.
- The hero uses a bounded canvas pixel-flow field spelling NEXA behind the agent; it pauses offscreen/hidden and honors reduced motion.
- The page background uses a fixed BNB-yellow ASCII particle-and-beam canvas; it lowers density on mobile, pauses when hidden, and honors reduced motion.
- Public repository branding assets live in docs/assets so README rendering does not depend on Lovable asset hosting.
