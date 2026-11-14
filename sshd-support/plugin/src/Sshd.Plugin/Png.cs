using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace Tkvsc.Sshd;

/// <summary>Writes RGBA8 pixels as a PNG, for the add-on's viewers.</summary>
public static class Png
{
    private static readonly uint[] CrcTable = BuildCrcTable();

    public static byte[] FromRgba8(ReadOnlySpan<byte> rgba, int width, int height)
    {
        int stride = width * 4;
        if (rgba.Length < stride * height) throw new ArgumentException($"{width}x{height} RGBA8 needs {stride * height} bytes, not {rgba.Length}.", nameof(rgba));

        using MemoryStream png = new();
        png.Write([0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A]);

        byte[] header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = 8; // bit depth
        header[9] = 6; // RGBA
        WriteChunk(png, "IHDR", header);

        using MemoryStream pixels = new();
        using (ZLibStream zlib = new(pixels, CompressionLevel.Fastest, leaveOpen: true))
        {
            for (int y = 0; y < height; y++)
            {
                zlib.WriteByte(0); // no filter
                zlib.Write(rgba.Slice(y * stride, stride));
            }
        }
        WriteChunk(png, "IDAT", pixels.ToArray());
        WriteChunk(png, "IEND", []);
        return png.ToArray();
    }

    private static void WriteChunk(Stream output, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> word = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(word, data.Length);
        output.Write(word);

        byte[] typeBytes = Encoding.ASCII.GetBytes(type);
        output.Write(typeBytes);
        output.Write(data);

        uint crc = Crc(0xFFFFFFFF, typeBytes);
        crc = Crc(crc, data) ^ 0xFFFFFFFF;
        BinaryPrimitives.WriteUInt32BigEndian(word, crc);
        output.Write(word);
    }

    private static uint Crc(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (byte b in data) crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
        return crc;
    }

    private static uint[] BuildCrcTable()
    {
        uint[] table = new uint[256];
        for (uint n = 0; n < 256; n++)
        {
            uint c = n;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
            table[n] = c;
        }
        return table;
    }
}
