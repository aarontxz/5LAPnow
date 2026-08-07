-- CreateEnum
CREATE TYPE "GameEngine" AS ENUM ('poker', 'clang');

-- DropForeignKey
ALTER TABLE "Table" DROP CONSTRAINT "Table_gameDefinitionId_fkey";

-- AlterTable
ALTER TABLE "GameDefinition" ADD COLUMN     "engine" "GameEngine" NOT NULL DEFAULT 'poker',
ALTER COLUMN "definition" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Table" DROP COLUMN "gameKind",
ALTER COLUMN "gameDefinitionId" SET NOT NULL;

-- DropEnum
DROP TYPE "TableGameKind";

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

