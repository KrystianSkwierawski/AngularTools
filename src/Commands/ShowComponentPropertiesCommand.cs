using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace AngularTools.Commands;

/// <summary>
/// Show properties of the component in a dialog and insert selected property into the template
/// </summary>
[Command(PackageIds.ShowComponentPropertiesCommand)]
internal sealed class ShowComponentPropertiesCommand : AbstractBaseCommand<ShowComponentPropertiesCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var document = await GetActiveDocumentAsync();

        if (string.IsNullOrEmpty(document.FullName) || !document.FullName.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            ActivityLog.LogInformation(Source, "Not a component template");

            return;
        }

        var fullName = Path.ChangeExtension(document.FullName, ".ts");

        if (!IsDocumentValid(fullName))
        {
            return;
        }

        var properties = GetProperties(fullName);

        if (properties.Count == 0)
        {
            ActivityLog.LogInformation(Source, "Not found properties");

            return;
        }

        new PropertiesForm().Show(properties, selected =>
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            var sel = document.TextSelection;
            sel?.Insert(selected);
        });
    }

    private static IList<string> GetProperties(string filePath)
        => GetProperties(filePath, new HashSet<string>(StringComparer.OrdinalIgnoreCase));

    private static IList<string> GetProperties(string filePath, HashSet<string> ancestors)
    {
        var result = new List<string>();
        var imports = new Dictionary<string, string>();
        filePath = Path.GetFullPath(filePath);

        if (!File.Exists(filePath) || ancestors.Contains(filePath))
        {
            return result;
        }
        // Each branch owns its ancestor set so sibling properties of the same
        // type are expanded independently, while recursive types terminate.
        var branch = new HashSet<string>(ancestors, StringComparer.OrdinalIgnoreCase) { filePath };

        foreach (var line in File.ReadLines(filePath))
        {
            var value = line.Replace(" ", string.Empty);

            var importMatch = Regex.Match(value, @"^import{(?<types>.*)}from'(?<path>.*)';$");

            if (importMatch.Success)
            {
                var importTypes = importMatch.Groups["types"].Value;
                var importPath = importMatch.Groups["path"].Value;

                foreach (var type in importTypes.Split(','))
                {
                    if (!imports.ContainsKey(type))
                    {
                        imports.Add(type, importPath);
                    }
                }

                continue;
            }

            // Match the original declaration: removing whitespace first merges
            // modifiers into the identifier (e.g. public title -> publictitle).
            var propertyMatch = Regex.Match(line,
                @"^\s*(?:(?<modifier>public|protected|private|readonly|static|declare|abstract|override)\s+)*(?<name>[\p{L}_$][\p{L}\p{N}_$]*)[!?]?\s*:\s*(?<type>[\p{L}_$][\p{L}\p{N}_$]*)\s*(?:=[^;]*)?;\s*(?://.*)?$");

            if (!propertyMatch.Success)
            {
                continue;
            }
            if (propertyMatch.Groups["modifier"].Captures.Cast<Capture>()
                .Any(c => c.Value is "private" or "protected" or "static"))
            {
                continue;
            }

            var propertyName = propertyMatch.Groups["name"].Value;
            var propertyType = propertyMatch.Groups["type"].Value;

            if (imports.TryGetValue(propertyType, out var import))
            {
                string path = Path.IsPathRooted(import)
                    ? Path.GetFullPath(import)
                    : Path.GetFullPath(Path.Combine(Path.GetDirectoryName(filePath), import));

                var properties = GetProperties($"{path}.ts", branch);

                foreach (var property in properties)
                {
                    result.Add($"{propertyName}.{property}");
                }

                result.Add(propertyName);
            }

            if (propertyType is "number" or "string" or "boolean" or "any")
            {
                result.Add(propertyName);
            }
        }

        return result;
    }

    private class PropertiesForm : Form
    {
        public void Show(IList<string> properties, Action<string> onInsert)
        {
            Text = "Component Properties";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(420, 400);
            MaximizeBox = false;
            MinimizeBox = false;

            var listBox = new ListBox
            {
                Dock = DockStyle.Top,
                Height = 400
            };

            listBox.Items.AddRange(new HashSet<string>(properties).ToArray());

            listBox.DoubleClick += (s, e) =>
            {
                if (listBox.SelectedItem is string sel)
                {
                    onInsert(sel);

                    DialogResult = DialogResult.OK;
                    Close();
                }
            };

            Controls.Add(listBox);

            KeyPreview = true;
            KeyDown += (s, e) =>
            {
                if (e.KeyCode == Keys.Escape)
                {
                    Close();
                    e.Handled = true;
                }
            };

            listBox.SelectedIndex = listBox.Items.Count > 0 ? 0 : -1;

            ShowDialog();
        }
    }
}
