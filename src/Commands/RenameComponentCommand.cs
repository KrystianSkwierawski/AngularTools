using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualBasic;
using Microsoft.VisualStudio.Shell.Interop;
using Process = System.Diagnostics.Process;
using Forms = System.Windows.Forms;
using System.Drawing;

namespace AngularTools;

[Command(PackageIds.RenameComponentCommand)]
internal sealed class RenameComponentCommand : AbstractBaseCommand<RenameComponentCommand>
{
    private static bool _running;

    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
        if (_running) return;
        _running = true;
        RenameProgress progress = null;
        try
        {
            var dte = await VS.GetServiceAsync<SDTE, DTE2>();
            var selected = dte.ActiveDocument?.FullName;
            if (dte.ActiveWindow?.Kind == EnvDTE.Constants.vsWindowKindSolutionExplorer &&
                dte.ToolWindows.SolutionExplorer.SelectedItems is Array items && items.Length == 1 &&
                items.GetValue(0) is UIHierarchyItem item && item.Object is ProjectItem projectItem && projectItem.FileCount > 0)
                selected = projectItem.FileNames[1];
            if (!IsDocumentValid(selected)) throw new InvalidOperationException("Select an Angular file first.");
            var defaultName = Path.GetFileNameWithoutExtension(selected);
            if (defaultName.EndsWith(".spec") || defaultName.EndsWith(".test")) defaultName = Path.GetFileNameWithoutExtension(defaultName);
            var name = Interaction.InputBox("New name (e.g. user-profile or UserProfile). Existing Angular suffix is retained.\nUse a trailing dot (user-profile.) for a suffixless name.", "Rename Angular Component", defaultName).Trim();
            if (string.IsNullOrWhiteSpace(name) || name == defaultName) return;

            progress = new RenameProgress();
            progress.Show(new WindowOwner(dte.MainWindow.HWnd));
            progress.SetStage("Analyzing TypeScript references and planning changes...");
            await VS.StatusBar.ShowMessageAsync("Angular rename: analyzing workspace...");

            var script = Path.Combine(Path.GetDirectoryName(typeof(RenameComponentCommand).Assembly.Location), "Rename", "rename.cjs");
            var json = await RunNodeAsync(script, Quote(selected) + " " + Quote(name), progress: progress);
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var plan = serializer.Deserialize<RenamePlan>(json);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            progress.SetStage("Checking documents and preparing changes...");
            // A disk-based refactoring must never overwrite unsaved editor text.
            foreach (Document document in dte.Documents)
                if (InWorkspace(plan.root, document.FullName) && !document.Saved)
                    throw new InvalidOperationException("Save your workspace documents before renaming: " + document.FullName);

            var reopened = new List<RenameEntry>();
            try
            {
                foreach (Document document in dte.Documents.Cast<Document>().ToArray())
                {
                    var fullName = document.FullName;
                    var entry = plan.entries.FirstOrDefault(x => string.Equals(x.from, fullName, StringComparison.OrdinalIgnoreCase));
                    var destination = entry?.to;
                    if (destination == null && plan.directory != null)
                        destination = RemapDirectoryPath(plan.directory.from, plan.directory.to, fullName);
                    if (destination == null && string.Equals(fullName, selected, StringComparison.OrdinalIgnoreCase))
                        destination = plan.selected;
                    if (destination == null) continue;
                    document.Close(vsSaveChanges.vsSaveChangesNo);
                    reopened.Add(new RenameEntry { from = fullName, to = destination });
                }
                progress.SetStage("Applying changes and updating the project...");
                await VS.StatusBar.ShowMessageAsync("Angular rename: applying changes...");
                await RunNodeAsync(script, "--apply-ide", json, dte, progress);
            }
            finally
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                progress.SetStage("Reopening documents...");
                foreach (var entry in reopened)
                {
                    var file = File.Exists(entry.to) ? entry.to : entry.from;
                    if (File.Exists(file)) dte.ItemOperations.OpenFile(file);
                }
            }
            if (File.Exists(plan.selected)) dte.ItemOperations.OpenFile(plan.selected);
            ActivityLog.LogInformation(Source, $"Renamed Angular file; updated {plan.entries.Count} files.");
            await VS.StatusBar.ShowMessageAsync($"Angular rename complete: {plan.entries.Count} files updated.");
        }
        catch
        {
            await VS.StatusBar.ShowMessageAsync("Angular rename failed. See the error message for details.");
            throw;
        }
        finally
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            progress?.Dispose();
            _running = false;
        }
    }

    private static bool InWorkspace(string root, string file) => file != null &&
        Path.GetFullPath(file).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    private static string RemapDirectoryPath(string from, string to, string file)
    {
        if (!InWorkspace(from, file)) return null;
        var prefix = Path.GetFullPath(from).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return Path.Combine(to, Path.GetFullPath(file).Substring(prefix.Length));
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static async System.Threading.Tasks.Task<string> RunNodeAsync(string script, string arguments, string input = null, DTE2 dte = null, RenameProgress progress = null)
    {
        return await Task.Run(async () =>
        {
            var start = new ProcessStartInfo("node.exe", Quote(script) + " " + arguments)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Path.GetDirectoryName(script)
            };
            Process process;
            try { process = Process.Start(start); }
            catch (System.ComponentModel.Win32Exception ex) { throw new InvalidOperationException("Node.js must be installed and available on PATH. Restart Visual Studio after installing Node.js.", ex); }
            using (process)
            {
                var output = ReadOutputAsync(process, dte, progress);
                var error = ReadErrorsAsync(process, progress);
                try
                {
                    if (input != null)
                    {
                        // One JSON message per line, including when stdout supplied CRLF.
                        var bytes = Encoding.UTF8.GetBytes(input.TrimEnd('\r', '\n') + "\n");
                        await process.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length);
                        await process.StandardInput.BaseStream.FlushAsync();
                    }
                    if (dte == null) process.StandardInput.Close();
                    var result = await output;
                    var message = await error;
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(message) ? "The rename engine exited without an error description." : message);
                    if (string.IsNullOrWhiteSpace(result)) throw new InvalidOperationException("The rename engine returned an empty response.");
                    return result;
                }
                finally
                {
                    process.StandardInput.Close();
                    if (!process.HasExited) process.Kill();
                }
            }
        });
    }

    private static async System.Threading.Tasks.Task<string> ReadOutputAsync(Process process, DTE2 dte, RenameProgress progress)
    {
        var result = new StringBuilder();
        var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        string line;
        while ((line = await process.StandardOutput.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var request = dte == null ? null : serializer.Deserialize<DirectoryRequest>(line);
            if (request?.operation != "renameDirectory") { result.AppendLine(line); continue; }
            string response;
            try
            {
                await RenameDirectoryAsync(dte, request.from, request.to, progress);
                response = serializer.Serialize(new { ok = true });
            }
            catch (Exception ex) { response = serializer.Serialize(new { ok = false, error = ex.Message }); }
            var bytes = Encoding.UTF8.GetBytes(response + "\n");
            await process.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length);
            await process.StandardInput.BaseStream.FlushAsync();
        }
        return result.ToString();
    }

    private static async System.Threading.Tasks.Task<string> ReadErrorsAsync(Process process, RenameProgress progress)
    {
        const string prefix = "ANGULAR_TOOLS_PROGRESS:";
        var errors = new StringBuilder();
        string line;
        while ((line = await process.StandardError.ReadLineAsync()) != null)
        {
            if (line.StartsWith(prefix, StringComparison.Ordinal))
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if (progress != null && !progress.IsDisposed) progress.SetStage(line.Substring(prefix.Length));
            }
            else errors.AppendLine(line);
        }
        return errors.ToString();
    }

    private static async Task RenameDirectoryAsync(DTE2 dte, string from, string to, RenameProgress progress)
    {
        if (!string.Equals(Path.GetDirectoryName(from), Path.GetDirectoryName(to), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The rename destination must be in the same parent directory.");
        for (var attempt = 0; ; attempt++)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            progress.SetStage($"Renaming folder to {Path.GetFileName(to)}" + (attempt == 0 ? "..." : $" (retry {attempt}/4)..."));
            try
            {
                if (Directory.Exists(to)) throw new InvalidOperationException("Destination folder already exists: " + to);
                var item = dte.Solution.FindProjectItem(from) ?? dte.Solution.FindProjectItem(from + Path.DirectorySeparatorChar);
                if (item != null) item.Name = Path.GetFileName(to);
                else Directory.Move(from, to);
                if (Directory.Exists(from) || !Directory.Exists(to)) throw new IOException("The project did not rename the folder.");
                return;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is System.Runtime.InteropServices.COMException)
            {
                // Some project systems report a notification error after the
                // actual move. Acknowledge that move so rollback remains valid.
                if (!Directory.Exists(from) && Directory.Exists(to)) return;
                if (attempt >= 4)
                    throw new IOException("Cannot rename folder: " + from + "\nTo: " + to +
                        "\nClose terminals, running dev servers or other applications holding this folder and try again.\n" + ex.Message, ex);
            }
            await Task.Delay(250 * (attempt + 1));
        }
    }

    private sealed class WindowOwner : Forms.IWin32Window
    {
        public WindowOwner(IntPtr handle) { Handle = handle; }
        public IntPtr Handle { get; }
    }

    private sealed class RenameProgress : Forms.Form
    {
        private readonly Forms.Label _stage = new Forms.Label { Dock = Forms.DockStyle.Top, Height = 55, Padding = new Forms.Padding(12) };
        private readonly Forms.Label _elapsed = new Forms.Label { Dock = Forms.DockStyle.Bottom, Height = 28, Padding = new Forms.Padding(12, 0, 0, 0) };
        private readonly Forms.Timer _timer = new Forms.Timer { Interval = 1000 };
        private readonly Stopwatch _watch = Stopwatch.StartNew();
        public RenameProgress()
        {
            Text = "Rename Angular Component — in progress";
            ClientSize = new Size(520, 110);
            FormBorderStyle = Forms.FormBorderStyle.FixedDialog;
            ControlBox = false;
            ShowInTaskbar = false;
            StartPosition = Forms.FormStartPosition.CenterParent;
            Controls.Add(new Forms.ProgressBar { Dock = Forms.DockStyle.Fill, Style = Forms.ProgressBarStyle.Marquee });
            Controls.Add(_stage);
            Controls.Add(_elapsed);
            _timer.Tick += (_, __) => _elapsed.Text = $"Elapsed: {(int)_watch.Elapsed.TotalSeconds}s";
            _timer.Start();
        }
        public void SetStage(string text) { _stage.Text = text; Refresh(); }
        protected override void OnFormClosing(Forms.FormClosingEventArgs e) { e.Cancel = true; base.OnFormClosing(e); }
        protected override void Dispose(bool disposing) { if (disposing) _timer.Dispose(); base.Dispose(disposing); }
    }

    public sealed class DirectoryRequest
    {
        public string operation { get; set; }
        public string from { get; set; }
        public string to { get; set; }
    }

    public sealed class RenamePlan
    {
        public string root { get; set; }
        public string selected { get; set; }
        public DirectoryMove directory { get; set; }
        public List<RenameEntry> entries { get; set; }
    }

    public sealed class DirectoryMove
    {
        public string from { get; set; }
        public string to { get; set; }
    }

    public sealed class RenameEntry
    {
        public string from { get; set; }
        public string to { get; set; }
    }
}
