import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

/** Directory-local profile pin (walks parents from cwd; not git-specific). */
export const DIRECTORY_PIN_FILE = ".decide.toml";

const DirectoryPinSchema = z.object({
  profile: z.string().min(1),
  lock: z.boolean().optional().default(false),
});

export type DirectoryPin = z.infer<typeof DirectoryPinSchema>;

/** Nearest `.decide.toml` in startDir or any parent directory. */
export function findDirectoryPin(
  startDir: string = process.cwd(),
): { pin: DirectoryPin; path: string } | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, DIRECTORY_PIN_FILE);
    if (existsSync(candidate)) {
      const raw = parse(readFileSync(candidate, "utf8")) as Record<string, unknown>;
      const parsed = DirectoryPinSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Invalid ${DIRECTORY_PIN_FILE} at ${candidate}: ${parsed.error.message}`);
      }
      return { pin: parsed.data, path: candidate };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** @deprecated alias */
export const findRepoPin = findDirectoryPin;
