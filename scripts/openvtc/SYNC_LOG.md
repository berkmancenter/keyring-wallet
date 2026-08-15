# Upstream sync log

One entry per pin advance (written by `tools/sync-external.mjs --advance`).
Policy: digest weekly and at every phase boundary; never advance mid-phase.

- **2026-08-01** · Initial pins seeded (Cypress-RC-0 era): vta-browser-plugin `4ef360f`, verifiable-trust-infrastructure `02f10b3f`, vti-didcomm-js `2365c86`, vti-setup `9ca6511`, vta-mobile-agent-ios `035dd65`. Baseline for ref-00.

- **2026-08-15** · `dtgwg-trust-tasks-tf` fbe196a → 8eb7509 — Adoption-week boundary: #208/#212 (our thread amendment + follow-ups), #213 (the four witnessed-exchange specs), #216 (binding 0.2, dedicated @type on our ref-06v1d measurement), #214/#217 (DigestMultibase convergence), 0.4-track authorization work; ladder re-run follows. **Re-run the reference ladder bottom-up.**
- **2026-08-15** · `verifiable-trust-infrastructure` 02f10b3f → 1c20e315 — Cypress-RC-1-era advance (tag re-cut at 719fa90f, main +47 past it incl. trust-tasks 0.6/0.7 dependency alignment #979); ladder re-run follows. **Re-run the reference ladder bottom-up.**
- **2026-08-15** · `vta-browser-plugin` 4ef360f → ebebb50 — pnm-core 0.3.0 + consent/durability fixes (#104-#115); base for the noble-crypto PR rebase check. **Re-run the reference ladder bottom-up.**