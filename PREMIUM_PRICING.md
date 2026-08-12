# Premium pricing

Purchases are currently handled manually via a Google Form (no in-app payment integration yet):
<https://forms.gle/bbYYd8v6RXEHaaaFA>

Linked from the lobby (`apps/web/app/page.tsx`'s "⭐ Get Premium" link). Access itself is granted manually — see `GameDefinitionAccess` in `apps/server/prisma/schema.prisma` and `apps/server/scripts/grant-game-access.ts`.

## What you can purchase

*(use "others" on the form if you want to buy multiple)*

### ⭐ Premium Subscription
Unlock all premium games available in the app, including special rules for regular NLH such as 7-2 Game, 4-Card PLO, Double-Board Bomb Pots, customisable UI, and more.

### 🤖 Game Request — $20/game
Create your own custom game mode with our AI. Your purchase includes 1 free month of Premium.

Once your game is generated, only you can host it. Your game will remain saved to your account even after your Premium subscription ends, and you can host it again anytime by reactivating Premium.

### 🏆 Premium Game Promotion — $20/game
Want other more players to know about your game? Pay to have your self-created game promoted to our Premium community. If approved, other Premium players can discover, host, and play your game.

We will have feature game of the month to help promote your game mode to other players.

Available only for games you already own.

### 🌎 Free Game Promotion — $79/game
Want your game to be accessible by everyone forever? Pay a one-time fee to have your game promoted as a free-to-host game permanently. If approved, both free and Premium members can discover, host, and play your game. You and any other users will be able to host the game even without a Premium subscription.

Available only for games you already own.

## Pricing tiers

| Option | Price |
| --- | --- |
| 1 month Premium subscription | $5/month |
| 6 months Premium subscription | $4.5/month ($27 total) |
| 1 year Premium subscription | $3.5/month ($42 total) |
| 1 Game Request | $20/game (comes with 1 free month of Premium once the game is created; refunded in full if the AI fails to create the game) |
| 1 Premium Game Promotion | $20/game |
| 1 Free Game Promotion | $79/game |
| Tip | Just want to tip me :D |
