# Clang, Explained

Clang is a fast card game for 2–5 players. It's not poker — there's no board, no folding, no pot. It's closer to a race: keep the point value of your hand as *low* as possible, and either be the one to call it or be the one who runs out of cards first.

## The basics

- Standard 52-card deck (a second deck gets shuffled in once there are more than 5 players).
- Every card has a point value: **Ace = 1, 2–10 = face value, J/Q/K = 10**.
- Everyone agrees on two numbers before playing: a **stake** (what the winner gets paid) and an **eat price** (what it costs to "Eat" — see below).
- Each player is dealt **5 cards**. Low total is good.

## Your turn: two choices

**1. Play.** Draw one card from the pile first (so you're choosing with 6 cards in hand, not 5), then discard every card of *one rank* (e.g. all your 7s). Turn passes to the next player.

**2. Call Clang.** Instead of playing, shout "Clang!" — everyone reveals their hand right there. Whoever has the lowest total wins the stake from everyone else. If you called it and you *weren't* the lowest, you pay everyone else instead (and pay more, since you're paying the whole table). It's a bet on your own hand — call it when you're confident, not just when you're low.

## Eating

Right after someone plays (discards a rank), the *next player only* gets one shot to "Eat" it, if they happen to hold a card of that same rank:

- They discard all their matching cards too, for free — shrinking their hand without drawing a card
- The original player pays them the eat price for every card eaten.
- The eater skips their own turn entirely; play moves on to the player after them. 
- Eat can be chained, if i eat a card the person after me can eat also and the original thrower need to give both of us

Eating is a way to piggyback on someone else's discard: you get rid of cards (a good thing — low hand, or a shot at emptying out) *and* you get paid for it, all without spending a turn.

## The instant win: 21

If your opening 5 cards add up to exactly **21**, you can shout "Clang!" immediately, before anyone even takes a turn. This wins outright — no comparing hands, everyone just pays you the stake. Anyone else dealt exactly 21 gets the same window, and it stays open for each player individually until *they've* taken their first action.

## How a round ends

A round ends one of four ways:
1. **Instant Clang** — someone opens with exactly 21 and calls it.
2. **Called Clang** — someone calls it mid-round; lowest hand wins.
3. **Empty hand** — a Play or an Eat empties someone's hand completely; they win on the spot, no comparison needed.
4. **Deck runs out** — if the draw pile empties mid-turn, that turn finishes normally and then it's an automatic showdown, lowest hand wins.

Whoever's "away" (stepped out) still gets played through automatically — they'll draw and discard their highest-value card each turn, or get an outstanding 21 called for them, so the table never stalls waiting on an AFK player.

## Optional side bets: bounties

A table can optionally configure a bonus payout for strong starting hands (e.g. "anyone dealt a Straight Flush gets paid extra by everyone else"). These pay out immediately at the deal and don't affect who wins the round itself.
