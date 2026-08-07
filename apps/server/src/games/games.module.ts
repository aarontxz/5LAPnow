import { Module } from "@nestjs/common";
import { GamesService } from "./games.service";

import { GamesController } from "./games.controller";
import { UsersService } from "src/users/users.service";

@Module({
  providers: [GamesService, UsersService],
  controllers: [GamesController],
  exports: [GamesService],
})
export class GamesModule {}
