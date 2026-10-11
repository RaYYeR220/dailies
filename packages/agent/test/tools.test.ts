import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../src/tools';

describe('defineTool', () => {
  it('builds a Tool whose execute runs with the typed args', async () => {
    const tool = defineTool({
      name: 'echo',
      description: 'echoes input',
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => ({ text }),
    });
    expect(tool.name).toBe('echo');
    expect(tool.description).toBe('echoes input');
    await expect(tool.execute({ text: 'hi' })).resolves.toEqual({ text: 'hi' });
  });
});
