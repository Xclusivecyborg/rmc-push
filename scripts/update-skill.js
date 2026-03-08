#!/usr/bin/env node
// update-skill.js — regenerates AUTO-GENERATED sections of skill.md
// Run: node scripts/update-skill.js
// Called automatically by the pre-commit hook when package.json is staged.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_PATH = path.join(ROOT, 'skill.md');
const PKG_PATH = path.join(ROOT, 'package.json');

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function readFile(p) {
	return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
	fs.writeFileSync(p, content, 'utf8');
}

/**
 * Walk src/ recursively, skip test/ directory.
 * Returns an array of relative paths sorted lexicographically.
 */
function walkSrc(dir, base) {
	base = base || dir;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const results = [];
	for (const entry of entries) {
		if (entry.isDirectory() && entry.name === 'test') { continue; }
		if (entry.isDirectory() && entry.name === 'node_modules') { continue; }
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkSrc(full, base));
		} else if (entry.name.endsWith('.ts')) {
			results.push(path.relative(base, full));
		}
	}
	return results.sort();
}

/**
 * Replace a single AUTO-GENERATED block in text.
 * Returns updated text.
 */
function replaceBlock(text, sectionName, newContent) {
	const startMarker = `<!-- AUTO-GENERATED: ${sectionName} -->`;
	const endMarker = `<!-- END AUTO-GENERATED: ${sectionName} -->`;
	const startIdx = text.indexOf(startMarker);
	const endIdx = text.indexOf(endMarker);
	if (startIdx === -1 || endIdx === -1) {
		// Section not present — append it
		return text + `\n${startMarker}\n${newContent}\n${endMarker}\n`;
	}
	return (
		text.slice(0, startIdx + startMarker.length) +
		'\n' +
		newContent +
		'\n' +
		text.slice(endIdx)
	);
}

// --------------------------------------------------------------------------
// Build section content from package.json
// --------------------------------------------------------------------------

const pkg = JSON.parse(readFile(PKG_PATH));

// What This Is
const whatThisIs = [
	`A VS Code extension that lets developers push key-value pairs directly to **Firebase Remote Config** from within VS Code, without opening the Firebase Console.`,
	``,
	`- **Extension ID**: \`${pkg.name}\``,
	`- **Display Name**: ${pkg.displayName}`,
	`- **Publisher**: ${pkg.publisher}`,
	`- **Version**: ${pkg.version}`,
	`- **Min VS Code**: ${pkg.engines.vscode.replace('^', '')}`
].join('\n');

// Commands
const commands = pkg.contributes.commands || [];
const commandRows = commands.map(c =>
	`| ${c.title} | \`${c.command}\` | ${c.description || '—'} |`
).join('\n');
const commandsSection = [
	`| Command | ID | Description |`,
	`|---|---|---|`,
	commandRows,
	``,
	`**Activation**: \`${(pkg.activationEvents || []).join(', ')}\``
].join('\n');

// Configuration
const props = (pkg.contributes.configuration && pkg.contributes.configuration.properties) || {};
const configLines = Object.entries(props).map(([key, val]) => {
	const v = val;
	return `- \`${key}\` (${v.type}): ${v.description}`;
}).join('\n');
const configSection = configLines || '_No configuration properties._';

// Build Scripts
const scripts = pkg.scripts || {};
const scriptLines = Object.entries(scripts).map(([name, cmd]) =>
	`- \`npm run ${name}\`: \`${cmd}\``
).join('\n');

// Project Structure
const srcFiles = walkSrc(path.join(ROOT, 'src'));
const tree = srcFiles.map(f => `│   ├── ${f}`).join('\n');
const projectStructure = [
	'```',
	`${pkg.name}/`,
	`├── src/`,
	tree,
	`├── scripts/`,
	`│   └── update-skill.js`,
	`├── dist/extension.js`,
	`├── esbuild.js`,
	`├── tsconfig.json`,
	`├── package.json`,
	`└── .vscode/`,
	'```'
].join('\n');

// --------------------------------------------------------------------------
// Patch skill.md
// --------------------------------------------------------------------------

let skill = readFile(SKILL_PATH);

skill = replaceBlock(skill, 'what-this-is', whatThisIs);
skill = replaceBlock(skill, 'commands', commandsSection);
skill = replaceBlock(skill, 'configuration', configSection);
skill = replaceBlock(skill, 'build-scripts', scriptLines);
skill = replaceBlock(skill, 'project-structure', projectStructure);

writeFile(SKILL_PATH, skill);
console.log('skill.md updated.');
