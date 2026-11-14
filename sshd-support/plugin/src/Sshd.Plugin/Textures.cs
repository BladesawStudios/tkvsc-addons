using BresSharp;
using JParticleSharp;
using TexSharp;
using XtxSharp;

namespace Tkvsc.Sshd;

/// <summary>One texture a file holds, decoded on demand. <see cref="Problem"/> says why one can't be shown.</summary>
public sealed record TextureEntry(string Name, int Width, int Height, string Format, int Levels, Func<byte[]>? Rgba, string? Problem = null);

/// <summary>
/// The textures in an XTX, TPL, BTI or BRES file. XTX holds the HD pixels for a model's TEX0s, which stay in the BRES as
/// slots: the two pair by order (every pair in the game does), so either file names or fills the other.
/// </summary>
public static class Textures
{
    public static List<TextureEntry> Load(string fileName, byte[] data, byte[]? sibling)
    {
        if (XtxFile.IsXtx(data)) return FromXtx(XtxFile.FromBinary(data), sibling is not null && BresFile.IsBres(sibling) ? BresFile.FromBinary(sibling) : null);
        if (BresFile.IsBres(data)) return FromBres(BresFile.FromBinary(data), sibling is not null && XtxFile.IsXtx(sibling) ? XtxFile.FromBinary(sibling) : null);
        if (Tpl.IsTpl(data)) return [.. Tpl.Read(data).Select((image, i) => FromGx($"image {i}", image))];
        if (JpacFile.IsJpac(data)) return [.. JpacFile.FromBinary(data).Textures.Select(texture => FromGx(texture.Name, texture.Image))];
        if (Path.GetExtension(fileName).Equals(".bti", StringComparison.OrdinalIgnoreCase)) return [FromGx(Path.GetFileNameWithoutExtension(fileName), Bti.Read(data))];
        throw new InvalidDataException($"{fileName} isn't an XTX, TPL, BTI, BRES or JPC file.");
    }

    private static List<TextureEntry> FromXtx(XtxFile xtx, BresFile? names)
    {
        IReadOnlyList<BresSubfile> slots = names?.XtxTextureSlots ?? [];
        return [.. xtx.Textures.Select((texture, i) => FromXtxTexture(i < slots.Count ? slots[i].Name : $"texture {i}", texture))];
    }

    private static List<TextureEntry> FromBres(BresFile bres, XtxFile? hd)
    {
        List<TextureEntry> entries = [];
        IReadOnlyList<BresSubfile> slots = bres.XtxTextureSlots;
        foreach (BresSubfile subfile in bres["Textures(NW4R)"]?.Files ?? [])
        {
            Tex0Texture tex0 = new(subfile);
            if (tex0.UsesXtx)
            {
                int slot = IndexOf(slots, subfile);
                entries.Add(hd is not null && slot < hd.Textures.Count
                    ? FromXtxTexture(tex0.Name, hd.Textures[slot])
                    : new TextureEntry(tex0.Name, 0, 0, "XTX", 0, null, "Its pixels are in the .xtx beside this file, which wasn't found."));
                continue;
            }

            GxFormat format = (GxFormat)tex0.GxFormat;
            byte[] palette = [];
            GxPaletteFormat paletteFormat = GxPaletteFormat.IA8;
            if (tex0.IsPaletted)
            {
                if (bres["Palettes(NW4R)"]?[tex0.Name] is not { } plt0)
                {
                    entries.Add(new TextureEntry(tex0.Name, tex0.Width, tex0.Height, format.ToString(), tex0.LevelCount, null, "Its palette (a PLT0 of the same name) is missing."));
                    continue;
                }
                Plt0Palette plt = new(plt0);
                palette = plt.Data.ToArray();
                paletteFormat = (GxPaletteFormat)plt.GxPaletteFormat;
            }

            byte[] data = tex0.Data.ToArray();
            int width = tex0.Width, height = tex0.Height;
            entries.Add(new TextureEntry(tex0.Name, width, height, format.ToString(), tex0.LevelCount,
                () => GxTexture.ToRgba8(format, data, width, height, palette, paletteFormat)));
        }
        return entries;
    }

    private static TextureEntry FromXtxTexture(string name, XtxTexture texture)
        => texture.Format is { } format
            ? new TextureEntry(name, (int)texture.Width, (int)texture.Height, format.ToString(), (int)texture.MipCount, () => texture.ToRgba8())
            : new TextureEntry(name, (int)texture.Width, (int)texture.Height, $"NVN 0x{texture.NvnFormat:X}", (int)texture.MipCount, null, "Its format isn't supported.");

    private static TextureEntry FromGx(string name, GxImage image)
        => new(name, image.Width, image.Height, image.Format.ToString(), image.LevelCount, () => image.ToRgba8());

    private static int IndexOf(IReadOnlyList<BresSubfile> slots, BresSubfile subfile)
    {
        for (int i = 0; i < slots.Count; i++)
            if (ReferenceEquals(slots[i], subfile)) return i;
        return -1;
    }
}
