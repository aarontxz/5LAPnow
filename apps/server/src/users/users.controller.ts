import { BadRequestException, Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import type { CreateGuestSessionRequest, CreateGuestSessionResponse, GoogleSignInRequest } from "@5lapnow/shared-types";
import { UsersService } from "./users.service";
import { extractBearerToken, GUEST_COOKIE_NAME } from "./cookie";
import { GuestAuthGuard, type AuthedRequest } from "./guest-auth.guard";
import { CurrentUser } from "./current-user.decorator";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

@Controller("auth")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private setGuestCookie(res: Response, userId: string): void {
    const isProd = process.env.NODE_ENV === "production";
    res.cookie(GUEST_COOKIE_NAME, userId, {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
  }

  private toSessionResponse(user: { id: string; displayName: string | null; googleId: string | null; email: string | null }): CreateGuestSessionResponse {
    return { userId: user.id, displayName: user.displayName, googleLinked: user.googleId !== null, email: user.email };
  }

  /** No name required here — a guest can browse the lobby anonymously and only picks a name when requesting a seat. */
  @Post("guest-session")
  async createGuestSession(
    @Body() body: CreateGuestSessionRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<CreateGuestSessionResponse> {
    const displayName = body.displayName?.trim() || undefined;

    const existingUserId = extractBearerToken(req.headers.authorization) ?? req.cookies?.[GUEST_COOKIE_NAME];
    const user = await this.usersService.getOrCreateGuest(existingUserId, displayName);

    // Bearer token (the client stores `userId` from the response body and
    // sends it back as `Authorization: Bearer <userId>`) is the primary auth
    // path — see cookie.ts. Still setting the cookie too costs nothing and
    // keeps same-origin/local dev working without the client needing to do
    // anything extra.
    this.setGuestCookie(res, user.id);

    return this.toSessionResponse(user);
  }

  @Get("me")
  async me(@Req() req: Request): Promise<CreateGuestSessionResponse | null> {
    const userId = extractBearerToken(req.headers.authorization) ?? req.cookies?.[GUEST_COOKIE_NAME];
    if (!userId) return null;
    const user = await this.usersService.findById(userId);
    if (!user) return null;
    return this.toSessionResponse(user);
  }

  /**
   * Verifies a Google ID token and links it to the caller's guest session (see
   * UsersService.linkGoogleAccount) — upgrades the current guest account in place, unless this
   * Google account was already linked elsewhere, in which case the response resolves to that
   * pre-existing account instead and the cookie is re-pointed at it.
   */
  @Post("google")
  @UseGuards(GuestAuthGuard)
  async signInWithGoogle(
    @Body() body: GoogleSignInRequest,
    @CurrentUser() currentUser: AuthedRequest["user"],
    @Res({ passthrough: true }) res: Response
  ): Promise<CreateGuestSessionResponse> {
    if (!process.env.GOOGLE_CLIENT_ID) throw new BadRequestException("Google sign-in is not configured");

    const ticket = await googleClient.verifyIdToken({ idToken: body.idToken, audience: process.env.GOOGLE_CLIENT_ID }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Google verifyIdToken failed:", err);
      return null;
    });
    const payload = ticket?.getPayload();
    if (!payload?.sub || !payload.email) throw new UnauthorizedException("Invalid Google sign-in token");

    const user = await this.usersService.linkGoogleAccount(currentUser.id, payload.sub, payload.email);
    this.setGuestCookie(res, user.id);

    return this.toSessionResponse(user);
  }
}
