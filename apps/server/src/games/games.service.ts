import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { GameDefinition, safeParseGameDefinition } from "@5lapnow/game-engine";
import { GameGenerationRequestView, validateGameGenerationPrompt } from "@5lapnow/shared-types";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId?: string) {
    const rows = await this.prisma.gameDefinition.findMany({
      where: userId ? { OR: [{ source: "builtin" }, { createdById: userId }] } : { source: "builtin" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      definition: row.definition as unknown as GameDefinition,
    }));
  }

  async getDefinition(id: string): Promise<GameDefinition> {
    const row = await this.prisma.gameDefinition.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Game definition ${id} not found`);
    const parsed = safeParseGameDefinition(row.definition);
    if (!parsed.success) {
      throw new Error(`Stored game definition ${id} failed schema validation: ${parsed.error.message}`);
    }
    return parsed.data;
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
