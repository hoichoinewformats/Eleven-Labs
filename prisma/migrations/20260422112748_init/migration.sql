-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'writer', 'viewer');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('pending', 'processing', 'done', 'error');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('Male', 'Female', 'Unspecified');

-- CreateEnum
CREATE TYPE "AgeBucket" AS ENUM ('teen', 'young', 'middle_aged', 'elder', 'unspecified');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'writer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ScriptStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT,
    "rawText" TEXT NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'Unspecified',
    "age" "AgeBucket" NOT NULL DEFAULT 'unspecified',
    "mood" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dialogue" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sceneCue" TEXT,

    CONSTRAINT "Dialogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceMatch" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "voiceId" TEXT NOT NULL,
    "voiceName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "age" TEXT NOT NULL,
    "previewUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "VoiceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");

-- CreateIndex
CREATE INDEX "Script_projectId_idx" ON "Script"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_scriptId_episodeNumber_key" ON "Episode"("scriptId", "episodeNumber");

-- CreateIndex
CREATE INDEX "Character_episodeId_idx" ON "Character"("episodeId");

-- CreateIndex
CREATE INDEX "Character_canonicalKey_idx" ON "Character"("canonicalKey");

-- CreateIndex
CREATE INDEX "Dialogue_characterId_idx" ON "Dialogue"("characterId");

-- CreateIndex
CREATE INDEX "Dialogue_characterId_sequence_idx" ON "Dialogue"("characterId", "sequence");

-- CreateIndex
CREATE INDEX "VoiceMatch_characterId_idx" ON "VoiceMatch"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceMatch_characterId_rank_key" ON "VoiceMatch"("characterId", "rank");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialogue" ADD CONSTRAINT "Dialogue_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceMatch" ADD CONSTRAINT "VoiceMatch_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
