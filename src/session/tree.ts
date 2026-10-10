import * as vscode from 'vscode';
import type { LangfuseSession, LangfuseTrace } from '../langfuse-client.js';
import {
  loadTracesAndObservations,
  readLangfuseConfigAsync,
  readRecentSessionsLimit,
} from '../langfuse-service.js';
import { hideSession, pinSession, readPinnedSessions, rememberSession, unpinSession } from './store.js';
import { loadRecentLangfuseSessions } from './recent.js';
import { describeSession, describeTrace } from './describe.js';
import { summarizeSession, type SessionSummary } from '../trace-insights.js';

type TreeNode = SessionTreeItem | TraceTreeItem | MessageTreeItem | GroupTreeItem;

const ERROR_COLOR = new vscode.ThemeColor('testing.iconFailed');

/** VS Code tree item representing a Langfuse session in the sidebar. */
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    readonly sessionId: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    options: { description?: string; tooltip?: string; pinned?: boolean; hasErrors?: boolean } = {},
  ) {
    super(label, collapsibleState);
    this.id = `session:${sessionId}`;
    this.contextValue = options.pinned ? 'langfuseSessionPinned' : 'langfuseSession';
    this.tooltip = options.tooltip ?? `Langfuse session: ${sessionId}`;
    this.description = options.description;
    this.iconPath = options.hasErrors
      ? new vscode.ThemeIcon('comment-unresolved', ERROR_COLOR)
      : new vscode.ThemeIcon(options.pinned ? 'pinned' : 'comment-discussion');
    this.command = {
      command: 'langfuse.sessions.open',
      title: 'Open Session Traces',
      arguments: [this],
    };
  }
}

/** Section header ("Pinned" / "Recent") shown when at least one session is pinned. */
export class GroupTreeItem extends vscode.TreeItem {
  constructor(readonly group: 'pinned' | 'recent', readonly sessions: SessionTreeItem[]) {
    super(group === 'pinned' ? 'Pinned' : 'Recent', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `group:${group}`;
    this.contextValue = 'langfuseGroup';
    this.description = String(sessions.length);
  }
}

/** VS Code tree item representing a trace within a session. */
export class TraceTreeItem extends vscode.TreeItem {
  constructor(
    readonly sessionId: string,
    readonly trace: LangfuseTrace,
    readonly traceIndex: number,
    label: string,
    hasErrors: boolean,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `trace:${sessionId}:${trace.id}`;
    this.contextValue = 'langfuseTrace';
    this.tooltip = trace.id;
    this.iconPath = hasErrors
      ? new vscode.ThemeIcon('error', ERROR_COLOR)
      : new vscode.ThemeIcon('circle-small-filled');
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
  /** Summaries of sessions whose traces were loaded this window, used for richer labels. */
  private readonly _summaries = new Map<string, SessionSummary>();

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

  /** Hides a session from the sidebar list (and unpins it). */
  async removeSession(sessionId: string): Promise<void> {
    await unpinSession(this._globalState, sessionId);
    await hideSession(this._globalState, sessionId);
    this.refresh();
  }

  /** Pins a session to the top of the sidebar. */
  async pin(sessionId: string): Promise<void> {
    await pinSession(this._globalState, sessionId);
    this._onDidChange.fire(undefined);
  }

  /** Removes a session from the pinned section. */
  async unpin(sessionId: string): Promise<void> {
    await unpinSession(this._globalState, sessionId);
    this._onDidChange.fire(undefined);
  }

  /** Remembers a session's opening message and error count for its sidebar label. */
  noteSessionTraces(sessionId: string, traces: LangfuseTrace[]): void {
    this._summaries.set(sessionId, summarizeSession(traces));
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return this._loadRootSessions();
    }

    if (element instanceof GroupTreeItem) {
      return element.sessions;
    }

    if (element instanceof SessionTreeItem) {
      return this._loadTraceChildren(element.sessionId);
    }

    return [];
  }

  private _buildSessionItem(sessionId: string, session: LangfuseSession | undefined, pinned: boolean): SessionTreeItem {
    const summary = this._summaries.get(sessionId);
    const text = describeSession(sessionId, session, summary);
    return new SessionTreeItem(
      sessionId,
      text.label,
      vscode.TreeItemCollapsibleState.Collapsed,
      {
        description: text.description,
        pinned,
        hasErrors: text.hasErrors,
        tooltip: [
          `Langfuse session: ${sessionId}`,
          summary?.firstMessage ? `First message: ${summary.firstMessage}` : undefined,
          session ? `Created: ${new Date(session.createdAt).toLocaleString()}` : undefined,
          session?.environment ? `Environment: ${session.environment}` : undefined,
          session?.projectId ? `Project: ${session.projectId}` : undefined,
          summary ? `${summary.traceCount} trace${summary.traceCount === 1 ? '' : 's'}${summary.errorCount ? `, ${summary.errorCount} with errors` : ''}` : undefined,
        ].filter(Boolean).join('\n'),
      },
    );
  }

  private async _loadRootSessions(): Promise<TreeNode[]> {
    try {
      const sessions = await this._ensureSessionsLoaded();
      const pinnedIds = readPinnedSessions(this._globalState);
      const byId = new Map(sessions.map(session => [session.id, session]));

      const pinnedItems = pinnedIds.map(id => this._buildSessionItem(id, byId.get(id), true));
      const recentItems = sessions
        .filter(session => !pinnedIds.includes(session.id))
        .map(session => this._buildSessionItem(session.id, session, false));

      if (pinnedItems.length === 0 && recentItems.length === 0) {
        return [new MessageTreeItem('No recent sessions in Langfuse')];
      }
      if (pinnedItems.length === 0) { return recentItems; }
      const nodes: TreeNode[] = [new GroupTreeItem('pinned', pinnedItems)];
      if (recentItems.length > 0) { nodes.push(new GroupTreeItem('recent', recentItems)); }
      return nodes;
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

      this.noteSessionTraces(sessionId, result.fullTraces);

      const sorted = [...result.fullTraces].sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      return sorted.map((trace, traceIndex) => {
        const text = describeTrace(trace, traceIndex);
        const item = new TraceTreeItem(sessionId, trace, traceIndex, text.label, text.hasErrors);
        item.description = text.description;
        item.tooltip = [
          trace.name ? `${trace.name}` : undefined,
          `Trace: ${trace.id}`,
          trace.timestamp ? `Time: ${new Date(trace.timestamp).toLocaleString()}` : undefined,
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
