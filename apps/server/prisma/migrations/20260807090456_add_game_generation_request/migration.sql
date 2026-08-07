-- CreateEnum
CREATE TYPE "GameGenerationStatus" AS ENUM ('pending', 'ready', 'rejected');

-- CreateTable
CREATE TABLE "GameGenerationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "GameGenerationStatus" NOT NULL DEFAULT 'pending',
    "gameDefinitionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameGenerationRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GameGenerationRequest" ADD CONSTRAINT "GameGenerationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameGenerationRequest" ADD CONSTRAINT "GameGenerationRequest_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
