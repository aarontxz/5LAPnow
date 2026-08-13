import { Controller, Body, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { CreateTableRequest } from "@5lapnow/shared-types";
import { TablesService } from "./tables.service";
import { GuestAuthGuard, type AuthedRequest } from "../users/guest-auth.guard";
import { CurrentUser } from "../users/current-user.decorator";

@Controller("tables")
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @UseGuards(GuestAuthGuard)
  create(@Body() body: CreateTableRequest, @CurrentUser() user: AuthedRequest["user"]) {
    if (!user.googleId) throw new ForbiddenException("Sign in with Google to host a table");
    return this.tablesService.createTable(body, user.id, user.displayName);
  }

  // Viewer identity must come from the authenticated session, never a client-suppliable
  // query param — buildTableSnapshot reveals a seat's hole cards to whoever's userId
  // matches that seat, so trusting a caller-provided viewerUserId let anyone read any
  // seated player's live hand by passing in their (publicly visible) playerId.
  @Get(":id")
  @UseGuards(GuestAuthGuard)
  getSnapshot(@Param("id") id: string, @CurrentUser() user: { id: string; displayName: string | null }) {
    return this.tablesService.getSnapshot(id, user.id);
  }

  // Hand history now embeds every seat's hole cards (redacted per-viewer in
  // TablesService.getLedger — own seat plus anything actually revealed, nothing
  // else) — same "identity from the session, never a client param" rule as
  // getSnapshot above, since this is the same class of leak if gotten wrong.
  @Get(":id/ledger")
  @UseGuards(GuestAuthGuard)
  getLedger(@Param("id") id: string, @CurrentUser() user: { id: string; displayName: string | null }) {
    return this.tablesService.getLedger(id, user.id);
  }

  @Get(":id/game-config")
  getGameConfig(@Param("id") id: string) {
    return this.tablesService.getGameConfig(id);
  }

  // Same redaction as getLedger — own seat's hole cards plus whatever was actually revealed.
  @Get(":id/hands/:handNumber/replay")
  @UseGuards(GuestAuthGuard)
  getHandReplay(
    @Param("id") id: string,
    @Param("handNumber") handNumber: string,
    @CurrentUser() user: { id: string; displayName: string | null }
  ) {
    return this.tablesService.getHandReplay(id, Number(handNumber), user.id);
  }

  @Post(":id/hands/:handNumber/replay/reveal-rabbit")
  @UseGuards(GuestAuthGuard)
  replayRevealRabbit(@Param("id") id: string, @Param("handNumber") handNumber: string) {
    return this.tablesService.replayRevealRabbit(id, Number(handNumber));
  }

  // No redaction needed — Clang has no folding/mucking concept, every seat's hand is
  // already fully public once a round completes (confirmed: settleShowdown/settleInstantWin
  // always reveal every player, and a round that never completes never gets a DB row at all).
  @Get(":id/clang-rounds/:roundNumber/replay")
  @UseGuards(GuestAuthGuard)
  getClangRoundReplay(@Param("id") id: string, @Param("roundNumber") roundNumber: string) {
    return this.tablesService.getClangRoundReplay(id, Number(roundNumber));
  }

  // Same reasoning as Clang — Card Flip hands are public even live.
  @Get(":id/cardflip-rounds/:roundNumber/replay")
  @UseGuards(GuestAuthGuard)
  getCardFlipRoundReplay(@Param("id") id: string, @Param("roundNumber") roundNumber: string) {
    return this.tablesService.getCardFlipRoundReplay(id, Number(roundNumber));
  }
}
