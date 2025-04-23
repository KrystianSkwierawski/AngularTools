using System.Globalization;
using System.IO;
using System.Linq;
using EnvDTE;
using Microsoft.VisualBasic;

namespace AngularTools;

/// <summary>
/// Rename component
/// </summary>
[Command(PackageIds.RenameComponentCommand)]
internal sealed class RenameComponentCommand : AbstractBaseCommand<RenameComponentCommand>
{
    protected override async Task RunCommandAsync(OleMenuCmdEventArgs e)
    {
        var document = await GetActiveDocumentAsync();

        if (IsDocumentValid(document.FullName) && document.Name.EndsWith(".component.ts"))
        {
            var input = Interaction.InputBox("Enter the new component name:", "Rename Angular Component", document.Name);

            if (document.Name == input || !input.EndsWith(".component.ts"))
            {
                return;
            }

            await Task.WhenAll
            (
                RenameClassNameAsync(document.Name, input),
                AdjustAttributesAsync(document.Name, input),
                AdjustPathsAsync(document.Name, input),
                AdjustSelectorsAsync(document.Name, input)
            );

            await SaveActiveDocumentAsync();
            RenameFiles(document, input);
            RenameDir(document, input);
        }
    }

    private async Task RenameClassNameAsync(string documentName, string input)
    {
        var find = GetClassName(documentName);
        var replace = GetClassName(input);

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.ts");
        ActivityLog.LogInformation(Source, "Renamed class name");
    }

    private async Task AdjustAttributesAsync(string documentName, string input)
    {
        var oldName = Path.GetFileNameWithoutExtension(documentName);
        var newName = Path.GetFileNameWithoutExtension(input);

        await Task.WhenAll
        (
            FindAndReplaceAsync($"{oldName}.html", $"{newName}.html", vsFindTarget.vsFindTargetCurrentProject, "*.ts"),
            FindAndReplaceAsync($"{oldName}.scss", $"{newName}.scss", vsFindTarget.vsFindTargetCurrentProject, "*.ts")
        );

        ActivityLog.LogInformation(Source, "Adjusted attributes");
    }

    private async Task AdjustPathsAsync(string documentName, string input)
    {
        var oldName = Path.GetFileNameWithoutExtension(documentName);
        var newName = Path.GetFileNameWithoutExtension(input);
        var find = $"{oldName.Replace(".component", string.Empty)}/{oldName}";
        var replace = $"{newName.Replace(".component", string.Empty)}/{newName}";

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.ts");
        ActivityLog.LogInformation(Source, "Adjusted paths");
    }

    private async Task AdjustSelectorsAsync(string documentName, string input)
    {
        var oldComponentName = documentName.Split('.')[0];
        var newComponentName = input.Split('.')[0];
        var find = $"app-{oldComponentName}";
        var replace = $"app-{newComponentName}";

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.html;*.ts");

        ActivityLog.LogInformation(Source, "Adjusted selectors");
    }

    private static void RenameFiles(ActiveDocument document, string input)
    {
        var oldName = Path.GetFileNameWithoutExtension(document.Name);
        var newName = Path.GetFileNameWithoutExtension(input);

        foreach (var extension in new[] { ".html", ".ts", ".spec.ts", ".scss" })
        {
            var oldPath = $"{document.Path}{oldName}{extension}";

            if (IsDocumentValid(oldPath))
            {
                Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(oldPath, $"{newName}{extension}");
            }
        }

        ActivityLog.LogInformation(Source, "Renamed files");
    }

    private static void RenameDir(ActiveDocument document, string input)
    {
        Directory.Move
        (
            document.Path,
            document.Path.Replace(document.Name.Split('.')[0], input.Split('.')[0])
        );

        ActivityLog.LogInformation(Source, "Renamed dir");
    }

    private string GetClassName(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        var parts = name.Split(['-', '.'], StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select(part => CultureInfo.CurrentCulture.TextInfo.ToTitleCase(part)));
    }
}