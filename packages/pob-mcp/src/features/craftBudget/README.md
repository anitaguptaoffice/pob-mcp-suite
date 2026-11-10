# Craft budget model

This module only evaluates repeated independent attempts using caller-supplied, externally verified probabilities and costs. It is not a crafting simulator and has no dependencies on pricing, trade, PoB, or an external simulator. Each tool result states its assumptions and preserves the supplied probability source.

## Simulator evaluation

The separate [poe-cli](https://github.com/srhinos/poe-cli/tree/524a5384e9ae8db94d94147462232972386bc96a) project was evaluated as a possible simulator. It is GPL-3.0 and was not copied or bundled. In `poe/services/repoe/sim.py`, `hit_rate` is the fraction of runs succeeding within `max_attempts`, while `avg_attempts` averages successful runs only. Treating that conditional average as an unconditional expected crafting cost ignores unsuccessful runs. Its comment also describes a different rare-mod count distribution from the weights in the same source. Its data revision and game-version compatibility need verification.

For example, running 300 one-attempt trials against an item returned a success rate near one third and `avg_attempts: 1`; this does not mean an independent repeat-until-success craft costs one attempt on average. Randomness affects the measured rate. Do not wire these results directly into user-facing budgets. A future adapter should pin game/data versions, isolate the external license boundary, validate its mechanics and distributions against independent PoE 1 references, account for failed runs and confidence intervals, and compare results against controlled fixtures before advertising game-derived probabilities.
