import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthedRequest } from "./guest-auth.guard";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user;
});
