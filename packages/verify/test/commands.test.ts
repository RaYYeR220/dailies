import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../src/index';

describe('classifyCommand', () => {
  it('classifies commands', () => {
    expect(classifyCommand('cd app && pnpm test -- --run')).toBe('test');
    expect(classifyCommand('npx tsc --noEmit')).toBe('typecheck');
    expect(classifyCommand('git status')).toBe('other');
  });

  it('classifies lint and build commands', () => {
    expect(classifyCommand('pnpm run lint')).toBe('lint');
    expect(classifyCommand('next build')).toBe('build');
    expect(classifyCommand('make')).toBe('build');
  });

  it('treats "make test" as test, not build', () => {
    expect(classifyCommand('make test')).toBe('test');
  });

  it('prefers test over build when a command chain has both', () => {
    expect(classifyCommand('next build && pnpm test')).toBe('test');
  });

  it('classifies pm typecheck scripts as typecheck', () => {
    expect(classifyCommand('pnpm typecheck')).toBe('typecheck');
    expect(classifyCommand('pnpm run type-check')).toBe('typecheck');
    expect(classifyCommand('yarn check-types')).toBe('typecheck');
  });

  it('does not take a mention of a runner for a run', () => {
    expect(classifyCommand('git commit -m "Add webhook sender with vitest coverage"')).toBe('other');
    expect(classifyCommand('grep -n "AbortSignal" node_modules/vitest/dist/chunks/index.js')).toBe('other');
    expect(classifyCommand('npm view vitest versions --json 2>/dev/null | node -e "console.log(1)"')).toBe('other');
    expect(classifyCommand('npm ls vitest typescript 2>&1 && npm audit --json')).toBe('other');
    expect(classifyCommand('git add src && git commit -m "make the build green"')).toBe('other');
    expect(classifyCommand('echo "=== typecheck ===" && pnpm typecheck 2>&1 | tail -20')).toBe('typecheck');
  });

  it('reads past environment assignments and wrappers to the runner', () => {
    expect(classifyCommand('CI=1 FORCE_COLOR=0 npx vitest run 2>&1 | tail -40')).toBe('test');
    expect(classifyCommand('pnpm --filter @acme/api exec vitest run --dir test')).toBe('test');
    expect(classifyCommand('timeout 60 pnpm test')).toBe('test');
  });

  it('ignores the body of a here-document', () => {
    const write = "cat > /tmp/probe.test.ts << 'EOF'\nimport { it } from 'vitest';\nit('x', () => {});\nEOF";
    expect(classifyCommand(write)).toBe('other');
    expect(classifyCommand(`${write}\nnpx vitest run /tmp/probe.test.ts`)).toBe('test');
  });

  it('still sees a run started through a command that looks harmless', () => {
    expect(classifyCommand('echo "$(npm test 2>&1 | tail -3)"')).toBe('test');
    expect(classifyCommand('find . -name "*.test.ts" -exec vitest run {} +')).toBe('test');
    expect(classifyCommand('git bisect run pnpm test')).toBe('test');
    expect(classifyCommand('git rebase -i HEAD~3 --exec "pytest -q"')).toBe('test');
    expect(classifyCommand('find tests -name "*.py" | xargs pytest -q')).toBe('test');
    expect(classifyCommand('npm install-test')).toBe('test');
  });

  it('reads a here-document fed to a shell, since its body is commands', () => {
    expect(classifyCommand("bash <<'EOF'\nset -e\nnpm test\nEOF")).toBe('test');
    expect(classifyCommand("ssh build-host <<EOF\ncd app && pytest -q\nEOF")).toBe('test');
    expect(classifyCommand("python3 - <<'EOF'\nprint('pytest is mentioned here')\nEOF")).toBe('other');
  });
});
