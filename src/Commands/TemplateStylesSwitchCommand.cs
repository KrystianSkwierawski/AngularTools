namespace AngularTools.Commands;

/// <summary>
/// Switches between a styles file (.scss) and a template file (.html)
/// </summary>
[Command(PackageIds.ComponentStylesSwitchCommand)]
internal sealed class TemplateStylesSwitchCommand : AbstractBaseCommand<TemplateStylesSwitchCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var activeDocument = await GetActiveDocumentAsync();

        var switchedDocument = activeDocument switch
        {
            var x when x.EndsWith(".html") => x.Replace(".html", ".scss"),
            var x when x.EndsWith(".ts") => x.Replace(".ts", ".scss"),
            var x when x.EndsWith(".scss") => x.Replace(".scss", ".html"),
            _ => null,
        };

        if (IsDocumentValid(switchedDocument))
        {
            await VS.Documents.OpenAsync(switchedDocument);
        }
    }
}
