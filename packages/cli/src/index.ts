import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUN_USAGE, runCommand } from './run';
import { VERIFY_USAGE, verifyCommand } from './verify';

export { runCommand, type RunOverrides } from './run';
export { verifyCommand, type VerifyOverrides } from './verify';

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'run') return runCommand(rest);
  if (command === 'verify') return verifyCommand(rest);
  console.error(`${RUN_USAGE}\n${VERIFY_USAGE}`);
  return 1;
}

/**
 * Whether `moduleUrl` (an `import.meta.url`) and `argv1` (`process.argv[1]`) name the same file,
 * resolving symlinks and decoding the URL first. A literal string comparison breaks on a path
 * with a space (percent-encoded in the URL, not in argv) or reached through a symlink (`/tmp` is
 * `/private/tmp` on macOS) — either would make the CLI silently do nothing instead of running.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
