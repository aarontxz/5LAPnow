import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { GameEngine } from "@prisma/client";
import { GameDefinition, safeParseGameDefinition } from "@5lapnow/game-engine";

import { ClangGameDefinition, safeParseClangGameDefinition } from "@5lapnow/clang-engine";
import { CardFlipGameDefinition, safeParseCardFlipGameDefinition } from "@5lapnow/card-flip-engine";
import { GameGenerationRequestView, validateGameGenerationPrompt } from "@5lapnow/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns every builtin game (even ones the caller can't host) plus the caller's own
   * AI-generated ones, each flagged `locked` — the UI shows locked games with a paywall
   * badge rather than hiding them. `TablesService.createTable` is the actual enforcement
   * point (via `canAccessGameDefinition`); `locked` here is display-only.
   */
  async list(userId?: string) {
    const rows = await this.prisma.gameDefinition.findMany({
      where: { OR: [{ source: "builtin" }, ...(userId ? [{ createdById: userId }] : [])] },
      orderBy: { createdAt: "asc" },
    });

    const grantedIds = userId
      ? new Set(
          (await this.prisma.gameDefinitionAccess.findMany({ where: { userId }, select: { gameDefinitionId: true } })).map(
            (g) => g.gameDefinitionId
          )
        )
      : new Set<string>();

    const games = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      engine: row.engine,
      /** Poker's own GameDefinition shape when `engine` is poker; the raw ClangGameDefinition/CardFlipGameDefinition JSON otherwise. */
      definition: row.engine === "poker" ? (row.definition ? (row.definition as unknown as GameDefinition) : null) : row.definition,
      locked: row.restricted && row.createdById !== userId && !grantedIds.has(row.id),
    }));

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
  ): Promise<{ id: string; name: string; description: string; engine: GameEngine; definition: unknown; restricted: boolean; createdById: string | null }> {
    const row = await this.prisma.gameDefinition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Game definition ${id} not found`);
    return row;
  }

  /** Anyone can access an unrestricted game or one they created themselves; a restricted builtin needs a manually-granted GameDefinitionAccess row (see scripts/grant-game-access.ts). */
  async canAccessGameDefinition(userId: string, row: { id: string; restricted: boolean; createdById: string | null }): Promise<boolean> {
    if (!row.restricted || row.createdById === userId) return true;
    const grant = await this.prisma.gameDefinitionAccess.findUnique({
      where: { userId_gameDefinitionId: { userId, gameDefinitionId: row.id } },
    });
    return grant !== null;
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
