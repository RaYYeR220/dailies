import type { ChatMessage, Completion, ModelClient, Role } from './router';

export function createMockClient(reply: (req: { role: Role; messages: ChatMessage[] }) => ChatMessage): ModelClient {
  return {
    async complete(req): Promise<Completion> {
      const message = reply({ role: req.role, messages: req.messages });
      return { message, inputTokens: 0, outputTokens: 0, model: 'mock', provider: 'mock' };
    },
  };
}
