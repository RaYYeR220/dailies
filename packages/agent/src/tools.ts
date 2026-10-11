import { z } from 'zod';

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute(args: unknown): Promise<unknown>;
}

export function defineTool<S extends z.ZodTypeAny>(t: {
  name: string;
  description: string;
  parameters: S;
  execute(args: z.infer<S>): Promise<unknown>;
}): Tool {
  return t;
}
