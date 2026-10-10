/**
 * Client-side script for the Langfuse trace viewer webview.
 * Kept free of backticks and template placeholders so it can live in a raw string.
 * View state (open traces/spans, filter, scroll) is persisted with vscode.setState so it
 * survives the full HTML replacement that happens on every refresh.
 */
export const PANEL_SCRIPT = String.raw`
(function () {
  var vscode = acquireVsCodeApi();
  var saved = vscode.getState() || {};
  var content = document.getElementById('content');
  var filterInput = document.getElementById('filter-input');
  var lastInteractedObservationId = null;
  var lastInteractedTraceId = null;
  var focusedTraceIndex = null;
  var focusedTraceId = null;
  var state = {
    q: typeof saved.q === 'string' ? saved.q : '',
    group: typeof saved.group === 'string' ? saved.group : 'all',
  };

  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function up(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  function isFiltering() { return document.body.classList.contains('filtering'); }

  // ── State reporting (extension host + persistence) ───────────────────────
  function reportUiState() {
    var expanded = $all('.obs-row.expanded').map(function (r) { return r.getAttribute('data-observation-id'); }).filter(Boolean);
    vscode.postMessage({
      command: 'uiState',
      focusedTraceIndex: focusedTraceIndex,
      focusedTraceId: focusedTraceId,
      expandedObservationIds: expanded,
      lastInteractedObservationId: lastInteractedObservationId,
      lastInteractedTraceId: lastInteractedTraceId,
    });
  }

  function save() {
    var sections = $all('.trace-section');
    vscode.setState({
      q: state.q,
      group: state.group,
      scroll: content ? content.scrollTop : 0,
      knownTraces: sections.map(function (s) { return s.getAttribute('data-trace-id'); }),
      openTraces: sections.filter(function (s) { return !s.classList.contains('collapsed'); })
        .map(function (s) { return s.getAttribute('data-trace-id'); }),
      openObs: $all('.obs-row.expanded').map(function (r) { return r.getAttribute('data-observation-id'); }),
      collapsedTree: $all('.obs-row.tree-collapsed').map(function (r) { return r.getAttribute('data-observation-id'); }),
    });
  }

  function touch(row, section) {
    if (row) {
      lastInteractedObservationId = row.getAttribute('data-observation-id');
      lastInteractedTraceId = row.getAttribute('data-trace-id');
    }
    var sec = section || up(row, '.trace-section');
    if (sec) {
      focusedTraceIndex = parseInt(sec.getAttribute('data-trace-index') || '', 10);
      focusedTraceId = sec.getAttribute('data-trace-id');
    }
  }

  // ── Trace sections ───────────────────────────────────────────────────────
  function setTraceCollapsed(section, collapsed) {
    section.classList.toggle('collapsed', collapsed);
    var head = section.querySelector('.trace-header');
    if (head) { head.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); }
  }

  // ── Span tree ────────────────────────────────────────────────────────────
  function applyTreeVisibility(root) {
    var rows = $all('.obs-row', root);
    var byId = {};
    rows.forEach(function (row) { byId[row.getAttribute('data-observation-id')] = row; });
    var filtering = isFiltering();
    rows.forEach(function (row) {
      var hidden = false;
      var parentId = row.getAttribute('data-parent-id') || '';
      var guard = 0;
      while (!filtering && parentId && guard < 64) {
        guard += 1;
        var parent = byId[parentId];
        if (!parent) { break; }
        if (parent.classList.contains('tree-collapsed')) { hidden = true; break; }
        parentId = parent.getAttribute('data-parent-id') || '';
      }
      row.classList.toggle('tree-hidden', hidden);
    });
  }

  function setTreeCollapsed(row, collapsed) {
    if (!row || !row.classList.contains('has-children')) { return; }
    row.classList.toggle('tree-collapsed', collapsed);
    row.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var toggle = row.querySelector('.obs-tree-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.title = collapsed ? 'Expand children' : 'Collapse children';
      toggle.setAttribute('aria-label', toggle.title);
    }
    applyTreeVisibility(up(row, '.trace-section') || document);
  }

  function setDetailOpen(row, open) {
    var detail = row.querySelector(':scope > .obs-detail');
    if (!detail) { return; }
    detail.classList.toggle('open', open);
    row.classList.toggle('expanded', open);
  }

  function toggleDetail(row) {
    var detail = row.querySelector(':scope > .obs-detail');
    if (!detail) { return; }
    setDetailOpen(row, !detail.classList.contains('open'));
    touch(row);
    reportUiState();
    save();
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  function highlightName(row, q) {
    var el = row.querySelector('.obs-name-text');
    if (!el) { return; }
    var name = el.getAttribute('data-name') || '';
    var i = q ? name.toLowerCase().indexOf(q) : -1;
    el.textContent = '';
    if (i < 0) { el.textContent = name; return; }
    el.appendChild(document.createTextNode(name.slice(0, i)));
    var mark = document.createElement('mark');
    mark.textContent = name.slice(i, i + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(name.slice(i + q.length)));
  }

  function applyFilter() {
    var q = state.q.trim().toLowerCase();
    var g = state.group;
    var active = !!q || g !== 'all';
    document.body.classList.toggle('filtering', active);
    $all('.seg button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-group') === g ? 'true' : 'false');
    });
    var total = 0, matched = 0, hiddenTraces = 0;
    $all('.trace-section').forEach(function (section) {
      var rows = $all('.obs-row', section);
      var byId = {};
      var hits = 0;
      rows.forEach(function (r) {
        byId[r.getAttribute('data-observation-id')] = r;
        r.classList.remove('f-match', 'f-ctx');
      });
      rows.forEach(function (r) {
        total += 1;
        var ok = false;
        if (active) {
          var groupOk = g === 'all' ||
            (g === 'error' ? r.getAttribute('data-error') === '1' : r.getAttribute('data-group') === g);
          ok = groupOk && (!q || (r.getAttribute('data-search') || '').indexOf(q) >= 0);
        }
        if (ok) {
          hits += 1; matched += 1;
          r.classList.add('f-match');
          var pid = r.getAttribute('data-parent-id') || '';
          var guard = 0;
          while (pid && guard < 64) {
            guard += 1;
            var p = byId[pid];
            if (!p) { break; }
            p.classList.add('f-ctx');
            pid = p.getAttribute('data-parent-id') || '';
          }
        }
        highlightName(r, ok ? q : '');
      });
      var hide = active && hits === 0;
      section.classList.toggle('f-hide', hide);
      if (hide) { hiddenTraces += 1; }
    });
    var summary = document.getElementById('filter-summary');
    if (summary) {
      summary.textContent = matched === 0
        ? 'No spans match'
        : matched + ' of ' + total + ' span' + (total === 1 ? '' : 's') + ' match' +
          (hiddenTraces > 0 ? ' · ' + hiddenTraces + ' trace' + (hiddenTraces === 1 ? '' : 's') + ' hidden' : '');
    }
    applyTreeVisibility(document);
    save();
  }

  // ── Keyboard navigation ──────────────────────────────────────────────────
  function visibleHeaders() {
    return $all('.trace-header, .obs-header').filter(function (h) { return h.offsetParent !== null; });
  }

  function focusHeader(el) {
    if (!el) { return; }
    $all('.trace-header, .obs-header').forEach(function (h) { h.setAttribute('tabindex', '-1'); });
    el.setAttribute('tabindex', '0');
    el.focus();
    if (el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); }
  }

  function headerRow(header) { return up(header, '.obs-row'); }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (typing) {
      if (e.key === 'Escape' && t === filterInput) {
        state.q = ''; filterInput.value = ''; applyFilter(); filterInput.blur();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) { return; }
    if (e.key === '/') { e.preventDefault(); if (filterInput) { filterInput.focus(); filterInput.select(); } return; }

    var header = up(t, '.obs-header, .trace-header');
    if (!header) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var first = visibleHeaders()[0];
        if (first) { e.preventDefault(); focusHeader(first); }
      }
      return;
    }
    var list = visibleHeaders();
    var idx = list.indexOf(header);
    var row = headerRow(header);
    var section = up(header, '.trace-section');

    if (e.key === 'ArrowDown') { e.preventDefault(); focusHeader(list[Math.min(list.length - 1, idx + 1)]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusHeader(list[Math.max(0, idx - 1)]); }
    else if (e.key === 'Home') { e.preventDefault(); focusHeader(list[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusHeader(list[list.length - 1]); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (row) {
        if (row.classList.contains('has-children') && !row.classList.contains('tree-collapsed') && !isFiltering()) {
          setTreeCollapsed(row, true); touch(row); reportUiState(); save();
        } else {
          var pid = row.getAttribute('data-parent-id');
          var parentRow = pid ? $all('.obs-row', section).filter(function (r) { return r.getAttribute('data-observation-id') === pid; })[0] : null;
          focusHeader(parentRow ? parentRow.querySelector('.obs-header') : section.querySelector('.trace-header'));
        }
      } else if (!section.classList.contains('collapsed')) {
        setTraceCollapsed(section, true); save();
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (row) {
        if (row.classList.contains('tree-collapsed')) { setTreeCollapsed(row, false); touch(row); reportUiState(); save(); }
        else if (list[idx + 1] && headerRow(list[idx + 1]) && headerRow(list[idx + 1]).getAttribute('data-parent-id') === row.getAttribute('data-observation-id')) {
          focusHeader(list[idx + 1]);
        }
      } else if (section.classList.contains('collapsed')) {
        setTraceCollapsed(section, false); save();
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (t !== header) { return; }
      e.preventDefault();
      if (row) { toggleDetail(row); }
      else { setTraceCollapsed(section, !section.classList.contains('collapsed')); touch(null, section); reportUiState(); save(); }
    } else if (e.key === 'c') {
      var btn = row ? row.querySelector('.obs-export-btn') : section.querySelector('.trace-chat-btn');
      if (btn) { btn.click(); }
    }
  });

  // ── Clicks ───────────────────────────────────────────────────────────────
  function flashCopied(el, label) {
    el.classList.add('copied');
    var prev = el.getAttribute('data-label') || el.textContent;
    el.setAttribute('data-label', prev);
    if (label) { el.textContent = label; }
    setTimeout(function () { el.classList.remove('copied'); el.textContent = prev; }, 1200);
  }

  function copyText(text, done) {
    if (text && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el;

    if ((el = up(t, '.obs-export-btn, .detail-export-btn'))) {
      e.preventDefault(); e.stopPropagation();
      var traceId = el.getAttribute('data-trace-id');
      var observationId = el.getAttribute('data-observation-id');
      if (traceId && observationId) {
        el.classList.add('exporting');
        vscode.postMessage({ command: 'exportSpan', traceId: traceId, observationId: observationId });
      }
      return;
    }
    if ((el = up(t, '.trace-chat-btn'))) {
      e.preventDefault(); e.stopPropagation();
      var tId = el.getAttribute('data-trace-id');
      if (tId) { el.classList.add('exporting'); vscode.postMessage({ command: 'exportTrace', traceId: tId }); }
      return;
    }
    if ((el = up(t, '#btn-send-session-chat'))) {
      el.classList.add('exporting');
      vscode.postMessage({ command: 'exportSession' });
      return;
    }
    if ((el = up(t, '.ext-link'))) {
      e.preventDefault(); e.stopPropagation();
      var href = el.getAttribute('data-href');
      if (href) { vscode.postMessage({ command: 'openExternal', url: href }); }
      return;
    }
    if ((el = up(t, '#btn-refresh'))) {
      el.classList.add('spinning');
      vscode.postMessage({ command: 'refresh' });
      return;
    }
    if ((el = up(t, '[data-copy-session]'))) {
      var sid = el.getAttribute('data-copy-session');
      copyText(sid, function () { el.classList.add('copied'); setTimeout(function () { el.classList.remove('copied'); }, 1200); });
      return;
    }

    // Filter controls
    if ((el = up(t, '.seg button'))) { state.group = el.getAttribute('data-group') || 'all'; applyFilter(); return; }
    if (up(t, '#btn-clear-filter')) {
      state.q = ''; state.group = 'all'; if (filterInput) { filterInput.value = ''; }
      applyFilter();
      return;
    }
    if (up(t, '#btn-filter-clear-x')) { state.q = ''; filterInput.value = ''; applyFilter(); filterInput.focus(); return; }
    if (up(t, '#btn-expand-all')) {
      $all('.trace-section').forEach(function (s) { setTraceCollapsed(s, false); });
      save();
      return;
    }
    if (up(t, '#btn-collapse-all')) {
      $all('.trace-section').forEach(function (s) { setTraceCollapsed(s, true); });
      save();
      return;
    }

    // Expand / collapse all span details of one trace
    if ((el = up(t, '.trace-ctrl-btn'))) {
      var section = up(el, '.trace-section');
      var expand = el.getAttribute('data-expanded') !== 'true';
      if (section) {
        $all('.obs-row', section).forEach(function (r) {
          if (r.querySelector(':scope > .obs-detail')) { setDetailOpen(r, expand); }
          if (expand) { setTreeCollapsed(r, false); }
        });
        setTraceCollapsed(section, false);
        el.setAttribute('data-expanded', expand ? 'true' : 'false');
        el.title = expand ? 'Collapse all spans in this trace' : 'Expand all spans in this trace';
        touch(null, section);
        reportUiState();
        save();
      }
      e.stopPropagation();
      return;
    }

    // Tree toggle
    if ((el = up(t, '.obs-tree-toggle'))) {
      var treeRow = up(el, '.obs-row');
      if (treeRow) {
        setTreeCollapsed(treeRow, !treeRow.classList.contains('tree-collapsed'));
        touch(treeRow);
        reportUiState();
        save();
      }
      e.stopPropagation();
      return;
    }

    // Formatted / JSON tabs
    if ((el = up(t, '.field-tab'))) {
      var view = el.getAttribute('data-view');
      var bar = up(el, '.field-tabs');
      if (!bar) { return; }
      var fieldId = bar.getAttribute('data-field');
      $all('.field-tab', bar).forEach(function (b) { b.classList.remove('active'); });
      el.classList.add('active');
      var jsonEl = document.getElementById(fieldId + '-json');
      var fmtEl = document.getElementById(fieldId + '-fmt');
      if (jsonEl) { jsonEl.style.display = view === 'json' ? '' : 'none'; }
      if (fmtEl) { fmtEl.style.display = view === 'fmt' ? '' : 'none'; }
      e.stopPropagation();
      return;
    }

    // Copy a field or an id
    if ((el = up(t, '.field-copy-btn'))) {
      var text = el.getAttribute('data-copy') || '';
      var copyField = el.getAttribute('data-copy-field');
      if (copyField) {
        var fmtView = document.getElementById(copyField + '-fmt');
        var jsonView = document.getElementById(copyField + '-json');
        var activeView = (fmtView && fmtView.style.display !== 'none') ? fmtView : jsonView;
        text = activeView ? (activeView.innerText || activeView.textContent || '') : '';
      }
      copyText(text, function () { flashCopied(el, 'Copied'); });
      e.stopPropagation();
      return;
    }

    // Interactive content inside an open detail should not toggle the row
    if (up(t, '.obs-detail, summary, details')) { return; }

    // Rows and headers
    if ((el = up(t, '.obs-header'))) {
      var row = headerRow(el);
      focusHeader(el);
      if (row && !el.classList.contains('no-detail')) { toggleDetail(row); }
      return;
    }
    if ((el = up(t, '.trace-header'))) {
      var sec = up(el, '.trace-section');
      focusHeader(el);
      setTraceCollapsed(sec, !sec.classList.contains('collapsed'));
      touch(null, sec);
      reportUiState();
      save();
      return;
    }
  });

  if (filterInput) {
    filterInput.addEventListener('input', function () { state.q = filterInput.value; applyFilter(); });
  }
  if (content) {
    var scrollTimer = null;
    content.addEventListener('scroll', function () {
      if (scrollTimer) { return; }
      scrollTimer = setTimeout(function () { scrollTimer = null; save(); }, 200);
    });
  }

  // ── Messages from the extension host ─────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.command === 'refreshDone') {
      var btn = document.getElementById('btn-refresh');
      if (btn) { btn.classList.remove('spinning'); }
    }
    if (msg.command === 'exportDone') {
      $all('.exporting').forEach(function (b) { b.classList.remove('exporting'); });
    }
    if (msg.command === 'focusTrace') {
      var idx = typeof msg.index === 'number' ? msg.index : 0;
      var target = $all('.trace-section')[idx];
      if (!target) { return; }
      setTraceCollapsed(target, false);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
      setTimeout(function () { target.classList.remove('flash'); }, 1300);
      touch(null, target);
      reportUiState();
      save();
    }
  });

  // ── "Updated … ago" indicator ────────────────────────────────────────────
  var updatedEl = document.getElementById('updated-at');
  function renderUpdated() {
    if (!updatedEl) { return; }
    var at = parseInt(updatedEl.getAttribute('data-updated') || '0', 10);
    var s = Math.max(0, Math.round((Date.now() - at) / 1000));
    var label;
    if (s < 5) { label = 'just now'; }
    else if (s < 60) { label = s + 's ago'; }
    else if (s < 3600) { label = Math.round(s / 60) + ' min ago'; }
    else { label = Math.round(s / 3600) + ' h ago'; }
    updatedEl.textContent = 'Updated ' + label;
  }
  renderUpdated();
  setInterval(renderUpdated, 5000);

  // ── Restore persisted state ──────────────────────────────────────────────
  (function restore() {
    var sections = $all('.trace-section');
    var known = Array.isArray(saved.knownTraces) ? saved.knownTraces : null;
    var open = Array.isArray(saved.openTraces) ? saved.openTraces : null;
    sections.forEach(function (s, i) {
      var id = s.getAttribute('data-trace-id');
      var collapsed;
      if (known && open && known.indexOf(id) >= 0) { collapsed = open.indexOf(id) < 0; }
      else { collapsed = i !== 0; }
      setTraceCollapsed(s, collapsed);
    });
    var openObs = Array.isArray(saved.openObs) ? saved.openObs : [];
    var collapsedTree = Array.isArray(saved.collapsedTree) ? saved.collapsedTree : [];
    $all('.obs-row').forEach(function (r) {
      var id = r.getAttribute('data-observation-id');
      if (openObs.indexOf(id) >= 0) { setDetailOpen(r, true); }
      if (collapsedTree.indexOf(id) >= 0) { r.classList.add('tree-collapsed'); r.setAttribute('aria-expanded', 'false'); }
    });
    if (filterInput) { filterInput.value = state.q; }
    applyTreeVisibility(document);
    applyFilter();
    if (content && typeof saved.scroll === 'number') { content.scrollTop = saved.scroll; }
  })();
})();
`;
