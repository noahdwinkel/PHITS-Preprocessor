const vscode = require('vscode');
const path = require('path');

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeExpr(expr) {
  return (expr ?? '').replace(/\s+/g, '');
}

function normalizeSectionName(raw) {
  return (raw ?? '').toLowerCase().replace(/[\s\-\_]+/g, '').trim();
}

function detectSection(line) {
  const m = line.match(/^\s*\[\s*([^\]]+)\s*\]/);
  if (!m) return null;
  return normalizeSectionName(m[1]);
}

function stripCommentsBySection(line, sectionName) {
  if (!line) return line;

  if (/^\s{0,4}[cC]\s/.test(line)) return '';

  const dollar = line.indexOf('$');
  if (dollar >= 0) return line.slice(0, dollar);

  const isSurface = sectionName === 'surface';
  const isCell = sectionName === 'cell';

  if (!isSurface && !isCell) {
    const hash = line.indexOf('#');
    const bang = line.indexOf('!');
    const first = [hash, bang].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (first !== undefined) return line.slice(0, first);
  }

  return line;
}

const RESERVED_WORDS = new Set([
  'title','parameters','source','material','surface','cell','end',
  'ttrack','tcross','tpoint','tdeposit','tdeposit2','theat','tyield','tproduct','tdpa','tlet','tsed','ttime','tinteract','tdchain','twwg','twwbg','tvolume','tuserdefined','tgshow','trshow','t3dshow','t4dtrack',
  'float','int','abs','exp','log','log10','max','min','mod','nint','sign','sqrt','acos','asin','atan','atan2','cos','cosh','sin','sinh','tan','tanh',
  'pi','set','infl','qp','q',
  'vol','tmp','trcl','u','lat','fill','mat','rho','like','but',
  'rpp','sph','rcc','rhp','hex','rec','trc','ell','wed','box'
].map((w) => w.toLowerCase()));

function normalizeNameForReservedCheck(name) {
  return (name ?? '').toLowerCase().replace(/[\s\[\]\-_:]+/g, '').trim();
}

function assertValidVarName(name) {
  const norm = normalizeNameForReservedCheck(name);
  if (!norm) throw new Error('Variable name is empty.');
  if (RESERVED_WORDS.has(norm)) {
    throw new Error(`Invalid variable name "${name}": reserved PHITS word/keyword/section.`);
  }
}

function isQuotedString(rhs) {
  if (!rhs) return false;
  const s = rhs.trim();
  if (s.length < 2) return false;
  const q0 = s[0];
  const q1 = s[s.length - 1];
  return (q0 === '"' && q1 === '"') || (q0 === "'" && q1 === "'");
}

function unquoteString(rhs) {
  const s = rhs.trim();
  return s.slice(1, -1);
}

