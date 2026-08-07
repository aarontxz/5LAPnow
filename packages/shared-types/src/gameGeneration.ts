export const GAME_GENERATION_PROMPT_MIN_LENGTH = 40;
export const GAME_GENERATION_PROMPT_MIN_WORDS = 8;

export type PromptValidationResult = { ok: true } | { ok: false; message: string };

const TOO_SHORT_MESSAGE =
  "Give us more detail so we can build it accurately — how does betting work, how many cards are dealt, and how are hands ranked?";

export function validateGameGenerationPrompt(rawPrompt: string): PromptValidationResult {
  const prompt = rawPrompt.trim();
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  if (prompt.length < GAME_GENERATION_PROMPT_MIN_LENGTH || wordCount < GAME_GENERATION_PROMPT_MIN_WORDS) {
    return { ok: false, message: TOO_SHORT_MESSAGE };
  }
  return { ok: true };
}

export interface CreateGameGenerationRequestBody {
  prompt: string;
}

export type GameGenerationStatus = "pending" | "ready" | "rejected";

export interface GameGenerationRequestView {
  id: string;
  prompt: string;
  status: GameGenerationStatus;
  gameDefinitionId: string | null;
  createdAt: string;
}
