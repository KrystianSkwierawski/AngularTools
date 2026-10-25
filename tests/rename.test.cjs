'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { plan, apply, names, sourceFor, findRoot } = require('../src/Rename/rename.cjs');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = { 'package.json': '{}', 'angular.json': '{}', 'tsconfig.json': JSON.stringify({ compilerOptions: { experimentalDecorators: true, baseUrl: '.', paths: { '@app/*': ['src/*'] } }, include: ['src/**/*.ts'] }), ...files };
  for (const [name, text] of Object.entries(all)) { const f = path.join(root, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  return { root, file: f => path.join(root, f), read: f => fs.readFileSync(path.join(root, f), 'utf8'), rename: (f, name) => plan(path.join(root, f), name, root, ts) };
}
const component = (metadata = '') => `import { Component } from '@angular/core';\n@Component({selector: 'lib-old', ${metadata}})\nexport class OldComponent {}`;

test('renames folder, siblings, semantic references, barrels, lazy imports and resource URLs', t => {
  const f = fixture(t, {
    'src/old/old.component.ts': component("templateUrl: './old.component.html', styleUrls: ['./old.component.css', './old.component.less']"),
    'src/old/old.component.html': '\ufeff<lib-old></lib-old>\r\n<!-- lib-old -->\r\n',
    'src/old/old.component.css': 'lib-old:hover { content: "lib-old"; }',
    'src/old/old.component.less': 'lib-old { color: red; }',
    'src/old/old.component.spec.ts': "import { OldComponent } from './old.component'; new OldComponent();",
    'src/old/index.ts': "export { OldComponent } from './old.component';",
    'src/main.ts': "import { OldComponent as Alias } from '@app/old/old.component';\nimport { OldComponent } from './old';\nconst a = new Alias(); const b = new OldComponent();\nconst routes = () => import(\n './old/old.component'\n).then(m => m.OldComponent);\nconst prose = 'OldComponent lib-old'; // OldComponent\n",
    'src/unrelated.ts': 'export class OldComponent {}\nconst x = new OldComponent();',
    'src/app.ts': "import {Component} from '@angular/core'; @Component({template: `<lib-old data-x='lib-old'></lib-old>`, styles: ['lib-old { color:red; }']}) export class App {}",
    'src/theme.scss': '@use "./old/old.component.css"; lib-old { color: blue; }',
  });
  const p = f.rename('src/old/old.component.html', 'NewCard');
  assert.equal(f.read('src/old/old.component.ts').includes('OldComponent'), true, 'planning does not write');
  apply(p);
  assert.match(f.read('src/new-card/new-card.component.ts'), /class NewCardComponent/);
  assert.match(f.read('src/new-card/new-card.component.ts'), /\.\/new-card.component.css/);
  assert.equal(f.read('src/new-card/new-card.component.html'), '\ufeff<lib-new-card></lib-new-card>\r\n<!-- lib-old -->\r\n');
  assert.match(f.read('src/main.ts'), /NewCardComponent as Alias/);
  assert.match(f.read('src/main.ts'), /m.NewCardComponent/);
  assert.match(f.read('src/main.ts'), /from '\.\/new-card'/);
  assert.match(f.read('src/main.ts'), /'OldComponent lib-old'; \/\/ OldComponent/);
  assert.match(f.read('src/unrelated.ts'), /class OldComponent/);
  assert.match(f.read('src/app.ts'), /<lib-new-card data-x='lib-old'>/);
  assert.match(f.read('src/app.ts'), /lib-new-card \{ color:red/);
  assert.match(f.read('src/theme.scss'), /new-card\/new-card.component.css/);
  assert.equal(f.read('src/new-card/new-card.component.css'), 'lib-new-card:hover { content: "lib-old"; }');
  assert.equal(fs.existsSync(f.file('src/old')), false);
});

test('shared folders are retained and unrelated files are preserved', t => {
  const f = fixture(t, { 'src/shared/old.component.ts': component(), 'src/shared/old.component.sass': 'x', 'src/shared/old.component.extra.ts': 'unchanged', 'src/shared/other.ts': 'export class Other {}' });
  apply(f.rename('src/shared/old.component.sass', 'fresh'));
  assert.ok(fs.existsSync(f.file('src/shared/fresh.component.ts')));
  assert.equal(f.read('src/shared/old.component.extra.ts'), 'unchanged');
});

test('supports suffixless migration in both directions', t => {
  const f = fixture(t, { 'src/old/old.component.ts': component(), 'src/old/old.component.spec.ts': "import {OldComponent} from './old.component'; new OldComponent();" });
  apply(f.rename('src/old/old.component.ts', 'fresh.'));
  assert.match(f.read('src/fresh/fresh.ts'), /class Fresh/);
  apply(f.rename('src/fresh/fresh.ts', 'final.component'));
  assert.match(f.read('src/final/final.component.ts'), /class FinalComponent/);
});

test('attribute and class selectors preserve prefixes and touch only template syntax', t => {
  const f = fixture(t, {
    'src/old.directive.ts': "import {Directive as D} from '@angular/core'; @D({ selector: '[libOld], .lib-old' }) export class OldDirective {}",
    'src/view.html': '<div libOld [libOld]="v" [(libOld)]="v" *libOld="v" title="libOld" class="lib-old lib-older" [class.lib-old]="v">libOld lib-old</div><!-- <div libOld> -->',
    'src/styles.scss': '[libOld] .lib-old { content: "libOld"; }',
  });
  apply(f.rename('src/old.directive.ts', 'new-panel'));
  assert.match(f.read('src/new-panel.directive.ts'), /\[libNewPanel\], .lib-new-panel/);
  assert.equal(f.read('src/view.html'), '<div libNewPanel [libNewPanel]="v" [(libNewPanel)]="v" *libNewPanel="v" title="libOld" class="lib-new-panel lib-older" [class.lib-new-panel]="v">libOld lib-old</div><!-- <div libOld> -->');
  assert.match(f.read('src/styles.scss'), /\[libNewPanel\] .lib-new-panel/);
});

test('updates exact tsconfig paths and folder include patterns without formatting loss', t => {
  const f = fixture(t, {
    'tsconfig.json': '{ // keep comment\n "compilerOptions": {"baseUrl":".", "paths":{"@old":["src/old/old.component.ts"]}}, "include":["src/old/**/*.ts"]}',
    'src/old/old.component.ts': component(),
    'src/main.ts': "import {OldComponent} from '@old'; new OldComponent();",
  });
  apply(f.rename('src/old/old.component.ts', 'new'));
  assert.match(f.read('tsconfig.json'), /keep comment/);
  assert.match(f.read('tsconfig.json'), /src\/new\/new.component.ts/);
  assert.match(f.read('tsconfig.json'), /src\/new\/\*\*\/\*.ts/);
});

test('collision and duplicate selectors fail before writes', t => {
  const f = fixture(t, { 'src/old/old.component.ts': component(), 'src/new/keep.ts': '', 'src/duplicate.ts': "import {Component} from '@angular/core'; @Component({selector:'lib-old'}) export class Duplicate {}" });
  assert.throws(() => f.rename('src/old/old.component.ts', 'new'), /Destination folder/);
  assert.throws(() => f.rename('src/old/old.component.ts', 'fresh'), /same selector/);
  assert.match(f.read('src/old/old.component.ts'), /OldComponent/);
});

test('rejects symbol collisions, unsupported selectors and custom exported names', t => {
  const f = fixture(t, { 'src/old.component.ts': component(), 'src/main.ts': "import {OldComponent} from './old.component'; class NewComponent {} new OldComponent();" });
  assert.throws(() => f.rename('src/old.component.ts', 'new'), /already declared/);
  fs.writeFileSync(f.file('src/old.component.ts'), component().replace('lib-old', 'button[old]'));
  assert.throws(() => f.rename('src/old.component.ts', 'fresh'), /Complex selectors/);
  fs.writeFileSync(f.file('src/old.component.ts'), component().replace('OldComponent', 'CustomName'));
  assert.throws(() => f.rename('src/old.component.ts', 'fresh'), /filename convention/);
});

test('stale plans abort without writing and write failures roll back all moves', t => {
  const f = fixture(t, { 'src/old/old.component.ts': component(), 'src/main.ts': "import {OldComponent} from './old/old.component'; new OldComponent();" });
  const stale = f.rename('src/old/old.component.ts', 'new');
  fs.appendFileSync(f.file('src/main.ts'), '\n// edited');
  assert.throws(() => apply(stale), /changed since planning/);
  assert.ok(fs.existsSync(f.file('src/old/old.component.ts')));
  const fresh = f.rename('src/old/old.component.ts', 'new');
  const write = fs.writeFileSync;
  let count = 0;
  fs.writeFileSync = (...args) => { if (++count === 2) throw new Error('simulated disk error'); return write(...args); };
  try { assert.throws(() => apply(fresh), /simulated disk error/); } finally { fs.writeFileSync = write; }
  for (const e of fresh.entries) assert.deepEqual(fs.readFileSync(e.from), Buffer.from(e.before, 'base64'));
  assert.equal(fs.existsSync(f.file('src/new')), false);
});

test('ignores dependencies and preserves binary assets moved with the folder', t => {
  const f = fixture(t, { 'src/old/old.component.ts': component(), 'node_modules/vendor/index.ts': 'OldComponent', 'src/old/icon.bin': Buffer.from([0, 255, 17]) });
  apply(f.rename('src/old/old.component.ts', 'new'));
  assert.equal(f.read('node_modules/vendor/index.ts'), 'OldComponent');
  assert.deepEqual(fs.readFileSync(f.file('src/new/icon.bin')), Buffer.from([0, 255, 17]));
});

test('normalizes names, rejects traversal and locates sibling source/workspace', t => {
  assert.equal(names('HTTPUser', 'old.component').stem, 'http-user.component');
  assert.equal(names('fresh.', 'old.component').stem, 'fresh');
  for (const name of ['../outside', 'bad/name', 'bad:name', 'CON', '1name', 'bad.other']) assert.throws(() => names(name, 'old.component'));
  const f = fixture(t, { 'src/old.component.ts': component() });
  assert.equal(findRoot(f.file('src/old.component.ts')), f.root);
  assert.equal(sourceFor(f.file('src/old.component.spec.ts')), f.file('src/old.component.ts'));
});

test('renames public binding aliases while preserving member and template references', t => {
  const f = fixture(t, {
    'src/old.directive.ts': `import {Directive, Input, Output, input} from '@angular/core';
      @Directive({selector:'[libOld]', exportAs:'old'}) export class OldDirective {
        @Input() libOld = ''; @Output() libOldChange: any;
        other = input('', {alias:'libOld'});
        run() { this.libOld = 'libOld'; this.libOldChange.emit(this.libOld); }
      }`,
    'src/view.html': '<div [libOld]="v" (libOldChange)="v=$event" #d="old">{{ d.libOld }}</div>',
  });
  apply(f.rename('src/old.directive.ts', 'fresh'));
  assert.match(f.read('src/fresh.directive.ts'), /@Input\("libFresh"\) libOld/);
  assert.match(f.read('src/fresh.directive.ts'), /@Output\("libFreshChange"\) libOldChange/);
  assert.match(f.read('src/fresh.directive.ts'), /this.libOldChange.emit\(this.libOld\)/);
  assert.match(f.read('src/fresh.directive.ts'), /alias:'libFresh'/);
  assert.match(f.read('src/fresh.directive.ts'), /this.libOld = 'libOld'/);
  assert.match(f.read('src/view.html'), /\(libFreshChange\)/);
  assert.match(f.read('src/view.html'), /{{ d.libOld }}/);
});

test('preserves signal fields and defaults while adding aliases in the correct argument', t => {
  for (const initializer of ["input()", "input({alias:'initial data'})", "input('', {transform: String,})", 'input.required<string>()', 'model(0)', 'model.required<number>()', 'output()']) {
    const f = fixture(t, { 'src/old.directive.ts': `import {Directive, input, model, output} from '@angular/core'; @Directive({selector:'[libOld]'}) export class OldDirective { libOld = ${initializer}; }` });
    apply(f.rename('src/old.directive.ts', 'fresh'));
    const result = f.read('src/fresh.directive.ts');
    assert.match(result, /libOld = /);
    assert.match(result, /alias: "libFresh"/);
    if (initializer.includes('initial data')) assert.match(result, /input\(\{alias:'initial data'\}, \{ alias: "libFresh" \}\)/);
    if (initializer === 'input()') assert.match(result, /input\(undefined, \{ alias: "libFresh" \}\)/);
    assert.equal(ts.createSourceFile('test.ts', result, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0);
  }
});

test('preserves decorator options and inline template field expressions', t => {
  const f = fixture(t, { 'src/old.component.ts': `import {Component, Input} from '@angular/core'; @Component({selector:'[libOld]', template:'{{ libOld }}'}) export class OldComponent { @Input({required:true}) libOld = ''; }` });
  apply(f.rename('src/old.component.ts', 'fresh'));
  const result = f.read('src/fresh.component.ts');
  assert.match(result, /required:true, alias: "libFresh"/);
  assert.match(result, /template:'{{ libOld }}'/);
  assert.match(result, /libOld = ''/);
});

test('renames structural input aliases and guards while preserving member expressions', t => {
  const f = fixture(t, {
    'src/old.directive.ts': `import {Directive, Input as I, input} from '@angular/core';
      @Directive({selector:'[appOld]', exportAs:'old'}) export class OldDirective {
        @I() appOldOf: any;
        @I('appOldTrackBy') track: any;
        condition = input.required<boolean>({alias:'appOldWhen'});
        static ngTemplateGuard_appOldOf: 'binding';
        static ngTemplateGuard_appOldWhen(dir: OldDirective, value: unknown): value is boolean { return true; }
        static ngTemplateContextGuard(dir: OldDirective, ctx: unknown): ctx is any { return true; }
      }`,
    'src/view.html': `<div *appOld="let item of items; trackBy: track; when: ready" #d="old">{{ d.appOldOf }}</div>
      <ng-template appOld [appOldOf]="items" [appOldTrackBy]="track" [appOldWhen]="ready"></ng-template>`,
  });
  apply(f.rename('src/old.directive.ts', 'fresh'));
  const code = f.read('src/fresh.directive.ts');
  assert.match(code, /@I\("appFreshOf"\) appOldOf/);
  assert.match(code, /@I\('appFreshTrackBy'\) track/);
  assert.match(code, /alias:'appFreshWhen'/);
  assert.match(code, /static ngTemplateGuard_appFreshOf/);
  assert.match(code, /static ngTemplateGuard_appFreshWhen/);
  assert.match(code, /static ngTemplateContextGuard/);
  assert.match(f.read('src/view.html'), /\*appFresh="let item of items; trackBy: track; when: ready"/);
  assert.match(f.read('src/view.html'), /{{ d.appOldOf }}/);
  assert.match(f.read('src/view.html'), /\[appFreshOf\]="items" \[appFreshTrackBy\]="track" \[appFreshWhen\]="ready"/);
});

test('resolves aliased and namespace Angular binding imports', t => {
  const cases = [
    ["import {Directive, Input as I, Output as O} from '@angular/core';", 'Directive', '@I() libOld: any; @O() libOldChange: any;', /@I\("libFresh"\) libOld/],
    ["import {Directive, input as i, model as m, output as o} from '@angular/core';", 'Directive', 'libOld = i.required<string>(); libOldChange = o();', /i.required<string>\(\{ alias: "libFresh" \}\)/],
    ["import {Directive, model as m} from '@angular/core';", 'Directive', 'libOld = m(0);', /m\(0, \{ alias: "libFresh" \}\)/],
    ["import * as ng from '@angular/core';", 'ng.Directive', '@ng.Input() libOld: any; libOldChange = ng.output();', /@ng.Input\("libFresh"\) libOld/],
  ];
  for (const [imports, decorator, members, expected] of cases) {
    const f = fixture(t, { 'src/old.directive.ts': `${imports} @${decorator}({selector:'[libOld]'}) export class OldDirective { ${members} }`, 'src/view.html': '<div [libOld]="value"></div>' });
    apply(f.rename('src/old.directive.ts', 'fresh'));
    assert.match(f.read('src/fresh.directive.ts'), expected);
    assert.match(f.read('src/view.html'), /\[libFresh\]/);
    if (members.includes('libOldChange')) assert.match(f.read('src/fresh.directive.ts'), /libFreshChange/);
  }
});

test('pipe expressions change while comments, prose and string literals remain intact', t => {
  const f = fixture(t, {
    'src/old.pipe.ts': "import {Pipe} from '@angular/core'; @Pipe({name:'old'}) export class OldPipe {}",
    'src/view.html': `{{ value | old }} <div [title]="value | old"></div> | old <!-- {{ x | old }} --> {{ 'a | old' }} {{ value | older }}`,
  });
  apply(f.rename('src/old.pipe.ts', 'fresh'));
  assert.equal(f.read('src/view.html'), `{{ value | fresh }} <div [title]="value | fresh"></div> | old <!-- {{ x | old }} --> {{ 'a | old' }} {{ value | older }}`);
});

test('renames pipes in balanced Angular control-flow headers and let declarations', t => {
  const template = `@if ((value | old) && fn(') | old')) { {{ value | old }} }
    @else if (other | old) { text }
    @for (item of (items | old); track item.id) { {{ item }} }
    @switch (value | old) { @case (key | old) { text } }
    @let result = ({a: fn(';', (value | old))});
    <!-- @if (value | old) { old } -->
    <div title="@if (value | old)">{{ flag || old }}</div>`;
  const expected = template.replaceAll('value | old', 'value | fresh').replaceAll('other | old', 'other | fresh')
    .replaceAll('items | old', 'items | fresh').replaceAll('key | old', 'key | fresh')
    .replace('<!-- @if (value | fresh)', '<!-- @if (value | old)').replace('title="@if (value | fresh)', 'title="@if (value | old)');
  const f = fixture(t, {
    'src/old.pipe.ts': "import {Pipe} from '@angular/core'; @Pipe({name:'old'}) export class OldPipe {}",
    'src/view.html': template,
    'src/app.ts': "import {Component} from '@angular/core'; @Component({template: `" + template + "`}) export class App {}",
  });
  apply(f.rename('src/old.pipe.ts', 'fresh'));
  assert.equal(f.read('src/view.html'), expected);
  assert.ok(f.read('src/app.ts').includes(expected));
});

test('moves Sass partial and index imports while retaining public specifier spelling', t => {
  const f = fixture(t, {
    'src/old/old.component.ts': component(),
    'src/old/_tokens.scss': '$color: red;',
    'src/old/_spacing.sass': '$gap: 1rem',
    'src/old/palette/_index.scss': '$color: blue;',
    'src/theme.scss': `@use './old/tokens'; @forward "./old/palette"; @import './old/spacing';\n@use './old/_tokens.scss' as explicit; /* @use './old/tokens'; */`,
  });
  apply(f.rename('src/old/old.component.ts', 'fresh'));
  assert.equal(f.read('src/theme.scss'), `@use './fresh/tokens'; @forward "./fresh/palette"; @import './fresh/spacing';\n@use './fresh/_tokens.scss' as explicit; /* @use './old/tokens'; */`);
  assert.ok(fs.existsSync(f.file('src/fresh/palette/_index.scss')));
});

test('supports functional guards, services, interfaces and enums', t => {
  for (const [filename, declaration, newName] of [
    ['old.guard', 'export const oldGuard = () => true;', 'newGuard'],
    ['old.service', 'export class OldService {}', 'NewService'],
    ['old', 'export interface Old {}', 'New'],
    ['old.enum', 'export enum OldEnum { A }', 'NewEnum'],
  ]) {
    const f = fixture(t, { ['src/' + filename + '.ts']: declaration });
    apply(f.rename('src/' + filename + '.ts', 'new'));
    const output = fs.readdirSync(f.file('src')).find(x => x.endsWith('.ts'));
    assert.ok(f.read('src/' + output).includes(newName));
  }
});

test('separate Node processes prepare and apply plans using workspace TypeScript', t => {
  const { spawnSync } = require('node:child_process');
  const f = fixture(t, { 'src/old.component.ts': component() });
  const script = path.resolve(__dirname, '../src/Rename/rename.cjs');
  const options = { encoding: 'utf8', env: { ...process.env, NODE_PATH: path.resolve(__dirname, '../node_modules') } };
  const prepared = spawnSync(process.execPath, [script, f.file('src/old.component.ts'), 'fresh'], options);
  assert.equal(prepared.status, 0, prepared.stderr);
  const applied = spawnSync(process.execPath, [script, '--apply'], { ...options, input: prepared.stdout });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(f.read('src/fresh.component.ts'), /FreshComponent/);
});

test('a newly added reference after planning invalidates the transaction', t => {
  const f = fixture(t, { 'src/old.component.ts': component() });
  const p = f.rename('src/old.component.ts', 'fresh');
  fs.writeFileSync(f.file('src/new-reference.ts'), "import {OldComponent} from './old.component';");
  assert.throws(() => apply(p), /Workspace files changed/);
  assert.ok(fs.existsSync(f.file('src/old.component.ts')));
});

test('renames attribute selectors immediately before self-closing slash', t => {
  const f = fixture(t, {
    'src/old.directive.ts': "import {Directive} from '@angular/core'; @Directive({selector:'[libOld]'}) export class OldDirective {}",
    'src/view.html': '<custom-card libOld/><custom-card libOld /><custom-card title="libOld/"/>',
  });
  apply(f.rename('src/old.directive.ts', 'fresh'));
  assert.equal(f.read('src/view.html'), '<custom-card libFresh/><custom-card libFresh /><custom-card title="libOld/"/>');
});

test('updates CSS asset URLs with quotes, query and fragments while leaving remote URLs and text intact', t => {
  const f = fixture(t, {
    'src/old/old.component.ts': component(),
    'src/old/image.svg': '<svg/>',
    'src/theme.scss': `a {background:url('./old/image.svg?v=1#icon'); mask: url(./old/image.svg); content: "url('./old/image.svg')"; other:url(data:image/png;base64,x); remote:url(https://example.com/old/image.svg); root:url(/old/image.svg); } /* url('./old/image.svg') */`,
    'src/inline.ts': `import {Component} from '@angular/core'; @Component({styles: [\`a {background:url('./old/image.svg')}\`]}) export class Inline {}`,
  });
  apply(f.rename('src/old/old.component.ts', 'fresh'));
  assert.equal(f.read('src/theme.scss'), `a {background:url('./fresh/image.svg?v=1#icon'); mask: url(./fresh/image.svg); content: "url('./old/image.svg')"; other:url(data:image/png;base64,x); remote:url(https://example.com/old/image.svg); root:url(/old/image.svg); } /* url('./old/image.svg') */`);
  assert.match(f.read('src/inline.ts'), /url\('\.\/fresh\/image.svg'\)/);
});

test('allows unrelated local declarations but blocks capture at a renamed reference', t => {
  const f = fixture(t, {
    'src/old.component.ts': component(),
    'src/main.ts': "import {OldComponent} from './old.component'; function unrelated() { const FreshComponent = 3; return FreshComponent; } const instance = new OldComponent();",
  });
  assert.doesNotThrow(() => f.rename('src/old.component.ts', 'fresh'));
  fs.writeFileSync(f.file('src/main.ts'), "import {OldComponent} from './old.component'; function capture() { const FreshComponent = 3; return new OldComponent(); }");
  assert.throws(() => f.rename('src/old.component.ts', 'fresh'), /already declared in this scope/);
});

test('updates selector queries and indented Sass without changing string content', t => {
  const f = fixture(t, {
    'src/old.component.ts': component(),
    'src/main.ts': `document.querySelector('lib-old:hover'); document.getElementsByTagName('lib-old'); const text = 'lib-old';`,
    'src/theme.sass': 'lib-old:hover\n  color: red\n  content: "lib-old"\n',
    'src/view.html': '<style>lib-old { color:red; }</style>',
  });
  apply(f.rename('src/old.component.ts', 'fresh'));
  assert.equal(f.read('src/main.ts'), `document.querySelector('lib-fresh:hover'); document.getElementsByTagName('lib-fresh'); const text = 'lib-old';`);
  assert.equal(f.read('src/theme.sass'), 'lib-fresh:hover\n  color: red\n  content: "lib-old"\n');
  assert.equal(f.read('src/view.html'), '<style>lib-fresh { color:red; }</style>');
});

test('a typed consumer project still compiles after rename', t => {
  const f = fixture(t, {
    'src/old/old.component.ts': component(),
    'src/main.ts': "import {OldComponent} from './old/old.component'; const value: OldComponent = new OldComponent(); const load = () => import('./old/old.component').then(m => new m.OldComponent());",
    'node_modules/@angular/core/index.d.ts': 'export declare function Component(metadata: any): ClassDecorator;',
  });
  const check = () => {
    const config = ts.readConfigFile(f.file('tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, f.root);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  };
  check();
  apply(f.rename('src/old/old.component.ts', 'fresh'));
  check();
});

test('updates explicit Visual Studio project items and preserves XML comments', t => {
  const f = fixture(t, {
    'src/old/old.component.ts': component(),
    'app.csproj': '<Project><ItemGroup><Content Include="src\\old\\old.component.ts"/><Content Update="src/old/**"/></ItemGroup><!-- Include="src/old/old.component.ts" --></Project>',
  });
  apply(f.rename('src/old/old.component.ts', 'fresh'));
  assert.equal(f.read('app.csproj'), '<Project><ItemGroup><Content Include="src\\fresh\\fresh.component.ts"/><Content Update="src/fresh/**"/></ItemGroup><!-- Include="src/old/old.component.ts" --></Project>');
});
