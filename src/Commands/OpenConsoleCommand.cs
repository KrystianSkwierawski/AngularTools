using EnvDTE;

namespace AngularTools;

[Command(PackageIds.OpenConsoleCommand)]
internal sealed class OpenConsoleCommand : AbstractBaseCommand<OpenConsoleCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var path = await ExtensionHelper.GetActiveProjectAsync();

        if (string.IsNullOrWhiteSpace(path))
        {
            ActivityLog.LogInformation(Source, "Not found active project");
            return;
        }

        var cmd = $"/k cd {path}";
        System.Diagnostics.Process.Start("CMD.exe", cmd);
    }
}
