namespace AngularTools.Commands;

[Command(PackageIds.ComponentTemplateSwitchCommand)]
internal sealed class ComponentTemplateSwitchCommand : AbstractBaseCommand<ComponentTemplateSwitchCommand>
{
    /// <summary>
    /// Switches between a component file (.ts) and a template file (.html)
    /// </summary>
    /// <param name="e"></param>
    /// <returns></returns>
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var activeDocument = await ExtensionHelper.GetActiveDocumentAsync();

        if (string.IsNullOrEmpty(activeDocument))
        {
            ActivityLog.LogInformation(Source, "Not found active document");
            return;
        }

        var switchedFile = activeDocument.Contains(".html")
            ? activeDocument.Replace(".html", ".ts")
            : activeDocument.Contains(".ts")
                ? activeDocument.Replace(".ts", ".html")
                : null;

        if (switchedFile is not null)
        {
            await VS.Documents.OpenAsync(switchedFile);
        }
    }
}
