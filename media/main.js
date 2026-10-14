// @ts-check
//
// The sidebar app. Runs in the webview, so it shares no code with the extension
// host — it talks to it only through postMessage.
//
// Everything user-supplied (parameter keys, values, error text) is written with
// textContent or via createElement, never innerHTML: Remote Config values come
// from a remote service and must not be able to inject markup here.

(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const root = /** @type {HTMLElement} */ (document.getElementById('root'));

	const KEY_REGEX = /^[a-zA-Z0-9_]+$/;
	// Group names are console display labels, not identifiers, so spaces are fine.
	const GROUP_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_ -]*$/;
	const VALUE_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'];

	/** Latest state pushed by the host. */
	let state = /** @type {any} */ ({ kind: 'busy', message: 'Loading…' });

	// ---- navigation; survives host state updates and is persisted
	let selectedKey = /** @type {string|null} */ (null);
	let search = '';
	/** null is "All". */
	let typeFilter = /** @type {string|null} */ (null);
	/** Group names the user has collapsed; '' is the root section. */
	let collapsed = /** @type {string[]} */ ([]);

	/** The built workspace while the state is ready; null otherwise. */
	let ws = /** @type {any} */ (null);
	/** The open editor, or null while nothing is selected. */
	let editor = /** @type {any} */ (null);
	/**
	 * The Batch Push view. Kept once built, so leaving it to look at a
	 * parameter and coming back does not lose a half-typed entry or import.
	 */
	let composer = /** @type {any} */ (null);
	/**
	 * A full-page view over the list — 'create' (New parameter) or 'batch'
	 * (Batch Push) — or null while the list is showing. Opening one keeps
	 * `selectedKey`, so Back returns to the same parameter.
	 */
	let page = /** @type {null|'create'|'batch'} */ (null);
	/** Last batch push outcome, shown in the batch bar until the batch changes. */
	let batchMessage = /** @type {{status: string, text: string}|null} */ (null);
	let lastStagedCount = 0;

	// ---------- tiny DOM helpers ----------

	/**
	 * @param {string} tag
	 * @param {Record<string, any>} [props]
	 * @param {(Node|string|null|false|undefined)[]} [children]
	 */
	function el(tag, props, children) {
		const node = document.createElement(tag);
		for (const [name, value] of Object.entries(props || {})) {
			if (value === undefined || value === false || value === null) {
				continue;
			}
			if (name === 'class') {
				node.className = value;
			} else if (name === 'text') {
				node.textContent = value;
			} else if (name.startsWith('on')) {
				node.addEventListener(name.slice(2), value);
			} else {
				node.setAttribute(name, value === true ? '' : String(value));
			}
		}
		for (const child of children || []) {
			if (child === null || child === undefined || child === false) {
				continue;
			}
			node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
		}
		return node;
	}

	/** Static line icons, drawn with stroke="currentColor" so they follow the theme. */
	const ICONS = {
		plus: 'M12 5v14M5 12h14',
		refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
		gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
		search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
		chevron: 'M6 9l6 6 6-6',
		upload: 'M12 15V4M7 9l5-5 5 5M5 20h14',
		back: 'M15 18l-6-6 6-6',
		stack: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
		close: 'M6 6l12 12M18 6L6 18'
	};

	/** @param {keyof typeof ICONS} name */
	function icon(name) {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('class', 'icon');
		svg.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute('d', ICONS[name]);
		svg.appendChild(path);
		return svg;
	}

	/** @param {string} valueType */
	function typeLabel(valueType) {
		return valueType === 'JSON' ? 'JSON' : valueType.charAt(0) + valueType.slice(1).toLowerCase();
	}

	/** @param {(Node|null|false)[]} nodes */
	function replaceRoot(nodes) {
		root.textContent = '';
		for (const node of nodes) {
			if (node) {
				root.appendChild(node);
			}
		}
	}

	function persist() {
		vscode.setState({ selectedKey, search, typeFilter, collapsed });
	}

	// ---------- model ----------

	/**
	 * A parameter as the panel shows it: what Firebase holds, overlaid with
	 * whatever is waiting in the batch. `remote` is null for a parameter that
	 * only exists in the batch so far.
	 */
	function itemsOf(sections, staged) {
		const stagedByKey = new Map(staged.map(c => [c.key, c]));
		const remote = sections.flatMap(s => s.entries);
		const remoteKeys = new Set(remote.map(e => e.key));
		const toItem = (r, s) => ({
			remote: r,
			staged: s,
			key: r ? r.key : s.key,
			group: r ? r.group : s.group,
			valueType: s ? s.valueType : r.valueType,
			value: s ? s.value : r.value,
			isNew: !r
		});
		return remote
			.map(r => toItem(r, stagedByKey.get(r.key) || null))
			.concat(staged.filter(s => !remoteKeys.has(s.key)).map(s => toItem(null, s)));
	}

	function currentItems() {
		return state.kind === 'ready' ? itemsOf(state.sections, state.staged || []) : [];
	}

	/** @param {string|null} key */
	function findItem(key) {
		return key === null ? null : currentItems().find(i => i.key === key) || null;
	}

	/**
	 * Mirrors src/validation.ts for instant feedback. The host re-validates
	 * before it calls Firebase, so this copy is convenience, not security.
	 */
	function validate(key, value, valueType, group) {
		if (key === '') { return { field: 'key', message: 'Key is required' }; }
		if (!KEY_REGEX.test(key)) { return { field: 'key', message: 'Use only letters, numbers, and underscores' }; }
		if (group !== '' && !GROUP_REGEX.test(group)) {
			return { field: 'group', message: 'Use letters, numbers, spaces, underscores, and hyphens' };
		}
		if (value === '') { return { field: 'value', message: 'Value is required' }; }
		if (valueType === 'NUMBER' && (value.trim() === '' || isNaN(Number(value)))) {
			return { field: 'value', message: 'Must be a valid number' };
		}
		if (valueType === 'JSON') {
			let parsed;
			try {
				parsed = JSON.parse(value);
			} catch (err) {
				return { field: 'value', message: 'Invalid JSON: ' + err.message };
			}
			// `false`, `42` and `"hi"` parse too, but belong in their own types.
			if (typeof parsed !== 'object' || parsed === null) {
				return { field: 'value', message: 'JSON must be an object {…} or an array […]' };
			}
		}
		return null;
	}

	/** Booleans are stored lower-case; matches normalizeValue() on the host. */
	function normalize(value, valueType) {
		return valueType === 'BOOLEAN' ? value.toLowerCase().trim() : value;
	}

	// ---------- placeholder screens ----------

	function renderPlaceholder(body) {
		// An open page — New parameter or Batch Push — outlives a reload; only
		// its host element goes. The list's editor is rebuilt from selectedKey.
		ws = null;
		if (page !== 'create') {
			editor = null;
		}
		replaceRoot([el('div', { class: 'placeholder' }, body)]);
	}

	function renderNoAccount() {
		renderPlaceholder([
			el('p', {
				text:
					'Select a Firebase service account JSON file to connect this workspace to a Remote Config project.'
			}),
			el('button', {
				class: 'primary',
				text: 'Select service account…',
				onclick: () => vscode.postMessage({ type: 'selectAccount' })
			})
		]);
	}

	function renderBusy() {
		renderPlaceholder([el('div', { class: 'spinner' }), el('p', { text: state.message })]);
	}

	function renderError() {
		renderPlaceholder([
			el('p', { class: 'error-detail', text: state.message }),
			el('button', {
				class: 'primary',
				text: 'Retry',
				onclick: () => vscode.postMessage({ type: 'refresh' })
			}),
			el('p', { style: 'margin-top:12px' }, [
				el('button', {
					class: 'link',
					text: state.hasAccount ? 'Use a different service account' : 'Select a service account',
					onclick: () => vscode.postMessage({ type: 'selectAccount' })
				})
			])
		]);
	}

	// ---------- workspace ----------

	/**
	 * Builds the connected screen once. Later state updates patch it in place,
	 * so the search box keeps focus and the editor keeps what the user typed.
	 */
	function buildWorkspace() {
		const projectName = el('span', { class: 'project-name' });
		const menu = el('div', { class: 'menu', role: 'menu', hidden: true }, [
			el('button', {
				role: 'menuitem',
				text: 'Use a different service account…',
				onclick: () => { closeMenu(); vscode.postMessage({ type: 'selectAccount' }); }
			}),
			el('button', {
				role: 'menuitem',
				text: 'Disconnect',
				onclick: () => { closeMenu(); vscode.postMessage({ type: 'clearAccount' }); }
			})
		]);
		const projectChip = el('button', {
			class: 'project-chip',
			'aria-haspopup': 'menu',
			onclick: event => {
				event.stopPropagation();
				menu.hidden = !menu.hidden;
			}
		}, [el('span', { class: 'dot' }), projectName, icon('chevron')]);

		const topbar = el('header', { class: 'topbar' }, [
			el('span', { class: 'eyebrow', text: 'Active project' }),
			el('div', { class: 'project' }, [projectChip, menu]),
			el('button', {
				class: 'icon-btn',
				title: 'Reload from Firebase',
				'aria-label': 'Reload from Firebase',
				onclick: () => vscode.postMessage({ type: 'refresh' })
			}, [icon('refresh')]),
			el('button', {
				class: 'icon-btn',
				title: 'Firebase Push settings',
				'aria-label': 'Firebase Push settings',
				onclick: () => vscode.postMessage({ type: 'openSettings' })
			}, [icon('gear')])
		]);

		const searchInput = el('input', {
			type: 'search',
			placeholder: 'Search configs…',
			'aria-label': 'Search configs',
			spellcheck: 'false',
			value: search,
			oninput: event => {
				search = event.target.value;
				persist();
				renderCards();
			},
			onkeydown: event => {
				// Down from the search box moves into the results.
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					const first = cards.querySelector('.card');
					if (first) { first.focus(); }
				}
			}
		});

		// Full width, straight under the search box, so creating one parameter
		// or many is always in plain sight rather than tucked into a small icon.
		const newButton = el('div', { class: 'new-row' }, [
			el('button', { class: 'primary', onclick: () => openCreate() }, [icon('plus'), 'New parameter']),
			el('button', { class: 'secondary', onclick: () => openComposer() }, [icon('stack'), 'Batch Push'])
		]);

		const chips = el('div', { class: 'chips', role: 'tablist', 'aria-label': 'Filter by type' },
			[null].concat(VALUE_TYPES).map(type =>
				el('button', {
					class: 'chip',
					role: 'tab',
					'data-type': type || '',
					text: type ? typeLabel(type) : 'All',
					onclick: () => {
						typeFilter = type;
						persist();
						renderCards();
					}
				})
			)
		);

		const cards = el('div', { class: 'cards', role: 'listbox', 'aria-label': 'Parameters' });
		cards.addEventListener('keydown', event => {
			const all = /** @type {HTMLElement[]} */ (Array.from(cards.querySelectorAll('.card, .group-head')));
			const focused = /** @type {HTMLElement} */ (document.activeElement);
			const index = all.indexOf(focused);
			// Left/Right close and open a group, as in a tree.
			if (focused.classList.contains('group-head') &&
				(event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
				const open = focused.getAttribute('aria-expanded') === 'true';
				if (open === (event.key === 'ArrowLeft')) {
					event.preventDefault();
					focused.click();
				}
				return;
			}
			if (event.key === 'ArrowDown' && index < all.length - 1) {
				event.preventDefault();
				all[index + 1].focus();
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				if (index > 0) { all[index - 1].focus(); } else { searchInput.focus(); }
			}
		});

		const hint = el('p', { class: 'list-hint', text: 'Select a parameter to view and edit it' });

		const browser = el('section', { class: 'browser' }, [
			el('div', { class: 'search-row' }, [
				el('label', { class: 'search-box' }, [icon('search'), searchInput])
			]),
			newButton,
			chips,
			hint,
			cards
		]);

		const detail = el('section', { class: 'detail' });

		const batchBar = el('div', { class: 'batch-bar', hidden: true });

		// New parameter and Batch Push open here, over the list, with a way back.
		const pageBody = el('div', { class: 'page-body' });
		const pageView = el('section', { class: 'page', hidden: true }, [
			el('div', { class: 'page-bar' }, [
				el('button', { class: 'back', onclick: () => closePage() }, [icon('back'), 'Back'])
			]),
			pageBody
		]);

		const split = el('div', { class: 'split' }, [browser, detail]);
		const workspace = el('div', { class: 'workspace' }, [topbar, split, pageView, batchBar]);
		replaceRoot([workspace]);

		return { projectName, projectChip, chips, hint, cards, split, detail, page: pageView, pageBody, batchBar };
	}

	function updateWorkspace() {
		ws.projectName.textContent = state.projectId;
		ws.projectChip.title = state.accountPath;
		ws.projectChip.setAttribute('aria-label', 'Active project: ' + state.projectId);

		// Keep the editor on its parameter: patch it with the newer copy, or
		// fall back to the empty state if it is gone (removed upstream, or
		// unstaged before it was ever pushed).
		if (page !== null) {
			// After a reload the workspace is rebuilt; put the open page back.
			const pageRoot = page === 'batch' ? composer.root : editor.root;
			if (pageRoot.parentNode !== ws.pageBody) {
				showPage(page, pageRoot);
			}
			if (page === 'batch') {
				composer.sync();
			}
		} else if (editor) {
			const item = findItem(editor.key);
			if (item) {
				editor.sync(item);
			} else {
				selectedKey = null;
				persist();
				showEmpty();
			}
		} else if (!editor) {
			const item = findItem(selectedKey);
			if (item) { openEditor(item); } else { showEmpty(); }
		}

		renderCards();
		renderBatchBar();
	}

	/**
	 * Groups items into the sections the list shows: root parameters first, then
	 * each group in the order the host sorted them. A staged new parameter in a
	 * group that does not exist yet gets a section of its own at the end.
	 */
	function sectionsOf(items) {
		const sections = state.sections.map(s => ({ group: s.group || '', description: s.description, items: [] }));
		const byName = new Map(sections.map(s => [s.group, s]));
		for (const item of items) {
			const name = item.group || '';
			let section = byName.get(name);
			if (!section) {
				section = { group: name, description: undefined, items: [] };
				byName.set(name, section);
				sections.push(section);
			}
			section.items.push(item);
		}
		return sections;
	}

	function renderCards() {
		const items = currentItems();
		const needle = search.trim().toLowerCase();
		const filtering = needle !== '' || typeFilter !== null;
		const matches = item =>
			(typeFilter === null || item.valueType === typeFilter) &&
			(needle === '' ||
				item.key.toLowerCase().includes(needle) ||
				(item.group || '').toLowerCase().includes(needle));

		for (const chip of ws.chips.querySelectorAll('.chip')) {
			const type = chip.getAttribute('data-type') || null;
			const selected = type === typeFilter;
			chip.classList.toggle('selected', selected);
			chip.setAttribute('aria-selected', String(selected));
			const count = type ? items.filter(i => i.valueType === type).length : items.length;
			chip.title = `${count} parameter${count === 1 ? '' : 's'}`;
		}

		ws.cards.textContent = '';
		let shown = 0;
		for (const section of sectionsOf(items)) {
			const visible = section.items.filter(matches);
			// A filter that matches nothing in a group hides the group entirely.
			if (filtering && visible.length === 0) {
				continue;
			}
			shown += visible.length;
			// While filtering, every matching group is open regardless of what the
			// user collapsed — otherwise a hit can hide inside a closed group.
			const open = filtering || !collapsed.includes(section.group);
			// A folded tile drops its body rather than hiding it, so the card
			// shrinks to just the header instead of leaving a stub of padding.
			ws.cards.appendChild(el('div', { class: 'tile' }, [
				groupHead(section, visible.length, open),
				open && el('div', { class: 'tile-body' },
					visible.length === 0
						? [el('div', { class: 'group-empty', text: 'No parameters' })]
						: visible.map(card))
			]));
		}

		if (shown === 0 && (filtering || items.length === 0)) {
			ws.cards.appendChild(el('div', { class: 'empty-note' }, [
				items.length === 0 ? 'This project has no parameters yet. ' : 'No parameters match.',
				items.length === 0 && el('button', { class: 'link', text: 'Create one', onclick: () => openCreate() })
			]));
		}
	}

	function groupHead(section, count, open) {
		return el('button', {
			class: 'group-head',
			'aria-expanded': String(open),
			title: section.description || undefined,
			onclick: () => {
				collapsed = open
					? collapsed.concat(section.group)
					: collapsed.filter(g => g !== section.group);
				persist();
				renderCards();
				// renderCards() rebuilt the header; put focus back on the new one.
				const heads = /** @type {HTMLElement[]} */ (Array.from(ws.cards.querySelectorAll('.group-head')));
				const again = heads.find(h => h.dataset.group === section.group);
				if (again) { again.focus(); }
			},
			'data-group': section.group
		}, [
			icon('chevron'),
			el('span', { class: 'group-name', text: section.group || 'Parameters' }),
			el('span', { class: 'group-count', text: String(count) })
		]);
	}

	/**
	 * The value shown on a card: what is staged, else what Firebase holds, on
	 * one line. Values are free-form and may contain newlines, which would
	 * otherwise break the card into an unreadable blob.
	 */
	function previewOf(item) {
		if (!item.staged && item.remote && item.remote.usesInAppDefault) {
			return '(in-app default)';
		}
		return item.value.replace(/\s*\n\s*/g, ' ').trim();
	}

	function card(item) {
		const conditions = item.remote ? item.remote.conditionCount : 0;
		const mark = item.isNew ? '● New' : item.staged ? '● Staged' : conditions > 0 ? `+${conditions} cond.` : '';
		const selected = item.key === selectedKey;
		return el('button', {
			class: 'card' + (selected ? ' selected' : ''),
			role: 'option',
			'aria-selected': String(selected),
			onclick: () => select(item.key)
		}, [
			el('span', { class: 'card-text' }, [
				el('span', { class: 'card-key', text: item.key }),
				// The group header above already names the group.
				el('span', { class: 'card-sub', title: previewOf(item) || undefined }, [
					typeLabel(item.valueType),
					el('span', { class: 'card-value', text: previewOf(item) })
				])
			]),
			mark && el('span', { class: 'card-mark' + (item.staged ? ' staged' : ''), text: mark })
		]);
	}

	function renderBatchBar() {
		const staged = state.staged || [];
		// A new change after a push starts a new batch; the old result is stale.
		if (staged.length > lastStagedCount) {
			batchMessage = null;
		}
		lastStagedCount = staged.length;

		const bar = ws.batchBar;
		bar.textContent = '';
		bar.hidden = staged.length === 0 && batchMessage === null;
		if (bar.hidden) {
			return;
		}
		const n = staged.length;
		bar.appendChild(el('div', { class: 'batch-text' }, [
			n > 0 && el('strong', { text: `● ${n} change${n === 1 ? '' : 's'} in batch` }),
			batchMessage && el('span', {
				class: 'batch-result ' + batchMessage.status,
				text: batchMessage.text
			})
		]));
		if (n > 0) {
			bar.appendChild(el('div', { class: 'batch-actions' }, [
				el('button', {
					class: 'link',
					text: 'Discard',
					onclick: () => vscode.postMessage({ type: 'discardStaged' })
				}),
				el('button', {
					class: 'primary compact',
					text: 'Review & push',
					onclick: () => vscode.postMessage({ type: 'reviewStaged' })
				})
			]));
		}
	}

	/** @param {string} key */
	function select(key) {
		const item = findItem(key);
		if (!item) {
			return;
		}
		if (page !== null) {
			closePage(false);
		}
		selectedKey = key;
		persist();
		openEditor(item);
		renderCards();
		const card = ws.cards.querySelector('.card.selected');
		if (card) { card.scrollIntoView({ block: 'nearest' }); }
	}

	function openEditor(item) {
		editor = createEditor(item);
		ws.detail.textContent = '';
		ws.detail.appendChild(editor.root);
		ws.split.classList.remove('no-detail');
		ws.hint.hidden = true;
	}

	/** Nothing selected: the list takes the whole height and says how to start. */
	function showEmpty() {
		editor = null;
		ws.detail.textContent = '';
		ws.split.classList.add('no-detail');
		ws.hint.hidden = false;
	}

	/** Closes the details panel: nothing selected, the list on its own. */
	function closeEditor() {
		selectedKey = null;
		persist();
		showEmpty();
		renderCards();
	}

	function openCreate() {
		editor = createEditor(null);
		showPage('create', editor.root);
		editor.focusFirst();
	}

	function openComposer() {
		if (!composer) {
			composer = createComposer();
		}
		editor = null;
		showPage('batch', composer.root);
		composer.sync();
		composer.focusFirst();
	}

	function showPage(kind, content) {
		page = kind;
		ws.pageBody.textContent = '';
		ws.pageBody.appendChild(content);
		ws.split.hidden = true;
		ws.page.hidden = false;
	}

	/**
	 * Back to the list. With `reopen`, the parameter that was selected before
	 * the page opened gets its editor back.
	 */
	function closePage(reopen = true) {
		page = null;
		editor = null;
		ws.page.hidden = true;
		ws.pageBody.textContent = '';
		ws.split.hidden = false;
		if (reopen) {
			const item = findItem(selectedKey);
			if (item) { openEditor(item); } else { showEmpty(); }
			renderCards();
		}
	}

	// ---------- editor ----------

	/**
	 * The value field for one type: a switch for BOOLEAN, a monospace box for
	 * JSON, a text box for STRING and a single line for NUMBER. Shared by the
	 * parameter editor and the batch form. `onChange` fires on every edit.
	 */
	function createValueInput(onChange) {
		const host = el('div', { class: 'value-host' });
		let control = /** @type {any} */ (null);

		function value() {
			if (control && control.type === 'checkbox') {
				return control.checked ? 'true' : 'false';
			}
			return control ? control.value : '';
		}

		/** Rebuilds the control for `type`, starting from `text`. */
		function set(type, text) {
			host.textContent = '';
			if (type === 'BOOLEAN') {
				const on = text.toLowerCase().trim() === 'true';
				const label = el('span', { class: 'switch-text', text: on ? 'true' : 'false' });
				const box = el('input', { type: 'checkbox', role: 'switch', class: 'switch', 'aria-label': 'Value' });
				box.checked = on;
				box.addEventListener('change', () => {
					label.textContent = box.checked ? 'true' : 'false';
					onChange();
				});
				control = box;
				host.appendChild(el('label', { class: 'switch-field' }, [label, box]));
				return;
			}
			if (type === 'NUMBER') {
				control = el('input', { type: 'text', inputmode: 'decimal', spellcheck: 'false', placeholder: '0', 'aria-label': 'Value' });
			} else {
				control = el('textarea', {
					spellcheck: 'false',
					rows: type === 'JSON' ? 8 : 2,
					class: type === 'JSON' ? 'mono' : undefined,
					'aria-label': 'Value',
					placeholder: type === 'JSON' ? '{ "enabled": true }' : 'Enter value…'
				});
			}
			control.value = text;
			control.addEventListener('input', onChange);
			host.appendChild(control);
		}

		return {
			el: host,
			value,
			set,
			/** Changes the type, carrying the current text across. */
			retype(type) { set(type, value()); },
			focus() { if (control) { control.focus(); } },
			/** Pretty-prints JSON in place; leaves invalid text alone for the error to explain. */
			formatJson() {
				try {
					control.value = JSON.stringify(JSON.parse(control.value), null, 2);
				} catch {
					// The inline error already says why it does not parse.
				}
			}
		};
	}

	/**
	 * Shows and edits one parameter, or creates one when `initial` is null.
	 *
	 * Built imperatively and patched through sync() rather than re-rendered, so
	 * a state update landing mid-edit neither steals focus nor discards what
	 * was typed. The key and group of an existing parameter are fixed: changing
	 * either would write a second parameter rather than move the original.
	 */
	function createEditor(initial) {
		let item = initial;
		const isCreate = initial === null;
		let valueType = initial ? initial.valueType : 'STRING';
		let attempted = false;
		let busy = false;
		let batchAction = 'add';

		// ---- create-only fields
		const groups = state.sections.map(s => s.group).filter(Boolean);
		const listId = 'rmc-groups';
		const keyInput = el('input', { type: 'text', placeholder: 'e.g. enable_new_home', spellcheck: 'false', oninput: refresh });
		const groupInput = el('input', { type: 'text', list: listId, placeholder: 'Leave blank for a root parameter', spellcheck: 'false', oninput: refresh });
		const groupList = el('datalist', { id: listId }, groups.map(g => el('option', { value: g })));
		const keyError = el('span', { class: 'error' });
		const groupError = el('span', { class: 'error' });
		const typeChips = el('div', { class: 'chips' }, VALUE_TYPES.map(type =>
			el('button', { class: 'chip', 'data-type': type, text: typeLabel(type), onclick: () => setType(type) })
		));

		// ---- value
		const typeSelect = el('select', {
			class: 'badge-select',
			'aria-label': 'Value type',
			onchange: () => setType(typeSelect.value)
		}, VALUE_TYPES.map(t => el('option', { value: t, text: typeLabel(t), selected: t === valueType })));
		const valueInput = createValueInput(() => refresh());
		const valueError = el('span', { class: 'error' });
		const formatLink = el('button', { class: 'link', text: 'Format', onclick: formatJson });
		const revertLink = el('button', { class: 'link', text: 'Revert', onclick: revert });

		// ---- preview, staged note, actions
		const preview = el('pre', { class: 'code', 'aria-label': 'JSON preview' });
		const stagedNote = el('span', { class: 'staged-note' });
		const status = el('div', { class: 'status', role: 'status' });
		const pushButton = el('button', { class: 'primary', onclick: push }, [icon('upload'), 'Push to Firebase']);
		const batchButton = el('button', { class: 'secondary wide', text: 'Add to batch', onclick: toggleBatch });

		function header() {
			if (isCreate) {
				return el('div', { class: 'editor-head' }, [
					el('h2', { text: 'New parameter' }),
					el('p', { class: 'muted small', text: 'Fill in the details, then push it now or add it to the batch.' })
				]);
			}
			const remote = item.remote;
			return el('div', { class: 'editor-head' }, [
				el('div', { class: 'title-row' }, [el('h2', { text: item.key }), typeSelect]),
				remote && remote.description && el('p', { class: 'muted small', text: remote.description }),
				el('p', { class: 'muted small', text: item.group ? `In group "${item.group}"` : 'Root parameter' }),
				remote && remote.conditionCount > 0 && el('p', {
					class: 'muted small',
					text: `${remote.conditionCount} conditional value(s) — kept as they are; edit them in the Firebase console.`
				}),
				remote && remote.usesInAppDefault && el('p', {
					class: 'muted small',
					text: 'Currently uses the in-app default. Pushing sets an explicit default value.'
				}),
				stagedNote
			]);
		}

		const rootEl = el('div', { class: 'editor' }, [
			// The New parameter page has its own Back; the details panel needs one
			// too, to close it and return to the list alone.
			!isCreate && el('div', { class: 'page-bar' }, [
				el('button', { class: 'back', title: 'Close and return to the list', onclick: () => closeEditor() }, [icon('back'), 'Back'])
			]),
			el('div', { class: 'editor-body' }, [
				header(),
				isCreate && el('div', { class: 'fields' }, [
					el('label', { class: 'field-label', text: 'Key' }), keyInput, keyError,
					el('label', { class: 'field-label', text: 'Group' }), groupInput, groupList, groupError,
					el('span', { class: 'field-label' , text: 'Type' }), typeChips
				]),
				el('div', { class: 'fields' }, [
					el('div', { class: 'label-row' }, [
						el('span', { class: 'field-label', text: 'Value' }),
						el('span', { class: 'links' }, [formatLink, revertLink])
					]),
					valueInput.el,
					valueError
				]),
				el('div', { class: 'fields' }, [
					el('span', { class: 'field-label', text: 'JSON Preview' }),
					preview,
					el('p', { class: 'muted small', text: 'The default value written to the template. Other fields on the parameter are kept.' })
				])
			]),
			el('div', { class: 'editor-actions' }, [status, pushButton, batchButton])
		]);

		function currentValue() {
			return valueInput.value();
		}

		function setType(type) {
			if (type === valueType) {
				return;
			}
			valueType = type;
			typeSelect.value = type;
			valueInput.retype(type);
			refresh();
		}

		function revert() {
			if (!item || !item.remote) {
				return;
			}
			valueType = item.remote.valueType;
			typeSelect.value = valueType;
			valueInput.set(valueType, item.remote.value);
			refresh();
		}

		function formatJson() {
			valueInput.formatJson();
			refresh();
		}

		function currentChange() {
			const group = isCreate ? groupInput.value.trim() : (item.group || '');
			return {
				key: isCreate ? keyInput.value.trim() : item.key,
				value: normalize(currentValue(), valueType),
				valueType,
				group: group === '' ? undefined : group,
				isNew: isCreate || item.isNew
			};
		}

		function firstError() {
			const change = currentChange();
			const invalid = validate(change.key, currentValue(), valueType, change.group || '');
			// A taken key is a key problem, so it outranks anything wrong further
			// down the form — otherwise it stays hidden until a value is typed.
			if (isCreate && (!invalid || invalid.field !== 'key') && currentItems().some(i => i.key === change.key)) {
				return { field: 'key', message: `A parameter named "${change.key}" already exists` };
			}
			return invalid;
		}

		/** True when the editor differs from Firebase — or the parameter is not in Firebase yet. */
		function differsFromRemote() {
			if (!item || !item.remote) {
				return true;
			}
			const change = currentChange();
			return change.valueType !== item.remote.valueType || change.value !== item.remote.value;
		}

		function sameAsStaged(change, staged) {
			return staged.value === change.value && staged.valueType === change.valueType;
		}

		/** Recomputes everything derived from the inputs: errors, preview, buttons. */
		function refresh() {
			const change = currentChange();
			const error = firstError();

			keyError.textContent = '';
			groupError.textContent = '';
			valueError.textContent = '';
			if (error) {
				// Before a first submit, stay quiet about fields still empty —
				// "Key is required" on a blank form is noise, not help.
				const empty = error.field === 'key' ? change.key === ''
					: error.field === 'group' ? !change.group
						: currentValue() === '';
				if (attempted || !empty) {
					({ key: keyError, group: groupError, value: valueError })[error.field].textContent = error.message;
				}
			}

			for (const chip of typeChips.querySelectorAll('.chip')) {
				chip.classList.toggle('selected', chip.getAttribute('data-type') === valueType);
			}
			formatLink.hidden = valueType !== 'JSON';
			revertLink.hidden = !(item && item.remote && differsFromRemote());

			renderPreview(change);

			const staged = item ? item.staged : null;
			stagedNote.hidden = !staged;
			stagedNote.textContent = !staged ? '' : item.isNew ? '● New — waiting in the batch' : '● Staged — waiting in the batch';

			const dirty = differsFromRemote();
			pushButton.disabled = busy || !dirty;
			pushButton.title = dirty ? '' : 'No changes to push';

			batchAction = staged && (sameAsStaged(change, staged) || !dirty) ? 'remove' : staged ? 'update' : 'add';
			batchButton.textContent = { add: 'Add to batch', update: 'Update in batch', remove: 'Remove from batch' }[batchAction];
			batchButton.disabled = busy || !(staged || dirty);
		}

		function renderPreview(change) {
			const param = { defaultValue: { value: change.value }, valueType: change.valueType };
			const key = change.key || 'parameter_key';
			const doc = change.group
				? { parameterGroups: { [change.group]: { parameters: { [key]: param } } } }
				: { parameters: { [key]: param } };
			highlightJson(preview, JSON.stringify(doc, null, 2));
		}

		function showStatus(kind, message) {
			status.className = 'status ' + kind;
			status.textContent = message;
		}

		/** Shows every error and focuses the first bad field. */
		function checkValid() {
			attempted = true;
			refresh();
			const error = firstError();
			if (!error) {
				return true;
			}
			showStatus('bad', error.message);
			({ key: keyInput, group: groupInput, value: valueInput })[error.field].focus();
			return false;
		}

		function push() {
			if (!checkValid()) {
				return;
			}
			busy = true;
			refresh();
			showStatus('muted', 'Pushing…');
			vscode.postMessage({ type: 'push', change: currentChange() });
		}

		function toggleBatch() {
			if (item && item.staged && batchAction === 'remove') {
				vscode.postMessage({ type: 'unstage', key: item.key });
				showStatus('muted', `Removed "${item.key}" from the batch.`);
				return;
			}
			if (!checkValid()) {
				return;
			}
			vscode.postMessage({ type: 'stage', change: currentChange() });
		}

		valueInput.set(valueType, initial ? initial.value : '');
		refresh();

		return {
			root: rootEl,
			isCreate,
			get key() { return item ? item.key : null; },
			/** Takes a newer copy of the same parameter, keeping what was typed. */
			sync(next) {
				item = next;
				refresh();
			},
			showStatus,
			/** The host replied to a push or stage. */
			done() {
				busy = false;
				refresh();
			},
			focusFirst() {
				(isCreate ? keyInput : valueInput).focus();
			}
		};
	}

	// ---------- batch push view ----------

	/**
	 * Builds the Batch Push view: a target group, then either one entry at a
	 * time or a JSON import, and the list of what is in the batch so far.
	 * Nothing is sent from here — the batch bar's Review & push does that.
	 */
	function createComposer() {
		let tab = 'single';
		let valueType = 'STRING';
		let attempted = false;
		/** Which form is waiting on a stageManyResult, so only that one clears. */
		let pending = /** @type {null|'single'|'json'} */ (null);

		// ---- target group
		const groupList = el('datalist', { id: 'rmc-batch-groups' });
		const groupInput = el('input', {
			type: 'text', list: 'rmc-batch-groups', spellcheck: 'false',
			placeholder: 'Leave blank for root parameters',
			oninput: () => { refreshSingle(); requestPreview(); }
		});
		const groupError = el('span', { class: 'error' });

		// ---- tabs
		const tabs = el('div', { class: 'chips segmented', role: 'tablist' }, [
			el('button', { class: 'chip', role: 'tab', 'data-tab': 'single', text: 'Add one by one', onclick: () => setTab('single') }),
			el('button', { class: 'chip', role: 'tab', 'data-tab': 'json', text: 'Import JSON', onclick: () => setTab('json') })
		]);

		// ---- one by one
		const keyInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'e.g. enable_new_home', 'aria-label': 'Key', oninput: onKeyInput });
		const keyNote = el('span', { class: 'note' });
		const keyError = el('span', { class: 'error' });
		const typeChips = el('div', { class: 'chips' }, VALUE_TYPES.map(type =>
			el('button', { class: 'chip', 'data-type': type, text: typeLabel(type), onclick: () => setType(type) })
		));
		const valueInput = createValueInput(() => refreshSingle());
		const valueError = el('span', { class: 'error' });
		const addButton = el('button', { class: 'primary', onclick: addSingle }, [icon('plus'), 'Add to batch']);
		const singlePane = el('div', { class: 'fields' }, [
			el('label', { class: 'field-label', text: 'Key' }), keyInput, keyNote, keyError,
			el('span', { class: 'field-label', text: 'Type' }), typeChips,
			el('span', { class: 'field-label', text: 'Value' }), valueInput.el, valueError,
			el('div', { class: 'spaced' }, [addButton])
		]);
		keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { addSingle(); } });

		// ---- import JSON
		const jsonInput = el('textarea', {
			class: 'mono', rows: 9, spellcheck: 'false', 'aria-label': 'JSON to import',
			placeholder: '{\n  "enable_new_home": true,\n  "app_min_version": 2.4,\n  "welcome_message": "Hi!"\n}',
			oninput: () => { fileName.textContent = ''; requestPreview(); }
		});
		const fileName = el('span', { class: 'muted small' });
		const previewEl = el('div', { class: 'import-preview', 'aria-live': 'polite' });
		const importButton = el('button', { class: 'primary', disabled: true, onclick: addImported }, [icon('plus'), 'Add to batch']);
		const jsonPane = el('div', { class: 'fields' }, [
			el('div', { class: 'label-row' }, [
				el('span', { class: 'field-label', text: 'JSON' }),
				el('span', { class: 'links' }, [fileName,
					el('button', { class: 'link', text: 'Upload .json…', onclick: () => vscode.postMessage({ type: 'pickImportFile' }) })])
			]),
			el('p', {
				class: 'muted small',
				text: 'Paste {"key": value, …} — the type comes from each value and new keys go into the target group — or a Firebase template export, which keeps its own groups and types.'
			}),
			jsonInput,
			previewEl,
			el('div', { class: 'spaced' }, [importButton])
		]);

		// ---- batch contents and status
		const status = el('div', { class: 'status', role: 'status' });
		const stagedTitle = el('span', { class: 'field-label' });
		const stagedList = el('div', { class: 'staged-list' });

		const root = el('div', { class: 'editor' }, [
			el('div', { class: 'editor-body' }, [
				el('div', { class: 'editor-head' }, [
					el('h2', { text: 'Batch push' }),
					el('p', {
						class: 'muted small',
						text: 'Add parameters one at a time or import JSON. Nothing is sent until you review and push the batch below.'
					})
				]),
				el('div', { class: 'fields' }, [
					el('label', { class: 'field-label', text: 'Target group' }), groupInput, groupList, groupError,
					el('span', { class: 'muted small', text: 'New parameters go here. Existing ones are updated in the group they already belong to.' })
				]),
				tabs,
				singlePane,
				jsonPane,
				status,
				el('div', { class: 'fields' }, [stagedTitle, stagedList])
			])
		]);

		function targetGroup() {
			return groupInput.value.trim();
		}

		function setTab(next) {
			tab = next;
			for (const t of tabs.querySelectorAll('.chip')) {
				const on = t.getAttribute('data-tab') === tab;
				t.classList.toggle('selected', on);
				t.setAttribute('aria-selected', String(on));
			}
			singlePane.hidden = tab !== 'single';
			jsonPane.hidden = tab !== 'json';
			showStatus('', '');
		}

		function setType(type) {
			if (type === valueType) {
				return;
			}
			valueType = type;
			valueInput.retype(type);
			refreshSingle();
		}

		function remoteFor(key) {
			const item = findItem(key);
			return item && item.remote ? item.remote : null;
		}

		/** An existing key takes on its current type, so a batch never flips one by accident. */
		function onKeyInput() {
			const remote = remoteFor(keyInput.value.trim());
			if (remote && remote.valueType !== valueType) {
				setType(remote.valueType);
			}
			refreshSingle();
		}

		function singleChange() {
			const key = keyInput.value.trim();
			const remote = remoteFor(key);
			const group = remote ? remote.group : (targetGroup() || undefined);
			return { key, value: normalize(valueInput.value(), valueType), valueType, group, isNew: !remote };
		}

		function singleError() {
			const change = singleChange();
			return validate(change.key, valueInput.value(), valueType, change.group || '');
		}

		function refreshSingle() {
			for (const chip of typeChips.querySelectorAll('.chip')) {
				chip.classList.toggle('selected', chip.getAttribute('data-type') === valueType);
			}
			const change = singleChange();
			const remote = remoteFor(change.key);
			const staged = (state.staged || []).some(c => c.key === change.key);
			keyNote.textContent = remote
				? `Exists ${remote.group ? `in group "${remote.group}"` : 'in root parameters'} — its value will be updated there.`
				: staged ? 'Already in the batch — adding replaces it.' : '';

			keyError.textContent = '';
			valueError.textContent = '';
			groupError.textContent = '';
			const error = singleError();
			if (error) {
				// Quiet about empty fields until the first Add, as in the editor.
				const empty = error.field === 'key' ? change.key === ''
					: error.field === 'value' ? valueInput.value() === '' : false;
				if (attempted || !empty) {
					({ key: keyError, value: valueError, group: groupError })[error.field].textContent = error.message;
				}
			}
		}

		function addSingle() {
			attempted = true;
			refreshSingle();
			const error = singleError();
			if (error) {
				showStatus('bad', error.message);
				({ key: keyInput, value: valueInput, group: groupInput })[error.field].focus();
				return;
			}
			pending = 'single';
			vscode.postMessage({ type: 'stageMany', changes: [singleChange()] });
		}

		// ---- import preview: parsed on the host, which owns the parser and the
		// live template; replies older than the latest request are dropped.
		let requestId = 0;
		let previewTimer = /** @type {any} */ (undefined);
		let preview = /** @type {any} */ (null);

		function requestPreview() {
			clearTimeout(previewTimer);
			previewTimer = setTimeout(() => {
				requestId += 1;
				vscode.postMessage({ type: 'previewImport', requestId, text: jsonInput.value, group: targetGroup() || undefined });
			}, 200);
		}

		function showPreview(id, result) {
			if (id !== requestId) {
				return;
			}
			preview = result;
			previewEl.textContent = '';
			const ready = result.rows.filter(r => !r.error);
			importButton.disabled = ready.length === 0;
			importButton.textContent = '';
			importButton.append(icon('plus'), ready.length > 0
				? `Add ${ready.length} to batch`
				: 'Add to batch');

			if (result.error) {
				previewEl.appendChild(el('p', { class: 'error', text: result.error }));
				return;
			}
			if (result.rows.length === 0) {
				return;
			}
			const bad = result.rows.length - ready.length;
			previewEl.appendChild(el('p', { class: 'muted small' }, [
				`${result.format === 'template' ? 'Firebase template' : 'Key/value map'} · ${ready.length} ready`,
				bad > 0 && el('span', { class: 'error-inline', text: ` · ${bad} with problems` })
			]));
			for (const warning of result.warnings) {
				previewEl.appendChild(el('p', { class: 'warning', text: warning }));
			}
			for (const row of result.rows) {
				previewEl.appendChild(el('div', { class: 'preview-row' + (row.error ? ' has-error' : '') }, [
					el('div', { class: 'preview-main' }, [
						el('span', { class: 'preview-key', text: row.key }),
						el('span', { class: 'pill ' + (row.error ? 'bad' : row.isNew ? 'new' : 'update'), text: row.error ? 'Skipped' : row.isNew ? 'New' : 'Update' })
					]),
					el('span', {
						class: 'muted small',
						text: `${typeLabel(row.valueType)} · ${row.group ? row.group : 'Root'} · ${oneLine(row.value)}`
					}),
					row.note && el('span', { class: 'note', text: row.note }),
					row.error && el('span', { class: 'error', text: row.error })
				]));
			}
		}

		function addImported() {
			const ready = preview ? preview.rows.filter(r => !r.error) : [];
			if (ready.length === 0) {
				return;
			}
			pending = 'json';
			vscode.postMessage({
				type: 'stageMany',
				changes: ready.map(r => ({ key: r.key, value: r.value, valueType: r.valueType, group: r.group, isNew: r.isNew }))
			});
		}

		function renderStaged() {
			const staged = state.staged || [];
			stagedTitle.textContent = staged.length === 0 ? 'Batch is empty' : `In this batch (${staged.length})`;
			stagedList.textContent = '';
			for (const change of staged) {
				stagedList.appendChild(el('div', { class: 'staged-row' }, [
					el('button', {
						class: 'staged-open',
						title: 'Open in the editor',
						onclick: () => select(change.key)
					}, [
						el('span', { class: 'preview-key', text: change.key }),
						el('span', {
							class: 'muted small',
							text: `${change.isNew ? 'New' : 'Update'} · ${typeLabel(change.valueType)} · ${change.group || 'Root'} · ${oneLine(change.value)}`
						})
					]),
					el('button', {
						class: 'icon-btn small-btn',
						title: `Remove "${change.key}" from the batch`,
						'aria-label': `Remove ${change.key} from the batch`,
						onclick: () => vscode.postMessage({ type: 'unstage', key: change.key })
					}, [icon('close')])
				]));
			}
		}

		function showStatus(kind, message) {
			status.className = 'status ' + kind;
			status.textContent = message;
		}

		valueInput.set(valueType, '');
		setTab('single');
		requestPreview();

		return {
			root,
			/** Picks up new groups, the current batch, and re-checks keys against the live template. */
			sync() {
				groupList.textContent = '';
				state.sections.filter(s => s.group).forEach(s => groupList.appendChild(el('option', { value: s.group })));
				renderStaged();
				refreshSingle();
				if (jsonInput.value.trim() !== '') {
					requestPreview();
				}
			},
			showPreview,
			/** The host replied to a stageMany. */
			staged(ok, message) {
				const which = pending;
				pending = null;
				showStatus(ok ? 'ok' : 'bad', message);
				if (!ok) {
					return;
				}
				if (which === 'single') {
					// Ready for the next one: key and value clear, group and type stay.
					attempted = false;
					keyInput.value = '';
					valueInput.set(valueType, '');
					refreshSingle();
					keyInput.focus();
				} else if (which === 'json') {
					jsonInput.value = '';
					fileName.textContent = '';
					requestPreview();
				}
			},
			loadFile(text, name) {
				setTab('json');
				jsonInput.value = text;
				fileName.textContent = name;
				requestPreview();
			},
			showStatus,
			focusFirst() {
				(tab === 'single' ? keyInput : jsonInput).focus();
			}
		};
	}

	/** @param {string} value */
	function oneLine(value) {
		const flat = value.replace(/\s*\n\s*/g, ' ').trim();
		return flat.length > 48 ? flat.slice(0, 47) + '…' : flat;
	}

	/**
	 * Colours pretty-printed JSON into `target`: keys, strings, and
	 * number/boolean/null literals. Built from text nodes, never markup.
	 */
	function highlightJson(target, json) {
		target.textContent = '';
		const token = /"(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
		let last = 0;
		let match;
		while ((match = token.exec(json)) !== null) {
			target.appendChild(document.createTextNode(json.slice(last, match.index)));
			const isKey = match[1] !== undefined;
			const text = isKey ? match[0].slice(0, match[0].length - match[1].length) : match[0];
			const kind = isKey ? 'tok-key' : match[0].startsWith('"') ? 'tok-string' : 'tok-literal';
			target.appendChild(el('span', { class: kind, text }));
			if (isKey) {
				target.appendChild(document.createTextNode(match[1]));
			}
			last = token.lastIndex;
		}
		target.appendChild(document.createTextNode(json.slice(last)));
	}

	// ---------- top level ----------

	/** Closes the project menu; registered once, as the workspace is rebuilt after every reload. */
	function closeMenu() {
		for (const menu of root.querySelectorAll('.menu')) {
			/** @type {HTMLElement} */ (menu).hidden = true;
		}
	}
	document.addEventListener('click', closeMenu);
	document.addEventListener('keydown', e => {
		if (e.key !== 'Escape') {
			return;
		}
		const menuOpen = Array.from(root.querySelectorAll('.menu')).some(m => !(/** @type {HTMLElement} */ (m).hidden));
		if (menuOpen) {
			closeMenu();
		} else if (page !== null && ws) {
			closePage();
		}
	});

	function render() {
		if (state.kind === 'no-account') {
			// A different account is a different project; its batch view starts over.
			selectedKey = null;
			composer = null;
			page = null;
			editor = null;
			return renderNoAccount();
		}
		if (state.kind === 'busy') {
			return renderBusy();
		}
		if (state.kind === 'error') {
			return renderError();
		}
		if (!ws) {
			ws = buildWorkspace();
		}
		updateWorkspace();
	}

	/**
	 * After a push or stage of a new parameter, the host has already sent the
	 * state that contains it — select it so its own editor shows the result.
	 */
	function landOn(key, kind, message) {
		if (page === 'create' && findItem(key)) {
			// Back to the list, on the parameter just made.
			select(key);
		}
		if (editor) {
			editor.showStatus(kind, message);
		}
	}

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'state':
				state = message.state;
				render();
				break;
			case 'pushResult':
				if (editor) {
					editor.done();
				}
				if (message.ok) {
					landOn(message.key, 'ok', message.message);
				} else if (editor) {
					editor.showStatus('bad', message.message);
				}
				break;
			case 'stageResult':
				if (message.ok) {
					landOn(message.key, 'muted', message.message);
				} else if (editor) {
					editor.showStatus('bad', message.message);
				}
				break;
			case 'stageManyResult':
				if (composer) {
					composer.staged(message.ok, message.message);
				}
				break;
			case 'importPreview':
				if (composer) {
					composer.showPreview(message.requestId, message.result);
				}
				break;
			case 'importFile':
				if (composer) {
					composer.loadFile(message.text, message.name);
				}
				break;
			case 'importFileError':
				if (composer) {
					composer.showStatus('bad', message.message);
				}
				break;
			case 'batchResult':
				batchMessage = { status: message.status, text: message.message };
				if (ws) {
					renderBatchBar();
				}
				break;
		}
	});

	const saved = vscode.getState();
	if (saved) {
		selectedKey = saved.selectedKey || null;
		search = saved.search || '';
		typeFilter = saved.typeFilter || null;
		collapsed = saved.collapsed || [];
	}

	render();
	vscode.postMessage({ type: 'ready' });
})();
