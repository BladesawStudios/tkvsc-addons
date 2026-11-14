using JParticleSharp;
using Tkvsc.Plugins;

namespace Tkvsc.Sshd;

/// <summary>The <c>jpc</c> kind: particle containers as the YAML <see cref="JpaText"/> describes.</summary>
internal sealed class JpcFormat : IFormatHandler
{
    public string Read(byte[] data, string logicalPath) => JpaText.ToText(JpacFile.FromBinary(data));

    public byte[] Write(byte[] original, string text, string logicalPath)
    {
        // Textures can't be written as text, so they come from the original; a new file has none.
        JpacFile file = original.Length > 0 ? JpacFile.FromBinary(original) : new JpacFile();
        JpaText.Apply(file, text);
        return file.Write();
    }

    public bool Matches(ReadOnlySpan<byte> data) => JpacFile.IsJpac(data);
}

/// <summary>The <c>jpn</c> kind: the table beside a particle container.</summary>
internal sealed class JpnFormat : IFormatHandler
{
    public string Read(byte[] data, string logicalPath) => JpnText.ToText(JpnFile.FromBinary(data));

    public byte[] Write(byte[] original, string text, string logicalPath) => JpnText.Parse(text).Write();
}
