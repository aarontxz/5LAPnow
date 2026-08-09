import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "./users.service";
import { extractBearerToken, GUEST_COOKIE_NAME } from "./cookie";

export interface AuthedRequest extends Request {
  user: { id: string; displayName: string | null };
}

@Injectable()
export class GuestAuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const userId = extractBearerToken(req.headers.authorization) ?? req.cookies?.[GUEST_COOKIE_NAME];
    if (!userId) throw new UnauthorizedException("No guest session; call POST /auth/guest-session first");
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException("Guest session is no longer valid");
    (req as AuthedRequest).user = { id: user.id, displayName: user.displayName };
    return true;
  }
}
