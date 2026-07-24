import * as vscode from 'vscode';
import type { LangfuseSession, LangfuseTrace } from '../langfuse-client.js';
import {
  loadTracesAndObservations,
  readLangfuseConfigAsync,
  readRecentSessionsLimit,
} from '../langfuse-service.js';
import { hideSession, rememberSession } from './store.js';
import { loadRecentLangfuseSessions } from './recent.js';
import { fmtMs } from '../trace-utils.js';

type TreeNode = SessionTreeItem | TraceTreeItem | MessageTreeItem;

/** VS Code tree item representing a Langfuse session in the sidebar. */
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    readonly sessionId: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options?: { description?: string; tooltip?: string },
  ) {
    const label = sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
    super(label, collapsibleState);
    this.id = `session:${sessionId}`;
    this.contextValue = 'langfuseSession';
    this.tooltip = options?.tooltip ?? `Langfuse session: ${sessionId}`;
    this.description = options?.description;
    this.iconPath = new vscode.ThemeIcon('debug-alt');
    this.command = {
      command: 'langfuse.sessions.open',
      title: 'Open Session Traces',
      arguments: [this],
    };
  }
}

/** VS Code tree item representing a trace within a session. */
export class TraceTreeItem extends vscode.TreeItem {
  constructor(
    readonly sessionId: string,
    readonly trace: LangfuseTrace,
    readonly traceIndex: number,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `trace:${sessionId}:${trace.id}`;
    this.contextValue = 'langfuseTrace';
    this.tooltip = trace.id;
    this.description = trace.timestamp ? new Date(trace.timestamp).toLocaleString() : undefined;
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.command = {
      command: 'langfuse.openTrace',
      title: 'Open Trace',
      arguments: [{ sessionId, traceIndex }],
    };
  }
}

/** Informational tree item shown when a session has no traces. */
class MessageTreeItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.id = `message:${message}`;
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

/** Tree data provider for the Langfuse sessions sidebar view. */
export class LangfuseSessionsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _loadPromise?: Promise<LangfuseSession[]>;

  constructor(
    private readonly _globalState: vscode.Memento,
    private readonly _secrets: vscode.SecretStorage,
  ) {}

  /** Refreshes the sidebar tree and re-fetches sessions from Langfuse. */
  refresh(): void {
    this._loadPromise = undefined;
    this._onDidChange.fire(undefined);
  }

  /** Persists a session and refreshes the tree. */
  async addSession(sessionId: string): Promise<void> {
    await rememberSession(this._globalState, sessionId);
    this.refresh();
  }

  /** Hides a session from the sidebar list. */
  async removeSession(sessionId: string): Promise<void> {
    await hideSession(this._globalState, sessionId);
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this._loadRootSessions();
    }

    if (element instanceof SessionTreeItem) {
      return this._loadTraceChildren(element.sessionId);
    }

    return [];
  }

  private async _loadRootSessions(): Promise<TreeNode[]> {
    try {
      const sessions = await this._ensureSessionsLoaded();
      if (sessions.length === 0) {
        return [new MessageTreeItem('No recent sessions in Langfuse')];
      }
      return sessions.map(session => {
        const env = session.environment ? ` · ${session.environment}` : '';
        return new SessionTreeItem(
          session.id,
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            description: `${formatSessionDescription(session.createdAt)}${env}`,
            tooltip: [
              `Langfuse session: ${session.id}`,
              `Created: ${new Date(session.createdAt).toLocaleString()}`,
              session.environment ? `Environment: ${session.environment}` : undefined,
              session.projectId ? `Project: ${session.projectId}` : undefined,
            ].filter(Boolean).join('\n'),
          },
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [new MessageTreeItem(`Could not load sessions: ${message}`)];
    }
  }

  private _ensureSessionsLoaded(): Promise<LangfuseSession[]> {
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        const config = await readLangfuseConfigAsync(this._secrets);
        return loadRecentLangfuseSessions(
          this._globalState,
          config,
          readRecentSessionsLimit(),
        );
      })();
    }
    return this._loadPromise;
  }

  private async _loadTraceChildren(sessionId: string): Promise<TreeNode[]> {
    try {
      const result = await loadTracesAndObservations(sessionId, this._secrets);
      if (!result || result.fullTraces.length === 0) {
        return [new MessageTreeItem('No traces found for this session')];
      }

      const sorted = [...result.fullTraces].sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      return sorted.map((trace, traceIndex) => {
        const obsCount = (trace.observations ?? []).length;
        const duration = trace.latency ? fmtMs(trace.latency * 1000) : undefined;
        const label = trace.name ?? `trace ${traceIndex + 1}`;
        const tagHint = (trace.tags ?? []).slice(0, 2).join(', ');
        const suffix = [
          duration,
          obsCount > 0 ? `${obsCount} spans` : undefined,
          trace.userId ? `user:${trace.userId}` : undefined,
          tagHint || undefined,
        ].filter(Boolean).join(' · ');
        const item = new TraceTreeItem(sessionId, trace, traceIndex, suffix ? `${label} (${suffix})` : label);
        item.tooltip = [
          `Trace: ${trace.id}`,
          trace.userId ? `User: ${trace.userId}` : undefined,
          trace.environment ? `Env: ${trace.environment}` : undefined,
          trace.release ? `Release: ${trace.release}` : undefined,
          (trace.tags ?? []).length ? `Tags: ${(trace.tags ?? []).join(', ')}` : undefined,
          (trace.scores ?? []).length
            ? `Scores: ${(trace.scores ?? []).map(s => `${s.name}=${s.stringValue ?? s.value ?? '?'}`).join(', ')}`
            : undefined,
        ].filter(Boolean).join('\n');
        return item;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return [new MessageTreeItem(`Error: ${message}`)];
    }
  }
}

function formatSessionDescription(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) { return createdAt; }
  return date.toLocaleString();
}
