using System.Windows.Forms;

internal abstract class AbstractBaseCommand<T> : BaseCommand<T> where T : class, new()
{
    protected static readonly string Source = $"[AngularTools]: {typeof(T).Name}";

    protected override async Task ExecuteAsync(OleMenuCmdEventArgs e)
    {
        await CatchErrorAsync(async () =>
        {
            await RunCommandAsync(e);
        });
    }

    protected abstract Task RunCommandAsync(OleMenuCmdEventArgs e);

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
}
