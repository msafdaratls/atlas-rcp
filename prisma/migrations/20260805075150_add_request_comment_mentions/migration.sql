-- CreateTable
CREATE TABLE "RequestCommentMention" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestCommentMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestCommentMention_userId_idx" ON "RequestCommentMention"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestCommentMention_commentId_userId_key" ON "RequestCommentMention"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "RequestCommentMention" ADD CONSTRAINT "RequestCommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "RequestComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCommentMention" ADD CONSTRAINT "RequestCommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
