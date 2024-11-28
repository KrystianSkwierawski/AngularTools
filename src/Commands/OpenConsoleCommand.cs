using EnvDTE;

namespace AngularTools;

[Command(PackageIds.OpenConsoleCommand)]
internal sealed class OpenConsoleCommand : BaseCommand<OpenConsoleCommand>
{
    protected override async Task ExecuteAsync(OleMenuCmdEventArgs e)
    {
        await ExtensionHelper.CatchErrorAsync(async () =>
        {
            var path = await ExtensionHelper.GetActiveProjectAsync();

            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentNullException("Empty directory path");
            }

            var cmd = $"/k cd {path}";
            System.Diagnostics.Process.Start("CMD.exe", cmd);
        });
    }
}
