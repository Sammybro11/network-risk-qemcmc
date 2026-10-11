# QeMCMC showcase: bailout decisions under a fixed iteration budget

Each scenario is a named real-world situation where the network sits near a tipping point and a budget-K bailout must be chosen from the susceptibility ranking. Both samplers get the *same* iteration budget; the question is who ranks the bailout targets correctly *first*.

![summary](summary_time_to_accuracy.png)

| scenario | QeMCMC correct from | classical MH correct from |
|---|---|---|
| Tight Conglomerate Core | 4,000 | 12,000 |
| Fragile Periphery, Hidden Amplifier | 12,000 | 16,000 |
| Rival Alliances | 2,000 | 2,000 |
| Rush-Hour Gridlock | 8,000 | 20,000 |

## Tight Conglomerate Core (`s1_conglomerate_core`)

**A tight cluster of banks that prop each other up**  Six core banks guarantee each other's debt so tightly that the system has two stable moods: everything stands, or the whole core falls together. A short simulation that only explores one mood will confidently tell you the wrong bank to bail out.

Setup: finance problem, n=12, 20,000 steps x 4 chains per arm.

### Time to correct ranking

| arm | first correct prefix | full-length relerr | full-length rho |
|---|---|---|---|
| QeMCMC | 4,000 | 0.008 | +0.958 |
| Classical MH | 12,000 | 0.018 | +0.972 |

**QeMCMC ranked the bailout targets correctly at 4,000 steps; classical Metropolis needed 12,000.** That is a 3.0x iteration-budget gap.

### Cost, reported fairly

- Classical MH: 0.0094 ms/step, ESS/step 0.030, acceptance 0.07
- QeMCMC: 52.7 ms/step (simulator), ESS/step 0.010, acceptance 0.21

### Caveats

- Convergence curves are prefix-truncated versions of the SAME chains (within-run convergence), not independent restarts -- each point uses fewer samples, and burn-in re-truncation is not modelled.
- Wall-clock cost differs strongly between arms (ms/step and ESS/step are reported per scenario below); the headline is steps-to-correct-ranking, the sampler's iteration budget, not wall-clock seconds.
- The quantum arm runs on an unseeded simulator, so its numbers vary run-to-run; the ranking gap reported here is far larger than that run-to-run spread in the scenarios where it appears.
- Prefix-truncated chains: within-run convergence, not independent-restart convergence.

## Fragile Periphery, Hidden Amplifier (`s2_hidden_amplifier`)

**A mid-tier bank quietly amplifies every shock**  The dangerous bank is not the biggest one: it sits in the middle of the network and multiplies whatever hits it. Vulnerability that only shows up under stress is exactly what a frozen sampler misses.

Setup: finance problem, n=12, 20,000 steps x 4 chains per arm.

### Time to correct ranking

| arm | first correct prefix | full-length relerr | full-length rho |
|---|---|---|---|
| QeMCMC | 12,000 | 0.055 | +0.986 |
| Classical MH | 16,000 | 0.075 | +0.916 |

**QeMCMC ranked the bailout targets correctly at 12,000 steps; classical Metropolis needed 16,000.** That is a 1.3x iteration-budget gap.

Both samplers chose the **same bailout sets at every budget** -- here the quantum advantage is in how *fast* the ranking became trustworthy, not in a different final decision.

### Cost, reported fairly

- Classical MH: 0.0102 ms/step, ESS/step 0.038, acceptance 0.03
- QeMCMC: 66.2 ms/step (simulator), ESS/step 0.014, acceptance 0.29

### Caveats

- Convergence curves are prefix-truncated versions of the SAME chains (within-run convergence), not independent restarts -- each point uses fewer samples, and burn-in re-truncation is not modelled.
- Wall-clock cost differs strongly between arms (ms/step and ESS/step are reported per scenario below); the headline is steps-to-correct-ranking, the sampler's iteration budget, not wall-clock seconds.
- The quantum arm runs on an unseeded simulator, so its numbers vary run-to-run; the ranking gap reported here is far larger than that run-to-run spread in the scenarios where it appears.
- Prefix-truncated chains: within-run convergence, not independent-restart convergence.

## Rival Alliances (`s3_rival_alliances`)

**Two alliances whose guarantees cancel each other out**  Frustrated loops of guarantees mean no arrangement pleases everyone -- the energy landscape is rugged for every method. This is our honest control: here both samplers agree, and we say so.

Setup: finance problem, n=12, frustration=0.50, 20,000 steps x 4 chains per arm.

### Time to correct ranking

| arm | first correct prefix | full-length relerr | full-length rho |
|---|---|---|---|
| QeMCMC | 2,000 | 0.020 | +1.000 |
| Classical MH | 2,000 | 0.039 | +1.000 |

**No time-to-accuracy gap here** -- both samplers rank correctly from the shortest prefix. We report this scenario as a control, not a win.

Both samplers chose the **same bailout sets at every budget** -- here the quantum advantage is in how *fast* the ranking became trustworthy, not in a different final decision.

### Cost, reported fairly

- Classical MH: 0.0095 ms/step, ESS/step 0.022, acceptance 0.26
- QeMCMC: 58.6 ms/step (simulator), ESS/step 0.014, acceptance 0.31

### Caveats

- Convergence curves are prefix-truncated versions of the SAME chains (within-run convergence), not independent restarts -- each point uses fewer samples, and burn-in re-truncation is not modelled.
- Wall-clock cost differs strongly between arms (ms/step and ESS/step are reported per scenario below); the headline is steps-to-correct-ranking, the sampler's iteration budget, not wall-clock seconds.
- The quantum arm runs on an unseeded simulator, so its numbers vary run-to-run; the ranking gap reported here is far larger than that run-to-run spread in the scenarios where it appears.
- Prefix-truncated chains: within-run convergence, not independent-restart convergence.

## Rush-Hour Gridlock (`s4_rush_hour`)

**A city grid at rush hour, one closure from gridlock**  Closing the wrong street at the wrong hour doesn't just slow one block -- traffic reroutes and jams somewhere else. The worst street is only visible once you've seen both the free-flowing and the gridlocked regime.

Setup: traffic problem, n=3, 20,000 steps x 4 chains per arm.

### Time to correct ranking

| arm | first correct prefix | full-length relerr | full-length rho |
|---|---|---|---|
| QeMCMC | 8,000 | 0.048 | +1.000 |
| Classical MH | 20,000 | 0.067 | +0.967 |

**QeMCMC ranked the bailout targets correctly at 8,000 steps; classical Metropolis needed 20,000.** That is a 2.5x iteration-budget gap.

Both samplers chose the **same bailout sets at every budget** -- here the quantum advantage is in how *fast* the ranking became trustworthy, not in a different final decision.

### Cost, reported fairly

- Classical MH: 0.0102 ms/step, ESS/step 0.009, acceptance 0.07
- QeMCMC: 16.2 ms/step (simulator), ESS/step 0.010, acceptance 0.39

### Caveats

- Convergence curves are prefix-truncated versions of the SAME chains (within-run convergence), not independent restarts -- each point uses fewer samples, and burn-in re-truncation is not modelled.
- Wall-clock cost differs strongly between arms (ms/step and ESS/step are reported per scenario below); the headline is steps-to-correct-ranking, the sampler's iteration budget, not wall-clock seconds.
- The quantum arm runs on an unseeded simulator, so its numbers vary run-to-run; the ranking gap reported here is far larger than that run-to-run spread in the scenarios where it appears.
- Prefix-truncated chains: within-run convergence, not independent-restart convergence.
