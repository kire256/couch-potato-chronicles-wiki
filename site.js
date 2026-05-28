let mermaid = null;

async function loadMermaid() {
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    mermaid = mod.default || mod;
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        curve: 'basis'
      },
      securityLevel: 'loose'
    });
    return true;
  } catch (e) {
    console.warn('Mermaid CDN import failed — relationship charts will not render:', e.message);
    return false;
  }
}

const FILTER_RULES = {
  all: () => true,
  family: (label) => /(father|mother|ancestor|spouse|married|guardian|parent|sibling|daughter|son)/i.test(label),
  allies: (label) => /(ally|allies|friends|friendship|childhood friend|childhood friends|supports|support|patron|mentor|guidance|advisor|de facto leader|research partner|protective)/i.test(label),
  enemies: (label) => /(enemy|opposes|oppresses|threatens|abusive|abandons|enslaves|coerces|kidnaps|terrorizes|world-ending threat|serves|arch-nemesis|supplies captives|enslaved by|manipulation)/i.test(label),
  romance: (label) => /(love|romance|spouse|spouses|married)/i.test(label)
};

function setupNavFilter() {
  const filterInput = document.querySelector('#page-filter');
  const links = Array.from(document.querySelectorAll('.nav-link'));

  if (!filterInput || links.length === 0) return;

  filterInput.addEventListener('input', () => {
    const query = filterInput.value.trim().toLowerCase();
    for (const link of links) {
      const match = link.textContent.toLowerCase().includes(query);
      link.parentElement.style.display = match ? '' : 'none';
    }
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseNodeKey(nodeId = '') {
  const match = nodeId.match(/-flowchart-([A-Za-z0-9]+)-\d+$/);
  return match?.[1] ?? '';
}

function parseEdgeKeys(edgeId = '') {
  const cleaned = edgeId.replace(/^.*-L_/, 'L_');
  const match = cleaned.match(/^L_([^_]+)_([^_]+)_\d+$/);
  if (!match) return null;
  return { source: match[1], target: match[2] };
}

function updateFullscreenButton(shell) {
  const button = shell.querySelector('[data-mermaid-action="fullscreen"]');
  if (!button) return;
  const active = document.fullscreenElement === shell;
  shell.classList.toggle('is-fullscreen', active);
  button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
}

function classifyRelationship(labelText = '') {
  for (const [name, matcher] of Object.entries(FILTER_RULES)) {
    if (name === 'all') continue;
    if (matcher(labelText)) return name;
  }
  return 'allies';
}

function attachRelationshipInteractions(shell, state) {
  const svg = shell.querySelector('.mermaid svg');
  if (!svg) return;

  const nodes = Array.from(svg.querySelectorAll('g.node'));
  const edgePaths = Array.from(svg.querySelectorAll('path.flowchart-link[id*="-L_"]'));
  const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel')).filter((label) => {
    const id = label.querySelector('.label')?.getAttribute('data-id');
    return Boolean(id);
  });

  const selectionTitle = shell.querySelector('.mermaid-selection-title');
  const selectionCopy = shell.querySelector('.mermaid-selection-copy');
  const selectionList = shell.querySelector('.mermaid-selection-list');
  const selectionOpen = shell.querySelector('[data-mermaid-open]');
  const filterButtons = Array.from(shell.querySelectorAll('[data-mermaid-filter]'));
  const characterHrefMap = new Map(
    Array.from(shell.querySelectorAll('.mermaid-character-links [data-character-key]')).map((link) => [
      link.getAttribute('data-character-key') || '',
      link.getAttribute('data-character-href') || ''
    ])
  );

  const nodeMap = new Map();
  const adjacency = new Map();

  const getNodeLabel = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  const ensureAdjacency = (key) => {
    if (!adjacency.has(key)) adjacency.set(key, []);
    return adjacency.get(key);
  };

  for (const node of nodes) {
    const key = parseNodeKey(node.id);
    if (!key) continue;
    const href = characterHrefMap.get(getNodeLabel(node)) || '';
    node.dataset.mermaidKey = key;
    if (href) node.dataset.characterHref = href;
    node.classList.add('is-clickable');
    nodeMap.set(key, { node, label: getNodeLabel(node), href });
    ensureAdjacency(key);
  }

  const labelsByEdgeId = new Map();
  for (const label of edgeLabels) {
    const id = label.querySelector('.label')?.getAttribute('data-id');
    const keys = parseEdgeKeys(id || '');
    if (!keys) continue;
    const text = label.textContent.replace(/\s+/g, ' ').trim();
    const category = classifyRelationship(text);
    label.dataset.sourceKey = keys.source;
    label.dataset.targetKey = keys.target;
    label.dataset.category = category;
    labelsByEdgeId.set(id, { label, text, category });
  }

  for (const path of edgePaths) {
    const keys = parseEdgeKeys(path.id);
    if (!keys) continue;
    const edgeId = path.id.replace(/^.*(L_[^\s]+)$/, '$1');
    const labelInfo = labelsByEdgeId.get(edgeId);
    const labelText = labelInfo?.text || '';
    const category = labelInfo?.category || classifyRelationship(labelText);
    path.dataset.sourceKey = keys.source;
    path.dataset.targetKey = keys.target;
    path.dataset.category = category;
    path.dataset.label = labelText;
    ensureAdjacency(keys.source).push({ other: keys.target, label: labelText, category });
    ensureAdjacency(keys.target).push({ other: keys.source, label: labelText, category });
  }

  let activeKey = '';
  state.activeFilter = state.activeFilter || 'all';

  const clearNodeStyles = (node) => {
    for (const rect of node.querySelectorAll('rect.basic, rect.label-container')) {
      rect.style.removeProperty('stroke');
      rect.style.removeProperty('stroke-width');
      rect.style.removeProperty('filter');
    }
  };

  const applyNodeStyles = (node, selected) => {
    const stroke = selected ? '#f59e0b' : '#fde68a';
    const width = selected ? '5px' : '4px';
    for (const rect of node.querySelectorAll('rect.basic, rect.label-container')) {
      rect.style.setProperty('stroke', stroke, 'important');
      rect.style.setProperty('stroke-width', width, 'important');
      rect.style.setProperty('filter', 'drop-shadow(0 0 14px rgba(125, 211, 252, 0.55))');
    }
  };

  const clearPathStyles = (path) => {
    path.style.removeProperty('stroke');
    path.style.removeProperty('stroke-width');
    path.style.removeProperty('filter');
  };

  const applyPathStyles = (path) => {
    path.style.setProperty('stroke', '#fbbf24', 'important');
    path.style.setProperty('stroke-width', '5px', 'important');
    path.style.setProperty('filter', 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.45))');
  };

  const clearLabelStyles = (label) => {
    for (const el of label.querySelectorAll('.labelBkg, rect')) {
      el.style.removeProperty('fill');
      el.style.removeProperty('stroke');
      el.style.removeProperty('stroke-width');
      el.style.removeProperty('rx');
      el.style.removeProperty('ry');
    }
    for (const el of label.querySelectorAll('foreignObject, span, p, div')) {
      el.style.removeProperty('filter');
    }
  };

  const applyLabelStyles = (label) => {
    for (const el of label.querySelectorAll('.labelBkg, rect')) {
      el.style.setProperty('fill', 'rgba(251, 191, 36, 0.18)', 'important');
      el.style.setProperty('stroke', '#fbbf24', 'important');
      el.style.setProperty('stroke-width', '2px', 'important');
      el.style.setProperty('rx', '8');
      el.style.setProperty('ry', '8');
    }
    for (const el of label.querySelectorAll('foreignObject, span, p, div')) {
      el.style.setProperty('filter', 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.3))');
    }
  };

  const passesFilter = (category) => state.activeFilter === 'all' || category === state.activeFilter;

  const setFilterButtons = () => {
    for (const button of filterButtons) {
      const active = button.dataset.mermaidFilter === state.activeFilter;
      button.classList.toggle('is-active', active);
    }
  };

  const renderSelectionPanel = (key) => {
    if (!selectionTitle || !selectionCopy || !selectionList) return;
    if (!key || !nodeMap.has(key)) {
      selectionTitle.textContent = 'No character selected';
      selectionCopy.textContent = 'Click a node to inspect that character\'s visible relationships in this diagram.';
      selectionList.innerHTML = '';
      if (selectionOpen) {
        selectionOpen.hidden = true;
        selectionOpen.removeAttribute('href');
      }
      return;
    }

    const origin = nodeMap.get(key);
    const entries = (adjacency.get(key) || [])
      .filter((entry) => passesFilter(entry.category))
      .sort((a, b) => a.other.localeCompare(b.other));

    selectionTitle.textContent = origin.label;
    selectionCopy.textContent = entries.length
      ? `Showing ${entries.length} visible relationship${entries.length === 1 ? '' : 's'} in this diagram.`
      : 'No visible relationships match the current filter in this diagram.';

    if (selectionOpen && origin.href) {
      selectionOpen.hidden = false;
      selectionOpen.href = origin.href;
    } else if (selectionOpen) {
      selectionOpen.hidden = true;
      selectionOpen.removeAttribute('href');
    }

    selectionList.innerHTML = entries
      .map((entry) => {
        const other = nodeMap.get(entry.other);
        const otherLabel = other?.label || entry.other;
        const otherHtml = other?.href
          ? `<a href="${other.href}">${otherLabel}</a>`
          : otherLabel;
        return `<li><strong>${otherHtml}</strong><span>${entry.label || entry.category}</span></li>`;
      })
      .join('');
  };

  const centerOnNode = (key) => {
    if (shell.dataset.centerOnSelect !== 'true') return;
    const node = nodeMap.get(key)?.node;
    if (!node) return;
    const nodeRect = node.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const nodeCenterX = nodeRect.left + (nodeRect.width / 2);
    const nodeCenterY = nodeRect.top + (nodeRect.height / 2);
    const viewportCenterX = viewportRect.left + (viewportRect.width / 2);
    const viewportCenterY = viewportRect.top + (viewportRect.height / 2);
    const nextX = state.x + (viewportCenterX - nodeCenterX);
    const nextY = state.y + (viewportCenterY - nodeCenterY);
    requestAnimationFrame(() => {
      state.x = nextX;
      state.y = nextY;
      state.applyTransform();
    });
  };

  const clearSelection = () => {
    activeKey = '';
    svg.classList.remove('has-selection');
    renderSelectionPanel('');
    for (const node of nodes) {
      node.classList.remove('is-related', 'is-selected', 'is-dimmed', 'is-filtered-out');
      clearNodeStyles(node);
    }
    for (const path of edgePaths) {
      path.classList.remove('is-related', 'is-dimmed', 'is-filtered-out');
      clearPathStyles(path);
      path.style.display = passesFilter(path.dataset.category || 'allies') ? '' : 'none';
    }
    for (const label of edgeLabels) {
      label.classList.remove('is-related', 'is-dimmed', 'is-filtered-out');
      clearLabelStyles(label);
      label.style.display = passesFilter(label.dataset.category || 'allies') ? '' : 'none';
    }
  };

  const applySelection = (key) => {
    activeKey = key;
    svg.classList.add('has-selection');
    renderSelectionPanel(key);

    const visibleEdges = edgePaths.filter((path) => passesFilter(path.dataset.category || 'allies'));
    const visibleNodeKeys = new Set([key]);
    for (const path of visibleEdges) {
      visibleNodeKeys.add(path.dataset.sourceKey || '');
      visibleNodeKeys.add(path.dataset.targetKey || '');
    }

    for (const node of nodes) {
      const nodeKey = node.dataset.mermaidKey || '';
      const connected = visibleEdges.some((path) => (
        (path.dataset.sourceKey === key && path.dataset.targetKey === nodeKey) ||
        (path.dataset.targetKey === key && path.dataset.sourceKey === nodeKey) ||
        nodeKey === key
      ));
      const selected = nodeKey === key;
      const visible = visibleNodeKeys.has(nodeKey);
      node.classList.toggle('is-selected', selected);
      node.classList.toggle('is-related', connected);
      node.classList.toggle('is-dimmed', visible && !connected);
      node.classList.toggle('is-filtered-out', !visible);
      node.style.display = visible ? '' : 'none';
      clearNodeStyles(node);
      if (connected) {
        applyNodeStyles(node, selected);
      }
    }

    for (const path of edgePaths) {
      const visible = passesFilter(path.dataset.category || 'allies');
      const related = visible && (path.dataset.sourceKey === key || path.dataset.targetKey === key);
      path.classList.toggle('is-related', related);
      path.classList.toggle('is-dimmed', visible && !related);
      path.classList.toggle('is-filtered-out', !visible);
      path.style.display = visible ? '' : 'none';
      clearPathStyles(path);
      if (related) {
        applyPathStyles(path);
      }
    }

    for (const label of edgeLabels) {
      const visible = passesFilter(label.dataset.category || 'allies');
      const related = visible && (label.dataset.sourceKey === key || label.dataset.targetKey === key);
      label.classList.toggle('is-related', related);
      label.classList.toggle('is-dimmed', visible && !related);
      label.classList.toggle('is-filtered-out', !visible);
      label.style.display = visible ? '' : 'none';
      clearLabelStyles(label);
      if (related) {
        applyLabelStyles(label);
      }
    }

    centerOnNode(key);
  };

  const findNodeKeyFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const entry of path) {
      if (!(entry instanceof Element)) continue;
      if (entry instanceof SVGGElement && entry.matches('g.node[data-mermaid-key]')) {
        return entry.dataset.mermaidKey || '';
      }
      const parentNode = entry.closest?.('g.node[data-mermaid-key]');
      if (parentNode) {
        return parentNode.dataset.mermaidKey || '';
      }
    }
    const fallbackNode = event.target instanceof Element
      ? event.target.closest?.('g.node[data-mermaid-key]')
      : null;
    return fallbackNode?.dataset.mermaidKey || '';
  };

  svg.addEventListener('click', (event) => {
    const key = findNodeKeyFromEvent(event);
    if (!key) {
      clearSelection();
      return;
    }
    event.stopPropagation();
    if (activeKey === key) {
      const href = nodeMap.get(key)?.href;
      if (href) {
        window.location.href = href;
        return;
      }
      clearSelection();
      return;
    }
    applySelection(key);
  });

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      state.activeFilter = button.dataset.mermaidFilter || 'all';
      setFilterButtons();
      if (activeKey) {
        applySelection(activeKey);
      } else {
        clearSelection();
      }
    });
  }

  setFilterButtons();
  clearSelection();
}

