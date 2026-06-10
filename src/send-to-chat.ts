import * as vscode from 'vscode';

const OPEN_CHAT_COMMANDS = [
  'composer.newAgentChat',
  'aichat.show-ai-chat',
  'workbench.action.chat.open',
];

/** Waits for the chat input to become ready before pasting. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Attempts to open chat with a pre-filled prompt via known Cursor/VS Code commands. */
async function tryOpenChatWithPrompt(text: string): Promise<boolean> {
  const payloads: unknown[] = [
    { query: text },
    { query: text, isPartialQuery: true },
    text,
    { prompt: text },
  ];

  const commands = [
    'workbench.action.chat.open',
    'cursor.startComposerPrompt',
    'composer.startComposerPrompt',
  ];

  for (const command of commands) {
    for (const payload of payloads) {
      try {
        await vscode.commands.executeCommand(command, payload);
        return true;
      } catch {
        // Command unavailable or rejected — try next variant.
      }
    }
  }

  return false;
}

/** Opens chat and pastes text via clipboard (restores clipboard afterward). */
async function openChatAndPaste(text: string): Promise<void> {
  const originalClipboard = await vscode.env.clipboard.readText();
  try {
    await vscode.env.clipboard.writeText(text);

    let opened = false;
    for (const command of OPEN_CHAT_COMMANDS) {
      try {
        await vscode.commands.executeCommand(command);
        opened = true;
        break;
      } catch {
        // Try the next chat-open command.
      }
    }

    if (!opened) {
      throw new Error('Could not open Cursor chat. Try Cmd+L manually.');
    }

    await delay(250);
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
  } finally {
    await vscode.env.clipboard.writeText(originalClipboard);
  }
}

/** Sends markdown context to the Cursor/VS Code chat input. */
export async function sendToChat(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Nothing to send to chat.');
  }

  if (await tryOpenChatWithPrompt(trimmed)) {
    return;
  }

  await openChatAndPaste(trimmed);
}
