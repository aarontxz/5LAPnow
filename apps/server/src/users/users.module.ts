import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { GuestAuthGuard } from "./guest-auth.guard";

@Module({
  providers: [UsersService, GuestAuthGuard],
  controllers: [UsersController],
  exports: [UsersService, GuestAuthGuard],
})
export class UsersModule {}
