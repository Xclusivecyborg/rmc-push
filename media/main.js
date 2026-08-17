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

	/** Which screen is showing. Survives host state updates. */
	let route = /** @type {any} */ ({ name: 'list' });

	let filter = '';
	/** Group names the user has collapsed. '' is the root section. */
	let collapsed = /** @type {string[]} */ ([]);
	let pushing = false;

	/** Set by renderForm() so a pushResult from the host lands on the live form. */
	let currentForm = /** @type {any} */ (null);

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
		vscode.setState({ route, filter, collapsed });
	}

	// ---------- screens ----------

	function renderPlaceholder(body) {
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

	function header() {
		return el('div', { class: 'header' }, [
			el('span', { class: 'dot', title: 'Connected' }),
			el('span', { class: 'project', text: state.projectId, title: state.accountPath }),
			el('button', {
				class: 'link',
				text: 'Change',
				title: 'Use a different service account',
				onclick: () => vscode.postMessage({ type: 'selectAccount' })
			})
		]);
	}

	/** @param {any} entry */
	function entryRow(entry) {
		const preview = entry.usesInAppDefault ? '(in-app default)' : entry.value;
		return el(
			'button',
			{
				class: 'entry',
				title: `${entry.key} — click to edit`,
				onclick: () => {
					route = { name: 'edit', entry };
					persist();
					render();
				}
			},
			[
				el('span', { class: 'key', text: entry.key }),
				el('span', { class: 'preview' }, [
					el('span', { class: 'badge', text: entry.valueType }),
					el('span', { class: 'val', text: preview }),
					entry.conditionCount > 0 &&
						el('span', {
							class: 'muted',
							text: `+${entry.conditionCount} cond.`,
							title: `${entry.conditionCount} conditional value(s) — edited in the Firebase console`
						})
				])
			]
		);
	}

	/** @param {any} section */
	function sectionBlock(section) {
		const group = section.group || '';
		const isCollapsed = collapsed.indexOf(group) !== -1;
		const needle = filter.toLowerCase();
		const entries = section.entries.filter(
			e => needle === '' || e.key.toLowerCase().indexOf(needle) !== -1
		);

		// A filter that matches nothing in this group hides the group entirely.
		if (needle !== '' && entries.length === 0) {
			return null;
		}

		const title = el(
			'button',
			{
				class: 'section-title',
				'aria-expanded': String(!isCollapsed),
				title: section.description || undefined,
				onclick: () => {
					collapsed = isCollapsed ? collapsed.filter(g => g !== group) : collapsed.concat(group);
					persist();
					render();
				}
			},
			[
				el('span', { class: 'chevron', text: '⌄' }),
				el('span', { class: 'name', text: section.group || 'Parameters' }),
				el('span', { class: 'muted', text: String(entries.length) })
			]
		);

		const body = isCollapsed
			? []
			: entries.length > 0
				? entries.map(entryRow)
				: [el('div', { class: 'empty-note', text: 'No parameters' })];

		return el('div', {}, [title, ...body]);
	}

	function renderList() {
		const blocks = state.sections.map(sectionBlock).filter(Boolean);
		const total = state.sections.reduce((n, s) => n + s.entries.length, 0);

		replaceRoot([
			header(),
			el('div', { class: 'actions' }, [
				el('button', {
					class: 'primary',
					text: '+ New parameter',
					onclick: () => {
						route = { name: 'create' };
						persist();
						render();
					}
				})
			]),
			el('div', { class: 'toolbar' }, [
				el('input', {
					class: 'search',
					type: 'search',
					placeholder: 'Filter parameters',
					value: filter,
					oninput: event => {
						filter = event.target.value;
						persist();
						render();
						// Re-focus: render() rebuilds the input the user is typing into.
						const box = root.querySelector('.search');
						if (box) {
							box.focus();
							box.setSelectionRange(box.value.length, box.value.length);
						}
					}
				}),
				el('button', {
					class: 'secondary',
					text: '⟳',
					title: 'Reload from Firebase',
					onclick: () => vscode.postMessage({ type: 'refresh' })
				})
			]),
			blocks.length > 0
				? el('div', {}, blocks)
				: el('div', { class: 'placeholder' }, [
					el('p', {
						text: total === 0 ? 'This project has no parameters yet.' : 'No parameters match the filter.'
					})
				])
		]);
	}

	/**
	 * Builds the editor. Held together imperatively rather than re-rendered, so
	 * that changing the type does not steal focus from the field being edited.
	 */
	function renderForm() {
		const isEdit = route.name === 'edit';
		const seed = isEdit ? route.entry : { key: '', value: '', valueType: 'STRING', group: '' };

		const keyInput = el('input', {
			type: 'text',
			value: seed.key,
			placeholder: 'e.g. welcome_title',
			readonly: isEdit,
			spellcheck: 'false'
		});
		const groupInput = el('input', {
			type: 'text',
			value: seed.group || '',
			placeholder: 'Leave blank for root parameters',
			readonly: isEdit,
			spellcheck: 'false'
		});
		const typeSelect = el(
			'select',
			{ onchange: () => swapValueControl(typeSelect.value) },
			VALUE_TYPES.map(t => el('option', { value: t, text: t, selected: t === seed.valueType }))
		);

		const valueHost = el('div', {});
		let valueControl = /** @type {any} */ (null);

		/** @param {string} type */
		function swapValueControl(type) {
			const carried = valueControl ? valueControl.value : seed.value;
			valueHost.textContent = '';
			if (type === 'JSON') {
				valueControl = el('textarea', { spellcheck: 'false', placeholder: '{ "enabled": true }' });
				valueControl.value = carried;
			} else if (type === 'BOOLEAN') {
				const normalized = carried.toLowerCase().trim() === 'true' ? 'true' : 'false';
				valueControl = el(
					'select',
					{},
					['true', 'false'].map(v => el('option', { value: v, text: v, selected: v === normalized }))
				);
			} else {
				valueControl = el('input', { type: 'text', placeholder: 'Enter value…', spellcheck: 'false' });
				valueControl.value = carried;
			}
			valueControl.addEventListener('input', () => clearFieldError(valueField));
			valueHost.appendChild(valueControl);
		}

		const keyError = el('span', { class: 'error' });
		const valueError = el('span', { class: 'error' });
		const groupError = el('span', { class: 'error' });

		const keyField = el('div', { class: 'field' }, [
			el('label', { text: 'Key' }),
			keyInput,
			isEdit && el('span', { class: 'hint', text: 'Keys cannot be renamed — create a new parameter instead.' }),
			keyError
		]);
		const typeField = el('div', { class: 'field' }, [el('label', { text: 'Type' }), typeSelect]);
		const valueField = el('div', { class: 'field' }, [el('label', { text: 'Value' }), valueHost, valueError]);
		const groupField = el('div', { class: 'field' }, [
			el('label', { text: 'Parameter group' }),
			groupInput,
			groupError
		]);

		swapValueControl(seed.valueType);
		keyInput.addEventListener('input', () => clearFieldError(keyField));
		groupInput.addEventListener('input', () => clearFieldError(groupField));

		const statusLine = el('div', { class: 'status' });
		const submit = el('button', {
			class: 'primary',
			text: isEdit ? 'Save to Firebase' : 'Push to Firebase',
			onclick: () => submitForm()
		});

		/** @param {HTMLElement} field */
		function clearFieldError(field) {
			field.classList.remove('invalid');
			const slot = field.querySelector('.error');
			if (slot) {
				slot.textContent = '';
			}
		}

		/**
		 * @param {HTMLElement} field
		 * @param {string} message
		 */
		function showFieldError(field, message) {
			field.classList.add('invalid');
			const slot = field.querySelector('.error');
			if (slot) {
				slot.textContent = message;
			}
			statusLine.className = 'status';
			statusLine.textContent = '';
		}

		function submitForm() {
			[keyField, valueField, groupField].forEach(clearFieldError);

			const key = keyInput.value.trim();
			const group = groupInput.value.trim();
			const valueType = typeSelect.value;
			const value = valueControl.value;

			// Mirrors src/validation.ts for instant feedback. The host re-validates
			// before it calls Firebase, so this copy is convenience, not security.
			if (key === '') {
				return showFieldError(keyField, 'Key is required');
			}
			if (!KEY_REGEX.test(key)) {
				return showFieldError(keyField, 'Use only letters, numbers, and underscores');
			}
			if (group !== '' && !GROUP_REGEX.test(group)) {
				return showFieldError(groupField, 'Use letters, numbers, spaces, underscores, and hyphens');
			}
			if (value === '') {
				return showFieldError(valueField, 'Value is required');
			}
			if (valueType === 'NUMBER' && (value.trim() === '' || isNaN(Number(value)))) {
				return showFieldError(valueField, 'Must be a valid number');
			}
			if (valueType === 'JSON') {
				try {
					JSON.parse(value);
				} catch (err) {
					return showFieldError(valueField, 'Invalid JSON: ' + err.message);
				}
			}

			setPushing(true);
			statusLine.className = 'status muted';
			statusLine.textContent = 'Pushing…';
			vscode.postMessage({
				type: 'push',
				key,
				value,
				valueType,
				group: group === '' ? undefined : group
			});
		}

		/** @param {boolean} active */
		function setPushing(active) {
			pushing = active;
			submit.disabled = active;
		}

		// Surfaced to the message handler so the host's reply lands on this form.
		currentForm = {
			showResult(ok, message) {
				setPushing(false);
				statusLine.className = 'status ' + (ok ? 'ok' : 'bad');
				statusLine.textContent = message;
			}
		};

		replaceRoot([
			header(),
			el('div', { class: 'form' }, [
				el('div', { class: 'form-head' }, [
					el('button', {
						class: 'link',
						text: '‹ Back',
						onclick: () => {
							route = { name: 'list' };
							persist();
							render();
						}
					})
				]),
				el('h2', { text: isEdit ? seed.key : 'New parameter' }),
				keyField,
				typeField,
				valueField,
				groupField,
				submit,
				statusLine
			])
		]);

		if (pushing) {
			setPushing(true);
		}
		if (!isEdit) {
			keyInput.focus();
		}
	}

	function render() {
		currentForm = null;
		if (state.kind === 'no-account') {
			route = { name: 'list' };
			return renderNoAccount();
		}
		if (state.kind === 'busy') {
			return renderBusy();
		}
		if (state.kind === 'error') {
			return renderError();
		}
		if (route.name === 'edit' || route.name === 'create') {
			return renderForm();
		}
		return renderList();
	}

	// ---------- host messaging ----------

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'state') {
			state = message.state;
			// A parameter open in the editor may have been renamed or removed
			// upstream; drop back to the list rather than editing a ghost.
			if (route.name === 'edit' && state.kind === 'ready') {
				const stillThere = state.sections.some(s =>
					s.entries.some(e => e.key === route.entry.key && (s.group || '') === (route.entry.group || ''))
				);
				if (!stillThere) {
					route = { name: 'list' };
				}
			}
			persist();
			render();
		} else if (message.type === 'pushResult') {
			if (currentForm) {
				currentForm.showResult(message.ok, message.message);
			}
			pushing = false;
		}
	});

	const saved = vscode.getState();
	if (saved) {
		route = saved.route || route;
		filter = saved.filter || '';
		collapsed = saved.collapsed || [];
	}

	render();
	vscode.postMessage({ type: 'ready' });
})();
