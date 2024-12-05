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

            // 1. Rename file
            Microsoft.VisualBasic.FileIO.FileSystem.RenameFile(document.FullName, input);

            // 2. Rename dir
            Directory.Move
            (
                document.Path,
                document.Path.Replace(document.Name.Split('.')[0], input.Split('.')[0])
            );

            // 3. Adjust class name, imports, attributes, selectors
            await FindAndReplaceAsync("AComponent", "BComponent");
            await FindAndReplaceAsync("selector: 'a'", "selector: 'b'");
            await FindAndReplaceAsync("a.component", "b.component");
            // get and replace selector
        }
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
