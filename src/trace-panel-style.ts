/** Stylesheet for the Langfuse trace viewer webview. */
export const PANEL_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --line: var(--vscode-editorWidget-border, rgba(128,128,128,0.28));
    --line-soft: color-mix(in srgb, var(--line) 55%, transparent);
    --muted: var(--vscode-descriptionForeground);
    --surface: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
    --surface-2: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.14));
    --chrome: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --danger: var(--vscode-terminal-ansiRed, #f07178);
    --cost: var(--vscode-terminal-ansiYellow, #e5c07b);
    --ok: var(--vscode-terminal-ansiGreen, #98c379);
    --accent: var(--vscode-focusBorder, #0078d4);
    --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
    --mono: var(--vscode-editor-font-family, ui-monospace, monospace);
    --tl-w: 280px;
  }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  body { display: flex; flex-direction: column; overflow: hidden; }
  button { font: inherit; color: inherit; }
  kbd {
    font-family: var(--mono);
    font-size: 10.5px;
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--vscode-foreground);
  }
  .mono { font-family: var(--mono); }

  /* ── Buttons ── */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    flex-shrink: 0;
    text-decoration: none;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--hover)); color: var(--vscode-foreground); }
  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .text-btn:hover { background: var(--hover); }
  .text-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .text-btn.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
  .link-btn {
    border: 0;
    background: transparent;
    color: var(--vscode-textLink-foreground, var(--accent));
    font-size: 12px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .link-btn:hover { background: var(--hover); }
  .icon-btn.exporting, .text-btn.exporting { pointer-events: none; opacity: 0.5; }
  .icon-btn:focus-visible, .text-btn:focus-visible, .seg button:focus-visible, .link-btn:focus-visible,
  .session-id:focus-visible, .field-tab:focus-visible, .field-copy-btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  #btn-refresh.spinning { animation: spin 0.7s linear infinite; pointer-events: none; opacity: 0.6; }

  /* ── Header ── */
  #header {
    flex-shrink: 0;
    padding: 12px 16px 10px;
    background: var(--chrome);
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hdr-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .hdr-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .session-id {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid transparent;
    background: var(--surface-2);
    color: var(--vscode-foreground);
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
  }
  .session-id:hover { border-color: var(--line); }
  .session-id.copied { border-color: var(--ok); }
  .sid-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .updated { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .updated::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); }
  .hdr-actions { margin-left: auto; display: flex; gap: 4px; align-items: center; }
  .stats-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 18px;
    font-size: 12px;
    color: var(--muted);
  }
  .stats-row strong { color: var(--vscode-foreground); font-weight: 600; }
  .stats-row .stat-cost strong { color: var(--cost); }
  .err-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--danger) 16%, transparent);
    color: color-mix(in srgb, var(--danger) 75%, var(--vscode-foreground));
    font-weight: 600;
    white-space: nowrap;
  }
  .filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filter-input {
    flex: 1 1 240px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 10px;
    border-radius: 5px;
    border: 1px solid var(--vscode-input-border, var(--line));
    background: var(--vscode-input-background, transparent);
    color: var(--muted);
  }
  .filter-input:focus-within { border-color: var(--accent); }
  .filter-input input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    font: inherit;
    font-size: 12.5px;
  }
  .seg { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--line-soft); }
  .seg button {
    height: 24px;
    padding: 0 10px;
    border-radius: 4px;
    border: 0;
    background: transparent;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .seg button:hover { background: var(--hover); }
  .seg button[aria-pressed="true"] {
    background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,0.3));
    color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
  }
  .seg button[data-group="error"][aria-pressed="true"] {
    background: color-mix(in srgb, var(--danger) 22%, transparent);
    color: var(--vscode-foreground);
    font-weight: 600;
  }
  .seg .n { color: var(--muted); margin-left: 4px; }
  .seg .dot { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; }
  .seg button.is-empty { opacity: 0.55; }
  .expand-ctrls { display: inline-flex; gap: 2px; }
  .filter-banner {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    background: color-mix(in srgb, var(--accent) 14%, var(--chrome));
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    font-size: 12px;
    flex-shrink: 0;
  }
  .filter-banner .link-btn { margin-left: auto; }
  .filtering .filter-banner { display: flex; }

  /* ── Scrollable content ── */
  #content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0 24px 0;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(128,128,128,0.3)) transparent;
  }

  /* ── Trace section ── */
  .trace-section { border-bottom: 1px solid var(--line); }
  .trace-section.f-hide { display: none; }
  .trace-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 6px 16px;
    cursor: pointer;
    user-select: none;
  }
  .trace-section:not(.collapsed) > .trace-header { border-bottom: 1px solid var(--line-soft); }
  .trace-header:hover { background: var(--hover); }
  .trace-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--muted);
    flex-shrink: 0;
    transition: transform 0.12s ease;
  }
  .trace-section.collapsed .trace-chevron { transform: rotate(-90deg); }
  .trace-idx { font-family: var(--mono); font-size: 11.5px; color: var(--muted); flex-shrink: 0; }
  .trace-name { font-weight: 600; white-space: nowrap; flex-shrink: 0; }
  .trace-preview {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .trace-ts, .trace-usage { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .trace-cost { font-size: 12px; color: var(--cost); font-family: var(--mono); white-space: nowrap; flex-shrink: 0; }
  .trace-dur { font-size: 13px; font-weight: 600; white-space: nowrap; min-width: 48px; text-align: right; flex-shrink: 0; }
  .trace-share { position: relative; width: 96px; height: 6px; border-radius: 3px; background: var(--line-soft); flex-shrink: 0; }
  .trace-share > i {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #61afef) 60%, transparent);
  }
  .trace-actions { display: flex; gap: 2px; flex-shrink: 0; }
  .trace-section.collapsed > .trace-body { display: none; }
  .filtering .trace-section > .trace-body { display: block; }
  .filtering .trace-io, .filtering .trace-meta { display: none; }
  .dim-stat { opacity: 0.6; }

  /* ── Facts, conversation turns, tree guides, formatted content ── */
  .trace-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 16px 2px;
  }
  .trace-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 0.78em;
    line-height: 1.45;
    color: var(--vscode-descriptionForeground);
  }
  .trace-fact {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }
  .trace-fact-k {
    opacity: 0.75;
    font-weight: 500;
  }
  .trace-fact-k::after { content: ''; }
  .trace-fact-v {
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family);
    font-size: 0.96em;
  }
  .trace-fact-tag .trace-fact-v {
    color: var(--vscode-terminal-ansiCyan, #56b6c2);
    font-family: inherit;
  }
  .score-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-size: 0.78em;
  }
  .score-name {
    color: var(--vscode-descriptionForeground);
    font-weight: 500;
  }
  .score-value {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-foreground);
  }
  .trace-scores, .obs-scores {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .score-list { display: inline-flex; flex-wrap: wrap; gap: 10px; }
  .trace-meta-more {
    font-size: 0.78em;
    color: var(--vscode-descriptionForeground);
  }
  .trace-meta-more > summary {
    cursor: pointer;
    user-select: none;
    list-style: none;
    width: fit-content;
    padding: 2px 0;
  }
  .trace-meta-more > summary::-webkit-details-marker { display: none; }
  .trace-meta-more > summary::before {
    content: '▸ ';
    opacity: 0.7;
  }
  .trace-meta-more[open] > summary::before { content: '▾ '; }
  .trace-meta-more[open] > summary { margin-bottom: 6px; }
  /* ── Conversation turns (User / Assistant / Input / Output) ── */
  .io-turn {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    border-radius: 10px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.1));
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.14));
  }
  .io-turn-user {
    border-left: 3px solid var(--vscode-terminal-ansiBlue, #61afef);
    background: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #61afef) 7%, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.14)));
  }
  .io-turn-assistant {
    border-left: 3px solid var(--vscode-terminal-ansiGreen, #98c379);
    background: color-mix(in srgb, var(--vscode-terminal-ansiGreen, #98c379) 7%, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.14)));
  }
  .io-turn-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .io-turn-label {
    font-size: 0.72em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
  }
  .io-turn-user .io-turn-label { color: var(--vscode-terminal-ansiBlue, #61afef); }
  .io-turn-assistant .io-turn-label { color: var(--vscode-terminal-ansiGreen, #98c379); }
  .io-turn-tools { margin-bottom: 0; }
  .io-turn-body { min-width: 0; }
  .io-prose {
    font-size: 1em;
    line-height: 1.65;
    color: var(--vscode-foreground);
  }
  .io-prose .fmt-md,
  .io-prose .fmt-text {
    font-size: 1em;
    line-height: 1.65;
  }
  .io-prose-user .fmt-md,
  .io-prose-assistant .fmt-md {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .obs-detail > .io-turn { margin-top: 2px; }
  .tree-guides {
    display: flex;
    align-self: stretch;
    flex-shrink: 0;
    margin-right: -2px;
  }
  .tg {
    position: relative;
    width: 14px;
    flex-shrink: 0;
    align-self: stretch;
  }
  .tg::before,
  .tg::after {
    content: '';
    position: absolute;
    pointer-events: none;
    background: var(--vscode-tree-indentGuidesStroke, var(--vscode-editorWidget-border, rgba(255,255,255,0.22)));
  }
  .tg-pipe::before {
    left: 6px;
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .tg-branch::before {
    left: 6px;
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .tg-branch::after {
    left: 6px;
    top: 50%;
    width: 8px;
    height: 1px;
  }
  .tg-last::before {
    left: 6px;
    top: 0;
    height: 50%;
    width: 1px;
  }
  .tg-last::after {
    left: 6px;
    top: 50%;
    width: 8px;
    height: 1px;
  }
  .obs-tree-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    flex-shrink: 0;
    line-height: 1;
  }
  .obs-tree-toggle:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08));
    color: var(--vscode-foreground);
  }
  .obs-tree-chevron {
    display: inline-block;
    font-size: 0.62em;
    transform: rotate(0deg);
    transition: transform 0.12s ease;
  }
  .obs-row.tree-collapsed .obs-tree-chevron { transform: rotate(-90deg); }
  .obs-tree-toggle-spacer {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
  .obs-type-icon {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .obs-type-icon svg { display: block; }
  .obs-type-icon.tip::after {
    content: attr(data-tip);
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    transform: translateX(-50%) translateY(2px);
    padding: 3px 7px;
    border-radius: 4px;
    background: var(--vscode-editorWidget-background, #252526);
    color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.12));
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.4px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    z-index: 20;
    transition: opacity 0.06s ease 0.08s, transform 0.06s ease 0.08s;
  }
  .obs-type-icon.tip:hover::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  .detail-section { display: flex; flex-direction: column; gap: 4px; }
  .detail-label {
    font-size: 0.72em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
  }
  .obs-cost { color: var(--vscode-terminal-ansiYellow, #e5c07b); font-family: var(--vscode-editor-font-family); }
  .json-block {
    margin: 0;
    padding: 8px 10px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    border-radius: 5px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.82em;
    overflow-x: auto;
    white-space: pre;
    word-break: normal;
    max-height: 300px;
    overflow-y: auto;
    line-height: 1.5;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.08));
  }
  .json-block.fmt-nested { max-height: 200px; font-size: 0.9em; }
  .json-key { color: var(--vscode-terminal-ansiBlue, #61afef); }
  .json-str { color: var(--vscode-terminal-ansiGreen, #98c379); }
  .json-num { color: var(--vscode-terminal-ansiYellow, #e5c07b); }
  .json-kw { color: var(--vscode-terminal-ansiMagenta, #c678dd); }

  /* ── Field JSON/Formatted toggle ── */
  .field-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .field-tabs {
    display: flex;
    gap: 2px;
  }
  .field-tab {
    font-size: 0.7em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    line-height: 1.6;
  }
  .field-tab:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05)); }
  .field-tab.active {
    background: color-mix(in srgb, var(--vscode-button-background) 20%, transparent);
    color: var(--vscode-button-background);
    border-color: color-mix(in srgb, var(--vscode-button-background) 50%, transparent);
  }
  .field-copy-btn {
    font-size: 0.7em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.15));
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    line-height: 1.6;
    flex-shrink: 0;
  }
  .field-copy-btn:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05)); color: var(--vscode-foreground); }
  .field-copy-btn.copied {
    color: var(--vscode-terminal-ansiGreen, #98c379);
    border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen, #98c379) 45%, transparent);
  }

  /* ── Formatted view ── */
  .fmt-text, .fmt-md {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 1em;
    line-height: 1.6;
    color: var(--vscode-foreground);
  }
  .fmt-inline-code {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--vscode-textCodeBlock-background, rgba(0,0,0,0.25)) 80%, transparent);
  }
  .fmt-code-block {
    margin: 6px 0 0;
    padding: 8px 10px;
    border-radius: 5px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
    max-height: 280px;
    overflow-y: auto;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2));
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.08));
  }
  .fmt-msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    border-radius: 6px;
    border-left: 3px solid transparent;
    margin-bottom: 8px;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.15));
  }
  .fmt-msg-system { border-left-color: var(--vscode-terminal-ansiYellow, #e5c07b); }
  .fmt-msg-user   { border-left-color: var(--vscode-terminal-ansiBlue, #61afef); }
  .fmt-msg-assistant, .fmt-msg-model { border-left-color: var(--vscode-terminal-ansiGreen, #98c379); }
  .fmt-msg-tool   { border-left-color: var(--vscode-terminal-ansiMagenta, #c678dd); }
  .fmt-msg-role {
    font-size: 0.72em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }
  .fmt-msg-body {
    font-size: 1em;
    line-height: 1.6;
  }
  .fmt-tool-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .fmt-tool {
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiMagenta, #c678dd) 35%, transparent);
    background: color-mix(in srgb, var(--vscode-terminal-ansiMagenta, #c678dd) 8%, transparent);
    overflow: hidden;
  }
  .fmt-tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiMagenta, #c678dd) 20%, transparent);
  }
  .fmt-tool-badge {
    font-size: 0.7em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--vscode-terminal-ansiMagenta, #c678dd);
  }
  .fmt-tool-name {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .fmt-tool-id {
    margin-left: auto;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.78em;
    color: var(--vscode-descriptionForeground);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fmt-tool-args { padding: 8px 10px; }
  .fmt-tool-args .json-block { max-height: 180px; border: none; background: transparent; padding: 0; }
  .fmt-primitive {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
  }
  .fmt-kv-table { display: flex; flex-direction: column; gap: 6px; }
  .fmt-kv-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 1em;
    line-height: 1.5;
  }
  .fmt-key {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.95em;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .fmt-key::after { content: ':'; }
  .fmt-val-inline { color: var(--vscode-foreground); font-size: 1em; }
  .fmt-val-block { width: 100%; padding-left: 10px; }
  .fmt-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
  }
  .fmt-meta-kv .fmt-key::after { content: ':'; }
  .fmt-list { display: flex; flex-direction: column; gap: 6px; }
  .fmt-list-item { display: flex; align-items: baseline; gap: 6px; font-size: 1em; }
  .fmt-list-idx {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
  }
  .fmt-list-val { flex: 1; min-width: 0; }
  .fmt-llm-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .fmt-llm-model {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.85em;
    font-weight: 600;
    color: var(--vscode-foreground);
    padding: 3px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--vscode-terminal-ansiGreen, #98c379) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiGreen, #98c379) 30%, transparent);
  }
  .fmt-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .fmt-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.78em;
    background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.18));
    border: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.1));
  }
  .fmt-chip-k {
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
  }
  .fmt-chip-v {
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-foreground);
  }

  .dim { color: var(--vscode-descriptionForeground); }
  em.dim { font-style: normal; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  /* ── Trace highlighted (focus flash) ── */
  @keyframes traceFlash {
    0%   { background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent); }
    100% { background: transparent; }
  }
  .trace-section.flash { animation: traceFlash 1.2s ease-out; }

  /* ── Empty state ── */
  #empty-state {
    padding: 48px 24px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    line-height: 1.7;
  }
  #empty-state .icon { font-size: 2.5em; margin-bottom: 12px; }

  /* ── Trace facts / conversation (layout overrides) ── */
  .trace-meta { padding: 10px 16px 2px 46px; }
  .trace-io {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 10px;
    padding: 10px 16px 14px 46px;
  }
  .trace-io .io-turn-body .fmt-text,
  .trace-io .io-turn-body .fmt-md,
  .trace-io .io-turn-body .io-prose {
    max-height: 220px;
    overflow-y: auto;
  }
  .trace-io .json-block { max-height: 160px; }

  /* ── Column header + time axis ── */
  .col-head {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 28px;
    padding: 0 16px;
    border-top: 1px solid var(--line-soft);
    border-bottom: 1px solid var(--line-soft);
    background: var(--chrome);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .col-name { flex: 1; min-width: 0; }
  .col-tok { width: 96px; text-align: right; flex-shrink: 0; }
  .col-cost { width: 72px; text-align: right; flex-shrink: 0; }
  .col-dur { width: 56px; text-align: right; flex-shrink: 0; }
  .col-tl { position: relative; width: var(--tl-w); align-self: stretch; flex-shrink: 0; }
  .col-act { width: 24px; flex-shrink: 0; }
  .tick-label {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    padding-left: 4px;
    border-left: 1px solid var(--line);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  /* ── Observation row ── */
  .obs-row { border-bottom: 1px solid var(--line-soft); }
  .obs-row.tree-hidden { display: none; }
  .obs-header {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 16px;
    cursor: pointer;
    user-select: none;
    min-width: 0;
  }
  .obs-header.no-detail { cursor: default; }
  .obs-header:hover { background: var(--hover); }
  .obs-header:focus-visible, .trace-header:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
  .obs-row.expanded > .obs-header { background: color-mix(in srgb, var(--wf-color) 9%, transparent); }
  .obs-row.is-error > .obs-header { box-shadow: inset 2px 0 0 var(--danger); }
  .obs-row.is-error > .obs-header .obs-name { color: color-mix(in srgb, var(--danger) 70%, var(--vscode-foreground)); }
  .obs-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 6px;
  }
  .obs-name {
    font-size: 0.95em;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .obs-name mark {
    background: color-mix(in srgb, var(--cost) 32%, transparent);
    color: inherit;
    border-radius: 2px;
  }
  .obs-model {
    margin-left: auto;
    flex-shrink: 1;
    min-width: 0;
    max-width: 150px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .obs-tok { width: 96px; text-align: right; flex-shrink: 0; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cache-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; background: var(--vscode-terminal-ansiBlue, #61afef); vertical-align: middle; }
  .obs-cost-badge { width: 72px; text-align: right; flex-shrink: 0; font-size: 11.5px; color: var(--cost); font-family: var(--mono); white-space: nowrap; }
  .obs-time { width: 56px; text-align: right; flex-shrink: 0; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .obs-level {
    font-size: 0.68em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .obs-level-error { color: color-mix(in srgb, var(--danger) 75%, var(--vscode-foreground)); background: color-mix(in srgb, var(--danger) 18%, transparent); }
  .obs-level-warning { color: var(--cost); background: color-mix(in srgb, var(--cost) 16%, transparent); }
  .obs-level-debug, .obs-level-default { color: var(--muted); background: color-mix(in srgb, var(--muted) 12%, transparent); }
  .obs-export-btn { opacity: 0; transition: opacity 0.12s; width: 24px; height: 24px; }
  .obs-row:hover .obs-export-btn, .obs-row.expanded .obs-export-btn, .obs-header:focus-visible .obs-export-btn, .obs-export-btn.exporting { opacity: 1; }

  /* ── Waterfall track ── */
  .wf-track { position: relative; width: var(--tl-w); align-self: stretch; flex-shrink: 0; }
  .wf-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--line-soft); }
  .wf-bar {
    position: absolute;
    top: 50%;
    height: 10px;
    margin-top: -5px;
    border-radius: 3px;
    min-width: 3px;
  }

  /* ── Filtering ── */
  .filtering .obs-row:not(.f-match):not(.f-ctx) { display: none; }
  .filtering .obs-row.f-ctx:not(.f-match) > .obs-header { opacity: 0.5; }
  .filtering .obs-row.f-ctx:not(.f-match) > .obs-detail { display: none; }

  /* ── Detail panel ── */
  .obs-detail { display: none; }
  .obs-detail.open {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px 16px 46px;
    background: color-mix(in srgb, var(--vscode-editor-background) 93%, #000);
    border-top: 1px solid var(--line-soft);
  }
  .detail-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .detail-title { font-weight: 600; color: var(--vscode-foreground); }
  .detail-sub { font-size: 12px; color: var(--muted); }
  .detail-actions { margin-left: auto; display: flex; gap: 6px; }
  .no-detail-msg { font-size: 0.82em; font-style: italic; }
  .obs-meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    border-radius: 6px;
    overflow: hidden;
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
  }
  .obs-meta-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    padding: 8px 10px;
    background: var(--vscode-editor-background);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    font-size: 1em;
  }
  .obs-meta-k {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--muted);
  }
  .obs-meta-v { color: var(--vscode-foreground); max-width: 100%; }
  .obs-meta-v.mono, .obs-meta-id { font-family: var(--mono); font-size: 11.5px; }
  .obs-meta-sub { color: var(--muted); }
  .obs-meta-id { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .obs-meta-copy { margin-top: 2px; }
  .obs-scores {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 10px;
    background: var(--vscode-editor-background);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .obs-error {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--danger) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
  }
  .obs-error svg { flex-shrink: 0; margin-top: 2px; color: var(--danger); }
  .obs-error code {
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: color-mix(in srgb, var(--danger) 55%, var(--vscode-foreground));
  }
  .io-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; align-items: start; }
  .io-empty {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px dashed var(--line);
    font-size: 12.5px;
    color: var(--muted);
  }
  .detail-more > summary {
    cursor: pointer;
    user-select: none;
    list-style: none;
    width: fit-content;
    padding: 2px 0;
    font-size: 12px;
    color: var(--muted);
  }
  .detail-more > summary::-webkit-details-marker { display: none; }
  .detail-more > summary::before { content: '▸ '; opacity: 0.7; }
  .detail-more[open] > summary::before { content: '▾ '; }
  .detail-more[open] > summary { margin-bottom: 8px; }
  .detail-more .muted { color: var(--muted); }

  /* ── Usage ── */
  .usage {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px 8px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .usage-head { display: flex; align-items: baseline; gap: 10px; }
  .usage-total { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
  .usage-total-cost { color: var(--cost); font-family: var(--mono); font-size: 12px; }
  .usage-bar { display: flex; gap: 2px; height: 12px; }
  .usage-seg { min-width: 5px; }
  .usage-seg:first-child { border-radius: 3px 0 0 3px; }
  .usage-seg:last-child { border-radius: 0 3px 3px 0; }
  .usage-seg:only-child { border-radius: 3px; }
  .u-cached { background: color-mix(in srgb, var(--vscode-terminal-ansiBlue, #61afef) 55%, var(--vscode-editor-background)); }
  .u-uncached, .u-input { background: var(--vscode-terminal-ansiBrightBlue, #7cc0ff); }
  .u-reasoning { background: var(--vscode-terminal-ansiMagenta, #c678dd); }
  .u-response, .u-output { background: var(--vscode-terminal-ansiGreen, #98c379); }
  .u-extra { background: var(--vscode-terminal-ansiYellow, #e5c07b); }
  .u-input-split { background: linear-gradient(90deg, color-mix(in srgb, var(--vscode-terminal-ansiBlue, #61afef) 55%, var(--vscode-editor-background)) 50%, var(--vscode-terminal-ansiBrightBlue, #7cc0ff) 50%); }
  .u-output-split { background: linear-gradient(90deg, var(--vscode-terminal-ansiMagenta, #c678dd) 50%, var(--vscode-terminal-ansiGreen, #98c379) 50%); }
  .usage-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 90px 100px 90px;
    gap: 10px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .usage-row:last-child { border-bottom: 0; }
  .usage-row-head {
    padding-top: 0;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .usage-row-head .usage-cost { color: inherit; font-family: inherit; font-size: inherit; }
  .usage-row-head .usage-tok { font-weight: 600; }
  .usage-pct { display: none; font-size: 11px; color: var(--muted); }
  .usage-row-sub { padding: 4px 0; color: var(--muted); }
  .usage-row-sub .usage-label { padding-left: 16px; }
  .usage-row-sub .usage-tok { font-weight: 400; color: var(--vscode-foreground); }
  .usage-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .usage-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .usage-hint { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .usage-tok { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .usage-share { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .usage-cost { text-align: right; color: var(--cost); font-family: var(--mono); font-size: 12px; }
  .usage-row-sub .usage-cost { opacity: 0.75; }

  /* ── Footer ── */
  #footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 32px;
    padding: 0 16px;
    border-top: 1px solid var(--line);
    background: var(--chrome);
    font-size: 11.5px;
    color: var(--muted);
    overflow: hidden;
  }
  #footer .hints { display: flex; gap: 16px; white-space: nowrap; }
  #footer .legend { margin-left: auto; display: inline-flex; align-items: center; gap: 12px; white-space: nowrap; }
  #footer .legend span { display: inline-flex; align-items: center; gap: 5px; }
  #footer .legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

  /* ── Responsive ── */
  @media (max-width: 860px) {
    :root { --tl-w: 200px; }
    .trace-share { display: none; }
  }
  @media (max-width: 640px) {
    :root { --tl-w: 120px; }
    #header { padding: 10px 12px; }
    .hdr-label, .updated, .btn-label { display: none; }
    .col-tok, .col-cost, .obs-tok, .obs-cost-badge, .obs-model, .trace-ts, .trace-usage, .trace-cost { display: none; }
    .trace-header { flex-wrap: wrap; row-gap: 2px; padding: 8px 12px; }
    .trace-preview { order: 10; flex-basis: 100%; padding-left: 30px; }
    .trace-dur { margin-left: auto; }
    .obs-header, .col-head { padding: 0 12px; gap: 8px; }
    .obs-detail.open { padding: 12px; }
    .trace-meta { padding-left: 12px; }
    .trace-io { padding-left: 12px; padding-right: 12px; grid-template-columns: minmax(0, 1fr); }
    .io-grid { grid-template-columns: minmax(0, 1fr); }
    .usage-row { grid-template-columns: minmax(0, 1fr) 56px 72px; gap: 8px; }
    .usage-share { display: none; }
    .usage-row-head .usage-share { display: none; }
    .usage-hint { display: none; }
    .usage-pct { display: inline; }
    #footer .hints { display: none; }
    #footer .legend { margin-left: 0; }
  }
`;
