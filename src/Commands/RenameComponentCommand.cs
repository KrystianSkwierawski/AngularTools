using System.IO;
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

        if (IsComponent(document.Name))
        {
            var input = Interaction.InputBox("Enter the new component name:", "Rename Angular Component", document.Name);

            if (document.Name == input)
            {
                return;
            }

            await Task.WhenAll
            (
                RenameClassNameAsync(),
                AdjustAttributesAsync(),
                AdjustPathsAsync(),
                AdjustSelectorsAsync()
            );

            RenameFiles(document, input);
            RenameDir(document, input);
        }
    }

    private async Task RenameClassNameAsync()
    {
        await FindAndReplaceAsync("TestAComponent", "TestBComponent", vsFindTarget.vsFindTargetCurrentProject, "*.ts");

        ActivityLog.LogInformation(Source, "Adjusted class name");
    }

    private async Task AdjustAttributesAsync()
    {
        await FindAndReplaceAsync("test-a.component.html", "test-b.component.html", vsFindTarget.vsFindTargetCurrentDocument, "*.ts");
        await FindAndReplaceAsync("test-a.scss", "test-b.scss", vsFindTarget.vsFindTargetCurrentDocument, "*.ts");

        ActivityLog.LogInformation(Source, "Adjusted attributes");
    }

    private async Task AdjustPathsAsync()
    {
        await FindAndReplaceAsync("test-a/test-a.component", "test-b/test-b.component", vsFindTarget.vsFindTargetCurrentProject, "*.ts");

        ActivityLog.LogInformation(Source, "Adjusted paths");
    }

    private async Task AdjustSelectorsAsync()
    {
        await FindAndReplaceAsync("<test-a", "<test-b", vsFindTarget.vsFindTargetCurrentProject, "*.html");
        await FindAndReplaceAsync("</test-a>", "</test-b>", vsFindTarget.vsFindTargetCurrentProject, "*.html");

        ActivityLog.LogInformation(Source, "Adjusted selectors");
    }
    private static void RenameFiles(ActiveDocument document, string input)
    {
        Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(document.FullName, input); // component.html
        Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(document.FullName, input); // component.ts
        Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(document.FullName, input); // component.scss
        Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(document.FullName, input); // component.spec.ts

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

    private static bool IsComponent(string document)
    {
        if (IsDocumentValid(document))
        {
            return false;
        }

        return document.EndsWith(".component.ts");
    }
}
