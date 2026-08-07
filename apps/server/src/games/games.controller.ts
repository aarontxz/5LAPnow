import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import type { CreateGameGenerationRequestBody } from "@5lapnow/shared-types";
import { GamesService } from "./games.service";
import { GuestAuthGuard } from "../users/guest-auth.guard";
import { CurrentUser } from "../users/current-user.decorator";

@Controller("games")
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  list(@Query("userId") userId?: string) {
    return this.gamesService.list(userId);
  }

  @Post("generate")
  @UseGuards(GuestAuthGuard)
  requestGeneration(@Body() body: CreateGameGenerationRequestBody, @CurrentUser() user: { id: string; displayName: string }) {
    return this.gamesService.requestGeneration(user.id, body.prompt);
  }

  @Get("generate-requests")
  @UseGuards(GuestAuthGuard)
  listGenerationRequests(@CurrentUser() user: { id: string; displayName: string }) {
    return this.gamesService.listGenerationRequests(user.id);
  }
}
