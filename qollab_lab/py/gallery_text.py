"""Plain-language copy for the qollab scenario gallery.

Kept separate from gallery.py so the narrative can be edited without
touching any rendering code. Same scenario framing as the showcase
STORY.md (experiments/render_showcase.py), tightened for the lab.
"""

HOW_TO_READ = (
    "how to read: (1) the network map shows the tier structure -- node size is the "
    "EXACT susceptibility rank, 'Q' marks the quantum sampler's top pick. "
    "(2) the basin histograms show where each sampler actually spent its time -- "
    "a frozen classical chain piles up in one mood and misses the other basin. "
    "(3) the traces make the freeze visible: flat energy lines vs the quantum "
    "arm's jumps between basins. (4) the flip histogram is the mechanism -- "
    "classical MH can only flip one spin at a time; the Trotterised proposal "
    "flips whole regions. (5) the convergence ladder is the headline: how many "
    "steps until the bailout ranking matches the exact answer. "
    "(6) regret bars: what picking the wrong bank/street costs at each budget."
)

_STORIES = {
    "s1_conglomerate_core": (
        ("A tight cluster of banks that prop each other up. Six core banks "
         "guarantee each other's debt so tightly that the system has two stable "
         "moods: everything stands, or the whole core falls together. A short "
         "simulation that only explores one mood will confidently tell you the "
         "wrong bank to bail out."),
        ("QeMCMC ranked the targets correctly at 4,000 steps; classical MH needed "
         "12,000 -- a 3x iteration-budget gap. Both converge eventually, but under "
         "a fixed budget the wrong ranking means the wrong bailout."),
    ),
    "s2_hidden_amplifier": (
        ("A mid-tier bank quietly amplifies every shock. The dangerous bank is not "
         "the biggest one: it sits in the periphery of the network and multiplies "
         "whatever hits it. Vulnerability that only shows up under stress is "
         "exactly what a frozen sampler misses."),
        ("Both samplers converge here, but the quantum arm's chi error stays "
         "roughly 1.4x lower and its rho reaches 0.986 vs 0.916 -- the amplifier "
         "ranks correctly sooner and more sharply."),
    ),
    "s3_rival_alliances": (
        ("Two alliances whose guarantees cancel each other out. Frustrated loops "
         "of guarantees mean no arrangement pleases everyone -- the energy "
         "landscape is rugged for every method. This is the honest control: both "
         "samplers agree, and the gallery says so."),
        ("No time-to-accuracy gap: both rank correctly from the shortest prefix. "
         "Reported as a control, not a win -- the mechanism needs a two-basin "
         "landscape, and frustration destroys the double well here."),
    ),
    "s4_rush_hour": (
        ("A city grid at rush hour, one closure from gridlock. Closing the wrong "
         "street at the wrong hour doesn't just slow one block -- traffic reroutes "
         "and jams somewhere else. The worst street is only visible once you've "
         "seen both the free-flowing and the gridlocked regime."),
        ("QeMCMC ranked the widening targets correctly at 8,000 steps; classical "
         "MH needed the full 20,000 -- a 2.5x iteration-budget gap, and the only "
         "arm whose final ranking matches the exact answer exactly (rho = 1.0)."),
    ),
}


def scenario_story(name):
    hook, verdict_ = _STORIES.get(name, ("", ""))
    return f"{hook}\n\nverdict: {verdict_}"


def verdict(name):
    return _STORIES.get(name, ("", ""))[1]