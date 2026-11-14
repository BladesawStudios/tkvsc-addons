using Tkvsc.Plugins;
using U8Sharp;

namespace Tkvsc.Sshd;

/// <summary>U8 archives (<c>.arc</c>, and <c>.arc.LZ</c> once the host removes the LZ). Folders such as <c>oarc/</c> are paths inside.</summary>
internal sealed class U8ArchiveFormat : IArchiveFormat
{
    public bool Matches(ReadOnlySpan<byte> data) => U8File.IsU8(data);

    public IReadOnlyList<ArchiveFile> Read(byte[] data, string logicalPath)
        => [.. U8File.FromBinary(data).Entries.Select(entry => new ArchiveFile(entry.Path, entry.Data))];

    public byte[] Write(IReadOnlyList<ArchiveFile> files, byte[] original, string logicalPath)
    {
        // Keep the root node's name; everything else is rebuilt from the file list.
        U8File archive = new() { RootName = U8File.IsU8(original) ? U8File.FromBinary(original).RootName : "." };
        foreach (ArchiveFile file in files) archive.Entries.Add(new U8Entry(file.Name, file.Data));
        return archive.Write();
    }
}
