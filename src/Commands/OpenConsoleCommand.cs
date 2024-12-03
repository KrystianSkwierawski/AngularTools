using EnvDTE;

namespace AngularTools;

/// <summary>
/// Opens a console window in the current project directory
/// </summary>
[Command(PackageIds.OpenConsoleCommand)]
internal sealed class OpenConsoleCommand : AbstractBaseCommand<OpenConsoleCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var path = await GetActiveProjectAsync();

        if (string.IsNullOrWhiteSpace(path))
        {
            ActivityLog.LogInformation(Source, "Not found active project");
            return;
        }

        var cmd = $"/k cd {path}";
        System.Diagnostics.Process.Start("CMD.exe", cmd);
    }
}
