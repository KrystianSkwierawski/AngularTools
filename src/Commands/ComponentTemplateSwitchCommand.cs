﻿namespace AngularTools.Commands;

/// <summary>
/// Switches between a component file (.ts) and a template file (.html)
/// </summary>
[Command(PackageIds.ComponentTemplateSwitchCommand)]
internal sealed class ComponentTemplateSwitchCommand : AbstractBaseCommand<ComponentTemplateSwitchCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var activeDocument = await GetActiveDocumentAsync();

        var switchedDocument = activeDocument switch
        {
            var x when x.EndsWith(".html") => x.Replace(".html", ".ts"),
            var x when x.EndsWith(".ts") => x.Replace(".ts", ".html"),
            var x when x.EndsWith(".scss") => x.Replace(".scss", ".html"),
            _ => null,
        };

        if (IsDocumentValid(switchedDocument))
        {
            await VS.Documents.OpenAsync(switchedDocument);
        }
    }
}
