import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import type { CreateTableRequest } from "@5lapnow/shared-types";
import { TablesService } from "./tables.service";
import { GuestAuthGuard } from "../users/guest-auth.guard";
import { CurrentUser } from "../users/current-user.decorator";

@Controller("tables")
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @UseGuards(GuestAuthGuard)
  create(@Body() body: CreateTableRequest, @CurrentUser() user: { id: string; displayName: string | null }) {
    return this.tablesService.createTable(body, user.id, user.displayName);
  }

  @Get(":id")
  getSnapshot(@Param("id") id: string, @Query("viewerUserId") viewerUserId?: string) {
    return this.tablesService.getSnapshot(id, viewerUserId ?? null);
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
