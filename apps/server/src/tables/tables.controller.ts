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

  @Get(":id/ledger")
  getLedger(@Param("id") id: string) {
    return this.tablesService.getLedger(id);
  }

  @Get(":id/game-config")
  getGameConfig(@Param("id") id: string) {
    return this.tablesService.getGameConfig(id);
  }
}
