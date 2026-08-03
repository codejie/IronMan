import { basename, dirname, extname, resolve } from "node:path";
import { currentMasterSchemaVersion, recoverAndActivateMasterDatabase } from "../backend/src/db/master-database-recovery";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (!process.argv.includes("--apply")) {
  throw new Error("This command changes the active database. Re-run with --apply after stopping the backend.");
}

const sourcePath = resolve(argumentValue("--source") ?? "data/ironman.sqlite");
const extension = extname(sourcePath) || ".sqlite";
const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
const baseName = basename(sourcePath, extension);
const directory = dirname(sourcePath);
const backupPath = resolve(directory, `${baseName}.before-master-recovery-${timestamp}${extension}`);
const targetPath = resolve(directory, `${baseName}.master-recovery-${timestamp}${extension}`);
const summary = recoverAndActivateMasterDatabase({ sourcePath, backupPath, targetPath });

console.log(JSON.stringify({
  backupPath,
  activeDatabasePath: sourcePath,
  masterSchemaVersion: currentMasterSchemaVersion(),
  ...summary,
}, null, 2));
