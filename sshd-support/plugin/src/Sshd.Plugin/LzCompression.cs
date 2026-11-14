using LzSharp;
using Tkvsc.Plugins;

namespace Tkvsc.Sshd;

/// <summary>
/// Nintendo LZ, as on every <c>.LZ</c> file in the game. The host asks about every file it reads, not only ones named <c>.LZ</c>,
/// and LZ has only a one-byte marker, so a file is taken as compressed only when its header also gives a believable size.
/// </summary>
internal sealed class LzCompression : ICompressionBackend
{
    // Far above anything in the game; a raw file that happens to start with 0x10 or 0x11 usually claims more.
    private const int MaxDecompressedSize = 256 << 20;

    public bool IsCompressed(ReadOnlySpan<byte> data)
    {
        if (!Lz.IsCompressed(data)) return false;
        try
        {
            int size = Lz.GetDecompressedSize(data);
            return size is > 0 and <= MaxDecompressedSize;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    public byte[] Decompress(byte[] data, string logicalPath) => Lz.Decompress(data);

    // Every compressed file in the game is LZ11.
    public byte[] Compress(byte[] data, string logicalPath) => Lz.Compress(data, LzType.Lz11);
}
