using System.Globalization;
using System.Text;
using MsbtSharp;

namespace Tkvsc.Sshd;

/// <summary>
/// MSBP message projects as editable text: the colour table and its labels. MsbtSharp reads only those two sections; any
/// others, and the header, are kept from the original file. Skyward Sword HD's <c>main.msbp</c> has just the colours.
/// </summary>
public static class MsbpText
{
    private static readonly string Header =
        """
        # Skyward Sword HD message project: the colours messages pick by number.
        # Colours are "#RRGGBBAA". Labels, if any, name a colour by its number.

        """;

    public static string ToText(MsbpFile file)
    {
        StringBuilder text = new(Header);

        text.Append("\ncolors:\n");
        for (int i = 0; i < file.Colors.Count; i++)
            text.Append("  ").Append(i.ToString(CultureInfo.InvariantCulture)).Append(": \"").Append(file.Colors[i]).Append("\"\n");

        if (file.ColorLabels.Count > 0)
        {
            text.Append("\nlabels:\n");
            foreach (MsbLabel label in file.ColorLabels)
                text.Append("  ").Append(label.Name).Append(": ").Append(label.Index.ToString(CultureInfo.InvariantCulture)).Append('\n');
        }

        return text.ToString();
    }

    /// <summary>Replaces the colours and colour labels of <paramref name="file"/> with those in <paramref name="text"/>.</summary>
    public static void Apply(MsbpFile file, string text)
    {
        List<MsbpColor> colors = [];
        List<MsbLabel> labels = [];
        string? section = null;

        string[] lines = text.TrimStart('﻿').Replace("\r\n", "\n").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            int number = i + 1;
            string line = lines[i];
            string trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;

            if (!char.IsWhiteSpace(line[0]))
            {
                section = trimmed switch
                {
                    "colors:" => "colors",
                    "labels:" => "labels",
                    _ => throw Error(number, $"expected 'colors:' or 'labels:', not '{trimmed}'."),
                };
                continue;
            }

            int colon = section == "labels" ? trimmed.LastIndexOf(": ", StringComparison.Ordinal) : trimmed.IndexOf(':');
            if (colon <= 0) throw Error(number, section == "labels" ? "should be 'Label: color'." : "should be 'N: \"#RRGGBBAA\"'.");
            string key = trimmed[..colon].Trim(), value = trimmed[(colon + 1)..].Trim();

            switch (section)
            {
                case "colors":
                    int index = ParseNumber(key, number, "color number");
                    if (index != colors.Count) throw Error(number, $"is color {index}, but color {colors.Count} comes next. Colors are numbered from 0 in order.");
                    colors.Add(ParseColor(value, number));
                    break;
                case "labels":
                    if (Encoding.UTF8.GetByteCount(key) > byte.MaxValue) throw Error(number, $"the label '{key}' is longer than 255 bytes.");
                    labels.Add(new MsbLabel(key, ParseNumber(value, number, "label's color")));
                    break;
                default:
                    throw Error(number, "is indented but isn't under 'colors:' or 'labels:'.");
            }
        }

        if (labels.GroupBy(l => l.Name).FirstOrDefault(g => g.Count() > 1) is { } duplicate)
            throw new FormatException($"The label '{duplicate.Key}' is listed twice.");
        if (labels.FirstOrDefault(l => l.Index >= colors.Count) is { } bad)
            throw new FormatException($"The label '{bad.Name}' names color {bad.Index}, but there are {colors.Count} colors.");

        file.Colors.Clear();
        file.Colors.AddRange(colors);
        file.ColorLabels.Clear();
        file.ColorLabels.AddRange(labels);
    }

    private static MsbpColor ParseColor(string value, int number)
    {
        string hex = value.Trim('"', '\'');
        if (hex.StartsWith('#')) hex = hex[1..];
        if (hex.Length == 6) hex += "FF";
        if (hex.Length != 8 || !uint.TryParse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out uint rgba))
            throw Error(number, $"'{value}' isn't a color; write \"#RRGGBBAA\" or \"#RRGGBB\".");
        return new MsbpColor((byte)(rgba >> 24), (byte)(rgba >> 16), (byte)(rgba >> 8), (byte)rgba);
    }

    private static int ParseNumber(string text, int number, string what)
        => int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out int value) ? value : throw Error(number, $"{what} '{text}' isn't a number.");

    private static FormatException Error(int line, string message) => new($"Line {line}: {message}");
}
