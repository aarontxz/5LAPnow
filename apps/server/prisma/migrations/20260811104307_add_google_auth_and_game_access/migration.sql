-- AlterTable
ALTER TABLE "GameDefinition" ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "googleId" TEXT;

-- CreateTable
CREATE TABLE "GameDefinitionAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameDefinitionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameDefinitionAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameDefinitionAccess_userId_gameDefinitionId_key" ON "GameDefinitionAccess"("userId", "gameDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "GameDefinitionAccess" ADD CONSTRAINT "GameDefinitionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameDefinitionAccess" ADD CONSTRAINT "GameDefinitionAccess_gameDefinitionId_fkey" FOREIGN KEY ("gameDefinitionId") REFERENCES "GameDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
