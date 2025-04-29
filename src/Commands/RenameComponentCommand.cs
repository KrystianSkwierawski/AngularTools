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

        if (!IsDocumentValid(document.FullName) || !document.Name.EndsWith(".component.ts"))
        {
            return;
        }

        var newComponentName = Interaction.InputBox("Enter the new component name:", "Rename Angular Component", document.Name);

        if (string.IsNullOrWhiteSpace(newComponentName) || document.Name == newComponentName || !newComponentName.EndsWith(".component.ts"))
        {
            return;
        }

        await RenameComponentAsync(document, newComponentName);
    }

    private async Task RenameComponentAsync(ActiveDocument document, string newComponentName)
    {
        await Task.WhenAll
        (
            RenameClassNameAsync(document.Name, newComponentName),
            AdjustAttributesAsync(document.Name, newComponentName),
            AdjustPathsAsync(document.Name, newComponentName),
            AdjustSelectorsAsync(document.Name, newComponentName)
        );

        await SaveActiveDocumentAsync();
        RenameFilesAndDirectory(document, newComponentName);
    }

    private async Task RenameClassNameAsync(string oldName, string newName)
    {
        var find = GetClassName(oldName);
        var replace = GetClassName(newName);

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.ts");
        ActivityLog.LogInformation(Source, "Renamed class name");
    }

    private async Task AdjustAttributesAsync(string oldName, string newName)
    {
        var oldBaseName = Path.GetFileNameWithoutExtension(oldName);
        var newBaseName = Path.GetFileNameWithoutExtension(newName);

        await Task.WhenAll
        (
            FindAndReplaceAsync($"{oldBaseName}.html", $"{newBaseName}.html", vsFindTarget.vsFindTargetCurrentProject, "*.ts"),
            FindAndReplaceAsync($"{oldBaseName}.scss", $"{newBaseName}.scss", vsFindTarget.vsFindTargetCurrentProject, "*.ts")
        );

        ActivityLog.LogInformation(Source, "Adjusted attributes");
    }

    private async Task AdjustPathsAsync(string oldName, string newName)
    {
        var find = GetComponentPath(oldName);
        var replace = GetComponentPath(newName);

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.ts");
        ActivityLog.LogInformation(Source, "Adjusted paths");
    }

    private async Task AdjustSelectorsAsync(string oldName, string newName)
    {
        var find = GetComponentSelector(oldName);
        var replace = GetComponentSelector(newName);

        await FindAndReplaceAsync(find, replace, vsFindTarget.vsFindTargetCurrentProject, "*.html;*.ts");
        ActivityLog.LogInformation(Source, "Adjusted selectors");
    }

    private void RenameFilesAndDirectory(ActiveDocument document, string newName)
    {
        RenameFiles(document, newName);
        RenameDirectory(document, newName);
    }

    private static void RenameFiles(ActiveDocument document, string newName)
    {
        var oldBaseName = Path.GetFileNameWithoutExtension(document.Name);
        var newBaseName = Path.GetFileNameWithoutExtension(newName);

        foreach (var extension in new[] { ".html", ".ts", ".spec.ts", ".scss" })
        {
            var oldPath = $"{document.Path}{oldBaseName}{extension}";

            if (IsDocumentValid(oldPath))
            {
                Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(oldPath, $"{newBaseName}{extension}");
            }
        }

        ActivityLog.LogInformation(Source, "Renamed files");
    }

    private static void RenameDirectory(ActiveDocument document, string newName)
    {
        var oldDirName = document.Name.Split('.')[0];
        var newDirName = newName.Split('.')[0];

        Directory.Move
        (
            document.Path,
            document.Path.Replace(oldDirName, newDirName)
        );

        ActivityLog.LogInformation(Source, "Renamed directory");
    }

    private static string GetClassName(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        var parts = name.Split(['-', '.'], StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(parts.Select(part => CultureInfo.CurrentCulture.TextInfo.ToTitleCase(part)));
    }

    private static string GetComponentPath(string fileName)
    {
        var baseName = Path.GetFileNameWithoutExtension(fileName).Replace(".component", string.Empty);
        return $"{baseName}/{Path.GetFileNameWithoutExtension(fileName)}";
    }

    private static string GetComponentSelector(string fileName)
    {
        return $"app-{fileName.Split('.')[0]}";
    }
}
