/** Pure function — returns the full HTML for the push UI webview. */
export function getWebviewContent(projectId: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<title>Push to Firebase Remote Config</title>
	<style>
		body { font-family: sans-serif; padding: 20px; }
		.error-placeholder { height: 1.5em; margin-bottom: 5px; }
		.error-msg { color: #f44336; font-size: 0.85em; display: none; }
		input, select { margin-bottom: 15px; width: 100%; box-sizing: border-box; padding: 8px; }
		button { padding: 10px 20px; cursor: pointer; background: #007acc; color: white; border: none; border-radius: 4px; display: block; width: 100%; }
		button:hover:not(:disabled) { background: #0062a3; }
		button:disabled { opacity: 0.5; cursor: not-allowed; }
		#result { margin-top: 25px; }
		.success-text { color: #4db33d; font-size: 1.15em; font-weight: 500; }
		.error-text { color: #f44336; font-size: 1em; }
		.loading-text { color: #888; font-size: 1em; }
	</style>
</head>
<body>
	<h2>Push to Remote Config: <span style="color: #007acc;">${projectId}</span></h2>
	<form id="configForm">
		<label>Key:</label>
		<input type="text" id="key" placeholder="e.g. welcome_title" required />
		<div class="error-placeholder">
			<div id="error-key" class="error-msg"></div>
		</div>

		<label>Value:</label>
		<input type="text" id="value" placeholder="Enter value..." required />
		<div class="error-placeholder">
			<div id="error-value" class="error-msg"></div>
		</div>

		<label>Type:</label>
		<select id="type">
			<option value="STRING">String</option>
			<option value="NUMBER">Number</option>
			<option value="BOOLEAN">Boolean</option>
			<option value="JSON">JSON</option>
		</select>

		<button type="submit" id="submitBtn">Push Config</button>
	</form>
	<div id="result"></div>
	<script>
		const vscode = acquireVsCodeApi();
		const errorKey = document.getElementById('error-key');
		const errorValue = document.getElementById('error-value');
		const keyInput = document.getElementById('key');
		const valueInput = document.getElementById('value');
		const submitBtn = document.getElementById('submitBtn');

		function showError(element, msg) {
			element.textContent = msg;
			element.style.display = 'block';
		}

		function hideError(element) {
			element.style.display = 'none';
			element.textContent = '';
		}

		function setLoading(loading) {
			submitBtn.disabled = loading;
			submitBtn.textContent = loading ? 'Pushing...' : 'Push Config';
		}

		keyInput.addEventListener('input', () => hideError(errorKey));
		valueInput.addEventListener('input', () => hideError(errorValue));

		document.getElementById('configForm').addEventListener('submit', function(e) {
			e.preventDefault();
			const key = keyInput.value.trim();
			let value = valueInput.value;
			const type = document.getElementById('type').value;

			hideError(errorKey);
			hideError(errorValue);

			const keyRegex = /^[a-zA-Z0-9_]+$/;
			if (!keyRegex.test(key)) {
				showError(errorKey, 'Invalid key: use only alphanumeric characters and underscores');
				return;
			}

			try {
				if (type === 'JSON') {
					JSON.parse(value);
				} else if (type === 'NUMBER') {
					if (isNaN(Number(value)) || value.trim() === '') {
						throw new Error('Invalid number format');
					}
				} else if (type === 'BOOLEAN') {
					const lowerVal = value.toLowerCase().trim();
					if (lowerVal !== 'true' && lowerVal !== 'false') {
						throw new Error('Boolean must be "true" or "false"');
					}
					value = lowerVal;
				}
			} catch (err) {
				showError(errorValue, err.message);
				return;
			}

			setLoading(true);
			vscode.postMessage({ command: 'pushConfig', key, value, type });
		});

		window.addEventListener('message', event => {
			const msg = event.data;
			const result = document.getElementById('result');
			if (msg.status === 'loading') {
				result.innerHTML = '<div class="loading-text">Pushing...</div>';
			} else if (msg.status === 'success') {
				setLoading(false);
				result.innerHTML = '<div class="success-text">' + msg.message + '</div>';
			} else if (msg.status === 'error') {
				setLoading(false);
				result.innerHTML = '<div class="error-text">Failed to update: ' + msg.message + '</div>';
			}
		});
	</script>
</body>
</html>`;
}
