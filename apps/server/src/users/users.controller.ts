import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { CreateGuestSessionRequest, CreateGuestSessionResponse } from "@5lapnow/shared-types";
import { UsersService } from "./users.service";
import { GUEST_COOKIE_NAME } from "./cookie";

@Controller("auth")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** No name required here — a guest can browse the lobby anonymously and only picks a name when requesting a seat. */
  @Post("guest-session")
  async createGuestSession(
    @Body() body: CreateGuestSessionRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<CreateGuestSessionResponse> {
    const displayName = body.displayName?.trim() || undefined;

    const existingUserId = req.cookies?.[GUEST_COOKIE_NAME];
    const user = await this.usersService.getOrCreateGuest(existingUserId, displayName);

    res.cookie(GUEST_COOKIE_NAME, user.id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return { userId: user.id, displayName: user.displayName };
  }

  @Get("me")
  async me(@Req() req: Request): Promise<CreateGuestSessionResponse | null> {
    const userId = req.cookies?.[GUEST_COOKIE_NAME];
    if (!userId) return null;
    const user = await this.usersService.findById(userId);
    if (!user) return null;
    return { userId: user.id, displayName: user.displayName };
  }
}
