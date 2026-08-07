import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  /** Reuses `existingUserId` if it still resolves to a real user, otherwise creates a fresh (possibly nameless) guest. */
  async getOrCreateGuest(existingUserId?: string, displayName?: string) {
    if (existingUserId) {
      const existing = await this.findById(existingUserId);
      if (existing) return existing;
    }
    return this.prisma.user.create({ data: { displayName } });
  }

  async setDisplayName(userId: string, displayName: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { displayName } });
  }
}
