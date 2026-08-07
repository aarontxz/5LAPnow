import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { GamesModule } from "./games/games.module";
import { TablesModule } from "./tables/tables.module";

@Module({
  imports: [PrismaModule, UsersModule, GamesModule, TablesModule],
})
export class AppModule {}
