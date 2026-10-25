$ErrorActionPreference = 'Stop'
# Compile the actual parser methods without loading Visual Studio or opening UI.
$source = Get-Content -Raw (Join-Path $PSScriptRoot '../src/Commands/ShowComponentPropertiesCommand.cs')
$start = $source.IndexOf('    private static IList<string> GetProperties(')
$end = $source.IndexOf('    private class PropertiesForm', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Parser methods not found' }
$methods = $source.Substring($start, $end - $start).Replace('private static', 'public static')
Add-Type -TypeDefinition ("using System; using System.Linq; using System.Collections.Generic; using System.IO; using System.Text.RegularExpressions; public static class PropertyParserProbe {" + $methods + '}')
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$root = Join-Path $tempBase ('angulartools-properties-' + [Guid]::NewGuid())
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    [IO.File]::WriteAllText((Join-Path $root 'component.ts'), "import {User} from './user';`nuser: User;`nowner: User;")
    [IO.File]::WriteAllText((Join-Path $root 'user.ts'), "name: string;`nage: number;")
    $actual = [PropertyParserProbe]::GetProperties((Join-Path $root 'component.ts'))
    $expected = @('user.name', 'user.age', 'user', 'owner.name', 'owner.age', 'owner')
    if (($actual -join '|') -cne ($expected -join '|')) { throw "Incorrect nested paths: $actual" }
    [IO.File]::WriteAllText((Join-Path $root 'a.ts'), "import {B} from './b';`nb: B;`nlabel: string;")
    [IO.File]::WriteAllText((Join-Path $root 'b.ts'), "import {A} from './a';`na: A;`nvalue: number;")
    $actual = [PropertyParserProbe]::GetProperties((Join-Path $root 'a.ts'))
    if (($actual -join '|') -cne 'b.a|b.value|b|label') { throw "Incorrect cyclic paths: $actual" }
    [IO.File]::WriteAllText((Join-Path $root 'self.ts'), "import {Self} from './self';`nnext: Self;`nvalue: string;")
    $actual = [PropertyParserProbe]::GetProperties((Join-Path $root 'self.ts'))
    if (($actual -join '|') -cne 'next|value') { throw "Incorrect self-referencing paths: $actual" }
    [IO.File]::WriteAllText((Join-Path $root 'fields.ts'), "public title: string;`nreadonly age: number = 42;`nready!: boolean;`nnote?: string;`nprivate secret: string;`nprotected hidden: number;`nstatic shared: string;`npublic readonly label: string = 'hello'; // text`nrun(): string;")
    $actual = [PropertyParserProbe]::GetProperties((Join-Path $root 'fields.ts'))
    if (($actual -join '|') -cne 'title|age|ready|note|label') { throw "Incorrect field identifiers: $actual" }
    Write-Output 'PASS: nested paths, repeated sibling types, mutual cycles, self-reference, field modifiers and declaration markers'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolved)).StartsWith('angulartools-properties-')) { throw 'Invalid cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
