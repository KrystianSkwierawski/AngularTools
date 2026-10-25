# Angular Tools for Visual Studio 2022 (WIP)

**Angular Tools** is a Visual Studio extension designed to streamline Angular development. It provides a set of productivity-enhancing commands and features tailored for Angular projects, making your workflow faster and more efficient.

## Features

1. **Rename Angular Component**  
   Rename Angular declarations and their references using the workspace's TypeScript language service. Handles component templates, styles, tests, import/export paths, selectors and matching folders.

*`Edit > Rename Angular Component`, Solution Explorer file context menu, or `Ctrl + 5`*

2. **Switch Between `.ts` and `.html` Files**  
   Quickly toggle between `.ts` and `.html`.

*`Tools > Switch Between .ts/html` or `[shortcut Ctrl + 2]`*

3. **Switch Between `.scss` and `.html` Files**  
   Quickly toggle between `.scss` and `.html`.

*`Tools > Switch Between .scss/.html` or `[shortcut Ctrl + 3]`*

4. **Open Console in Project Directory**  
   Open a terminal directly in the current project directory for quick access to Angular CLI commands.

*`Tools > Open Console Here` or `[shortcut Ctrl + 4]`*

## Rename Angular Component

Install Node.js 18 or later (available on `PATH`) and install your Angular workspace dependencies, including TypeScript. Restart Visual Studio if Node.js was installed while it was open. The extension uses the project's TypeScript version; it does not download or run npm packages during a rename.

Save your documents, select a `.ts` file or its same-basename `.html`, `.css`, `.scss`, `.sass`, `.less`, `.spec.ts` or `.test.ts` sibling, and invoke Rename. `UserProfile`, `user profile` and `user-profile` become `user-profile.component.ts` when renaming a legacy component. The existing suffix is retained unless you explicitly enter another suffix. Enter `user-profile.` (trailing dot) to migrate to `user-profile.ts`; enter `user-profile.component` to migrate back.

The refactoring supports:

- One conventionally named exported class, interface, enum, function or variable per file, including services, directives, modules, pipes and functional guards.
- Semantic symbol references, aliased imports, re-exports, index barrels, dynamic/lazy imports and import types. Unrelated symbols with the same spelling, comments and ordinary strings are preserved. Aliased paths to moved files become direct relative paths.
- Conventional sibling files and folder renaming only when the folder name matches the declaration's basename. Other assets in that folder move with it; shared folders stay in place.
- `templateUrl`, `styleUrl`, `styleUrls`, external and inline templates/styles; element, attribute and class selectors with existing prefixes; common selector-query APIs; Sass/CSS imports; Angular pipe expressions; selector-linked `@Input`/`@Output` declarations and signal aliases.
- Path references in JSON/JSONC (including tsconfig aliases/globs) and explicit Visual Studio project item paths.
- Preflight collision checks, UTF-8/BOM and newline preservation, stale-plan detection and rollback on write/move errors. Unsaved workspace documents block the operation. Affected saved editor buffers are closed and reopened to avoid stale content overwriting the result.

Scope is the enclosing `angular.json`/`nx.json` workspace, falling back to the nearest package root. Dependencies, generated build folders, source-control metadata and symlinks are excluded. Selectors are updated across that workspace (also suitable for NgModule applications); duplicate or conflicting selectors stop the operation before writes.

This is not a full Angular template type-checker. Complex/computed selectors, computed resource URLs, ambiguous exports and class names inconsistent with filenames require manual refactoring and are rejected. Arbitrary application strings, dynamically constructed paths, custom decorators, MSBuild property expressions and custom naming schemes are not inferred. Use source control to review changes; the filesystem transaction is not part of Visual Studio's text-editor Undo stack.

## Development and validation

```powershell
npm ci
npm test
msbuild AngularTools.sln /restore /p:Configuration=Release /p:DeployExtension=false
```

The tests exercise filesystem changes, semantic references, selector/template handling, name migrations, collision/stale-plan protection, rollback and a TypeScript compilation before and after rename. The Release package is `src/bin/Release/AngularTools.vsix`.

For a manual Visual Studio smoke test, install the VSIX, open an Angular project, rename from both the editor and Solution Explorer, verify reopened documents/project refresh, and run the application's Angular build. Also verify that an unsaved document blocks rename. Automated engine tests do not replace this IDE integration check.

## License

This project is licensed under the [MIT License](LICENSE).
