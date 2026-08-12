import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { GameEngine, GameVisibility } from "@prisma/client";
import { GameDefinition, safeParseGameDefinition } from "@5lapnow/game-engine";

import { ClangGameDefinition, safeParseClangGameDefinition } from "@5lapnow/clang-engine";
import { CardFlipGameDefinition, safeParseCardFlipGameDefinition } from "@5lapnow/card-flip-engine";
import { GameGenerationRequestView, validateGameGenerationPrompt } from "@5lapnow/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns every PUBLIC/PREMIUM_HOST game plus the caller's own (PRIVATE included) and any
   * PRIVATE game they've been explicitly granted, each flagged `locked` — the UI shows locked
   * games with a paywall badge rather than hiding them. Other accounts' PRIVATE games never
   * appear at all. `TablesService.createTable` is the actual hosting-enforcement point (via
   * `canAccessGameDefinition`); `locked` here is display-only.
   */
  async list(userId?: string) {
    const rows = await this.prisma.gameDefinition.findMany({
      where: {
        OR: [
          { visibility: { in: ["PUBLIC", "PREMIUM_HOST"] } },
          ...(userId ? [{ createdById: userId }, { access: { some: { userId } } }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    const [grantedIds, premium] = await Promise.all([
      userId
        ? this.prisma.gameDefinitionAccess
            .findMany({ where: { userId }, select: { gameDefinitionId: true } })
            .then((rows) => new Set(rows.map((g) => g.gameDefinitionId)))
        : Promise.resolve(new Set<string>()),
      userId ? this.isPremium(userId) : Promise.resolve(false),
    ]);

    const games = rows.map((row) => {
      const isOwner = row.createdById === userId;
      const hasGrant = grantedIds.has(row.id);
      const locked =
        row.visibility === "PUBLIC"
          ? false
          : isOwner
            ? !premium
            : hasGrant
              ? false
              : row.visibility === "PREMIUM_HOST"
                ? !premium
                : true; // PRIVATE, not owner, no grant

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        source: row.source,
        engine: row.engine,
        /** Poker's own GameDefinition shape when `engine` is poker; the raw ClangGameDefinition/CardFlipGameDefinition JSON otherwise. */
        definition: row.engine === "poker" ? (row.definition ? (row.definition as unknown as GameDefinition) : null) : row.definition,
        locked,
      };
    });

    // Unlocked (accessible) games first, locked ones after — each group keeps its createdAt order.
    return games.sort((a, b) => Number(a.locked) - Number(b.locked));
  }

  /** Poker-only: parses and validates the DeclarativeEngine-shaped definition JSON. Throws for non-poker rows. */
  async getDefinition(id: string): Promise<GameDefinition> {
    const row = await this.getRow(id);
    if (row.engine !== "poker") throw new BadRequestException(`Game definition ${id} is not a poker game`);
    const parsed = safeParseGameDefinition(row.definition);
    if (!parsed.success) {
      throw new Error(`Stored game definition ${id} failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Clang-only: parses and validates the ClangEngine-shaped definition JSON (stake, eat payment). Throws for non-Clang rows. */
  async getClangDefinition(id: string): Promise<ClangGameDefinition> {
    const row = await this.getRow(id);
    if (row.engine !== "clang") throw new BadRequestException(`Game definition ${id} is not a Clang game`);
    const parsed = safeParseClangGameDefinition(row.definition);
    if (!parsed.success) {
      throw new Error(`Stored game definition ${id} failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Card Flip-only: parses and validates the CardFlipEngine-shaped definition JSON (stake, cards per player, bonuses). Throws for non-Card-Flip rows. */
  async getCardFlipDefinition(id: string): Promise<CardFlipGameDefinition> {
    const row = await this.getRow(id);
    if (row.engine !== "cardflip") throw new BadRequestException(`Game definition ${id} is not a 10 Card Flip game`);
    const parsed = safeParseCardFlipGameDefinition(row.definition);
    if (!parsed.success) {
      throw new Error(`Stored game definition ${id} failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async getRow(
    id: string
  ): Promise<{
    id: string;
    name: string;
    description: string;
    engine: GameEngine;
    definition: unknown;
    visibility: GameVisibility;
    createdById: string | null;
  }> {
    const row = await this.prisma.gameDefinition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Game definition ${id} not found`);
    return row;
  }

  /**
   * PUBLIC games are hostable by anyone. PRIVATE/PREMIUM_HOST games are hostable by their
   * creator only while Premium is active (User.premiumUntil in the future), by anyone with a
   * manually-granted GameDefinitionAccess row (see scripts/grant-game-access.ts) regardless of
   * Premium, or — PREMIUM_HOST only — by any other currently-Premium account.
   */
  async canAccessGameDefinition(
    userId: string,
    row: { id: string; visibility: GameVisibility; createdById: string | null }
  ): Promise<boolean> {
    if (row.visibility === "PUBLIC") return true;
    if (row.createdById === userId) return this.isPremium(userId);
    const grant = await this.prisma.gameDefinitionAccess.findUnique({
      where: { userId_gameDefinitionId: { userId, gameDefinitionId: row.id } },
    });
    if (grant) return true;
    return row.visibility === "PREMIUM_HOST" && (await this.isPremium(userId));
  }

  /** True while User.premiumUntil is set and in the future — see PREMIUM_PRICING.md / scripts/grant-premium.ts. */
  async isPremium(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { premiumUntil: true } });
    return !!user?.premiumUntil && user.premiumUntil > new Date();
  }

  async requestGeneration(userId: string, prompt: string): Promise<GameGenerationRequestView> {
    const validation = validateGameGenerationPrompt(prompt);
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }
    const row = await this.prisma.gameGenerationRequest.create({
      data: { userId, prompt: prompt.trim() },
    });
    return this.toGenerationRequestView(row);
  }

  async listGenerationRequests(userId: string): Promise<GameGenerationRequestView[]> {
    const rows = await this.prisma.gameGenerationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toGenerationRequestView(row));
  }

  private toGenerationRequestView(row: {
    id: string;
    prompt: string;
    status: string;
    gameDefinitionId: string | null;
    createdAt: Date;
  }): GameGenerationRequestView {
    return {
      id: row.id,
      prompt: row.prompt,
      status: row.status as GameGenerationRequestView["status"],
      gameDefinitionId: row.gameDefinitionId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
