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

            var script = Path.Combine(Path.GetDirectoryName(typeof(RenameComponentCommand).Assembly.Location), "Rename", "rename.cjs");
            var json = await RunNodeAsync(script, Quote(selected) + " " + Quote(name));
            var serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            var plan = serializer.Deserialize<RenamePlan>(json);
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
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
                    if (entry == null) continue;
                    document.Close(vsSaveChanges.vsSaveChangesNo);
                    reopened.Add(entry);
                }
                await RunNodeAsync(script, "--apply", json);
            }
            finally
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
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
        finally { _running = false; }
    }

    private static bool InWorkspace(string root, string file) => file != null &&
        Path.GetFullPath(file).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

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

    private static async System.Threading.Tasks.Task<string> RunNodeAsync(string script, string arguments, string input = null)
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
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (input != null)
                {
                    var bytes = Encoding.UTF8.GetBytes(input);
                    await process.StandardInput.BaseStream.WriteAsync(bytes, 0, bytes.Length);
                }
                process.StandardInput.Close();
                var result = await output;
                var message = await error;
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(message);
                return result;
            }
        });
    }

    public sealed class RenamePlan
    {
        public string root { get; set; }
        public string selected { get; set; }
        public List<RenameEntry> entries { get; set; }
    }

    public sealed class RenameEntry
    {
        public string from { get; set; }
        public string to { get; set; }
    }
}
