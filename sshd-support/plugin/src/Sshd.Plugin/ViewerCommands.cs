using System.Text.Json;
using System.Text.Json.Nodes;
using BrFontSharp;
using Tkvsc.Plugins;

namespace Tkvsc.Sshd;

/// <summary>
/// Host commands behind the add-on's texture and font viewers. The add-on sends the file (and for textures, its .xtx or
/// .brres sibling) on standard input as JSON with base64 bytes, so these work wherever the add-on can read the file.
/// </summary>
internal static class ViewerCommands
{
    public static void Register(IPluginBuilder builder)
    {
        IPluginHost host = builder.Host;
        builder.AddCommand("sshd-textures", command => TexturesCommand(host, command));
        builder.AddCommand("sshd-font", command => FontCommand(host, command));
    }

    // sshd-textures            -> the list of textures
    // sshd-textures <index>    -> one texture as a PNG
    private static JsonNode TexturesCommand(IPluginHost host, IPluginCommand command)
    {
        Input input = Input.Read(host, command);
        List<TextureEntry> textures = Textures.Load(input.Name, input.Data, input.Sibling);

        if (command.Args.Count == 0)
        {
            return new JsonObject
            {
                ["textures"] = new JsonArray([.. textures.Select(t => (JsonNode)new JsonObject
                {
                    ["name"] = t.Name,
                    ["width"] = t.Width,
                    ["height"] = t.Height,
                    ["format"] = t.Format,
                    ["levels"] = t.Levels,
                    ["problem"] = t.Problem,
                })]),
            };
        }

        int index = int.Parse(command.Args[0]);
        if ((uint)index >= textures.Count) throw new ArgumentOutOfRangeException(nameof(index), $"There are {textures.Count} textures.");
        TextureEntry texture = textures[index];
        if (texture.Rgba is null) throw new InvalidOperationException(texture.Problem ?? $"{texture.Name} can't be shown.");
        return new JsonObject { ["png"] = Convert.ToBase64String(Png.FromRgba8(texture.Rgba(), texture.Width, texture.Height)) };
    }

    // sshd-font                -> the font's metrics and glyph table
    // sshd-font sheets 0,3,5   -> those glyph sheets as PNGs (an archived font can have dozens)
    private static JsonNode FontCommand(IPluginHost host, IPluginCommand command)
    {
        Input input = Input.Read(host, command);
        BrfntFile font = BrfntFile.FromBinary(input.Data);
        GlyphSheets sheets = font.Sheets;

        if (command.Args is ["sheets", string list])
        {
            JsonObject pngs = [];
            foreach (int sheet in list.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).Distinct())
            {
                if ((uint)sheet >= sheets.SheetCount) throw new ArgumentOutOfRangeException(nameof(sheet), $"The font has {sheets.SheetCount} sheets.");
                pngs[sheet.ToString()] = Convert.ToBase64String(Png.FromRgba8(sheets.SheetToRgba8(sheet), sheets.SheetWidth, sheets.SheetHeight));
            }
            return new JsonObject { ["sheets"] = pngs };
        }

        JsonArray glyphs = [];
        foreach ((int code, int index) in font.AllCodes())
        {
            Glyph? glyph = font.GetGlyph(code);
            if (glyph is null || glyph.Index != index) continue;
            glyphs.Add(new JsonArray(code, glyph.Sheet, glyph.X, glyph.Y, (int)glyph.Width.Left, (int)glyph.Width.GlyphWidth, (int)glyph.Width.Width));
        }

        return new JsonObject
        {
            ["kind"] = font.Magic,
            ["lineFeed"] = (int)font.Info.LineFeed,
            ["height"] = (int)font.Info.Height,
            ["width"] = (int)font.Info.Width,
            ["ascent"] = (int)font.Info.Ascent,
            ["encoding"] = (int)font.Info.Encoding,
            ["cellWidth"] = (int)sheets.CellWidth,
            ["cellHeight"] = (int)sheets.CellHeight,
            ["baseline"] = (int)sheets.BaselinePos,
            ["maxCharWidth"] = (int)sheets.MaxCharWidth,
            ["sheetWidth"] = (int)sheets.SheetWidth,
            ["sheetHeight"] = (int)sheets.SheetHeight,
            ["sheetFormat"] = sheets.Format.ToString(),
            ["sheetCount"] = (int)sheets.SheetCount,
            ["compressed"] = sheets.Compressed,
            // [code, sheet, x, y, left, glyphWidth, advance]
            ["glyphs"] = glyphs,
        };
    }

    private sealed record Input(string Name, byte[] Data, byte[]? Sibling)
    {
        public static Input Read(IPluginHost host, IPluginCommand command)
        {
            JsonObject json = JsonNode.Parse(command.StdinText.TrimStart('﻿')) as JsonObject ?? throw new JsonException("Expected a JSON object on standard input.");
            string name = (string?)json["name"] ?? "";
            byte[] data = host.Decompress(Convert.FromBase64String((string?)json["data"] ?? ""), name);
            byte[]? sibling = json["sibling"] is { } s && (string?)s is { Length: > 0 } text
                ? host.Decompress(Convert.FromBase64String(text), (string?)json["siblingName"] ?? "")
                : null;
            return new Input(name, data, sibling);
        }
    }
}
