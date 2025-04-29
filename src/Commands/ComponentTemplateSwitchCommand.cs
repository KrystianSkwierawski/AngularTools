namespace AngularTools.Commands;

/// <summary>
/// Switches between .ts/.html file
/// </summary>
[Command(PackageIds.ComponentTemplateSwitchCommand)]
internal sealed class ComponentTemplateSwitchCommand : AbstractBaseCommand<ComponentTemplateSwitchCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var document = await GetActiveDocumentAsync();

        var switchedDocument = document.FullName switch
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
