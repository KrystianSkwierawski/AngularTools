'use strict';

// Runs with the workspace's TypeScript version, so its module resolution and
// symbol identity agree with the application being edited.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ignored = new Set(['node_modules', '.git', '.angular', 'dist', 'build', 'coverage', 'bin', 'obj', '.vs']);
const slash = p => p.replace(/\\/g, '/');
const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = message => { throw new Error(message); };

function walk(root) {
  const files = [];
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const p = path.join(root, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) files.push(...walk(p));
    else if (item.isFile()) files.push(p);
  }
  return files;
}

function findRoot(selected) {
  let dir = path.dirname(path.resolve(selected));
  let packageRoot;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'angular.json')) || fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    if (!packageRoot && fs.existsSync(path.join(dir, 'package.json'))) packageRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) return packageRoot || fail('Cannot find an Angular workspace or package.json.');
    dir = parent;
  }
}

function sourceFor(selected) {
  if (/\.(?:spec|test)\.ts$/i.test(selected)) return selected.replace(/\.(spec|test)\.ts$/i, '.ts');
  if (/\.(html|css|scss|sass|less)$/i.test(selected)) return selected.replace(/\.(html|css|scss|sass|less)$/i, '.ts');
  if (/\.ts$/i.test(selected) && !/\.d\.ts$/i.test(selected)) return selected;
  fail('Select an Angular TypeScript file, template, stylesheet or test.');
}

function names(input, oldStem) {
  input = input.trim().replace(/\.ts$/i, '');
  if (!input || /[\\/:<>"|?*\x00-\x1f]/.test(input)) fail('Enter a name, not a path.');
  const oldSuffix = oldStem.match(/\.(component|directive|service|guard|module|pipe|resolver|interceptor|enum|interface|class|model|type)$/)?.[0] || '';
  const explicit = input.match(/\.(component|directive|service|guard|module|pipe|resolver|interceptor|enum|interface|class|model|type)$/)?.[0] || '';
  // A trailing dot explicitly opts into the suffixless convention.
  const suffix = input.endsWith('.') ? '' : explicit || oldSuffix;
  input = input.replace(/\.$/, '');
  if (explicit) input = input.slice(0, -explicit.length);
  const base = input.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z\d])([A-Z])/g, '$1-$2').replace(/[ _-]+/g, '-').toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(base) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) fail('Use a valid name such as user-profile or UserProfile.');
  return { base, stem: base + suffix, oldBase: oldStem.slice(0, oldStem.length - oldSuffix.length), suffix };
}
const pascal = s => s.split(/[-.]/).map(x => x[0].toUpperCase() + x.slice(1)).join('');

