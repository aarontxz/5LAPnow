import { Module } from "@nestjs/common";
import { TablesService } from "./tables.service";
import { TablesController } from "./tables.controller";
import { TablesGateway } from "./tables.gateway";
import { ClangService } from "../clang/clang.service";
import { GamesModule } from "../games/games.module";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [GamesModule, UsersModule],
  providers: [TablesService, TablesGateway, ClangService],
  controllers: [TablesController],
})
export class TablesModule {}
