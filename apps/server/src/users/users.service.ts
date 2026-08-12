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

  /**
   * Links a verified Google identity to the caller's guest account. If this Google account was
   * already linked to a *different* user (e.g. signing in again from a fresh browser/guest
   * session), resolves to that existing account instead — the "log back in" path — rather than
   * erroring or creating a duplicate. Otherwise upgrades the current guest session's own User row
   * in place, so its existing table/chip history carries over.
   */
  async linkGoogleAccount(currentUserId: string, googleId: string, email: string) {
    const existing = await this.prisma.user.findUnique({ where: { googleId } });
    if (existing) return existing;
    return this.prisma.user.update({ where: { id: currentUserId }, data: { googleId, email } });
  }
}
