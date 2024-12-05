using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell.Interop;

internal abstract class AbstractBaseCommand<T> : BaseCommand<T> where T : class, new()
{
    protected static readonly string Source = $"[AngularTools]: {typeof(T).Name}";
    private DTE2 _dte;

    protected override async Task ExecuteAsync(OleMenuCmdEventArgs e)
    {
        await CatchErrorAsync(async () =>
        {
            _dte = await VS.GetServiceAsync<SDTE, DTE2>();
            await RunCommandAsync(e);
        });
    }

    protected abstract Task RunCommandAsync(OleMenuCmdEventArgs e);

    #region Helpers

    protected async Task<ActiveDocument> GetActiveDocumentAsync()
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

        var document = _dte.ActiveDocument;

        return new ActiveDocument(document.FullName, document.Name, document.Path);
    }

    protected async Task<string> GetActiveProjectAsync()
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

        var activeSolutionProjects = _dte.ActiveSolutionProjects as Array;

        if (activeSolutionProjects?.Length > 0)
        {
            var activeProject = activeSolutionProjects.GetValue(0) as EnvDTE.Project;
            var fullname = activeProject.FullName;

            var attr = File.GetAttributes(fullname);

            return attr.HasFlag(FileAttributes.Directory) ? fullname : Path.GetDirectoryName(fullname);
        }

        return string.Empty;
    }

    protected async Task FindAndReplaceAsync(string find, string replace)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

        _dte.Find.FindReplace(vsFindAction.vsFindActionReplaceAll, find, 0, replace, vsFindTarget.vsFindTargetCurrentProject);
    }

    protected static bool IsDocumentValid(string document)
    {
        if (string.IsNullOrEmpty(document) || !File.Exists(document))
        {
            ActivityLog.LogInformation(Source, "Document doesn't exist");
            return false;
        }

        return true;
    }

    private static async Task CatchErrorAsync(Func<Task> func)
    {
        try
        {
            ActivityLog.LogInformation(Source, "Start");
            await func();
            ActivityLog.LogInformation(Source, "Stop");
        }
        catch (Exception ex)
        {
            ActivityLog.LogError(Source, ex.ToString());
            System.Windows.Forms.MessageBox.Show(ex.Message, $"{Source} Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    protected record ActiveDocument(string FullName, string Name, string Path);

    #endregion
}