function attachMermaidViewer(shell) {
  const viewport = shell.querySelector('.mermaid-viewport');
  const diagramRoot = shell.querySelector('.mermaid');
  if (!viewport || !diagramRoot) return;

  const state = {
    scale: 1,
    minScale: 0.45,
    maxScale: 2.8,
    x: 24,
    y: 24,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    activeFilter: 'all',
    applyTransform: () => {}
  };

  shell.dataset.scale = String(state.scale);

  const applyTransform = () => {
    diagramRoot.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    shell.dataset.scale = state.scale.toFixed(2);
  };
  state.applyTransform = applyTransform;

  const setScale = (nextScale, anchorX = viewport.clientWidth / 2, anchorY = viewport.clientHeight / 2) => {
    const clamped = clamp(nextScale, state.minScale, state.maxScale);
    const ratio = clamped / state.scale;
    state.x = anchorX - (anchorX - state.x) * ratio;
    state.y = anchorY - (anchorY - state.y) * ratio;
    state.scale = clamped;
    applyTransform();
  };

  const reset = () => {
    state.scale = 1;
    state.x = 24;
    state.y = 24;
    applyTransform();
  };

  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, g.node')) return;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.originX = state.x;
    state.originY = state.y;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.x = state.originX + (event.clientX - state.startX);
    state.y = state.originY + (event.clientY - state.startY);
    applyTransform();
  });

  const stopDragging = (event) => {
    if (state.pointerId !== null && event.pointerId === state.pointerId) {
      viewport.releasePointerCapture(event.pointerId);
    }
    state.dragging = false;
    state.pointerId = null;
    viewport.classList.remove('is-dragging');
  };

  viewport.addEventListener('pointerup', stopDragging);
  viewport.addEventListener('pointercancel', stopDragging);
  viewport.addEventListener('pointerleave', (event) => {
    if (state.dragging && event.pointerId === state.pointerId) {
      stopDragging(event);
    }
  });

  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const delta = event.deltaY < 0 ? 1.12 : 0.88;
    setScale(state.scale * delta, anchorX, anchorY);
  }, { passive: false });

  shell.querySelector('[data-mermaid-action="zoom-in"]')?.addEventListener('click', () => {
    setScale(state.scale * 1.15);
  });

  shell.querySelector('[data-mermaid-action="zoom-out"]')?.addEventListener('click', () => {
    setScale(state.scale * 0.87);
  });

  shell.querySelector('[data-mermaid-action="reset"]')?.addEventListener('click', reset);

  shell.querySelector('[data-mermaid-action="fullscreen"]')?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen request failed', error);
    } finally {
      updateFullscreenButton(shell);
    }
  });

  document.addEventListener('fullscreenchange', () => updateFullscreenButton(shell));

  reset();
  updateFullscreenButton(shell);
  attachRelationshipInteractions(shell, state);
}

