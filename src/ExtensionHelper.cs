using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using EnvDTE80;
using Microsoft.VisualStudio.Shell.Interop;

namespace AngularTools;
public static class ExtensionHelper
{
    public static async Task<string> GetActiveProjectAsync()
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

        var dte2 = await VS.GetServiceAsync<SDTE, DTE2>();
        var activeSolutionProjects = dte2.ActiveSolutionProjects as Array;

        if (activeSolutionProjects?.Length > 0)
        {
            var activeProject = activeSolutionProjects.GetValue(0) as EnvDTE.Project;
            var fullname = activeProject.FullName;

            var attr = File.GetAttributes(fullname);

            return attr.HasFlag(FileAttributes.Directory) ? fullname : Path.GetDirectoryName(fullname);
        }

        return string.Empty;
    }

    public static async Task CatchErrorAsync(Func<Task> func)
    {
        try
        {
            await func();
        }
        catch (Exception ex)
        {
            ActivityLog.LogError($"[AngularTools]{nameof(OpenConsoleCommand)}", ex.ToString());
            System.Windows.Forms.MessageBox.Show(ex.Message, $"[AngularTools]:{nameof(OpenConsoleCommand)} Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
