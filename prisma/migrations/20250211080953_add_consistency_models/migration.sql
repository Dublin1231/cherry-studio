-- CreateTable
CREATE TABLE "ConsistencyCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "details" TEXT
);

-- CreateTable
CREATE TABLE "ConsistencyIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" TEXT,
    "checkId" TEXT NOT NULL,
    CONSTRAINT "ConsistencyIssue_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "ConsistencyCheck" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
