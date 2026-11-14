using MsbtSharp;
using Tkvsc.Plugins;

namespace Tkvsc.Sshd;

/// <summary>The <c>msbf</c> kind: message flows as the text <see cref="MsbfText"/> describes.</summary>
internal sealed class MsbfFormat : IFormatHandler
{
    public string Read(byte[] data, string logicalPath) => MsbfText.ToText(MsbfFile.FromBinary(data));

    public byte[] Write(byte[] original, string text, string logicalPath)
    {
        // Start from the original so its header and section layout survive; a new file gets the game's defaults.
        MsbfFile file = original.Length > 0 ? MsbfFile.FromBinary(original) : new MsbfFile { EntrySlotCount = 19 };
        MsbfText.Apply(file, text);
        return file.ToBinary();
    }

    public bool Matches(ReadOnlySpan<byte> data) => MsbfFile.IsMsbf(data);
}
