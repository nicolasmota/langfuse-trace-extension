import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeCommand = vi.fn();

vi.mock('vscode', () => ({
  commands: { executeCommand },
  env: {
    clipboard: {
      readText: vi.fn().mockResolvedValue('original'),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe('sendToChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses workbench.action.chat.open when available', async () => {
    executeCommand.mockResolvedValueOnce(undefined);
    const { sendToChat } = await import('../send-to-chat.js');
    await sendToChat('# span context');
    expect(executeCommand).toHaveBeenCalled();
    const firstCall = executeCommand.mock.calls[0];
    expect(firstCall?.[0]).toBe('workbench.action.chat.open');
  });

  it('throws when text is empty', async () => {
    const { sendToChat } = await import('../send-to-chat.js');
    await expect(sendToChat('   ')).rejects.toThrow('Nothing to send to chat.');
  });
});
