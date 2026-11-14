using MsbtSharp;
using Tkvsc.Plugins;

namespace Tkvsc.Sshd;

/// <summary>The <c>msbp</c> kind: message projects as the text <see cref="MsbpText"/> describes.</summary>
internal sealed class MsbpFormat : IFormatHandler
{
    public string Read(byte[] data, string logicalPath) => MsbpText.ToText(MsbpFile.FromBinary(data));

    public byte[] Write(byte[] original, string text, string logicalPath)
    {
        // Start from the original so its header and the sections MsbtSharp doesn't read survive.
        MsbpFile file = original.Length > 0 ? MsbpFile.FromBinary(original) : new MsbpFile();
        MsbpText.Apply(file, text);
        return file.ToBinary();
    }

    public bool Matches(ReadOnlySpan<byte> data) => MsbpFile.IsMsbp(data);
}