function plan(selected, input, root = findRoot(selected), tsOverride) {
  selected = path.resolve(selected); root = path.resolve(root);
  if (!inside(root, selected)) fail('Selected file is outside the workspace.');
  const source = sourceFor(selected);
  if (!fs.existsSync(source)) fail('Cannot find the associated TypeScript file: ' + source);
  let ts;
  try { ts = tsOverride || require(require.resolve('typescript', { paths: [path.dirname(source), root] })); }
  catch { fail('Install the workspace dependencies first: TypeScript must be available in node_modules.'); }
  const oldStem = path.basename(source, '.ts');
  const n = names(input, oldStem);
  if (oldStem === n.stem) fail('The new name is unchanged.');
  const files = walk(root);
  const dir = path.dirname(source);
  const folderName = path.basename(dir);
  const moveDir = folderName === n.oldBase || folderName === oldStem;
  if (moveDir && key(dir) === key(root)) fail('The workspace root cannot be renamed.');
  const newDir = moveDir ? path.join(path.dirname(dir), folderName === n.oldBase ? n.base : n.stem) : dir;
  const directory = key(dir) !== key(newDir) ? { from: dir, to: newDir } : null;
  const associated = new Set(files.filter(f => path.dirname(f) === dir &&
    new RegExp('^' + escape(oldStem) + '(?:\\.(?:spec|test))?\\.(?:ts|html|css|scss|sass|less)$').test(path.basename(f))).map(key));
  const relocated = f => {
    let result = directory && inside(dir, f) ? path.join(newDir, path.relative(dir, f)) : f;
    if (associated.has(key(f))) result = path.join(path.dirname(result), n.stem + path.basename(f).slice(oldStem.length));
    return result;
  };
  if (directory && fs.existsSync(directory.to)) fail('Destination folder already exists: ' + directory.to);
  // A folder rename must not silently move ignored build output or symlink targets.
  if (directory) {
    const check = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink() || ignored.has(e.name)) fail('Folder contains an excluded directory or symlink: ' + e.name);
      if (e.isDirectory()) check(path.join(d, e.name));
    } }; check(dir);
  }
  const texts = new Map();
  const originals = new Map();
  for (const f of files.filter(f => /\.(ts|tsx|html|css|scss|sass|less|json|csproj|esproj|njsproj|projitems)$/.test(f))) {
    const bytes = fs.readFileSync(f);
    if (bytes.includes(0)) fail('Unsupported text encoding (use UTF-8): ' + f);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) fail('Unsupported text encoding (use UTF-8): ' + f);
    texts.set(f, text); originals.set(f, bytes);
  }
  const edits = new Map();
  const edit = (file, start, length, text) => {
    if (!inside(root, file) || !texts.has(file)) fail('A reference is outside the editable workspace: ' + file);
    const list = edits.get(file) || [];
    if (!list.some(e => e.start === start && e.length === length && e.text === text)) list.push({ start, length, text });
    edits.set(file, list);
  };
  const asts = new Map([...texts].filter(([f]) => /\.tsx?$/.test(f)).map(([f, text]) => [f, ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true)]));
  const ast = asts.get(source);
  const declarations = ast.statements.filter(s => s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [s])
    .filter(s => s.name && ts.isIdentifier(s.name) &&
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isEnumDeclaration(s) || ts.isFunctionDeclaration(s) || ts.isVariableDeclaration(s)));
  if (declarations.length !== 1) fail('Rename requires exactly one exported class, interface, enum, function or variable.');
  const declaration = declarations[0];
  const oldSymbol = declaration.name.text;
  const expected = pascal(oldStem);
  const functionStyle = ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration);
  const newPascal = pascal(n.stem);
  const newSymbol = functionStyle ? newPascal[0].toLowerCase() + newPascal.slice(1) : newPascal;
  if (oldSymbol !== expected && !(functionStyle && oldSymbol === expected[0].toLowerCase() + expected.slice(1)))
    fail('The exported name does not follow the filename convention: ' + oldSymbol + '. Rename it with the TypeScript symbol refactoring first.');

  const configs = files.filter(f => /^tsconfig.*\.json$/.test(path.basename(f))).map(f => {
    const read = ts.readConfigFile(f, ts.sys.readFile);
    if (read.error) fail(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(f));
    const errors = parsed.errors.filter(e => e.code !== 18003);
    if (errors.length) fail(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    return { file: f, options: parsed.options, files: parsed.fileNames };
  });
  if (!configs.length) fail('No tsconfig found in the workspace.');
  const optionsFor = f => configs.filter(c => c.files.some(p => key(p) === key(f))).sort((a, b) => b.file.length - a.file.length)[0]?.options || configs[0].options;
  // Each configuration may use different aliases; collect semantic references in
  // each project, retaining import aliases and shorthand property names.
  function renameIdentifier(identifier, replacement) { for (const config of configs) {
    const options = { ...config.options, allowNonTsExtensions: true };
    const host = {
      getScriptFileNames: () => [...asts.keys()], getScriptVersion: () => '0',
      getScriptSnapshot: f => { const t = texts.get(f) ?? ts.sys.readFile(f); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
      getCurrentDirectory: () => root, getCompilationSettings: () => options,
      getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
      fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
    };
    const service = ts.createLanguageService(host);
    try {
      const refs = service.findRenameLocations(source, identifier.getStart(ast), false, false, true);
      if (!refs?.length) fail('TypeScript could not resolve the exported symbol.');
      const program = service.getProgram();
      const checker = program.getTypeChecker();
      for (const r of refs) {
        const tree = program.getSourceFile(r.fileName);
        let token = tree;
        const locate = node => {
          if (node.getStart(tree) <= r.textSpan.start && node.end > r.textSpan.start) {
            token = node; ts.forEachChild(node, locate);
          }
        };
        locate(tree);
        const parent = token.parent;
        let collision;
        if (ts.isPropertyAccessExpression(parent) && parent.name === token)
          collision = checker.getTypeAtLocation(parent.expression).getProperty(replacement);
        else if (parent.name === token && parent.parent && ts.isClassLike(parent.parent))
          collision = parent.parent.members.find(m => m.name?.getText(tree) === replacement);
        else
          collision = checker.getSymbolsInScope(token, ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace).find(s => s.name === replacement);
        if (collision) fail('The new symbol name is already declared in this scope in ' + tree.fileName + ': ' + replacement);
        edit(path.resolve(r.fileName), r.textSpan.start, r.textSpan.length, (r.prefixText || '') + replacement + (r.suffixText || ''));
      }
    } finally { service.dispose(); }
  } }
  renameIdentifier(declaration.name, newSymbol);

  const resolve = (specifier, from) => ts.resolveModuleName(specifier, from, optionsFor(from), ts.sys).resolvedModule?.resolvedFileName;
  for (const [f, tree] of asts) {
    const visit = node => {
      if (ts.isStringLiteralLike(node)) {
        const p = node.parent;
        const module = (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node ||
          ts.isCallExpression(p) && p.arguments[0] === node && (p.expression.kind === ts.SyntaxKind.ImportKeyword || p.expression.getText(tree) === 'require') ||
          ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent);
        if (module) {
          const target = resolve(node.text, f);
          if (target && (relocated(target) !== target || relocated(f) !== f)) {
            let spec = node.text;
            const targetNew = relocated(target);
            // Keep aliases when they still resolve to the destination. Otherwise
            // use a direct relative path; unlike string replacement this handles
            // index barrels and references leaving a renamed directory.
            if (spec.startsWith('.') || targetNew !== target) {
              spec = slash(path.relative(path.dirname(relocated(f)), targetNew)).replace(/\.(?:tsx?|jsx?)$/, '');
              if (/\/index$/.test(spec) && !/\/index(?:\.[cm]?[jt]s)?$/.test(node.text)) spec = spec.slice(0, -6);
              const extension = node.text.match(/\.(?:tsx?|jsx?)$/)?.[0];
              if (extension && !spec.endsWith(extension)) spec += extension;
              if (!spec.startsWith('.')) spec = './' + spec;
            }
            if (spec !== node.text) edit(f, node.getStart(tree) + 1, node.getWidth(tree) - 2, spec);
          }
        }
      }
      ts.forEachChild(node, visit);
    }; visit(tree);
  }

  // Only Angular decorator object literals are treated as metadata.
  const angularImports = tree => {
    const imports = new Map();
    for (const s of tree.statements) if (ts.isImportDeclaration(s) && s.moduleSpecifier.text === '@angular/core') {
      for (const el of s.importClause?.namedBindings?.elements || []) imports.set(el.name.text, el.propertyName?.text || el.name.text);
      const binding = s.importClause?.namedBindings;
      if (binding && ts.isNamespaceImport(binding))
        for (const name of ['Component', 'Directive', 'Pipe', 'Input', 'Output', 'input', 'output', 'model']) imports.set(binding.name.text + '.' + name, name);
    }
    return imports;
  };
  const metadata = tree => {
    const imports = angularImports(tree);
    const result = [];
    const visit = node => {
      if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && ['Component', 'Directive', 'Pipe'].includes(imports.get(node.expression.expression.getText(tree)))) {
        const obj = node.expression.arguments[0];
        if (!obj || !ts.isObjectLiteralExpression(obj)) fail('Computed Angular metadata is not supported: ' + tree.fileName);
        result.push({ kind: imports.get(node.expression.expression.getText(tree)), obj });
      }
      ts.forEachChild(node, visit);
    }; visit(tree); return result;
  };
  const metas = new Map([...asts].map(([f, tree]) => [f, metadata(tree)]));
  const properties = obj => obj.properties.filter(ts.isPropertyAssignment);
  const literal = p => ts.isStringLiteralLike(p.initializer);
  const selectorChanges = [];
  let pipeChange;
  for (const { kind, obj } of metas.get(source)) for (const p of properties(obj)) {
    const prop = p.name.getText(ast).replace(/['"]/g, '');
    if (prop === 'selector' || kind === 'Pipe' && prop === 'name') {
      if (!literal(p)) fail('Computed selector/pipe name cannot be renamed safely.');
      const old = p.initializer.text;
      if (prop === 'name') {
        const replacement = n.base.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        pipeChange = [old, replacement];
        edit(source, p.initializer.getStart(ast) + 1, p.initializer.getWidth(ast) - 2, replacement);
      } else {
        const tokens = old.split(',').map(s => s.trim());
        for (const token of tokens) {
          const match = token.match(/^(?:([a-zA-Z][\w-]*)|\[([a-zA-Z][\w-]*)\]|\.([a-zA-Z][\w-]*))$/);
          if (!match) fail('Complex selectors require a manual rename: ' + token);
          const type = match[1] ? 'element' : match[2] ? 'attribute' : 'class';
          const value = match[1] || match[2] || match[3];
          const oldPart = type === 'attribute' ? n.oldBase.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : n.oldBase;
          const newPart = type === 'attribute' ? n.base.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : n.base;
          const upperOld = oldPart[0].toUpperCase() + oldPart.slice(1);
          const replacement = value === oldPart || value.endsWith('-' + oldPart) ? value.slice(0, -oldPart.length) + newPart :
            type === 'attribute' && value.endsWith(upperOld) ? value.slice(0, -upperOld.length) + newPart[0].toUpperCase() + newPart.slice(1) : null;
          if (!replacement) fail('Selector does not follow the filename convention: ' + token);
          selectorChanges.push({ type, old: value, value: replacement, token });
        }
        let replacement = old;
        for (const change of selectorChanges) replacement = replacement.replace(change.token, change.token.replace(change.old, change.value));
        edit(source, p.initializer.getStart(ast) + 1, p.initializer.getWidth(ast) - 2, replacement);
      }
    }
  }
  for (const [f, items] of metas) if (f !== source) for (const { obj } of items) for (const p of properties(obj)) {
    const prop = p.name.getText(asts.get(f)).replace(/['"]/g, '');
    if (literal(p) && prop === 'selector' && selectorChanges.some(c => p.initializer.text.split(',').map(s => s.trim()).some(s => s === c.token || s === c.token.replace(c.old, c.value))))
      fail('Another declaration uses the same selector in ' + f + '. Rename requires an unambiguous selector.');
    if (literal(p) && prop === 'name' && pipeChange?.includes(p.initializer.text)) fail('Another pipe uses the same name: ' + f);
  }
  // Attribute selectors frequently double as public inputs (and two-way
  // outputs). Change only their public aliases: member names can also be used
  // in Angular expressions, which the TypeScript service cannot rename.
  const publicBindings = new Map();
  for (const c of selectorChanges.filter(c => c.type === 'attribute')) {
    publicBindings.set(c.old, c.value);
    publicBindings.set(c.old + 'Change', c.value + 'Change');
  }
  function rememberBinding(name) {
    for (const c of selectorChanges.filter(c => c.type === 'attribute')) {
      // Angular expands `of`, `trackBy`, etc. into selector + PascalCase key.
      if (name.startsWith(c.old) && /^[A-Z]/.test(name.slice(c.old.length)))
        publicBindings.set(name, c.value + name.slice(c.old.length));
    }
  }
  function bindingAlias(call, optionsIndex, memberName, decorator) {
    const options = call.arguments[optionsIndex];
    if (options && ts.isStringLiteralLike(options) && decorator) {
      rememberBinding(options.text);
      if (publicBindings.has(options.text)) edit(source, options.getStart(ast) + 1, options.getWidth(ast) - 2, publicBindings.get(options.text));
      return;
    }
    if (options && !ts.isObjectLiteralExpression(options)) {
      if (publicBindings.has(memberName)) fail('Computed binding options cannot be renamed safely.');
      return;
    }
    const alias = options && properties(options).find(p => p.name.getText(ast).replace(/['"]/g, '') === 'alias');
    if (alias) {
      if (!literal(alias)) fail('Computed binding alias cannot be renamed safely.');
      rememberBinding(alias.initializer.text);
      if (publicBindings.has(alias.initializer.text)) edit(source, alias.initializer.getStart(ast) + 1, alias.initializer.getWidth(ast) - 2, publicBindings.get(alias.initializer.text));
      return;
    }
    rememberBinding(memberName);
    if (!publicBindings.has(memberName)) return;
    const value = JSON.stringify(publicBindings.get(memberName));
    if (options) {
      const comma = options.properties.length && !options.properties.hasTrailingComma ? ',' : '';
      edit(source, options.end - 1, 0, comma + ' alias: ' + value);
    } else {
      const argument = decorator ? value : '{ alias: ' + value + ' }';
      const missingDefault = optionsIndex === 1 && call.arguments.length === 0 ? 'undefined, ' : '';
      const comma = call.arguments.length && !call.arguments.hasTrailingComma ? ', ' : '';
      edit(source, call.end - 1, 0, comma + missingDefault + argument);
    }
  }
  const sourceImports = angularImports(ast);
  for (const member of declaration.members || []) {
    const memberName = member.name && ts.isIdentifier(member.name) ? member.name.text : '';
    for (const decorator of member.modifiers?.filter(ts.isDecorator) || []) {
      if (!ts.isCallExpression(decorator.expression)) continue;
      const call = decorator.expression;
      if (!['Input', 'Output'].includes(sourceImports.get(call.expression.getText(ast)))) continue;
      bindingAlias(call, 0, memberName, true);
    }
    if (member.initializer && ts.isCallExpression(member.initializer)) {
      const expression = member.initializer.expression.getText(ast);
      const required = expression.endsWith('.required');
      const name = sourceImports.get(required ? expression.slice(0, -'.required'.length) : expression);
      if (['input', 'output', 'model'].includes(name))
        bindingAlias(member.initializer, name === 'output' || required ? 0 : 1, memberName, false);
    }
  }
  for (const member of declaration.members || []) {
    if (!member.name || !ts.isIdentifier(member.name) || !member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
    const prefix = 'ngTemplateGuard_';
    if (member.name.text.startsWith(prefix)) {
      const binding = member.name.text.slice(prefix.length);
      if (publicBindings.has(binding)) renameIdentifier(member.name, prefix + publicBindings.get(binding));
    }
  }
  const template = (text, file) => {
    // Tag-only edits keep prose, comments and attribute values intact.
    let result = text.replace(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g, tag => {
      if (tag.startsWith('<!--')) return tag;
      for (const c of selectorChanges) {
        if (c.type === 'element') tag = tag.replace(new RegExp('^(<\\/?)' + escape(c.old) + '(?=[\\s/>])'), '$1' + c.value);
        if (c.type === 'attribute') tag = tag.replace(/"[^"]*"|'[^']*'|([^\s=<>/]+)/g, (token, name) => {
          if (!name) return token;
          if (token === '*' + c.old) return '*' + c.value;
          for (const [oldBinding, newBinding] of publicBindings) {
            if ([oldBinding, '[' + oldBinding + ']', '[(' + oldBinding + ')]', '(' + oldBinding + ')'].includes(token))
              return token.replace(oldBinding, newBinding);
          }
          return token;
        });
        if (c.type === 'class') {
          tag = tag.replace(/(\sclass\s*=\s*)(["'])([\s\S]*?)\2/g, (_, prefix, quote, value) => prefix + quote + value.replace(new RegExp('(^|\\s)' + escape(c.old) + '(?=\\s|$)', 'g'), '$1' + c.value) + quote);
          tag = tag.replace(new RegExp('(\\[class\\.)' + escape(c.old) + '(\\])', 'g'), '$1' + c.value + '$2');
        }
      }
      return tag;
    });
    if (pipeChange) {
      const expression = value => value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\|\||\|\s*([\w$]+)/g, (token, name) => name === pipeChange[0] ? token.replace(name, pipeChange[1]) : token);
      result = result.replace(/<!--[\s\S]*?-->|{{[\s\S]*?}}|(?:\[[^\]]+\]|\*[^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, token => {
        if (token.startsWith('<!--')) return token;
        if (token.startsWith('{{')) return expression(token);
        return token.replace(/(["'])([\s\S]*)\1$/, (_, quote, body) => quote + expression(body) + quote);
      });
      // Control-flow headers can contain nested calls, objects and quoted
      // delimiters, so locate their boundaries with a balanced scan.
      const headers = /<!--[\s\S]*?-->|{{[\s\S]*?}}|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|@(else\s+if|if|for|switch|case|let)\b/g;
      let match, offset = 0, rebuilt = '';
      while ((match = headers.exec(result))) {
        if (!match[1]) continue;
        let start = headers.lastIndex;
        while (/\s/.test(result[start] || '') && start < result.length) start++;
        const isLet = match[1] === 'let';
        if (!isLet && result[start] !== '(') continue;
        let end = start, quote = '', depth = 0, closed = false;
        for (; end < result.length; end++) {
          const c = result[end];
          if (quote) { if (c === '\\') end++; else if (c === quote) quote = ''; continue; }
          if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
          if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) {
            depth--;
            if (!isLet && depth === 0) { closed = true; end++; break; }
          } else if (isLet && c === ';' && depth === 0) { closed = true; end++; break; }
        }
        if (!closed) fail('Cannot safely parse an Angular control-flow expression.');
        rebuilt += result.slice(offset, start) + expression(result.slice(start, end));
        offset = end; headers.lastIndex = end;
      }
      result = rebuilt + result.slice(offset);
    }
    return result.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => open + resourceUrls(styles(css), file) + close);
  };
  const resourceUrls = (text, file) => text.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(url\(\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^)'"\s]+))(\s*\))/gi,
    (all, prefix, double, single, bare, closing) => {
      if (!prefix || !file) return all;
      const spec = double ?? single ?? bare;
      if (/^(?:[a-z][\w+.-]*:|\/|#|~)/i.test(spec) || /[\\$]|#\{/.test(spec)) return all;
      const split = spec.search(/[?#]/);
      const pathname = split < 0 ? spec : spec.slice(0, split);
      const suffix = split < 0 ? '' : spec.slice(split);
      let decoded;
      try { decoded = decodeURIComponent(pathname); } catch { return all; }
      const target = path.resolve(path.dirname(file), decoded);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile() || relocated(target) === target && relocated(file) === file) return all;
      let relative = slash(path.relative(path.dirname(relocated(file)), relocated(target)));
      if (pathname.startsWith('./') && !relative.startsWith('.')) relative = './' + relative;
      // URL-encode path segments without changing path separators or dot segments.
      relative = relative.split('/').map(encodeURIComponent).join('/');
      const quote = double !== undefined ? '"' : single !== undefined ? "'" : '';
      return prefix + quote + relative + suffix + quote + closing;
    });
  const styles = text => {
    // Process selector preludes only, never declaration values, quoted strings
    // or comments (e.g. content: 'app-old' must remain unchanged).
    let result = '', start = 0, i = 0;
    while (i < text.length) {
      if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
      if (text[i] === '"' || text[i] === "'") { const q = text[i++]; while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i++] === q) break; } continue; }
      if (text[i] === '{') {
        let prelude = text.slice(start, i);
        prelude = prelude.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^"'/]+|./g, part => {
          if (/^(?:\/\*|["'])/.test(part)) return part;
          for (const c of selectorChanges) {
            const re = c.type === 'element' ? new RegExp('(^|[^\\w.#-])' + escape(c.old) + '(?![\\w-])', 'g') :
              c.type === 'class' ? new RegExp('(\\.)' + escape(c.old) + '(?![\\w-])', 'g') :
              new RegExp('(\\[\\s*)' + escape(c.old) + '(?=\\s*[\\]=~|^$*])', 'g');
            part = part.replace(re, '$1' + c.value);
          }
          return part;
        });
        result += prelude + '{'; start = i + 1;
      } else if (text[i] === ';' || text[i] === '}') { result += text.slice(start, i + 1); start = i + 1; }
      i++;
    }
    return result + text.slice(start);
  };
  for (const [f, tree] of asts) {
    const visit = node => {
      if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
        const method = node.expression.getText(tree).split('.').pop();
        const literal = node.arguments[0];
        let value = literal.text;
        if (['querySelector', 'querySelectorAll', 'closest', 'matches'].includes(method) || /\bBy\.css$/.test(node.expression.getText(tree)))
          value = styles(value + '{}').slice(0, -2);
        else {
          const type = method === 'getElementsByTagName' ? 'element' : method === 'getElementsByClassName' ? 'class' :
            ['getAttribute', 'hasAttribute', 'setAttribute', 'removeAttribute'].includes(method) ? 'attribute' : null;
          value = selectorChanges.find(c => c.type === type && c.old === value)?.value || value;
        }
        if (value !== literal.text) edit(f, literal.getStart(tree) + 1, literal.getWidth(tree) - 2, value);
      }
      ts.forEachChild(node, visit);
    }; visit(tree);
  }
  for (const [f, text] of texts) if (/\.html$/.test(f)) {
    const updated = template(text, f); if (updated !== text) edit(f, 0, text.length, updated);
  }
  for (const [f, text] of texts) if (/\.(css|scss|sass|less)$/.test(f)) {
    let updated = /\.sass$/.test(f) ? text.replace(/[^\r\n]+/g, line => {
      if (/^\s*(?:\/\/|\$|[\w-]+\s*:\s)/.test(line)) return line;
      return styles(line + '{}').slice(0, -2);
    }) : styles(text);
    updated = updated.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(@(?:import|use|forward)\s+["'])([^"']+)(["'])/g, (all, prefix, spec, quote) => {
      if (!prefix) return all;
      if (/^(?:https?:|~|sass:)/.test(spec)) return all;
      const absolute = path.resolve(path.dirname(f), spec);
      const extensions = path.extname(spec) ? [''] : ['.scss', '.sass', '.css', '.less'];
      const candidates = extensions.flatMap(ext => [absolute + ext, path.join(path.dirname(absolute), '_' + path.basename(absolute)) + ext]);
      const isFile = p => fs.existsSync(p) && fs.statSync(p).isFile();
      let matches = candidates.filter(isFile);
      let index = false;
      if (!matches.length && !path.extname(spec)) {
        index = true;
        matches = ['_index.scss', 'index.scss', '_index.sass', 'index.sass'].map(name => path.join(absolute, name)).filter(isFile);
      }
      if (matches.length > 1) fail('Ambiguous stylesheet import: ' + spec);
      const target = matches[0];
      if (!target || relocated(target) === target && relocated(f) === f) return all;
      let destination = relocated(target);
      if (index) destination = path.dirname(destination);
      else if (!path.basename(spec).startsWith('_') && path.basename(destination).startsWith('_'))
        destination = path.join(path.dirname(destination), path.basename(destination).slice(1));
      let relative = slash(path.relative(path.dirname(relocated(f)), destination));
      if (!index && !path.extname(spec)) relative = relative.replace(/\.(scss|sass|css|less)$/, '');
      if (spec.startsWith('./') && !relative.startsWith('.')) relative = './' + relative;
      return prefix + relative + quote;
    });
    updated = resourceUrls(updated, f);
    if (updated !== text) edit(f, 0, text.length, updated);
  }
  for (const [f, items] of metas) for (const { obj } of items) for (const p of properties(obj)) {
    const tree = asts.get(f);
    const prop = p.name.getText(tree).replace(/['"]/g, '');
    if (prop === 'template' && literal(p)) {
      const raw = textSlice(f, p.initializer, tree);
      const updated = template(raw, f); if (updated !== raw) edit(f, p.initializer.getStart(tree) + 1, p.initializer.getWidth(tree) - 2, updated);
    }
    if (prop === 'styles') {
      const nodes = ts.isArrayLiteralExpression(p.initializer) ? p.initializer.elements : [p.initializer];
      for (const node of nodes) if (ts.isStringLiteralLike(node)) {
        const raw = textSlice(f, node, tree), updated = resourceUrls(styles(raw), f);
        if (raw !== updated) edit(f, node.getStart(tree) + 1, node.getWidth(tree) - 2, updated);
      }
    }
    if (['templateUrl', 'styleUrl', 'styleUrls'].includes(prop)) {
      const nodes = ts.isArrayLiteralExpression(p.initializer) ? p.initializer.elements : [p.initializer];
      for (const node of nodes) {
        if (!ts.isStringLiteralLike(node)) fail('Computed template/style URLs cannot be renamed safely: ' + f);
        const target = path.resolve(path.dirname(f), node.text);
        if (relocated(target) !== target || relocated(f) !== f) {
          let relative = slash(path.relative(path.dirname(relocated(f)), relocated(target)));
          if (node.text.startsWith('./') && !relative.startsWith('.')) relative = './' + relative;
          if (relative !== node.text) edit(f, node.getStart(tree) + 1, node.getWidth(tree) - 2, relative);
        }
      }
    }
  }
  function textSlice(f, node, tree) { return texts.get(f).slice(node.getStart(tree) + 1, node.end - 1); }
  for (const [f, text] of texts) if (/\.(csproj|esproj|njsproj|projitems)$/.test(f)) {
    const updated = text.replace(/<!--[\s\S]*?-->|\b(Include|Update|Remove)\s*=\s*(["'])([^"']+)\2/g, (all, attribute, quote, value) => {
      if (!attribute || /[$@%&]/.test(value)) return all;
      const replacement = value.split(';').map(spec => {
        const wildcard = spec.search(/[?*]/);
        const prefix = wildcard < 0 ? spec : spec.slice(0, wildcard);
        const target = path.resolve(path.dirname(f), prefix.replace(/\\/g, path.sep));
        if (relocated(target) === target) return spec;
        let relative = path.relative(path.dirname(relocated(f)), relocated(target));
        if (spec.includes('/')) relative = slash(relative);
        if (/[\\/]$/.test(prefix)) relative += spec.includes('/') ? '/' : '\\';
        return relative + (wildcard < 0 ? '' : spec.slice(wildcard));
      }).join(';');
      return all.replace(quote + value + quote, quote + replacement + quote);
    });
    if (updated !== text) edit(f, 0, text.length, updated);
  }
  for (const [f, text] of texts) if (/\.json$/.test(f)) {
    // JSONC AST preserves comments/formatting. Only path-shaped string values
    // resolving to a moved file/directory are touched, never arbitrary text.
    const tree = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSON);
    const visit = node => {
      if (ts.isStringLiteral(node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        const value = node.text;
        if (!value.includes('/') || value.includes('://')) return;
        const tail = value.indexOf('*');
        const prefix = tail < 0 ? value : value.slice(0, tail);
        let base = path.dirname(f);
        let ancestor = node.parent;
        while (ancestor) {
          if (ts.isPropertyAssignment(ancestor) && ancestor.name.getText(tree).replace(/["']/g, '') === 'paths') {
            const config = configs.find(c => c.file === f);
            base = config?.options.baseUrl || base; break;
          }
          ancestor = ancestor.parent;
        }
        const target = path.resolve(base, prefix);
        if (relocated(target) !== target) {
          let replacement = slash(path.relative(base, relocated(target)));
          if (prefix.endsWith('/')) replacement += '/';
          if (value.startsWith('./') && !replacement.startsWith('.')) replacement = './' + replacement;
          if (tail >= 0) replacement += value.slice(tail);
          edit(f, node.getStart(tree), node.getWidth(tree), JSON.stringify(replacement));
        }
      }
      ts.forEachChild(node, visit);
    }; visit(tree);
  }
  const entries = [];
  for (const f of files) {
    const changes = (edits.get(f) || []).sort((a, b) => b.start - a.start);
    let content = texts.get(f);
    let boundary = content?.length ?? 0;
    for (const e of changes) {
      if (e.start + e.length > boundary) fail('Conflicting edits detected in ' + f);
      content = content.slice(0, e.start) + e.text + content.slice(e.start + e.length);
      boundary = e.start;
    }
    const to = relocated(f);
    if (changes.length || to !== f) {
      const before = originals.get(f) || fs.readFileSync(f);
      const after = changes.length ? Buffer.from(content, 'utf8') : before;
      if (to !== f && fs.existsSync(to)) fail('Destination file already exists: ' + to);
      entries.push({ from: f, to, before: before.toString('base64'), after: after.toString('base64') });
    }
  }
  const snapshots = files.map(f => ({ file: f, hash: digest(fs.readFileSync(f)) }));
  return { root, directory, selected: relocated(selected), entries, snapshots };
}

function apply(plan, moveDirectory = fs.renameSync) {
  // Revalidate the complete snapshot immediately before touching disk.
  if (plan.snapshots) {
    const current = walk(plan.root);
    if (current.length !== plan.snapshots.length) fail('Workspace files changed since planning. Run rename again.');
    for (const snapshot of plan.snapshots)
      if (!fs.existsSync(snapshot.file) || digest(fs.readFileSync(snapshot.file)) !== snapshot.hash) fail('File changed since planning: ' + snapshot.file);
  }
  for (const e of plan.entries) {
    if (!inside(plan.root, e.from) || !inside(plan.root, e.to)) fail('Invalid rename plan.');
    if (!fs.readFileSync(e.from).equals(Buffer.from(e.before, 'base64'))) fail('File changed since planning: ' + e.from);
    if (e.from !== e.to && fs.existsSync(e.to)) fail('Destination already exists: ' + e.to);
    fs.accessSync(e.from, fs.constants.W_OK);
  }
  if (plan.directory && fs.existsSync(plan.directory.to)) fail('Destination directory already exists.');
  const moved = [];
  const written = [];
  let directoryMoved = false;
  try {
    if (plan.directory) { moveDirectory(plan.directory.from, plan.directory.to); directoryMoved = true; }
    for (const e of plan.entries) {
      const current = plan.directory && inside(plan.directory.from, e.from) ? path.join(plan.directory.to, path.relative(plan.directory.from, e.from)) : e.from;
      if (current !== e.to) { fs.renameSync(current, e.to); moved.push([current, e.to]); }
      if (e.before !== e.after) { written.push(e); fs.writeFileSync(e.to, Buffer.from(e.after, 'base64')); }
    }
  } catch (error) {
    const failures = [];
    const undo = fn => { try { fn(); } catch (e) { failures.push(e.message); } };
    for (const e of written.reverse()) undo(() => fs.writeFileSync(e.to, Buffer.from(e.before, 'base64')));
    for (const [from, to] of moved.reverse()) undo(() => fs.renameSync(to, from));
    if (directoryMoved) undo(() => moveDirectory(plan.directory.to, plan.directory.from));
    if (failures.length) error.message += '\nRollback needs attention: ' + failures.join('\n');
    throw error;
  }
  return { selected: plan.selected, changed: plan.entries.length };
}

module.exports = { plan, apply, findRoot, sourceFor, names };
if (require.main === module) {
  try {
    let result;
    if (process.argv[2] === '--apply-ide') {
      // Keep stdin open for acknowledgements from Visual Studio. The same
      // directory mover is used for rollback, so the project hierarchy follows
      // the filesystem in both directions.
      let pending = Buffer.alloc(0);
      const readLine = () => {
        while (!pending.includes(10)) {
          const chunk = Buffer.alloc(65536);
          const count = fs.readSync(0, chunk, 0, chunk.length, null);
          if (!count) fail('Visual Studio closed the rename connection.');
          pending = Buffer.concat([pending, chunk.subarray(0, count)]);
        }
        const end = pending.indexOf(10), line = pending.subarray(0, end).toString('utf8');
        pending = pending.subarray(end + 1);
        return JSON.parse(line);
      };
      const request = readLine();
      result = apply(request, (from, to) => {
        fs.writeSync(1, JSON.stringify({ operation: 'renameDirectory', from, to }) + '\n');
        const reply = readLine();
        if (!reply.ok) fail(reply.error || 'Visual Studio could not rename the directory.');
      });
    } else result = process.argv[2] === '--apply' ? apply(JSON.parse(fs.readFileSync(0, 'utf8'))) : plan(process.argv[2], process.argv[3]);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