async function renderMermaid() {
  const shells = Array.from(document.querySelectorAll('[data-mermaid-viewer]'));
  if (shells.length === 0 || !mermaid) return;

  for (const shell of shells) {
    const block = shell.querySelector('pre.mermaid');
    if (!block) continue;
    block.removeAttribute('data-processed');
  }

  await mermaid.run({ querySelector: 'pre.mermaid' });

  for (const shell of shells) {
    attachMermaidViewer(shell);
  }
}

function slugifyTimelineValue(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'timeline-group';
}

function escapeTimelineHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setupTimelineShell(shell) {
  const dataNode = shell.querySelector('[data-timeline-data]');
  const list = shell.querySelector('[data-timeline-list]');
  const jumpBar = shell.querySelector('[data-timeline-jump]');
  const searchInput = shell.querySelector('[data-timeline-search]');
  const rangeNode = shell.querySelector('[data-timeline-range]');
  const filterButtons = Array.from(shell.querySelectorAll('[data-timeline-filter]'));

  if (!dataNode || !list || !jumpBar) return;

  // Build entity lookup: name -> slug
  const entityLookup = new Map();
  const entityScript = document.querySelector('[data-entity-index]');
  if (entityScript) {
    try {
      const records = JSON.parse(entityScript.textContent || '[]');
      for (const rec of records) {
        entityLookup.set(rec.label.toLowerCase(), rec.slug);
        // Also index by the primary name (before any parenthetical/alias part)
        const primary = rec.label.split('(')[0].split('/')[0].trim().toLowerCase();
        if (primary) entityLookup.set(primary, rec.slug);
      }
    } catch (e) { /* ignore */ }
  }

  function linkEntity(name) {
    const slug = entityLookup.get(name.toLowerCase());
    if (slug) {
      return `<a href="./${slug}.html" class="timeline-entity-link">${escapeTimelineHtml(name)}</a>`;
    }
    return escapeTimelineHtml(name);
  }

  let payload = null;
  try {
    payload = JSON.parse(dataNode.textContent || '{}');
  } catch (error) {
    console.warn('Timeline data parse failed', error);
    list.innerHTML = '<div class="timeline-empty-state"><p class="timeline-empty-title">Timeline data could not be parsed.</p><p class="timeline-empty-copy">Check the JSON embedded in timeline.md.</p></div>';
    return;
  }

  const events = Array.isArray(payload.events)
    ? [...payload.events].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    : [];

  const state = {
    activeFilter: 'all',
    query: ''
  };

  const matchesFilter = (event) => state.activeFilter === 'all' || event.category === state.activeFilter;
  const matchesQuery = (event) => {
    if (!state.query) return true;
    const haystack = [
      event.when,
      event.era,
      event.title,
      event.summary,
      ...(event.details ?? []),
      ...(event.characters ?? []),
      ...(event.locations ?? []),
      ...(event.tags ?? []),
      ...(event.references ?? [])
    ].join(' ').toLowerCase();
    return haystack.includes(state.query);
  };

  const getVisibleEvents = () => events.filter((event) => matchesFilter(event) && matchesQuery(event));

  const renderJumpBar = (visibleEvents) => {
    const groups = [];
    for (const event of visibleEvents) {
      const key = event.era || 'Timeline';
      if (!groups.some((group) => group.key === key)) {
        groups.push({ key, anchor: `timeline-era-${slugifyTimelineValue(key)}` });
      }
    }

    jumpBar.innerHTML = groups.length
      ? groups.map((group) => `<button type="button" class="timeline-jump-btn" data-jump-target="${group.anchor}">${escapeTimelineHtml(group.key)}</button>`).join('')
      : '<span class="timeline-jump-empty">No eras match the current filters.</span>';

    for (const button of jumpBar.querySelectorAll('[data-jump-target]')) {
      button.addEventListener('click', () => {
        const target = shell.querySelector(`#${button.dataset.jumpTarget}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const renderSummary = (visibleEvents) => {
    if (!rangeNode) return;
    if (visibleEvents.length === 0) {
      rangeNode.textContent = 'No chronology entries match the current search/filter state.';
      return;
    }
    const first = visibleEvents[0];
    const last = visibleEvents[visibleEvents.length - 1];
    rangeNode.textContent = `Showing ${visibleEvents.length} event${visibleEvents.length === 1 ? '' : 's'} from ${first.when} through ${last.when}.`;
  };

  const renderList = (visibleEvents) => {
    if (visibleEvents.length === 0) {
      list.innerHTML = '<div class="timeline-empty-state"><p class="timeline-empty-title">No matching events</p><p class="timeline-empty-copy">Try clearing the search box or switching back to All events.</p></div>';
      return;
    }

    let currentEra = '';
    const markup = [];
    for (const event of visibleEvents) {
      if (event.era !== currentEra) {
        currentEra = event.era || 'Timeline';
        markup.push(`
          <section class="timeline-era-group" id="timeline-era-${slugifyTimelineValue(currentEra)}">
            <div class="timeline-era-heading">
              <p class="timeline-era-kicker">Jump point</p>
              <h2>${escapeTimelineHtml(currentEra)}</h2>
            </div>
        `);
      }

      const whenParts = [];
      if (event.era) whenParts.push(`<span class="timeline-when-era">${escapeTimelineHtml(event.era)}</span>`);
      if (event.date) whenParts.push(`<span class="timeline-when-date">${escapeTimelineHtml(event.date)}</span>`);
      if (event.timeOfDay) whenParts.push(`<span class="timeline-when-time">${escapeTimelineHtml(event.timeOfDay)}</span>`);
      const whenBlock = whenParts.length
        ? `<div class="timeline-when-block">${whenParts.join('')}</div>`
        : '';

      const chips = [
        `<span class="timeline-chip timeline-chip--${escapeTimelineHtml(event.category || 'story-event')}">${escapeTimelineHtml(event.category === 'world-history' ? 'World history' : 'Story event')}</span>`,
        ...(event.tags ?? []).slice(0, 4).map((tag) => `<span class="timeline-chip">${escapeTimelineHtml(tag)}</span>`)
      ].join('');

      const meta = [
        ...(event.characters?.length ? [`<li><strong>Characters:</strong> ${event.characters.map(linkEntity).join(', ')}</li>`] : []),
        ...(event.locations?.length ? [`<li><strong>Locations:</strong> ${event.locations.map(linkEntity).join(', ')}</li>`] : []),
        ...(event.references?.length ? [`<li><strong>References:</strong> ${event.references.map(escapeTimelineHtml).join(' · ')}</li>`] : [])
      ].join('');

      markup.push(`
        <article class="timeline-entry timeline-entry--${escapeTimelineHtml(event.category || 'story-event')}" data-timeline-entry>
          <div class="timeline-entry-rail">
            <span class="timeline-entry-dot" aria-hidden="true"></span>
          </div>
          <details class="timeline-card" ${visibleEvents.length <= 3 ? 'open' : ''}>
            <summary class="timeline-card-summary">
              <div>
                <p class="timeline-card-when">${escapeTimelineHtml(event.when || '')}</p>
                ${whenBlock}
                <h3>${escapeTimelineHtml(event.title || 'Untitled event')}</h3>
              </div>
              <div class="timeline-card-chips">${chips}</div>
            </summary>
            <div class="timeline-card-body">
              <p class="timeline-card-copy">${escapeTimelineHtml(event.summary || '')}</p>
              ${(event.details ?? []).length ? `<ul class="timeline-detail-list">${event.details.map((detail) => `<li>${escapeTimelineHtml(detail)}</li>`).join('')}</ul>` : ''}
              ${meta ? `<ul class="timeline-meta-list">${meta}</ul>` : ''}
            </div>
          </details>
        </article>
      `);
    }

    list.innerHTML = markup.join('') + '</section>';
  };

  const syncFilterButtons = () => {
    for (const button of filterButtons) {
      const active = button.dataset.timelineFilter === state.activeFilter;
      button.classList.toggle('is-active', active);
      button.classList.toggle('timeline-btn--ghost', active);
    }
  };

  const render = () => {
    const visibleEvents = getVisibleEvents();
    syncFilterButtons();
    renderSummary(visibleEvents);
    renderJumpBar(visibleEvents);
    renderList(visibleEvents);
  };

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      state.activeFilter = button.dataset.timelineFilter || 'all';
      render();
    });
  }

  searchInput?.addEventListener('input', () => {
    state.query = searchInput.value.trim().toLowerCase();
    render();
  });

  render();
}

function setupTimelineShells() {
  const shells = Array.from(document.querySelectorAll('[data-timeline-shell]'));
  for (const shell of shells) {
    setupTimelineShell(shell);
  }
}

function setupLightbox() {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = '<img class="lightbox-img" src="" alt=""><button class="lightbox-close" aria-label="Close">&times;</button>';
  document.body.appendChild(overlay);

  const img = overlay.querySelector('.lightbox-img');

  function open(src, alt) {
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    img.src = '';
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('lightbox-close')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });

  document.addEventListener('click', (e) => {
    const picture = e.target.closest('.article-card p > img[src^="art/"]');
    if (!picture) return;
    e.preventDefault();
    open(picture.src, picture.alt);
  });
}

async function boot() {
  setupNavFilter();
  setupTimelineShells();
  setupLightbox();
  await loadMermaid();
  await renderMermaid();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
