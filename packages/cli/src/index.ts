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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