function parseVarDeclsAndStripLines(inputText) {
  const lines = inputText.split(/\r?\n/);
  const declRe = /^\s*var\s+([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/;

  const decls = [];
  const keptLines = [];

  let section = '';

  for (const rawLine of lines) {
    const maybeSection = detectSection(rawLine);
    if (maybeSection) section = maybeSection;

    const candidate = stripCommentsBySection(rawLine, section);

    const m = candidate.match(declRe);
    if (!m) {
      keptLines.push(rawLine);
      continue;
    }

    const name = m[1];
    assertValidVarName(name);

    const rhsRaw = (m[2] ?? '').trim();
    if (!rhsRaw) throw new Error(`Variable "${name}" has no value.`);

    if (isQuotedString(rhsRaw)) decls.push({ name, kind: 'string', rhsRaw });
    else decls.push({ name, kind: 'number', rhsRaw });
  }

  return { decls, strippedText: keptLines.join('\n') };
}

function replaceTokens(text, replacementsMap) {
  const keys = Array.from(replacementsMap.keys()).sort((a, b) => b.length - a.length);
  let out = text;

  for (const name of keys) {
    const value = replacementsMap.get(name);
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
    out = out.replace(re, value);
  }
  return out;
}

function resolveDeclarationsSequential(decls) {
  const env = new Map(); // name -> { type: 'number'|'string', value: string }

  for (const decl of decls) {
    if (decl.kind === 'string') {
      env.set(decl.name, { type: 'string', value: unquoteString(decl.rhsRaw) });
      continue;
    }

    let expr = normalizeExpr(decl.rhsRaw);
    if (!expr) throw new Error(`Variable "${decl.name}" has no numeric expression.`);

    const subs = new Map();
    for (const [varName, varVal] of env.entries()) {
      const depRe = new RegExp(`\\b${escapeRegex(varName)}\\b`);
      if (!depRe.test(expr)) continue;

      if (varVal.type !== 'number') {
        throw new Error(
          `Type error in "${decl.name}": numeric expression references string variable "${varName}".`
        );
      }
      subs.set(varName, `(${varVal.value})`);
    }

    expr = replaceTokens(expr, subs);
    expr = normalizeExpr(expr);

    env.set(decl.name, { type: 'number', value: expr });
  }

  return env;
}

function buildFinalReplacementMap(env) {
  const map = new Map();
  for (const [name, v] of env.entries()) {
    if (v.type === 'number') map.set(name, `(${v.value})`);
    else map.set(name, v.value); // no quotes on substitution
  }
  return map;
}

async function writeOutputFile(originalPath, outputText) {
  const dir = path.dirname(originalPath);
  const base = path.basename(originalPath, path.extname(originalPath));
  const outName = `${base}.expanded.inp`;
  const outPath = path.join(dir, outName);

  const outUri = vscode.Uri.file(outPath);
  await vscode.workspace.fs.writeFile(outUri, Buffer.from(outputText, 'utf8'));
  return outUri;
}

function isInpEditor(editor) {
  if (!editor) return false;
  const doc = editor.document;
  if (!doc || doc.isUntitled) return false;
  return path.extname(doc.fileName).toLowerCase() === '.inp';
}

async function expandActiveInp() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('No active editor.');

  const doc = editor.document;
  if (!doc || doc.isUntitled) throw new Error('Save the file first.');
  if (path.extname(doc.fileName).toLowerCase() !== '.inp') throw new Error('This command only works for .inp files.');

  const inputText = doc.getText();

  const { decls, strippedText } = parseVarDeclsAndStripLines(inputText);
  const env = resolveDeclarationsSequential(decls);
  const finalMap = buildFinalReplacementMap(env);

  const outputText = replaceTokens(strippedText, finalMap);
  const outUri = await writeOutputFile(doc.fileName, outputText);

  return { outUri, replacedCount: finalMap.size, sourceDoc: doc };
}

let sharedTerminal = null;

function getConfig() {
  return vscode.workspace.getConfiguration('phitsPreprocessor');
}

function platformDefault(cmdType) {
  const isWin = process.platform === 'win32';
  if (cmdType === 'phits') return isWin ? 'phits.bat' : 'phits.sh';
  if (cmdType === 'phig3d') return isWin ? 'phig3d.bat' : 'phid3d.sh';
  return '';
}

function getOrCreateTerminal(cwd) {
  if (sharedTerminal) return sharedTerminal;

  sharedTerminal = vscode.window.createTerminal({
    name: 'PHITS',
    cwd
  });

  const sub = vscode.window.onDidCloseTerminal((t) => {
    if (sharedTerminal && t === sharedTerminal) sharedTerminal = null;
    sub.dispose();
  });

  return sharedTerminal;
}

function quoteForShell(s) {
  if (!s) return s;
  if (/[ \t"]/g.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function isBatchCommand(cmd) {
  const c = (cmd ?? '').trim().toLowerCase();
  if (c.startsWith('wsl ')) return false;
  return c.endsWith('.bat') || c.endsWith('.cmd');
}

function resolveCommand(cmdSettingValue, fallback) {
  const v = (cmdSettingValue ?? '').trim();
  return v.length ? v : fallback;
}

async function runInTerminal({ command, inputUri }) {
  const inputPath = inputUri.fsPath;
  const cwd = path.dirname(inputPath);
  const fileName = path.basename(inputPath);

  const term = getOrCreateTerminal(cwd);
  term.show(true);

  const cmd = (command ?? '').trim();
  if (!cmd) throw new Error('Command is empty. Check PHITS Preprocessor settings.');

  if (process.platform === 'win32' && isBatchCommand(cmd)) {
    const bat = quoteForShell(cmd);
    const arg = quoteForShell(fileName);
    term.sendText(`cmd /c ""${bat} ${arg}""`, true);
    return;
  }

  term.sendText(`${cmd} ${quoteForShell(fileName)}`, true);
}

function boilerplateText() {
  return [
    '[title]',
    '',
    '[parameters]',
    '',
    '[material]',
    '',
    '[surface]',
    '',
    '[cell]',
    '',
    '[source]',
    '',
    '[end]',
    ''
  ].join('\n');
}

async function createBoilerplateFile() {
  const doc = await vscode.workspace.openTextDocument({
    language: 'phits-inp',
    content: boilerplateText()
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Shortcut labels are *display-only* (VS Code keybindings are user-overridable in Keyboard Shortcuts UI).
 * These values let the run menu reflect whatever the user set their shortcuts to.
 */
function getShortcutLabel(commandId) {
  const cfg = getConfig();
  const labels = cfg.get('shortcutLabels') ?? {};
  return labels[commandId] ?? '';
}

async function showRunMenu() {
  const items = [
    { label: 'Run PHITS (current file)', command: 'phits-preprocessor.runPhits' },
    { label: 'Send to PHIG-3D (current file)', command: 'phits-preprocessor.sendToPhig3d' },
    { label: 'Expand only (create .expanded.inp)', command: 'phits-preprocessor.replaceVariables' },
    { label: 'Expand and run PHITS', command: 'phits-preprocessor.runPhitsExpanded' },
    { label: 'Expand and send to PHIG-3D', command: 'phits-preprocessor.sendToPhig3dExpanded' },
    { label: 'Create PHITS boilerplate input', command: 'phits-preprocessor.createBoilerplate' }
  ].map((it) => ({
    ...it,
    // VS Code renders `description` on the right in grey.
    description: getShortcutLabel(it.command)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'PHITS',
    placeHolder: 'Choose an action'
  });

  if (!picked) return;
  await vscode.commands.executeCommand(picked.command);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.runMenu', async () => {
      try {
        await showRunMenu();
      } catch (err) {
        vscode.window.showErrorMessage(`PHITS menu failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.replaceVariables', async () => {
      try {
        const { outUri, replacedCount } = await expandActiveInp();
        vscode.window.showInformationMessage(
          `Wrote ${path.basename(outUri.fsPath)} (${replacedCount} vars expanded).`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`PHITS preprocessor failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.runPhits', async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor.');
        const doc = editor.document;

        if (!doc || doc.isUntitled) throw new Error('Save the file first.');
        if (path.extname(doc.fileName).toLowerCase() !== '.inp') throw new Error('This command only works for .inp files.');

        const cfg = getConfig();
        const cmd = resolveCommand(cfg.get('phitsCommand'), platformDefault('phits'));
        await runInTerminal({ command: cmd, inputUri: doc.uri });
      } catch (err) {
        vscode.window.showErrorMessage(`PHITS run failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.runPhitsExpanded', async () => {
      try {
        const { outUri, replacedCount } = await expandActiveInp();

        const cfg = getConfig();
        const cmd = resolveCommand(cfg.get('phitsCommand'), platformDefault('phits'));
        await runInTerminal({ command: cmd, inputUri: outUri });

        vscode.window.showInformationMessage(
          `Expanded (${replacedCount} vars) and ran PHITS on ${path.basename(outUri.fsPath)}.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`PHITS expanded run failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.sendToPhig3dExpanded', async () => {
      try {
        const { outUri, replacedCount } = await expandActiveInp();

        const cfg = getConfig();
        const cmd = resolveCommand(cfg.get('phig3dCommand'), platformDefault('phig3d'));
        await runInTerminal({ command: cmd, inputUri: outUri });

        vscode.window.showInformationMessage(
          `Expanded (${replacedCount} vars) and launched PHIG-3D for ${path.basename(outUri.fsPath)}.`
        );
      } catch (err) {
        vscode.window.showErrorMessage(`PHIG-3D launch failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.sendToPhig3d', async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor.');
        const doc = editor.document;

        if (!doc || doc.isUntitled) throw new Error('Save the file first.');
        if (path.extname(doc.fileName).toLowerCase() !== '.inp') throw new Error('This command only works for .inp files.');

        const cfg = getConfig();
        const cmd = resolveCommand(cfg.get('phig3dCommand'), platformDefault('phig3d'));
        await runInTerminal({ command: cmd, inputUri: doc.uri });
      } catch (err) {
        vscode.window.showErrorMessage(`PHIG-3D launch failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('phits-preprocessor.createBoilerplate', async () => {
      try {
        await createBoilerplateFile();
      } catch (err) {
        vscode.window.showErrorMessage(`Boilerplate failed: ${err?.message ?? String(err)}`);
      }
    })
  );

  const btnRunMenu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
  btnRunMenu.text = '$(play) PHITS Run';
  btnRunMenu.tooltip = 'PHITS actions (menu)';
  btnRunMenu.command = 'phits-preprocessor.runMenu';
  context.subscriptions.push(btnRunMenu);

  const refresh = () => {
    if (isInpEditor(vscode.window.activeTextEditor)) btnRunMenu.show();
    else btnRunMenu.hide();
  };

  refresh();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument(() => refresh())
  );
}

function deactivate() {}

module.exports = { activate, deactivate };