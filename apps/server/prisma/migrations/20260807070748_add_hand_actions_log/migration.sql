-- AlterTable
ALTER TABLE "Hand" ADD COLUMN     "actions" JSONB NOT NULL DEFAULT '[]';
